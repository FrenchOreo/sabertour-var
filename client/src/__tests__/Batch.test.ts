import { describe, it, expect } from 'vitest';
import { summarizeFile, batchTotals } from '../lib/vision/batch';
import type { VisionFrame, VisionStats } from '../lib/vision/types';

const frame = (t: number, contact = false, clash = false): VisionFrame => ({
  t, persons: 2, fighters: [], blades: [],
  contact: contact ? { zone: 'torse', gap: 0, point: { x: 0.5, y: 0.5 }, attacker: 0 } : null,
  clash: clash ? { x: 0.5, y: 0.3 } : null, inferMs: 20, totalMs: 25,
});
const stats = (n: number, blade: number): VisionStats => ({
  delegate: 'CPU', framesAnalysed: n, avgInferMs: 20, fightersShare: 1, bladeShare: blade, contactFrames: 0, clashFrames: 0, coveredSec: 60,
});

describe('batch', () => {
  it('summarizes one video: events, speed, size', () => {
    const r = summarizeFile('combat1.mp4', 50 * 1048576, 60, 30000, [frame(1), frame(2, true), frame(2.1, true), frame(5, false, true)], stats(4, 0.9));
    expect(r).toMatchObject({ name: 'combat1.mp4', sizeMB: 50, durationSec: 60, speed: 2, touches: 1, clashes: 1 });
    expect(r.events[0]).toMatchObject({ kind: 'touche', zone: 'torse', frames: 2 });
  });

  it('totals a batch and flags videos where blades are rarely seen', () => {
    const a = summarizeFile('a.mp4', 1, 60, 30000, [frame(1, true)], stats(100, 0.9));
    const b = summarizeFile('b.mp4', 1, 30, 15000, [], stats(300, 0.1));
    const failed = { ...summarizeFile('c.mp4', 1, null, 0, [], stats(0, 0)), error: 'illisible' };
    const t = batchTotals([a, b, failed]);
    expect(t).toMatchObject({ files: 3, failed: 1, videoSec: 90, wallSec: 45, touches: 1, lowBlade: ['b.mp4'] });
    expect(t.bladePct).toBe(30); // pondéré : (100×0,9 + 300×0,1) / 400
  });
});
