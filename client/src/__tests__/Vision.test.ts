import { describe, it, expect } from 'vitest';
import { bladeMask, traceBladeFromHand } from '../lib/vision/blade';
import { segmentDistance, segmentsIntersect } from '../lib/vision/geometry';
import { analyzeFrame, personFromLandmarks, bladeBodyContact, RawLandmark } from '../lib/vision/fighters';
import { framesToEvents, fuseEvents, selectMarkers, FrameObs } from '../lib/vision/events';

const W = 320;
const H = 200;

function emptyMask(): Uint8Array {
  return new Uint8Array(W * H);
}

/** Trace un segment épais dans un masque */
function drawLine(mask: Uint8Array, x0: number, y0: number, x1: number, y1: number, thick = 1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const y = y0 + ((y1 - y0) * i) / n;
    for (let dx = -thick; dx <= thick; dx++) for (let dy = -thick; dy <= thick; dy++) {
      const xi = Math.round(x + dx);
      const yi = Math.round(y + dy);
      if (xi >= 0 && yi >= 0 && xi < W && yi < H) mask[yi * W + xi] = 1;
    }
  }
}

function fillRect(mask: Uint8Array, x0: number, y0: number, w: number, h: number) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) mask[y * W + x] = 1;
}

/** Silhouette synthétique au format MediaPipe (33 points normalisés), debout, bras armé tendu */
function person(cx: number, feetY: number, height: number, facing: 1 | -1): RawLandmark[] {
  const lm: RawLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  const set = (i: number, x: number, y: number) => { lm[i] = { x: x / W, y: y / H, visibility: 0.95 }; };
  const top = feetY - height;
  set(0, cx, top + 0.06 * height); // nez
  set(11, cx - 0.1 * height, top + 0.18 * height); set(12, cx + 0.1 * height, top + 0.18 * height); // épaules
  set(23, cx - 0.08 * height, top + 0.5 * height); set(24, cx + 0.08 * height, top + 0.5 * height); // hanches
  set(25, cx - 0.08 * height, top + 0.75 * height); set(26, cx + 0.08 * height, top + 0.75 * height); // genoux
  set(27, cx - 0.08 * height, feetY); set(28, cx + 0.08 * height, feetY); // chevilles
  // bras armé (côté facing) tendu vers l'avant, l'autre le long du corps
  const armSide = facing === 1 ? 1 : 0;
  const shX = lm[11 + armSide].x * W;
  const shY = lm[11 + armSide].y * H;
  set(13 + armSide, shX + facing * 0.15 * height, shY + 0.02 * height);
  set(15 + armSide, shX + facing * 0.28 * height, shY + 0.04 * height);
  set(19 + armSide, shX + facing * 0.32 * height, shY + 0.04 * height);
  const other = 1 - armSide;
  set(13 + other, lm[11 + other].x * W, shY + 0.15 * height);
  set(15 + other, lm[11 + other].x * W, shY + 0.28 * height);
  set(19 + other, lm[11 + other].x * W, shY + 0.31 * height);
  return lm;
}

describe('bladeMask', () => {
  it('keeps bright saturated pixels and blown-out white, rejects mid-grey and dull colours', () => {
    const px = [
      [40, 200, 255], // halo bleu vif
      [255, 255, 255], // cœur blanc saturé
      [180, 180, 180], // gris clair (mur)
      [170, 50, 50], // rouge trop sombre
      [230, 220, 215], // veste blanche dans l'ombre
    ];
    const rgba = px.flatMap((p) => [...p, 255]);
    expect(Array.from(bladeMask(rgba, 5, 1))).toEqual([1, 1, 0, 0, 0]);
  });
});

describe('traceBladeFromHand', () => {
  it('finds a thin bright line starting at the hand, with its tip', () => {
    const m = emptyMask();
    drawLine(m, 105, 95, 165, 45);
    const b = traceBladeFromHand(m, W, H, { x: 100, y: 99 }, 120);
    expect(b).not.toBeNull();
    expect(Math.hypot(b!.tip.x - 165, b!.tip.y - 45)).toBeLessThan(5);
    expect(b!.fill).toBeGreaterThan(0.8);
    expect(b!.widthPx).toBeLessThanOrEqual(5);
  });

  it('rejects a wide bright blob next to the hand (white jacket, window)', () => {
    const m = emptyMask();
    fillRect(m, 102, 70, 50, 60);
    expect(traceBladeFromHand(m, W, H, { x: 100, y: 99 }, 120)).toBeNull();
  });

  it('ignores a line that does not start at the hand (blade of someone else)', () => {
    const m = emptyMask();
    drawLine(m, 140, 99, 200, 99);
    expect(traceBladeFromHand(m, W, H, { x: 100, y: 99 }, 120)).toBeNull();
  });

  it('does not take the own forearm for a blade', () => {
    const m = emptyMask();
    drawLine(m, 100, 99, 60, 99); // manche clair qui remonte vers le coude
    const forearm = { x: 40, y: 0 }; // main − coude : le coude est à gauche
    expect(traceBladeFromHand(m, W, H, { x: 100, y: 99 }, 120, { forearm })).toBeNull();
  });
});

describe('geometry', () => {
  it('detects crossing segments and measures gaps', () => {
    expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 })).toBe(true);
    expect(segmentDistance({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 10, y: 5 }).d).toBeCloseTo(5);
  });
});

describe('analyzeFrame', () => {
  const left = person(100, 190, 140, 1);
  const right = person(220, 190, 140, -1);

  it('finds two armed fighters and a blade reaching the opponent torso', () => {
    const m = emptyMask();
    const pl = personFromLandmarks(left, W, H)!;
    const hand = pl.hands[1]!; // main droite (côté avant) du tireur de gauche
    drawLine(m, hand.x + 2, hand.y, 216, hand.y + 18); // lame vers le torse adverse
    const pr = personFromLandmarks(right, W, H)!;
    const h2 = pr.hands[0]!;
    drawLine(m, h2.x - 2, h2.y, h2.x - 30, h2.y - 45); // lame adverse levée
    const a = analyzeFrame([left, right], m, W, H);
    expect(a.fighters.sort()).toEqual([0, 1]);
    expect(a.blades.length).toBe(2);
    const c = a.contacts.find((x) => x.attacker === 0);
    expect(c?.zone).toBe('torse');
    expect(a.contacts.some((x) => x.attacker === 1)).toBe(false);
  });

  it('reports no contact when blades stay away from bodies', () => {
    const m = emptyMask();
    const pl = personFromLandmarks(left, W, H)!;
    const hand = pl.hands[1]!;
    drawLine(m, hand.x + 2, hand.y, hand.x + 30, hand.y - 50);
    const a = analyzeFrame([left, right], m, W, H);
    expect(a.contacts).toEqual([]);
  });

  it('detects a blade clash between the two fighters', () => {
    const m = emptyMask();
    const pl = personFromLandmarks(left, W, H)!;
    const pr = personFromLandmarks(right, W, H)!;
    const hl = pl.hands[1]!;
    const hr = pr.hands[0]!;
    drawLine(m, hl.x + 2, hl.y, 175, hl.y - 50);
    drawLine(m, hr.x - 2, hr.y, 150, hr.y - 50);
    const a = analyzeFrame([left, right], m, W, H);
    expect(a.clash).not.toBeNull();
  });

  it('does not call hands close together a blade clash', () => {
    const m = emptyMask();
    const pl = personFromLandmarks(left, W, H)!;
    const pr = personFromLandmarks(right, W, H)!;
    const hl = pl.hands[1]!;
    const hr = pr.hands[0]!;
    // deux lames levées qui partent de mains presque jointes, sans se croiser plus haut
    drawLine(m, hl.x + 1, hl.y, hl.x - 10, hl.y - 60);
    drawLine(m, hr.x - 1, hr.y, hr.x + 10, hr.y - 60);
    const a = analyzeFrame([left, right], m, W, H);
    expect(a.blades.length).toBe(2);
    expect(a.clash).toBeNull();
  });

  it('measures a contact on the head with a negative gap when the blade overlaps it', () => {
    const pr = personFromLandmarks(right, W, H)!;
    const head = { x: pr.lm[0].x, y: pr.lm[0].y };
    const c = bladeBodyContact({ hilt: { x: head.x - 60, y: head.y }, tip: { x: head.x, y: head.y }, support: 60, fill: 1, concentration: 10, widthPx: 3, angleDeg: 0 }, pr);
    expect(c?.zone).toBe('tête');
    expect(c!.gap).toBeLessThan(0);
  });
});

describe('events', () => {
  const f = (t: number, contact: FrameObs['contact'] = null, clash = false): FrameObs => ({ t, contact, clash });

  it('groups consecutive contact frames and dates the event at the closest approach', () => {
    const frames = [f(1.0), f(1.1, { zone: 'torse', gap: 0.01 }), f(1.2, { zone: 'torse', gap: -0.02 }), f(1.3, { zone: 'bras', gap: 0.0 }), f(2.5, { zone: 'tête', gap: 0.0 })];
    const ev = framesToEvents(frames);
    expect(ev.length).toBe(2);
    expect(ev[0]).toMatchObject({ kind: 'touche', t: 1.2, start: 1.1, end: 1.3, frames: 3, zone: 'torse' });
    expect(ev[1]).toMatchObject({ t: 2.5, zone: 'tête' });
  });

  it('keeps clashes separate from touches', () => {
    const ev = framesToEvents([f(3, null, true), f(3.1, null, true), f(3.1, { zone: 'bras', gap: 0 })]);
    expect(ev.map((e) => e.kind).sort()).toEqual(['clash', 'touche']);
  });

  it('fuses the same touch seen by two cameras, using the sync offsets', () => {
    const perCam = new Map([
      [1, framesToEvents([f(5.0, { zone: 'torse', gap: 0 })])],
      [2, framesToEvents([f(4.0, { zone: 'torse', gap: 0 }), f(9, { zone: 'jambe', gap: 0 })])],
    ]);
    // caméra 2 : temps média = timeline − 1 s (elle a commencé à filmer 1 s plus tard)
    const fused = fuseEvents(perCam, new Map([[1, 0], [2, -1]]));
    expect(fused.length).toBe(2);
    expect(fused[0]).toMatchObject({ kind: 'touche', t: 5, cams: [1, 2] });
    expect(fused[1]).toMatchObject({ t: 10, cams: [2] });
    // marqueurs : les touches vues par 2 caméras passent avant
    expect(selectMarkers([...fused, { kind: 'clash', t: 1, cams: [1], frames: 1 }], 2).map((e) => e.t)).toEqual([5, 10]);
  });
});
