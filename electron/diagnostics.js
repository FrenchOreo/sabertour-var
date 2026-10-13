// Diagnostic RÉEL de l'ordinateur arbitre : uniquement des valeurs lues dans le système
// (Electron, Node `os`, outils du système d'exploitation), aucune estimation.
const { app, powerMonitor, dialog, shell } = require('electron');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { parseMacWifi, parseWindowsWifi } = require('./wifiParse');

const WIFI_REFRESH_MS = 20000;
const MAX_LOG_FILES = 15;

let prevCpu = cpuTimes();
let wifi = null;
let wifiAt = 0;
let wifiPending = false;
let lanIps = [];
let logFile = null;

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    for (const v of Object.values(c.times)) total += v;
    idle += c.times.idle;
  }
  return { idle, total };
}

/** Charge processeur de TOUTE la machine depuis le dernier appel (%) */
function systemCpuPct() {
  const now = cpuTimes();
  const dTotal = now.total - prevCpu.total;
  const dIdle = now.idle - prevCpu.idle;
  prevCpu = now;
  if (dTotal <= 0) return null;
  return Math.round((1 - dIdle / dTotal) * 1000) / 10;
}

/** Processeur et mémoire de SABER VAR, par type de processus (app.getAppMetrics) */
function appCpu() {
  const out = { totalPct: 0, gpuPct: 0, rendererPct: 0, browserPct: 0, otherPct: 0, memMB: 0 };
  for (const p of app.getAppMetrics()) {
    const pct = p.cpu ? p.cpu.percentCPUUsage : 0;
    out.totalPct += pct;
    if (p.type === 'GPU') out.gpuPct += pct;
    else if (p.type === 'Tab') out.rendererPct += pct;
    else if (p.type === 'Browser') out.browserPct += pct;
    else out.otherPct += pct;
    if (p.memory) out.memMB += p.memory.workingSetSize / 1024;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 10) / 10;
  return out;
}

function refreshWifi() {
  if (wifiPending || Date.now() - wifiAt < WIFI_REFRESH_MS) return;
  wifiPending = true;
  const done = (parsed) => {
    wifi = parsed;
    wifiAt = Date.now();
    wifiPending = false;
  };
  if (process.platform === 'darwin') {
    execFile('system_profiler', ['SPAirPortDataType', '-json'], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      done(err ? { error: String(err.message || err) } : parseMacWifi(stdout));
    });
  } else if (process.platform === 'win32') {
    execFile('netsh', ['wlan', 'show', 'interfaces'], { timeout: 10000 }, (err, stdout) => {
      done(err ? { error: String(err.message || err) } : parseWindowsWifi(stdout));
    });
  } else {
    done(null);
  }
}

/** Interface réseau qui porte l'adresse donnée aux téléphones : WiFi ou câble ? */
function lanInterface() {
  const ifaces = os.networkInterfaces();
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && lanIps.includes(a.address)) {
        const isWifi = wifi && wifi.interface ? wifi.interface === name : null;
        return { name, address: a.address, isWifi };
      }
    }
  }
  return null;
}

function getMetrics() {
  refreshWifi();
  let thermal = null;
  try { thermal = typeof powerMonitor.getCurrentThermalState === 'function' ? powerMonitor.getCurrentThermalState() : null; } catch { /* non supporté */ }
  let onBattery = null;
  try { onBattery = powerMonitor.isOnBatteryPower(); } catch { /* non supporté */ }
  return {
    t: Date.now(),
    platform: process.platform,
    cpuModel: os.cpus()[0] ? os.cpus()[0].model : null,
    cpuCount: os.cpus().length,
    systemCpuPct: systemCpuPct(),
    loadAvg1: process.platform === 'win32' ? null : Math.round(os.loadavg()[0] * 100) / 100,
    app: appCpu(),
    memFreeMB: Math.round(os.freemem() / 1048576),
    memTotalMB: Math.round(os.totalmem() / 1048576),
    thermal,
    onBattery,
    wifi,
    wifiAgeMs: wifiAt ? Date.now() - wifiAt : null,
    lan: lanInterface(),
    appVersion: app.getVersion(),
  };
}

function logsDir() {
  return path.join(app.getPath('userData'), 'diagnostics');
}

function ensureLogFile() {
  if (logFile) return logFile;
  const dir = logsDir();
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  logFile = path.join(dir, `session-${stamp}.jsonl`);
  // On garde les dernières sessions seulement
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('session-') && f.endsWith('.jsonl')).sort();
    for (const f of files.slice(0, Math.max(0, files.length - MAX_LOG_FILES))) fs.unlinkSync(path.join(dir, f));
  } catch { /* nettoyage best effort */ }
  fs.appendFileSync(logFile, JSON.stringify({ type: 'session', t: Date.now(), version: app.getVersion(), platform: process.platform, arch: process.arch, cpu: os.cpus()[0] && os.cpus()[0].model, cpus: os.cpus().length, memTotalMB: Math.round(os.totalmem() / 1048576) }) + '\n');
  return logFile;
}

function appendLog(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  const file = ensureLogFile();
  fs.appendFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

async function exportLog(win) {
  const file = ensureLogFile();
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Exporter le diagnostic',
    defaultPath: path.join(app.getPath('desktop'), `saber-var-diagnostic-${stamp}.jsonl`),
    filters: [{ name: 'Diagnostic SABER VAR', extensions: ['jsonl'] }],
  });
  if (canceled || !filePath) return null;
  fs.copyFileSync(file, filePath);
  shell.showItemInFolder(filePath);
  return filePath;
}

function openFolder() {
  fs.mkdirSync(logsDir(), { recursive: true });
  shell.openPath(logsDir());
}

function setLanIps(ips) {
  lanIps = Array.isArray(ips) ? ips : [];
}

module.exports = { getMetrics, appendLog, exportLog, openFolder, setLanIps, refreshWifi };
