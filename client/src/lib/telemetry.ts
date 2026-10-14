import type { CameraTelemetry } from 'shared/types';

/**
 * Mesures réelles côté téléphone : lecture des compteurs WebRTC de l'ÉMETTEUR.
 * Fonction pure (testée) : on lui passe les entrées de getStats() et les compteurs du sondage précédent.
 */

type StatEntry = Record<string, unknown> & { type?: string; kind?: string };

export interface SenderCounters {
  timestampMs: number;
  bytesSent: number;
  framesEncoded: number;
  totalEncodeTime: number;
  nackCount: number;
  pliCount: number;
  limitationDurations: Record<string, number>;
}

export interface TrackInfo {
  requestedFps: number;
  trackWidth: number | null;
  trackHeight: number | null;
  trackFps: number | null;
  maxFps: number | null;
}

const num = (v: unknown): number | null => (typeof v === 'number' && isFinite(v) ? v : null);

export function computeCameraTelemetry(
  entries: Iterable<StatEntry>,
  prev: SenderCounters | undefined,
  track: TrackInfo,
  nowMs: number,
  battery: { pct: number | null; charging: boolean | null } = { pct: null, charging: null }
): { telemetry: CameraTelemetry; counters: SenderCounters | undefined } {
  let source: StatEntry | null = null;
  let outbound: StatEntry | null = null;
  let remoteIn: StatEntry | null = null;
  for (const e of entries) {
    if (e.kind !== 'video' && e.type !== 'remote-inbound-rtp') continue;
    if (e.type === 'media-source') source = e;
    else if (e.type === 'outbound-rtp') outbound = e;
    else if (e.type === 'remote-inbound-rtp' && (e.kind === 'video' || e.kind === undefined)) remoteIn = e;
  }

  const telemetry: CameraTelemetry = {
    t: nowMs,
    ...track,
    sourceFps: num(source?.framesPerSecond),
    encodedFps: num(outbound?.framesPerSecond),
    sentKbps: null,
    targetKbps: num(outbound?.targetBitrate) !== null ? Math.round((outbound!.targetBitrate as number) / 1000) : null,
    limitation: null,
    bandwidthLimitedShare: null,
    cpuLimitedShare: null,
    encodeMsPerFrame: null,
    rttMs: num(remoteIn?.roundTripTime) !== null ? Math.round((remoteIn!.roundTripTime as number) * 1000) : null,
    remoteLossPct: num(remoteIn?.fractionLost) !== null ? Math.round((remoteIn!.fractionLost as number) * 1000) / 10 : null,
    nacks: null,
    plis: null,
    batteryPct: battery.pct,
    charging: battery.charging,
  };

  if (!outbound) return { telemetry, counters: undefined };

  const reason = outbound.qualityLimitationReason;
  telemetry.limitation = reason === 'none' || reason === 'cpu' || reason === 'bandwidth' || reason === 'other' ? reason : null;

  const durations: Record<string, number> = {};
  const rawDur = outbound.qualityLimitationDurations;
  if (rawDur && typeof rawDur === 'object') {
    for (const [k, v] of Object.entries(rawDur as Record<string, unknown>)) {
      const n = num(v);
      if (n !== null) durations[k] = n;
    }
  }

  const counters: SenderCounters = {
    timestampMs: nowMs,
    bytesSent: num(outbound.bytesSent) ?? 0,
    framesEncoded: num(outbound.framesEncoded) ?? 0,
    totalEncodeTime: num(outbound.totalEncodeTime) ?? 0,
    nackCount: num(outbound.nackCount) ?? 0,
    pliCount: num(outbound.pliCount) ?? 0,
    limitationDurations: durations,
  };

  // Les deltas n'ont de sens qu'entre deux sondages de la même connexion (compteurs croissants)
  if (prev && nowMs > prev.timestampMs && counters.bytesSent >= prev.bytesSent) {
    const dtSec = (nowMs - prev.timestampMs) / 1000;
    telemetry.sentKbps = Math.round(((counters.bytesSent - prev.bytesSent) * 8) / 1000 / dtSec);
    const dFrames = counters.framesEncoded - prev.framesEncoded;
    if (dFrames > 0) {
      telemetry.encodeMsPerFrame = Math.round(((counters.totalEncodeTime - prev.totalEncodeTime) / dFrames) * 10000) / 10;
    }
    telemetry.nacks = Math.max(0, counters.nackCount - prev.nackCount);
    telemetry.plis = Math.max(0, counters.pliCount - prev.pliCount);
    const share = (k: string) => {
      const d = (durations[k] ?? 0) - (prev.limitationDurations[k] ?? 0);
      return Math.max(0, Math.min(1, Math.round((d / dtSec) * 100) / 100));
    };
    if (Object.keys(durations).length > 0) {
      telemetry.bandwidthLimitedShare = share('bandwidth');
      telemetry.cpuLimitedShare = share('cpu');
    }
  }

  return { telemetry, counters };
}
