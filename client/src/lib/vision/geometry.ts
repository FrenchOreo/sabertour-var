/** Géométrie 2D (pixels de l'image analysée). Fonctions pures. */

export interface Pt {
  x: number;
  y: number;
}

export const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Point de [a,b] le plus proche de p, et paramètre t ∈ [0,1] */
export function closestOnSegment(p: Pt, a: Pt, b: Pt): { pt: Pt; t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return { pt: { x: a.x + t * dx, y: a.y + t * dy }, t };
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsIntersect(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Distance minimale entre deux segments, et le point du premier segment qui réalise ce minimum */
export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): { d: number; onFirst: Pt } {
  if (segmentsIntersect(a, b, c, d)) {
    // Point d'intersection (les segments se croisent : distance nulle)
    const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
    const t = den === 0 ? 0 : ((a.x - c.x) * (c.y - d.y) - (a.y - c.y) * (c.x - d.x)) / den;
    return { d: 0, onFirst: { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } };
  }
  const cands = [
    { d: dist(a, closestOnSegment(a, c, d).pt), onFirst: a },
    { d: dist(b, closestOnSegment(b, c, d).pt), onFirst: b },
    (() => { const q = closestOnSegment(c, a, b).pt; return { d: dist(c, q), onFirst: q }; })(),
    (() => { const q = closestOnSegment(d, a, b).pt; return { d: dist(d, q), onFirst: q }; })(),
  ];
  return cands.reduce((m, x) => (x.d < m.d ? x : m));
}

/** Angle en degrés entre deux directions (0..180) */
export function angleBetween(ax: number, ay: number, bx: number, by: number): number {
  const n = Math.hypot(ax, ay) * Math.hypot(bx, by);
  if (n === 0) return 0;
  return (Math.acos(Math.max(-1, Math.min(1, (ax * bx + ay * by) / n))) * 180) / Math.PI;
}
