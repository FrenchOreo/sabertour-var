import { framesToEvents, CamEvent } from './events';
import type { VisionFrame, VisionStats } from './types';

/**
 * Banc d'essai sur un lot de vidéos : résumé d'une vidéo analysée et bilan du lot.
 * Fonctions pures (testées) ; l'analyse elle-même est celle du mode VAR (analyzeClip).
 */

export interface BatchFileResult {
  name: string;
  sizeMB: number;
  durationSec: number | null;
  /** temps réel d'analyse (ms) et vitesse = secondes de vidéo par seconde d'analyse */
  wallMs: number;
  speed: number | null;
  stats: VisionStats;
  touches: number;
  clashes: number;
  events: { t: number; kind: CamEvent['kind']; zone: string | null; frames: number }[];
  error?: string;
}

export function summarizeFile(
  name: string,
  sizeBytes: number,
  durationSec: number | null,
  wallMs: number,
  frames: VisionFrame[],
  stats: VisionStats
): BatchFileResult {
  const events = framesToEvents(frames.map((f) => ({ t: f.t, contact: f.contact ? { zone: f.contact.zone, gap: f.contact.gap } : null, clash: f.clash !== null })));
  const covered = stats.coveredSec ?? durationSec ?? 0;
  return {
    name,
    sizeMB: Math.round((sizeBytes / 1048576) * 10) / 10,
    durationSec: durationSec === null ? null : Math.round(durationSec * 10) / 10,
    wallMs,
    speed: wallMs > 0 && covered > 0 ? Math.round((covered / (wallMs / 1000)) * 100) / 100 : null,
    stats,
    touches: events.filter((e) => e.kind === 'touche').length,
    clashes: events.filter((e) => e.kind === 'clash').length,
    events: events.map((e) => ({ t: Math.round(e.t * 100) / 100, kind: e.kind, zone: e.zone ?? null, frames: e.frames })),
  };
}

export interface BatchTotals {
  files: number;
  failed: number;
  videoSec: number;
  wallSec: number;
  /** moyennes pondérées par le nombre d'images analysées */
  fighterPct: number;
  bladePct: number;
  avgInferMs: number;
  touches: number;
  clashes: number;
  /** vidéos où l'IA ne voit presque jamais de lame (< 20 % des images) : à regarder en priorité */
  lowBlade: string[];
}

export function batchTotals(results: BatchFileResult[]): BatchTotals {
  const ok = results.filter((r) => !r.error);
  const frames = ok.reduce((s, r) => s + r.stats.framesAnalysed, 0);
  const w = (k: 'fightersShare' | 'bladeShare' | 'avgInferMs') =>
    frames ? ok.reduce((s, r) => s + r.stats[k] * r.stats.framesAnalysed, 0) / frames : 0;
  return {
    files: results.length,
    failed: results.length - ok.length,
    videoSec: Math.round(ok.reduce((s, r) => s + (r.durationSec ?? 0), 0)),
    wallSec: Math.round(ok.reduce((s, r) => s + r.wallMs, 0) / 1000),
    fighterPct: Math.round(w('fightersShare') * 100),
    bladePct: Math.round(w('bladeShare') * 100),
    avgInferMs: Math.round(w('avgInferMs')),
    touches: ok.reduce((s, r) => s + r.touches, 0),
    clashes: ok.reduce((s, r) => s + r.clashes, 0),
    lowBlade: ok.filter((r) => r.stats.framesAnalysed > 0 && r.stats.bladeShare < 0.2).map((r) => r.name),
  };
}
