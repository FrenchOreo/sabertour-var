const { app, BrowserWindow, dialog, ipcMain, shell, net, Menu } = require('electron');
const { startServer } = require('./server');
const path = require('path');
const fs = require('fs');

let mainWindow = null;
let serverInfo = null;
let lastRecordingFolder = null;

// ── Mise à jour : vérification sur GitHub Releases ──
// L'app n'est pas signée par un certificat Apple Developer, donc pas d'auto-update
// silencieux possible sur Mac (electron-updater l'exige). On prévient et on propose
// le téléchargement : ouvrir le .dmg / l'installateur, et c'est fait.

const GITHUB_REPO = 'FrenchOreo/sabertour-var';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** > 0 si a est plus récent que b (versions « x.y.z ») */
function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Le fichier de la release adapté à cette machine (Mac arm64/x64 → .dmg, Windows → .exe) */
function pickReleaseAsset(assets) {
  if (!Array.isArray(assets)) return null;
  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    return (
      assets.find((a) => a.name.endsWith('.dmg') && a.name.includes(`-${arch}`)) ||
      assets.find((a) => a.name.endsWith('.dmg')) ||
      null
    );
  }
  if (process.platform === 'win32') return assets.find((a) => a.name.endsWith('.exe')) || null;
  return assets.find((a) => a.name.endsWith('.AppImage')) || null;
}

/**
 * Vérifie si une version plus récente est publiée.
 * Silencieux hors ligne (le WiFi du tournoi n'a pas internet) ; `manual` (menu) affiche aussi « à jour ».
 */
async function checkForUpdates(manual = false) {
  if (!app.isPackaged && !manual) return;
  const win = mainWindow || undefined;
  try {
    const res = await net.fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `saber-var/${app.getVersion()}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const release = await res.json();
    const latest = String(release.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();

    if (!latest || compareVersions(latest, current) <= 0) {
      if (manual) {
        await dialog.showMessageBox(win, { type: 'info', message: `SABER VAR ${current} est à jour.`, buttons: ['OK'] });
      }
      return;
    }

    const asset = pickReleaseAsset(release.assets);
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Mise à jour disponible',
      message: `SABER VAR ${latest} est disponible (version installée : ${current}).`,
      detail:
        process.platform === 'darwin'
          ? "Cliquez sur Télécharger, ouvrez le fichier .dmg puis glissez SABER VAR dans Applications (remplacer l'ancienne version)."
          : "Cliquez sur Télécharger puis lancez l'installateur : il remplace l'ancienne version automatiquement.",
      buttons: ['Télécharger', 'Plus tard'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      shell.openExternal(asset ? asset.browser_download_url : release.html_url);
    }
  } catch {
    // Pas d'internet (cas normal en tournoi) ou GitHub injoignable : on ne dérange pas l'arbitre
    if (manual) {
      dialog.showMessageBox(win, {
        type: 'warning',
        message: 'Impossible de vérifier les mises à jour.',
        detail: 'Vérifiez la connexion internet puis réessayez.',
        buttons: ['OK'],
      });
    }
  }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const openPage = (page) => {
    if (mainWindow && serverInfo) mainWindow.loadURL(`https://localhost:${serverInfo.port}/${page}`);
  };
  const updateItem = { label: 'Vérifier les mises à jour…', click: () => checkForUpdates(true) };
  const template = [
    ...(isMac
      ? [{ label: app.name, submenu: [{ role: 'about' }, updateItem, { type: 'separator' }, { role: 'quit' }] }]
      : []),
    {
      label: 'Navigation',
      submenu: [
        { label: 'Configuration', click: () => openPage('setup') },
        { label: 'Arbitrage', click: () => openPage('arbitrage') },
        { label: 'Paramètres', click: () => openPage('settings') },
        { type: 'separator' },
        { role: 'reload', label: 'Recharger' },
        { role: 'togglefullscreen', label: 'Plein écran' },
      ],
    },
    { label: 'Édition', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: 'Aide',
      submenu: [
        { label: 'Guide bénévoles', click: () => openPage('guide') },
        ...(isMac ? [] : [updateItem]),
        { role: 'toggleDevTools', label: 'Outils de développement' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── IPC Handlers for continuous recording ──

ipcMain.handle('select-recording-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choisir le dossier d\'enregistrement',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  lastRecordingFolder = result.filePaths[0];
  return lastRecordingFolder;
});

ipcMain.handle('save-recording-chunk', async (_event, { folder, slotName, chunkIndex, data, fileName: customFileName }) => {
  const fileName = customFileName || `${slotName}_${chunkIndex}.webm`;
  const filePath = path.join(folder, fileName);
  const buffer = Buffer.from(data);
  await fs.promises.writeFile(filePath, buffer);
  const stat = await fs.promises.stat(filePath);
  return { path: filePath, size: stat.size };
});

ipcMain.handle('get-recording-folder', () => {
  return lastRecordingFolder;
});

ipcMain.handle('read-recording-file', async (_event, filePath) => {
  try {
    const buffer = await fs.promises.readFile(filePath);
    return { data: buffer, size: buffer.length };
  } catch (err) {
    console.error('[read-recording-file] Error:', err.message);
    return null;
  }
});

async function createWindow() {
  // Start the embedded server first with persistent token storage
  const persistPath = path.join(app.getPath('userData'), 'slots.json');
  try {
    serverInfo = await startServer({ persistPath });
  } catch (err) {
    dialog.showErrorBox('Erreur SABER VAR', `Impossible de démarrer le serveur:\n${err.message}`);
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'SABER VAR',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Ignore self-signed cert errors for our own server
  mainWindow.webContents.session.setCertificateVerifyProc((_request, callback) => {
    callback(0); // 0 = trust
  });

  mainWindow.loadURL(`https://localhost:${serverInfo.port}/setup`);
  buildMenu();

  // Vérification des mises à jour : quelques secondes après l'ouverture, puis périodiquement
  setTimeout(() => checkForUpdates(false), 4000);
  setInterval(() => checkForUpdates(false), UPDATE_CHECK_INTERVAL_MS);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Log the URLs in the console for debugging
  console.log('');
  console.log('╔═══════════════════════════════════════════════════╗');
  console.log('║  SABER VAR — Système VAR actif                    ║');
  console.log('║                                                   ║');
  console.log('║  URLs pour les téléphones :                       ║');
  for (const url of serverInfo.urls) {
    console.log(`║  → ${url.padEnd(45)}║`);
  }
  console.log('╚═══════════════════════════════════════════════════╝');
  console.log('');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (serverInfo?.server) {
    serverInfo.server.close();
  }
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
