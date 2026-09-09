import { describe, it, expect } from 'vitest';
import {
  resampleUniform,
  zNormalize,
  estimateOffsetSec,
  findImpactSpikes,
  buildDisplayCurve,
  MotionSignal,
} from '../lib/varAnalysis';

/** Signal pseudo-aléatoire lisse et non périodique (somme de sinus incommensurables) */
function activity(t: number): number {
  return (
    2 +
    Math.sin(1.31 * t) +
    Math.sin(2.71 * t + 1.1) +
    Math.sin(0.93 * t + 0.4) +
    Math.sin(4.17 * t + 2.3) +
    Math.sin(6.29 * t + 0.7) +
    0.5 * Math.sin(9.51 * t + 1.9)
  );
}

/** Petit PRNG déterministe pour du bruit reproductible */
function makeRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

function sample(fn: (t: number) => number, t0: number, t1: number, dt: number): MotionSignal {
  const times: number[] = [];
  const values: number[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += dt) {
    times.push(t);
    values.push(fn(t));
  }
  return { times, values };
}

describe('resampleUniform', () => {
  it('interpolates a linear signal exactly', () => {
    const sig: MotionSignal = { times: [0, 1, 2, 3], values: [0, 10, 20, 30] };
    const uni = resampleUniform(sig, 0.5);
    expect(uni).not.toBeNull();
    expect(uni!.start).toBe(0);
    expect(uni!.values[0]).toBeCloseTo(0);
    expect(uni!.values[1]).toBeCloseTo(5);
    expect(uni!.values[2]).toBeCloseTo(10);
    expect(uni!.values[6]).toBeCloseTo(30);
  });

  it('returns null for signals too short to resample', () => {
    expect(resampleUniform({ times: [1], values: [5] }, 0.1)).toBeNull();
    expect(resampleUniform({ times: [], values: [] }, 0.1)).toBeNull();
  });

  it('handles irregular sampling', () => {
    const sig: MotionSignal = { times: [0, 0.3, 1.1, 2.0], values: [0, 3, 11, 20] };
    const uni = resampleUniform(sig, 0.1);
    expect(uni).not.toBeNull();
    // signal linéaire y = 10t malgré l'échantillonnage irrégulier
    for (let i = 0; i < uni!.values.length; i++) {
      expect(uni!.values[i]).toBeCloseTo((uni!.start + i * 0.1) * 10, 5);
    }
  });
});

describe('zNormalize', () => {
  it('produces zero mean and unit variance', () => {
    const v = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const z = zNormalize(v);
    const mean = Array.from(z).reduce((a, b) => a + b, 0) / z.length;
    const variance = Array.from(z).reduce((a, b) => a + b * b, 0) / z.length;
    expect(mean).toBeCloseTo(0, 5);
    expect(variance).toBeCloseTo(1, 4);
  });

  it('returns zeros for a constant signal', () => {
    const z = zNormalize(new Float32Array([4, 4, 4, 4]));
    expect(Array.from(z)).toEqual([0, 0, 0, 0]);
  });
});

describe('estimateOffsetSec', () => {
  it('recovers a known shift between two cameras filming the same scene', () => {
    const delta = 0.35; // la caméra B voit l'événement 350 ms plus tard dans son temps média
    const rngA = makeRng(1);
    const rngB = makeRng(2);
    // ~12 fps d'échantillonnage, bruit indépendant par caméra
    const a = sample((t) => activity(t) + 0.15 * rngA(), 0, 20, 0.08);
    const b = sample((t) => activity(t - delta) + 0.15 * rngB(), 0, 20, 0.08);

    const est = estimateOffsetSec(a, b);
    expect(est).not.toBeNull();
    expect(est!).toBeCloseTo(delta, 1);
    expect(Math.abs(est! - delta)).toBeLessThan(0.06);
  });

  it('recovers a negative shift', () => {
    const delta = -0.6;
    const a = sample((t) => activity(t), 0, 20, 0.08);
    const b = sample((t) => activity(t - delta), 0, 20, 0.08);
    const est = estimateOffsetSec(a, b);
    expect(est).not.toBeNull();
    expect(Math.abs(est! - delta)).toBeLessThan(0.06);
  });

  it('returns null for uncorrelated signals', () => {
    const rngA = makeRng(7);
    const rngB = makeRng(1234567);
    const a = sample(() => rngA(), 0, 20, 0.08);
    const b = sample(() => rngB(), 0, 20, 0.08);
    expect(estimateOffsetSec(a, b)).toBeNull();
  });

  it('returns null for signals too short to overlap', () => {
    const a = sample((t) => activity(t), 0, 0.5, 0.08);
    const b = sample((t) => activity(t), 0, 0.5, 0.08);
    expect(estimateOffsetSec(a, b)).toBeNull();
  });
});

describe('findImpactSpikes', () => {
  const bump = (t: number, center: number) => 6 * Math.exp(-((t - center) ** 2) / (2 * 0.04 ** 2));

  it('finds isolated impact spikes at the right times', () => {
    const rng = makeRng(3);
    const sig = sample((t) => 0.5 + 0.1 * rng() + bump(t, 3) + bump(t, 7.2), 0, 12, 0.05);
    const spikes = findImpactSpikes(sig);
    expect(spikes.length).toBe(2);
    expect(Math.abs(spikes[0] - 3)).toBeLessThan(0.15);
    expect(Math.abs(spikes[1] - 7.2)).toBeLessThan(0.15);
  });

  it('merges spikes closer than the minimum separation', () => {
    const rng = makeRng(4);
    const sig = sample((t) => 0.5 + 0.1 * rng() + bump(t, 5) + bump(t, 5.2), 0, 10, 0.05);
    const spikes = findImpactSpikes(sig, { minSeparationSec: 0.5 });
    expect(spikes.length).toBe(1);
    expect(Math.abs(spikes[0] - 5.1)).toBeLessThan(0.35);
  });

  it('returns nothing on a flat signal (static camera, sensor noise only)', () => {
    const rng = makeRng(5);
    const sig = sample(() => 0.5 + 0.05 * rng(), 0, 10, 0.05);
    expect(findImpactSpikes(sig)).toEqual([]);
  });

  it('still finds spikes on a busy scene with steady motion in between', () => {
    const rng = makeRng(6);
    // mouvement continu (médiane ~2) + un impact net (~8) : rapport max/médiane ≈ 4
    const sig = sample((t) => 2 + 0.3 * rng() + bump(t, 4), 0, 10, 0.05);
    const spikes = findImpactSpikes(sig);
    expect(spikes.length).toBe(1);
    expect(Math.abs(spikes[0] - 4)).toBeLessThan(0.15);
  });

  it('returns empty array for too-short signals', () => {
    expect(findImpactSpikes({ times: [0], values: [1] })).toEqual([]);
    expect(findImpactSpikes({ times: [], values: [] })).toEqual([]);
  });
});

describe('buildDisplayCurve', () => {
  it('returns one value per bin, normalised to 0..1', () => {
    const sig: MotionSignal = { times: [0, 1, 2, 3, 4], values: [1, 5, 2, 10, 1] };
    const curve = buildDisplayCurve(sig, 4, 8);
    expect(curve).not.toBeNull();
    expect(curve!.length).toBe(8);
    for (const v of Array.from(curve!)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(Math.max(...Array.from(curve!))).toBe(1);
  });

  it('fills bins without samples with the previous value (no holes)', () => {
    const sig: MotionSignal = { times: [0, 4], values: [4, 4] };
    const curve = buildDisplayCurve(sig, 4, 8);
    expect(Array.from(curve!).every((v) => v === 1)).toBe(true);
  });

  it('ignores samples outside the timeline and rejects degenerate input', () => {
    const sig: MotionSignal = { times: [-1, 0, 2, 9], values: [100, 1, 1, 100] };
    const curve = buildDisplayCurve(sig, 4, 4);
    expect(curve).not.toBeNull();
    expect(Math.max(...Array.from(curve!))).toBe(1); // le 100 hors plage n'a pas servi de référence
    expect(buildDisplayCurve({ times: [0], values: [1] }, 4)).toBeNull();
    expect(buildDisplayCurve(sig, 0)).toBeNull();
  });
});
