import type { ConnectionHealth } from '../hooks/useConnectionStats';

/**
 * GO / NO-GO avant un assaut.
 * Synthétise l'état des caméras et des buffers en UN verdict lisible par un bénévole :
 * il ne doit pas avoir à interpréter quatre badges.
 */
export type ReadinessLevel = 'idle' | 'ready' | 'warning' | 'blocked';

export interface SlotReadinessInput {
  slotId: number;
  name: string;
  cameraConnected: boolean;
  /** santé réseau mesurée (absente tant qu'aucune stat n'est arrivée) */
  health?: ConnectionHealth;
  /** flux perdu / gelé détecté par l'auto-réparation */
  frozen?: boolean;
  /** durée de replay disponible dans le buffer (ms) */
  bufferMs: number;
}

export interface ReadinessOptions {
  /** durée de buffer configurée (ms) */
  bufferTargetMs: number;
  bufferPaused: boolean;
}

export type ChipTone = 'good' | 'degraded' | 'bad' | 'off';

export interface SlotChip {
  slotId: number;
  name: string;
  tone: ChipTone;
  text: string;
}

export interface Readiness {
  level: ReadinessLevel;
  title: string;
  details: string[];
  chips: SlotChip[];
}

/** En dessous de cette réserve de replay, on considère le buffer encore en cours de remplissage */
export const MIN_REPLAY_MS = 15000;

function plural(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? 's' : ''}`;
}

export function computeReadiness(slots: SlotReadinessInput[], opts: ReadinessOptions): Readiness {
  if (slots.length === 0) {
    return { level: 'idle', title: 'En attente de configuration', details: [], chips: [] };
  }

  const blocked: string[] = [];
  const warnings: string[] = [];
  const connected = slots.filter((s) => s.cameraConnected);
  const offline = slots.filter((s) => !s.cameraConnected);

  if (connected.length === 0) {
    blocked.push('Aucune caméra connectée');
  } else if (offline.length > 0) {
    // Une position non équipée n'empêche pas d'arbitrer : simple avertissement
    warnings.push(`${offline.length > 1 ? 'Caméras' : 'Caméra'} ${offline.map((s) => s.name).join(', ')} hors ligne`);
  }

  for (const s of connected) {
    // Le cas dangereux : l'opérateur croit que ça filme, et ça ne filme plus
    if (s.frozen) blocked.push(`Caméra ${s.name} : flux perdu`);
    else if (s.health === 'bad') blocked.push(`Caméra ${s.name} : réseau critique`);
    else if (s.health === 'degraded') warnings.push(`Caméra ${s.name} dégradée`);
  }

  const minReplay = Math.min(MIN_REPLAY_MS, opts.bufferTargetMs);
  if (opts.bufferPaused) {
    warnings.push('Buffer en pause — reprendre avant le combat');
  } else {
    const filling = connected.filter((s) => !s.frozen && s.bufferMs < minReplay);
    if (filling.length > 0) {
      const worst = Math.min(...filling.map((s) => s.bufferMs));
      warnings.push(`Buffer en cours ${Math.round(worst / 1000)} s / ${Math.round(opts.bufferTargetMs / 1000)} s`);
    }
  }

  const chips: SlotChip[] = slots.map((s) => {
    let tone: ChipTone = 'good';
    let text = `${Math.round(s.bufferMs / 1000)} s`;
    if (!s.cameraConnected) {
      tone = 'off';
      text = 'hors ligne';
    } else if (s.frozen) {
      tone = 'bad';
      text = 'gelé';
    } else if (s.health === 'bad') {
      tone = 'bad';
    } else if (s.health === 'degraded') {
      tone = 'degraded';
    }
    return { slotId: s.slotId, name: s.name, tone, text };
  });

  if (blocked.length > 0) {
    return { level: 'blocked', title: blocked[0], details: [...blocked.slice(1), ...warnings], chips };
  }
  if (warnings.length > 0) {
    return { level: 'warning', title: warnings[0], details: warnings.slice(1), chips };
  }
  const replaySec = Math.round(Math.min(...connected.map((s) => s.bufferMs)) / 1000);
  return {
    level: 'ready',
    title: `Prêt — ${plural(connected.length, 'caméra')} OK · replay ${replaySec} s`,
    details: [],
    chips,
  };
}
