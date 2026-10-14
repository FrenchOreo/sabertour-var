import type { Zone } from './fighters';

/**
 * Des observations image par image aux moments à revoir. Fonctions pures (testées).
 * - Par caméra : les images consécutives où une lame touche un corps (ou deux lames se croisent)
 *   forment un événement, daté à l'image où la lame est la plus proche du corps.
 * - Entre caméras : deux événements au même instant (décalages de synchro appliqués) sont
 *   fusionnés ; vu par plusieurs caméras = plus fiable (une lame qui passe DEVANT un corps
 *   ne le touche que dans un seul angle de vue).
 */

export interface FrameObs {
  /** temps média de l'image (s) */
  t: number;
  /** meilleur contact lame → corps de l'image (gap ≤ tolérance), null sinon */
  contact: { zone: Zone; gap: number } | null;
  clash: boolean;
}

export type EventKind = 'touche' | 'clash';

export interface CamEvent {
  kind: EventKind;
  /** instant retenu (s, temps média de la caméra) */
  t: number;
  start: number;
  end: number;
  frames: number;
  zone?: Zone;
  minGap?: number;
}

export function framesToEvents(frames: FrameObs[], maxGapSec = 0.5): CamEvent[] {
  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const out: CamEvent[] = [];
  for (const kind of ['touche', 'clash'] as EventKind[]) {
    let cur: CamEvent | null = null;
    for (const f of sorted) {
      const hit = kind === 'touche' ? f.contact !== null : f.clash;
      if (!hit) continue;
      if (cur && f.t - cur.end <= maxGapSec) {
        cur.end = f.t;
        cur.frames++;
        if (kind === 'touche' && f.contact && f.contact.gap < (cur.minGap ?? Infinity)) {
          cur.minGap = f.contact.gap;
          cur.zone = f.contact.zone;
          cur.t = f.t;
        }
      } else {
        if (cur) out.push(cur);
        cur = { kind, t: f.t, start: f.t, end: f.t, frames: 1 };
        if (kind === 'touche' && f.contact) { cur.minGap = f.contact.gap; cur.zone = f.contact.zone; }
      }
    }
    if (cur) out.push(cur);
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface FusedEvent {
  kind: EventKind;
  /** temps timeline (s) */
  t: number;
  /** caméras qui l'ont vu */
  cams: number[];
  zone?: Zone;
  frames: number;
}

/**
 * offsets : convention de l'écran VAR, `temps média = temps timeline + offset`.
 * Deux événements du même type à moins de `windowSec` sont fusionnés.
 */
export function fuseEvents(perCam: Map<number, CamEvent[]>, offsets: Map<number, number>, windowSec = 0.4): FusedEvent[] {
  const all: { cam: number; e: CamEvent; t: number }[] = [];
  perCam.forEach((events, cam) => {
    const off = offsets.get(cam) ?? 0;
    for (const e of events) all.push({ cam, e, t: e.t - off });
  });
  all.sort((a, b) => a.t - b.t);
  const fused: FusedEvent[] = [];
  for (const x of all) {
    const near = fused.find((f) => f.kind === x.e.kind && Math.abs(f.t - x.t) <= windowSec);
    if (near) {
      if (!near.cams.includes(x.cam)) near.cams.push(x.cam);
      near.frames += x.e.frames;
      if (!near.zone && x.e.zone) near.zone = x.e.zone;
    } else {
      fused.push({ kind: x.e.kind, t: x.t, cams: [x.cam], zone: x.e.zone, frames: x.e.frames });
    }
  }
  return fused.sort((a, b) => a.t - b.t);
}

/** Les marqueurs affichés : touches d'abord, plusieurs caméras d'abord, au plus `max` */
export function selectMarkers(events: FusedEvent[], max = 10): FusedEvent[] {
  const rank = (e: FusedEvent) => (e.kind === 'touche' ? 100 : 0) + e.cams.length * 10 + Math.min(9, e.frames);
  return [...events].sort((a, b) => rank(b) - rank(a)).slice(0, max).sort((a, b) => a.t - b.t);
}
