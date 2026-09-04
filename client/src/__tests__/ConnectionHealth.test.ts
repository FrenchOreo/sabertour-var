import { describe, it, expect } from 'vitest';
import { getHealth, ConnectionStats } from '../hooks/useConnectionStats';

const base: ConnectionStats = {
  bitrateKbps: 4000,
  fps: 60,
  width: 1280,
  height: 720,
  lossPct: 0,
  rttMs: 20,
  jitterBufferMs: 30,
  latencyMs: 40,
  peakFps: 60,
  stalledPolls: 0,
  connectionState: 'connected',
  updatedAt: 0,
};

describe('getHealth', () => {
  it('is good on a clean 60 fps link', () => {
    expect(getHealth(base)).toBe('good');
  });

  it('judges framerate against the best observed rate, not a fixed floor', () => {
    expect(getHealth({ ...base, fps: 45 })).toBe('degraded'); // 75 % du pic
    expect(getHealth({ ...base, fps: 25 })).toBe('bad'); // < 50 % du pic
    // Une caméra qui n'a jamais dépassé 30 fps n'est pas pénalisée pour ses 30 fps
    expect(getHealth({ ...base, fps: 30, peakFps: 30 })).toBe('good');
  });

  it('ignores framerate while the reference is unknown', () => {
    expect(getHealth({ ...base, fps: 15, peakFps: 15 })).toBe('good');
  });

  it('flags a stalled stream as bad', () => {
    expect(getHealth({ ...base, stalledPolls: 2 })).toBe('bad');
    expect(getHealth({ ...base, stalledPolls: 1 })).toBe('good');
  });

  it('grades packet loss and latency', () => {
    expect(getHealth({ ...base, lossPct: 2 })).toBe('degraded');
    expect(getHealth({ ...base, lossPct: 6 })).toBe('bad');
    expect(getHealth({ ...base, rttMs: 200 })).toBe('degraded');
  });
});
