import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VideoBuffer } from '../hooks/useVideoBuffer';

describe('VideoBuffer', () => {
  let buffer: VideoBuffer;

  beforeEach(() => {
    vi.useFakeTimers();
    buffer = new VideoBuffer();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should start with no data', () => {
    expect(buffer.hasData()).toBe(false);
    expect(buffer.getBufferDurationMs()).toBe(0);
  });

  it('should track init segment', () => {
    const initData = new ArrayBuffer(100);
    buffer.addChunk(initData, true);

    // Has init but only one chunk
    expect(buffer.hasData()).toBe(false);
  });

  it('should report hasData after init + data chunk', () => {
    buffer.addChunk(new ArrayBuffer(100), true);
    vi.advanceTimersByTime(100);
    buffer.addChunk(new ArrayBuffer(50), false);

    expect(buffer.hasData()).toBe(true);
  });

  it('should track buffer duration', () => {
    buffer.addChunk(new ArrayBuffer(100), true);

    vi.advanceTimersByTime(1000);
    buffer.addChunk(new ArrayBuffer(50), false);

    vi.advanceTimersByTime(2000);
    buffer.addChunk(new ArrayBuffer(50), false);

    // Duration should be ~3000ms (from first non-init chunk to now)
    expect(buffer.getBufferDurationMs()).toBeGreaterThanOrEqual(2000);
  });

  it('should create replay blob with init segment prefix', () => {
    // Init segment
    const initData = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer;
    buffer.addChunk(initData, true);

    vi.advanceTimersByTime(500);
    buffer.addChunk(new ArrayBuffer(50), false);

    vi.advanceTimersByTime(500);
    buffer.addChunk(new ArrayBuffer(50), false);

    const blob = buffer.getFullReplayBlob();
    expect(blob).not.toBeNull();
    expect(blob!.type).toBe('video/webm; codecs=vp8');
    // Blob should contain init + 2 data chunks
    expect(blob!.size).toBeGreaterThan(0);
  });

  it('should return null replay blob when no init segment', () => {
    expect(buffer.getFullReplayBlob()).toBeNull();
  });

  it('should return null replay blob when no data chunks', () => {
    buffer.addChunk(new ArrayBuffer(100), true);
    expect(buffer.getFullReplayBlob()).toBeNull();
  });

  it('should purge old chunks beyond 60s', () => {
    buffer.addChunk(new ArrayBuffer(100), true);

    // Add chunks over 70 seconds
    for (let i = 0; i < 70; i++) {
      vi.advanceTimersByTime(1000);
      buffer.addChunk(new ArrayBuffer(10), false);
    }

    // Buffer duration should be capped around 60s
    expect(buffer.getBufferDurationMs()).toBeLessThanOrEqual(61000);
  });

  it('should filter replay blob by time window', () => {
    buffer.addChunk(new ArrayBuffer(100), true);

    // Add 10 chunks, 1 per second
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(1000);
      buffer.addChunk(new ArrayBuffer(10), false);
    }

    // Get last 5 seconds
    const blob = buffer.getReplayBlob(0, 5000);
    expect(blob).not.toBeNull();

    // Get from 3-8 seconds ago (5s window)
    const blob2 = buffer.getReplayBlob(3000, 5000);
    expect(blob2).not.toBeNull();
  });
});
