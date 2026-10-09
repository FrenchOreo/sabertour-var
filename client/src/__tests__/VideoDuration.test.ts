import { describe, it, expect } from 'vitest';
import { snapFrameRate, frameRateFromMediaTimes } from '../lib/videoDuration';

describe('snapFrameRate', () => {
  it('snaps a noisy measurement onto the nearest common rate', () => {
    expect(snapFrameRate(59.2)).toBe(60);
    expect(snapFrameRate(29.1)).toBe(30);
    expect(snapFrameRate(24.6)).toBe(25);
    expect(snapFrameRate(51)).toBe(50);
  });

  it('keeps an unusual rate instead of forcing a wrong common one', () => {
    expect(snapFrameRate(40.04)).toBe(40);
    expect(snapFrameRate(15.3)).toBe(15.3);
  });
});

describe('frameRateFromMediaTimes', () => {
  const times = (fps: number, n: number, jitter = 0) => Array.from({ length: n }, (_, i) => i / fps + (i % 2 ? jitter : -jitter));

  it('recovers the frame rate from presented media times', () => {
    expect(frameRateFromMediaTimes(times(60, 60))!).toBeCloseTo(60, 0);
    expect(frameRateFromMediaTimes(times(30, 40))!).toBeCloseTo(30, 0);
  });

  it('is robust to dropped frames (lower quartile of the gaps, not the mean)', () => {
    const t = times(60, 90).filter((_, i) => i % 7 !== 3); // ~14 % d'images sautées
    expect(frameRateFromMediaTimes(t)!).toBeCloseTo(60, 0);
    // PC saturé : 2 images sur 3 sautées, il reste un tiers d'écarts simples
    const heavy = times(60, 120).filter((_, i) => i % 3 === 0 || i % 9 === 1);
    expect(frameRateFromMediaTimes(heavy)!).toBeCloseTo(60, 0);
  });

  it('tolerates timestamp jitter', () => {
    expect(frameRateFromMediaTimes(times(50, 60, 0.002))!).toBeCloseTo(50, 0);
  });

  it('returns null for too few samples or a frozen clock', () => {
    expect(frameRateFromMediaTimes([0, 0.016, 0.033])).toBeNull();
    expect(frameRateFromMediaTimes(new Array(20).fill(1))).toBeNull();
  });
});
