import { Pt, dist, segmentDistance, closestOnSegment } from './geometry';
import { BladeTrace, traceBladeFromHand, TraceOptions } from './blade';

/**
 * Tireurs, lames et contacts sur UNE image. Fonctions pures (testées).
 * Entrée : les silhouettes du modèle (33 points normalisés par personne, format BlazePose/MediaPipe).
 */

export interface RawLandmark {
  x: number;
  y: number;
  visibility?: number;
}

export interface Person {
  /** points en pixels de l'image analysée */
  lm: { x: number; y: number; v: number }[];
  box: { x0: number; y0: number; x1: number; y1: number };
  height: number;
  /** mains gauche / droite (null si invisibles) */
  hands: (Pt | null)[];
  /** direction avant-bras (main − coude), pour ne pas prendre le bras pour une lame */
  forearms: (Pt | null)[];
}

export type Zone = 'tête' | 'torse' | 'bras' | 'jambe';

export interface Blade extends BladeTrace {
  owner: number;
  hand: 0 | 1;
}

export interface Contact {
  /** index (dans persons) du porteur de la lame et du tireur touché */
  attacker: number;
  target: number;
  zone: Zone;
  /** distance lame ↔ corps, en fraction de la taille du tireur touché (≤ 0 : la lame recouvre le corps) */
  gap: number;
  point: Pt;
}

export interface FrameAnalysis {
  persons: Person[];
  fighters: number[];
  blades: Blade[];
  contacts: Contact[];
  clash: Pt | null;
}

const VIS = 0.3;
// Indices BlazePose
const L = { nose: 0, sh: [11, 12], el: [13, 14], wr: [15, 16], idx: [19, 20], hip: [23, 24], knee: [25, 26], ank: [27, 28] };

export function personFromLandmarks(raw: RawLandmark[], w: number, h: number): Person | null {
  if (!raw || raw.length < 29) return null;
  const lm = raw.map((p) => ({ x: p.x * w, y: p.y * h, v: p.visibility ?? 1 }));
  const vis = lm.filter((p) => p.v >= VIS);
  if (vis.length < 8) return null;
  const xs = vis.map((p) => p.x);
  const ys = vis.map((p) => p.y);
  const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  // Taille : du nez aux chevilles si visibles (plus stable que la boîte quand les bras sont levés)
  const ankles = L.ank.map((i) => lm[i]).filter((p) => p.v >= VIS);
  const height = ankles.length && lm[L.nose].v >= VIS
    ? Math.max(...ankles.map((a) => a.y)) - lm[L.nose].y + 0.1 * (box.y1 - box.y0)
    : box.y1 - box.y0;
  const hands: (Pt | null)[] = [0, 1].map((s) => {
    const wr = lm[L.wr[s]];
    const ix = lm[L.idx[s]];
    const el = lm[L.el[s]];
    if (ix.v >= VIS && wr.v >= VIS) return { x: (wr.x + 2 * ix.x) / 3, y: (wr.y + 2 * ix.y) / 3 };
    if (wr.v >= VIS && el.v >= VIS) return { x: wr.x + 0.3 * (wr.x - el.x), y: wr.y + 0.3 * (wr.y - el.y) };
    return wr.v >= VIS ? { x: wr.x, y: wr.y } : null;
  });
  const forearms: (Pt | null)[] = [0, 1].map((s) => {
    const wr = lm[L.wr[s]];
    const el = lm[L.el[s]];
    return wr.v >= VIS && el.v >= VIS ? { x: wr.x - el.x, y: wr.y - el.y } : null;
  });
  return { lm, box, height: Math.max(height, 10), hands, forearms };
}

interface Capsule { a: Pt; b: Pt; r: number; zone: Zone }

export function bodyCapsules(p: Person): Capsule[] {
  const h = p.height;
  const ok = (i: number) => p.lm[i].v >= VIS;
  const pt = (i: number) => ({ x: p.lm[i].x, y: p.lm[i].y });
  const caps: Capsule[] = [];
  if (ok(L.nose)) caps.push({ a: pt(L.nose), b: pt(L.nose), r: 0.065 * h, zone: 'tête' });
  const sh = L.sh.filter(ok).map(pt);
  const hip = L.hip.filter(ok).map(pt);
  if (sh.length && hip.length) {
    const ms = { x: sh.reduce((s, q) => s + q.x, 0) / sh.length, y: sh.reduce((s, q) => s + q.y, 0) / sh.length };
    const mh = { x: hip.reduce((s, q) => s + q.x, 0) / hip.length, y: hip.reduce((s, q) => s + q.y, 0) / hip.length };
    const shoulderW = sh.length === 2 ? dist(sh[0], sh[1]) : 0.22 * h;
    caps.push({ a: ms, b: mh, r: Math.max(0.08 * h, shoulderW / 2), zone: 'torse' });
  }
  const limb = (i: number, j: number, r: number, zone: Zone) => { if (ok(i) && ok(j)) caps.push({ a: pt(i), b: pt(j), r: r * h, zone }); };
  for (const s of [0, 1]) {
    limb(L.sh[s], L.el[s], 0.035, 'bras');
    limb(L.el[s], L.wr[s], 0.03, 'bras');
    limb(L.hip[s], L.knee[s], 0.05, 'jambe');
    limb(L.knee[s], L.ank[s], 0.04, 'jambe');
  }
  return caps;
}

/** Contact lame → corps : on ignore le quart de lame côté poignée (la main du porteur) */
export function bladeBodyContact(blade: BladeTrace, target: Person, tolFrac = 0.02): { zone: Zone; gap: number; point: Pt } | null {
  const from = { x: blade.hilt.x + 0.25 * (blade.tip.x - blade.hilt.x), y: blade.hilt.y + 0.25 * (blade.tip.y - blade.hilt.y) };
  let best: { zone: Zone; gap: number; point: Pt } | null = null;
  for (const c of bodyCapsules(target)) {
    const { d, onFirst } = c.a.x === c.b.x && c.a.y === c.b.y
      ? (() => { const q = closestOnSegment(c.a, from, blade.tip).pt; return { d: dist(q, c.a), onFirst: q }; })()
      : segmentDistance(from, blade.tip, c.a, c.b);
    const gap = (d - c.r) / target.height;
    if (gap <= tolFrac && (!best || gap < best.gap)) best = { zone: c.zone, gap, point: onFirst };
  }
  return best;
}

/** Les deux tireurs : porteurs de lame les plus grands (plus proches de la caméra) et proches l'un de l'autre */
export function pickFighters(persons: Person[], bladesByPerson: Map<number, Blade[]>): number[] {
  const cx = (p: Person) => (p.box.x0 + p.box.x1) / 2;
  const near = (i: number, j: number) => Math.abs(cx(persons[i]) - cx(persons[j])) <= 3 * Math.max(persons[i].height, persons[j].height);
  const armed = persons.map((_, i) => i).filter((i) => (bladesByPerson.get(i)?.length ?? 0) > 0);
  let best: number[] = [];
  let bestScore = -1;
  for (let a = 0; a < armed.length; a++) {
    for (let b = a + 1; b < armed.length; b++) {
      const i = armed[a];
      const j = armed[b];
      if (!near(i, j)) continue;
      const score = persons[i].height + persons[j].height;
      if (score > bestScore) { bestScore = score; best = [i, j]; }
    }
  }
  if (best.length) return best;
  if (armed.length === 1) {
    const i = armed[0];
    const others = persons.map((_, j) => j).filter((j) => j !== i && near(i, j)).sort((x, y) => persons[y].height - persons[x].height);
    return others.length ? [i, others[0]] : [i];
  }
  return [];
}

export interface AnalyzeOptions {
  trace?: TraceOptions;
  /** tolérance de contact lame-corps (fraction de la taille du tireur touché) */
  contactTol?: number;
  /** distance lame-lame d'un clash (fraction de la taille moyenne) */
  clashTol?: number;
}

/** Analyse complète d'une image : silhouettes → lames → tireurs → contacts et clash */
export function analyzeFrame(
  poses: RawLandmark[][],
  mask: Uint8Array,
  w: number,
  h: number,
  opts: AnalyzeOptions = {}
): FrameAnalysis {
  const persons = poses.map((p) => personFromLandmarks(p, w, h)).filter((p): p is Person => !!p);
  const bladesByPerson = new Map<number, Blade[]>();
  persons.forEach((p, i) => {
    const found: Blade[] = [];
    p.hands.forEach((hand, s) => {
      if (!hand) return;
      const t = traceBladeFromHand(mask, w, h, hand, p.height, { ...opts.trace, forearm: p.forearms[s] });
      if (t) found.push({ ...t, owner: i, hand: s as 0 | 1 });
    });
    // Deux mains sur la même poignée trouvent la même lame : on garde la meilleure
    found.sort((a, b) => b.support - a.support);
    const kept = found.filter((b, k) => k === 0 || Math.abs(((b.angleDeg - found[0].angleDeg + 540) % 360) - 180) > 30);
    if (kept.length) bladesByPerson.set(i, kept);
  });
  const fighters = pickFighters(persons, bladesByPerson);
  const blades = fighters.flatMap((i) => bladesByPerson.get(i) ?? []);
  const contacts: Contact[] = [];
  let clash: Pt | null = null;
  if (fighters.length === 2) {
    for (const [att, tgt] of [[fighters[0], fighters[1]], [fighters[1], fighters[0]]]) {
      for (const b of bladesByPerson.get(att) ?? []) {
        const c = bladeBodyContact(b, persons[tgt], opts.contactTol ?? 0.02);
        if (c) contacts.push({ attacker: att, target: tgt, ...c });
      }
    }
    const b0 = bladesByPerson.get(fighters[0]) ?? [];
    const b1 = bladesByPerson.get(fighters[1]) ?? [];
    const tol = (opts.clashTol ?? 0.015) * (persons[fighters[0]].height + persons[fighters[1]].height) / 2;
    // Croisement de lames : hors du premier quart de chaque lame (mains proches ≠ lames croisées)
    const outer = (b: Blade) => ({ a: { x: b.hilt.x + 0.25 * (b.tip.x - b.hilt.x), y: b.hilt.y + 0.25 * (b.tip.y - b.hilt.y) }, b: b.tip });
    for (const x of b0) for (const y of b1) {
      const sx = outer(x);
      const sy = outer(y);
      const { d, onFirst } = segmentDistance(sx.a, sx.b, sy.a, sy.b);
      if (d <= tol) clash = onFirst;
    }
  }
  return { persons, fighters, blades, contacts, clash };
}
