import type { CameraTelemetry } from 'shared/types';
import type { ConnectionStats } from '../hooks/useConnectionStats';
import type { SystemMetrics, WifiInfo } from '../types/electron';
import type { RendererSample } from './diagnostics';

/**
 * Causes de problème déduites UNIQUEMENT de mesures (compteurs du navigateur, du téléphone ou
 * du système). Chaque cause cite la valeur mesurée qui la déclenche. Fonctions pures, testées.
 */

export type CauseKind = 'wifi' | 'capteur' | 'telephone' | 'mac' | 'flux';
export type CauseSeverity = 'info' | 'warn' | 'bad';

export interface Cause {
  kind: CauseKind;
  severity: CauseSeverity;
  text: string;
}

export interface RecorderSample {
  /** plus grand / médian écart mesuré entre deux morceaux livrés par l'enregistreur (ms) */
  maxGapMs: number;
  medianGapMs?: number;
  chunks: number;
  mime?: string;
}

/**
 * Au-delà, le buffer a un trou. Seuil volontairement large : en MP4, Chromium livre l'enregistrement
 * par fragments irréguliers de 0,4 à 1 s même sur une machine au repos (mesuré) — ce n'est pas une surcharge.
 */
export const RECORDER_GAP_WARN_MS = 3000;

const pct = (x: number) => `${Math.round(x * 100)} %`;

export function diagnoseCamera(
  rx: ConnectionStats | undefined,
  phone: CameraTelemetry | null | undefined,
  rec?: RecorderSample | null
): Cause[] {
  const causes: Cause[] = [];

  if (phone) {
    if (phone.maxFps !== null && phone.maxFps < phone.requestedFps - 5) {
      causes.push({ kind: 'capteur', severity: 'info', text: `Capteur limité à ${phone.maxFps} images/s (réglage ${phone.requestedFps})` });
    } else if (phone.sourceFps !== null && phone.sourceFps > 0 && phone.sourceFps < phone.requestedFps * 0.8) {
      causes.push({ kind: 'capteur', severity: 'warn', text: `La caméra ne produit que ${Math.round(phone.sourceFps)} images/s (réglage ${phone.requestedFps})` });
    }
    const bw = phone.bandwidthLimitedShare ?? (phone.limitation === 'bandwidth' ? 1 : 0);
    if (bw > 0.3) {
      causes.push({ kind: 'wifi', severity: bw > 0.7 ? 'bad' : 'warn', text: `Le téléphone baisse sa qualité faute de débit WiFi (${pct(bw)} du temps)` });
    }
    const cpu = phone.cpuLimitedShare ?? (phone.limitation === 'cpu' ? 1 : 0);
    if (cpu > 0.3) {
      const enc = phone.encodeMsPerFrame !== null ? `, encodage ${phone.encodeMsPerFrame} ms/image` : '';
      causes.push({ kind: 'telephone', severity: 'warn', text: `Téléphone surchargé (${pct(cpu)} du temps${enc})` });
    }
    if (phone.batteryPct !== null && phone.batteryPct < 20 && phone.charging === false) {
      causes.push({ kind: 'telephone', severity: 'warn', text: `Batterie du téléphone à ${phone.batteryPct} %` });
    }
  }

  if (rx) {
    if (rx.lossPct > 1) {
      causes.push({ kind: 'wifi', severity: rx.lossPct > 5 ? 'bad' : 'warn', text: `Pertes réseau ${rx.lossPct} % des paquets` });
    }
    if (rx.rttMs > 150) {
      causes.push({ kind: 'wifi', severity: 'warn', text: `Aller-retour réseau ${rx.rttMs} ms` });
    }
    const sent = phone ? phone.encodedFps : null;
    if (sent !== null && sent > 0 && rx.receivedFps !== null && rx.receivedFps !== undefined && rx.receivedFps < sent * 0.8) {
      causes.push({ kind: 'wifi', severity: 'warn', text: `Le Mac reçoit ${rx.receivedFps} images/s sur ${Math.round(sent)} envoyées` });
    }
    const dropped = rx.droppedPerSec ?? 0;
    const decoded = rx.decodedFps ?? null;
    const received = rx.receivedFps ?? null;
    if (dropped > 1 || (decoded !== null && received !== null && received > 10 && decoded < received * 0.9)) {
      const dec = rx.decodeMsPerFrame !== null && rx.decodeMsPerFrame !== undefined ? `, décodage ${rx.decodeMsPerFrame} ms/image` : '';
      causes.push({ kind: 'mac', severity: dropped > 5 ? 'bad' : 'warn', text: `Le Mac jette ${dropped} images/s${dec}` });
    }
    if ((rx.freezeMs ?? 0) > 300) {
      causes.push({ kind: 'flux', severity: 'warn', text: `Image figée ${rx.freezeMs} ms sur les 2 dernières secondes` });
    }
  }

  if (rec && rec.maxGapMs > RECORDER_GAP_WARN_MS) {
    causes.push({ kind: 'mac', severity: rec.maxGapMs > 2 * RECORDER_GAP_WARN_MS ? 'bad' : 'warn', text: `Enregistrement du buffer interrompu ${(rec.maxGapMs / 1000).toFixed(1)} s` });
  }

  return causes;
}

function isWifiInfo(w: SystemMetrics['wifi']): w is WifiInfo {
  return !!w && !('error' in w && Object.keys(w).length === 1);
}

export function diagnoseMac(m: SystemMetrics | null | undefined, r: RendererSample | null | undefined): Cause[] {
  const causes: Cause[] = [];
  if (m) {
    if (m.systemCpuPct !== null && m.systemCpuPct > 70) {
      causes.push({ kind: 'mac', severity: m.systemCpuPct > 85 ? 'bad' : 'warn', text: `Processeur du Mac à ${m.systemCpuPct} % (SABER VAR : ${m.app.totalPct} % d'un cœur)` });
    }
    if (m.thermal === 'serious' || m.thermal === 'critical') {
      causes.push({ kind: 'mac', severity: 'bad', text: `Mac en surchauffe (état thermique : ${m.thermal}) : le système ralentit le processeur` });
    } else if (m.thermal === 'fair') {
      causes.push({ kind: 'mac', severity: 'info', text: 'Mac chaud (état thermique : fair)' });
    }
    if (m.memFreeMB < 500) {
      causes.push({ kind: 'mac', severity: 'warn', text: `Mémoire libre ${m.memFreeMB} Mo` });
    }
    const w = isWifiInfo(m.wifi) ? m.wifi : null;
    if (m.lan?.isWifi === false) {
      causes.push({ kind: 'wifi', severity: 'info', text: `Mac relié par câble (${m.lan.name})` });
    } else if (w && w.connected) {
      if (w.band === '2,4 GHz') causes.push({ kind: 'wifi', severity: 'warn', text: `Mac sur WiFi 2,4 GHz (canal ${w.channel ?? '?'}) : bande lente et encombrée` });
      if (w.rssiDbm !== null && w.rssiDbm < -70) causes.push({ kind: 'wifi', severity: w.rssiDbm < -78 ? 'bad' : 'warn', text: `Signal WiFi du Mac faible : ${w.rssiDbm} dBm` });
      if (w.snrDb !== null && w.snrDb < 20) causes.push({ kind: 'wifi', severity: 'warn', text: `Rapport signal/bruit WiFi du Mac : ${w.snrDb} dB` });
      if (w.signalPct !== null && w.signalPct !== undefined && w.signalPct < 50) causes.push({ kind: 'wifi', severity: 'warn', text: `Signal WiFi du PC : ${w.signalPct} %` });
      if (w.txRateMbps !== null && w.txRateMbps < 150) causes.push({ kind: 'wifi', severity: 'warn', text: `Débit radio du Mac : ${w.txRateMbps} Mb/s` });
    }
  }
  if (r && r.lagMaxMs > 200) {
    causes.push({ kind: 'mac', severity: r.lagMaxMs > 1000 ? 'bad' : 'warn', text: `Interface bloquée jusqu'à ${r.lagMaxMs} ms (tâches longues : ${r.longTaskMs} ms)` });
  }
  return causes;
}

/** La cause la plus grave d'une liste (pour le bandeau) */
export function worstCause(causes: Cause[]): Cause | null {
  const rank = { bad: 3, warn: 2, info: 1 } as const;
  let best: Cause | null = null;
  for (const c of causes) if (!best || rank[c.severity] > rank[best.severity]) best = c;
  return best;
}
