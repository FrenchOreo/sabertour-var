import React from 'react';
import type { CameraTelemetry, SlotId, SlotState } from 'shared/types';
import type { ConnectionStats } from '../hooks/useConnectionStats';
import type { SystemMetrics, WifiInfo } from '../types/electron';
import type { RendererSample } from '../lib/diagnostics';
import { diagnoseCamera, diagnoseMac, Cause, RecorderSample } from '../lib/diagnosis';
import { exportDiagnostics } from '../lib/diagnostics';

interface Props {
  slots: SlotState[];
  rx: Map<SlotId, ConnectionStats>;
  phone: Map<SlotId, CameraTelemetry>;
  recorder: Map<number, RecorderSample>;
  mac: SystemMetrics | null;
  renderer: RendererSample | null;
  onClose: () => void;
}

const SEV_COLOR = { bad: 'var(--red)', warn: 'var(--orange)', info: 'var(--text-muted)' } as const;
const dash = '—';
const v = (x: number | null | undefined, unit = '') => (x === null || x === undefined ? dash : `${x}${unit}`);

function CauseList({ causes, empty }: { causes: Cause[]; empty: string }) {
  if (causes.length === 0) return <div style={{ color: '#22c55e', fontSize: '0.8rem' }}>✓ {empty}</div>;
  return (
    <ul style={{ margin: 0, paddingLeft: 16, fontSize: '0.8rem' }}>
      {causes.map((c, i) => (
        <li key={i} style={{ color: SEV_COLOR[c.severity] }}>{c.text}</li>
      ))}
    </ul>
  );
}

function wifiLine(w: SystemMetrics['wifi']): string {
  if (!w) return 'non mesuré';
  if ('error' in w && w.error) return `lecture impossible (${w.error})`;
  const x = w as WifiInfo;
  if (!x.connected) return 'non connecté';
  const parts = [x.band, x.channel !== null ? `canal ${x.channel}` : null, x.widthMHz ? `${x.widthMHz} MHz` : null, x.phyMode,
    x.rssiDbm !== null ? `signal ${x.rssiDbm} dBm` : x.signalPct !== null && x.signalPct !== undefined ? `signal ${x.signalPct} %` : null,
    x.noiseDbm !== null ? `bruit ${x.noiseDbm} dBm` : null, x.txRateMbps !== null ? `débit radio ${x.txRateMbps} Mb/s` : null];
  return parts.filter(Boolean).join(' · ');
}

/** Panneau Diagnostic (touche D) : uniquement des valeurs mesurées, et les causes qu'elles prouvent */
export default function DiagnosticsPanel({ slots, rx, phone, recorder, mac, renderer, onClose }: Props) {
  const macCauses = diagnoseMac(mac, renderer);
  const th: React.CSSProperties = { textAlign: 'left', padding: '3px 8px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '3px 8px', whiteSpace: 'nowrap' };
  return (
    <div className="diag-panel" role="dialog" aria-label="Diagnostic">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <strong style={{ fontFamily: 'var(--font-ui)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--cyan)', flex: 1 }}>
          Diagnostic — mesures réelles
        </strong>
        <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => exportDiagnostics()}>Exporter le journal</button>
        <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={onClose}>Fermer (D)</button>
      </div>

      <section style={{ marginBottom: 12 }}>
        <div className="diag-title">Ordinateur arbitre</div>
        {mac ? (
          <div className="font-mono" style={{ fontSize: '0.78rem', lineHeight: 1.6 }}>
            Processeur : {v(mac.systemCpuPct, ' %')} (machine) · SABER VAR {mac.app.totalPct} % d'un cœur
            {' '}(affichage {mac.app.rendererPct} %, GPU {mac.app.gpuPct} %) · {mac.cpuCount} cœurs
            <br />
            Mémoire libre {mac.memFreeMB} / {mac.memTotalMB} Mo · app {Math.round(mac.app.memMB)} Mo
            {' '}· thermique : {mac.thermal ?? dash} · {mac.onBattery === null ? '' : mac.onBattery ? 'sur batterie' : 'sur secteur'}
            <br />
            Réseau des téléphones : {mac.lan ? `${mac.lan.address} via ${mac.lan.name}${mac.lan.isWifi === true ? ' (WiFi)' : mac.lan.isWifi === false ? ' (câble)' : ''}` : dash}
            <br />
            WiFi du Mac : {wifiLine(mac.wifi)}
          </div>
        ) : (
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mesures système disponibles uniquement dans l'application SABER VAR (pas dans un navigateur).</div>
        )}
        {renderer && (
          <div className="font-mono" style={{ fontSize: '0.78rem' }}>
            Interface : retard max {renderer.lagMaxMs} ms (95 % &lt; {renderer.lagP95Ms} ms) · tâches longues {renderer.longTaskMs} ms en {renderer.longTaskCount} fois sur {Math.round(renderer.windowMs / 1000)} s
          </div>
        )}
        <div style={{ marginTop: 6 }}><CauseList causes={macCauses} empty="Ordinateur : rien d'anormal mesuré" /></div>
      </section>

      <section>
        <div className="diag-title">Caméras</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="font-mono" style={{ borderCollapse: 'collapse', fontSize: '0.75rem' }}>
            <thead>
              <tr>
                <th style={th}>Caméra</th>
                <th style={th}>Capteur (réel / max / réglé)</th>
                <th style={th}>Envoyé par le tél.</th>
                <th style={th}>Reçu par le Mac</th>
                <th style={th}>Décodé / jeté</th>
                <th style={th}>Pertes · A/R</th>
                <th style={th}>Bridage tél.</th>
                <th style={th}>Buffer</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => {
                const r = rx.get(s.slotId);
                const p = phone.get(s.slotId);
                const rec = recorder.get(s.slotId);
                return (
                  <tr key={s.slotId} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={td}>{s.name}{!s.cameraConnected && <span style={{ color: 'var(--text-dim)' }}> (hors ligne)</span>}</td>
                    <td style={td}>{p ? `${v(p.sourceFps ?? p.trackFps)} / ${v(p.maxFps)} / ${p.requestedFps} fps · ${v(p.trackWidth)}×${v(p.trackHeight)}` : dash}</td>
                    <td style={td}>{p ? `${v(p.encodedFps, ' fps')} · ${p.sentKbps !== null ? (p.sentKbps / 1000).toFixed(1) + ' Mb/s' : dash}` : dash}</td>
                    <td style={td}>{r ? `${v(r.receivedFps ?? r.fps, ' fps')} · ${(r.bitrateKbps / 1000).toFixed(1)} Mb/s` : dash}</td>
                    <td style={td}>{r ? `${v(r.decodedFps, ' fps')} · ${v(r.droppedPerSec, '/s')} · ${v(r.decodeMsPerFrame, ' ms')}` : dash}</td>
                    <td style={td}>{r ? `${r.lossPct} % · ${r.rttMs} ms` : dash}</td>
                    <td style={td}>{p ? (p.limitation === 'none' ? 'aucun' : p.limitation === 'bandwidth' ? `WiFi ${Math.round((p.bandwidthLimitedShare ?? 1) * 100)} %` : p.limitation === 'cpu' ? `processeur ${Math.round((p.cpuLimitedShare ?? 1) * 100)} %` : (p.limitation ?? dash)) : dash}</td>
                    <td style={td}>{rec ? `${(rec.mime ?? '').replace('video/', '').split(';')[0] || '?'} · morceaux ${rec.medianGapMs ?? '?'} ms (max ${rec.maxGapMs})` : dash}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, marginTop: 8 }}>
          {slots.filter((s) => s.cameraConnected).map((s) => (
            <div key={s.slotId}>
              <div style={{ fontSize: '0.75rem', color: 'var(--cyan)', fontWeight: 700 }}>{s.name}</div>
              <CauseList causes={diagnoseCamera(rx.get(s.slotId), phone.get(s.slotId), recorder.get(s.slotId))} empty="rien d'anormal mesuré" />
            </div>
          ))}
        </div>
        {slots.some((s) => s.cameraConnected && !phone.has(s.slotId)) && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>
            « — » côté téléphone : la page caméra n'a pas encore envoyé ses mesures (recharger la page du téléphone si elle date d'avant cette version).
          </div>
        )}
      </section>
    </div>
  );
}
