import { useEffect, useRef, useState, useCallback } from 'react';
import { SlotId } from 'shared/types';

export interface ConnectionStats {
  bitrateKbps: number;
  fps: number;
  width: number;
  height: number;
  lossPct: number;
  rttMs: number;
  jitterBufferMs: number;
  /** Latence bout-en-bout estimée (RTT/2 + jitter buffer) — sert à la synchro VAR */
  latencyMs: number;
  /** Meilleur fps observé pour ce slot : référence de cadence (la cible réglée sur le téléphone est inconnue ici) */
  peakFps: number;
  /** Sondages consécutifs sans aucun octet reçu alors que la connexion se dit établie */
  stalledPolls: number;
  connectionState: RTCPeerConnectionState;
  updatedAt: number;
}

export type ConnectionHealth = 'good' | 'degraded' | 'bad';

/** Nombre de sondages (2 s chacun) sans données à partir duquel le flux est déclaré gelé */
export const STALL_POLLS_FROZEN = 3;

export function getHealth(s: ConnectionStats): ConnectionHealth {
  if (s.stalledPolls >= 2) return 'bad';
  if (s.lossPct > 5) return 'bad';
  // Cadence jugée par rapport au meilleur fps vu sur cette caméra :
  // à 60 fps demandés, recevoir 30 fps est déjà une dégradation
  const ref = s.peakFps >= 20 ? s.peakFps : 0;
  if (ref > 0 && s.fps > 0) {
    const ratio = s.fps / ref;
    if (ratio < 0.5) return 'bad';
    if (ratio < 0.8) return 'degraded';
  }
  if (s.lossPct > 1 || s.rttMs > 150) return 'degraded';
  return 'good';
}

interface PrevCounters {
  pc: RTCPeerConnection;
  bytesReceived: number;
  packetsReceived: number;
  packetsLost: number;
  jitterBufferDelay: number;
  jitterBufferEmittedCount: number;
  stalledPolls: number;
  timestampMs: number;
}

const POLL_INTERVAL_MS = 2000;
const ALL_SLOTS: SlotId[] = [1, 2, 3, 4];

function computeSlotStats(
  pc: RTCPeerConnection,
  report: RTCStatsReport,
  prev: PrevCounters | undefined,
  peakFpsPrev: number
): { stats: ConnectionStats; counters: PrevCounters } | null {
  type StatEntry = Record<string, number | string | undefined> & { type?: string };
  let inb: Record<string, number | undefined> | null = null;
  let selectedPairId: string | undefined;
  const pairs = new Map<string, StatEntry>();

  for (const entry of report.values() as Iterable<StatEntry>) {
    if (entry.type === 'inbound-rtp' && entry.kind === 'video') inb = entry as Record<string, number | undefined>;
    else if (entry.type === 'transport' && typeof entry.selectedCandidatePairId === 'string') selectedPairId = entry.selectedCandidatePairId;
    else if (entry.type === 'candidate-pair' && typeof entry.id === 'string') pairs.set(entry.id, entry);
  }

  if (!inb) return null;

  let rttSec = 0;
  const selectedPair = selectedPairId ? pairs.get(selectedPairId) : undefined;
  if (selectedPair && typeof selectedPair.currentRoundTripTime === 'number') {
    rttSec = selectedPair.currentRoundTripTime;
  } else {
    for (const p of pairs.values()) {
      if (p.state === 'succeeded' && typeof p.currentRoundTripTime === 'number') {
        rttSec = p.currentRoundTripTime;
        break;
      }
    }
  }

  const now = Date.now();
  // Une connexion remplacée (renégociation) repart de zéro : ses compteurs ne sont pas comparables
  const samePc = prev !== undefined && prev.pc === pc;
  const counters: PrevCounters = {
    pc,
    bytesReceived: inb.bytesReceived ?? 0,
    packetsReceived: inb.packetsReceived ?? 0,
    packetsLost: inb.packetsLost ?? 0,
    jitterBufferDelay: inb.jitterBufferDelay ?? 0,
    jitterBufferEmittedCount: inb.jitterBufferEmittedCount ?? 0,
    stalledPolls: 0,
    timestampMs: now,
  };

  let bitrateKbps = 0;
  let lossPct = 0;
  let jitterBufferMs = 0;
  if (samePc && prev && now > prev.timestampMs) {
    const dtSec = (now - prev.timestampMs) / 1000;
    const dBytes = counters.bytesReceived - prev.bytesReceived;
    bitrateKbps = Math.max(0, (dBytes * 8) / 1000 / dtSec);
    const dPackets = counters.packetsReceived - prev.packetsReceived;
    const dLost = counters.packetsLost - prev.packetsLost;
    if (dPackets + dLost > 0) lossPct = Math.max(0, (dLost / (dPackets + dLost)) * 100);
    const dEmitted = counters.jitterBufferEmittedCount - prev.jitterBufferEmittedCount;
    if (dEmitted > 0) {
      jitterBufferMs = ((counters.jitterBufferDelay - prev.jitterBufferDelay) / dEmitted) * 1000;
    }
    // Connexion « établie » mais plus aucun octet : le flux est gelé
    counters.stalledPolls = dBytes <= 0 && pc.connectionState === 'connected' ? prev.stalledPolls + 1 : 0;
  }

  const fps = typeof inb.framesPerSecond === 'number' ? Math.round(inb.framesPerSecond) : 0;
  const rttMs = rttSec * 1000;
  const stats: ConnectionStats = {
    bitrateKbps: Math.round(bitrateKbps),
    fps,
    width: inb.frameWidth ?? 0,
    height: inb.frameHeight ?? 0,
    lossPct: Math.round(lossPct * 10) / 10,
    rttMs: Math.round(rttMs),
    jitterBufferMs: Math.round(jitterBufferMs),
    latencyMs: Math.round(rttMs / 2 + jitterBufferMs),
    peakFps: Math.max(peakFpsPrev, fps),
    stalledPolls: counters.stalledPolls,
    connectionState: pc.connectionState,
    updatedAt: now,
  };
  return { stats, counters };
}

/**
 * Sonde périodiquement pc.getStats() de chaque caméra connectée.
 * - Affichage santé réseau en direct (débit, fps, perte)
 * - Latence estimée par caméra, utilisée pour corriger la synchro VAR
 * - Détection de flux gelé (connexion établie mais plus aucune donnée)
 */
export function useConnectionStats(getPeerConnection: (slotId: SlotId) => RTCPeerConnection | undefined) {
  const [stats, setStats] = useState<Map<SlotId, ConnectionStats>>(new Map());
  const statsRef = useRef<Map<SlotId, ConnectionStats>>(new Map());
  const prevRef = useRef<Map<SlotId, PrevCounters>>(new Map());
  // Le pic de fps survit aux renégociations : c'est la même caméra
  const peakFpsRef = useRef<Map<SlotId, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      const next = new Map(statsRef.current);
      let changed = false;
      for (const slotId of ALL_SLOTS) {
        const pc = getPeerConnection(slotId);
        if (!pc || pc.connectionState === 'closed') {
          if (next.delete(slotId)) changed = true;
          prevRef.current.delete(slotId);
          continue;
        }
        try {
          const report = await pc.getStats();
          const result = computeSlotStats(pc, report, prevRef.current.get(slotId), peakFpsRef.current.get(slotId) ?? 0);
          if (result) {
            prevRef.current.set(slotId, result.counters);
            peakFpsRef.current.set(slotId, result.stats.peakFps);
            next.set(slotId, result.stats);
            changed = true;
          }
        } catch {
          // pc fermée entre-temps — ignorer ce cycle
        }
      }
      if (!cancelled && changed) {
        statsRef.current = next;
        setStats(next);
      }
    };

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [getPeerConnection]);

  /** Lecture sans re-render (utilisée au moment de l'appui VAR) */
  const getStatsSnapshot = useCallback((slotId: SlotId): ConnectionStats | undefined => {
    return statsRef.current.get(slotId);
  }, []);

  return { stats, getStatsSnapshot };
}
