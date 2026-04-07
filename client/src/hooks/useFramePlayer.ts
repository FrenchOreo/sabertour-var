import { useState, useCallback, useRef, useEffect } from 'react';

async function detectFPS(videoEl: HTMLVideoElement): Promise<number> {
  if ('requestVideoFrameCallback' in videoEl) {
    return new Promise((resolve) => {
      const frames: number[] = [];
      let count = 0;
      const cb = (_: DOMHighResTimeStamp, meta: any) => {
        frames.push(meta.mediaTime);
        count++;
        if (count < 10) {
          (videoEl as any).requestVideoFrameCallback(cb);
        } else {
          const intervals = frames.slice(1).map((t: number, i: number) => t - frames[i]);
          const avgInterval = intervals.reduce((a: number, b: number) => a + b) / intervals.length;
          resolve(Math.round(1 / avgInterval));
        }
      };
      (videoEl as any).requestVideoFrameCallback(cb);
      videoEl.play();
    });
  }
  return 30;
}

export class FramePlayer {
  private videoEl: HTMLVideoElement;
  fps: number;
  private frameInterval: number;

  constructor(videoEl: HTMLVideoElement, fps: number) {
    this.videoEl = videoEl;
    this.fps = fps;
    this.frameInterval = 1 / fps;
  }

  async stepForward(frames = 1): Promise<void> {
    this.videoEl.pause();
    const el = this.videoEl as any;
    if ('requestVideoFrameCallback' in el) {
      return new Promise((resolve) => {
        el.requestVideoFrameCallback(() => resolve());
        el.currentTime += this.frameInterval * frames;
      });
    } else {
      el.currentTime += this.frameInterval * frames;
    }
  }

  async stepBackward(frames = 1): Promise<void> {
    this.videoEl.pause();
    const el = this.videoEl as any;
    const target = Math.max(0, el.currentTime - this.frameInterval * frames);
    if ('requestVideoFrameCallback' in el) {
      return new Promise((resolve) => {
        el.requestVideoFrameCallback(() => resolve());
        el.currentTime = target;
      });
    } else {
      el.currentTime = target;
    }
  }

  setPlaybackRate(rate: number): void {
    this.videoEl.playbackRate = rate;
  }

  getCurrentFrameNumber(): number {
    return Math.round(this.videoEl.currentTime / this.frameInterval);
  }

  getTotalFrames(): number {
    if (!isFinite(this.videoEl.duration)) return 0;
    return Math.round(this.videoEl.duration / this.frameInterval);
  }

  play(): void {
    this.videoEl.play();
  }

  pause(): void {
    this.videoEl.pause();
  }

  get paused(): boolean {
    return this.videoEl.paused;
  }

  get currentTime(): number {
    return this.videoEl.currentTime;
  }

  get duration(): number {
    return this.videoEl.duration;
  }
}

export function useFramePlayer(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [player, setPlayer] = useState<FramePlayer | null>(null);
  const [fps, setFps] = useState(30);

  const init = useCallback(async () => {
    const el = videoRef.current;
    if (!el) return;

    let detectedFps = 30;
    try {
      detectedFps = await detectFPS(el);
    } catch {
      detectedFps = 30;
    }
    if (detectedFps < 10 || detectedFps > 240) detectedFps = 30;

    setFps(detectedFps);
    const fp = new FramePlayer(el, detectedFps);
    setPlayer(fp);
    return fp;
  }, [videoRef]);

  return { player, fps, init };
}
