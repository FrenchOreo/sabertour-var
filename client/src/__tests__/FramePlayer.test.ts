import { describe, it, expect, vi } from 'vitest';
import { FramePlayer } from '../hooks/useFramePlayer';

function createMockVideo(overrides: Partial<HTMLVideoElement> = {}): HTMLVideoElement {
  return {
    currentTime: 0,
    duration: 10,
    paused: true,
    playbackRate: 1,
    pause: vi.fn(),
    play: vi.fn(),
    ...overrides,
  } as any as HTMLVideoElement;
}

describe('FramePlayer', () => {
  it('should calculate frame interval from fps', () => {
    const video = createMockVideo();
    const player = new FramePlayer(video, 30);
    expect(player.fps).toBe(30);
  });

  it('should step forward by one frame', async () => {
    const video = createMockVideo({ currentTime: 1.0 });
    const player = new FramePlayer(video, 30);

    await player.stepForward(1);

    expect(video.pause).toHaveBeenCalled();
    // currentTime should have been incremented by 1/30
    expect((video as any).currentTime).toBeCloseTo(1.0 + 1 / 30, 5);
  });

  it('should step forward by multiple frames', async () => {
    const video = createMockVideo({ currentTime: 1.0 });
    const player = new FramePlayer(video, 30);

    await player.stepForward(10);

    expect((video as any).currentTime).toBeCloseTo(1.0 + 10 / 30, 5);
  });

  it('should step backward by one frame', async () => {
    const video = createMockVideo({ currentTime: 1.0 });
    const player = new FramePlayer(video, 30);

    await player.stepBackward(1);

    expect(video.pause).toHaveBeenCalled();
    expect((video as any).currentTime).toBeCloseTo(1.0 - 1 / 30, 5);
  });

  it('should not go below zero when stepping backward', async () => {
    const video = createMockVideo({ currentTime: 0.01 });
    const player = new FramePlayer(video, 30);

    await player.stepBackward(10);

    expect((video as any).currentTime).toBe(0);
  });

  it('should set playback rate', () => {
    const video = createMockVideo();
    const player = new FramePlayer(video, 30);

    player.setPlaybackRate(0.25);
    expect(video.playbackRate).toBe(0.25);

    player.setPlaybackRate(1);
    expect(video.playbackRate).toBe(1);
  });

  it('should calculate current frame number', () => {
    const video = createMockVideo({ currentTime: 2.0 });
    const player = new FramePlayer(video, 30);

    expect(player.getCurrentFrameNumber()).toBe(60); // 2.0 * 30
  });

  it('should calculate total frames', () => {
    const video = createMockVideo({ duration: 10 });
    const player = new FramePlayer(video, 30);

    expect(player.getTotalFrames()).toBe(300); // 10 * 30
  });

  it('should handle Infinity duration gracefully', () => {
    const video = createMockVideo({ duration: Infinity });
    const player = new FramePlayer(video, 30);

    expect(player.getTotalFrames()).toBe(0);
  });

  it('should report paused state', () => {
    const video = createMockVideo({ paused: true });
    const player = new FramePlayer(video, 30);

    expect(player.paused).toBe(true);
  });

  it('should work with different fps values', () => {
    const video = createMockVideo({ currentTime: 1.0, duration: 5 });

    const player60 = new FramePlayer(video, 60);
    expect(player60.getCurrentFrameNumber()).toBe(60);
    expect(player60.getTotalFrames()).toBe(300);

    const player24 = new FramePlayer(video, 24);
    expect(player24.getCurrentFrameNumber()).toBe(24);
    expect(player24.getTotalFrames()).toBe(120);
  });
});
