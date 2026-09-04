import { useRef, useCallback, useState } from 'react';
import { getBitrate, getRecordingMimeType, getBufferDurationSec } from '../lib/qualitySettings';

// 250 ms : la granularité des chunks borne l'erreur de synchro entre caméras
// (l'alignement se fait sur les timestamps d'arrivée des chunks)
const CHUNK_INTERVAL_MS = 250;
// Keyframe forcée chaque seconde : la purge du buffer coupe en frontière de
// chunk, sans keyframe proche le début du replay serait illisible plusieurs secondes
const KEYFRAME_INTERVAL_MS = 1000;

interface TimedChunk {
  data: Uint8Array;
  timestampMs: number;
  isInit: boolean;
}

export class VideoBuffer {
  private initSegment: Uint8Array | null = null;
  private chunks: TimedChunk[] = [];
  private mimeType: string = 'video/webm; codecs=vp8';

  setMimeType(mt: string): void {
    this.mimeType = mt;
  }

  addChunk(data: ArrayBuffer, isFirst: boolean): void {
    const chunk = new Uint8Array(data);
    const now = Date.now();

    if (isFirst) {
      this.initSegment = chunk;
    }

    this.chunks.push({
      data: chunk,
      timestampMs: now,
      isInit: isFirst,
    });

    this.purgeOldChunks();
  }

  private purgeOldChunks(): void {
    const cutoff = Date.now() - (getBufferDurationSec() * 1000);
    this.chunks = this.chunks.filter(
      (c) => c.isInit || c.timestampMs > cutoff
    );
  }

  getReplayBlob(offsetFromNowMs: number, durationMs: number): Blob | null {
    if (!this.initSegment) return null;

    const endTime = Date.now() - offsetFromNowMs;
    const startTime = endTime - durationMs;

    const replayChunks = this.chunks.filter(
      (c) => !c.isInit && c.timestampMs >= startTime && c.timestampMs <= endTime
    );

    if (replayChunks.length === 0) return null;

    const parts: BlobPart[] = [this.initSegment as BlobPart, ...replayChunks.map((c) => c.data as BlobPart)];
    return new Blob(parts, { type: this.mimeType });
  }

  getFullReplayBlob(): Blob | null {
    if (!this.initSegment) return null;

    const dataChunks = this.chunks.filter((c) => !c.isInit);
    if (dataChunks.length === 0) return null;

    const parts: BlobPart[] = [this.initSegment as BlobPart, ...dataChunks.map((c) => c.data as BlobPart)];
    return new Blob(parts, { type: this.mimeType });
  }

  /** Known duration from chunk timestamps (reliable, unlike video.duration which is Infinity for WebM) */
  getReplayDurationMs(): number {
    const dataChunks = this.chunks.filter((c) => !c.isInit);
    if (dataChunks.length < 2) return 0;
    return dataChunks[dataChunks.length - 1].timestampMs - dataChunks[0].timestampMs;
  }

  getBufferDurationMs(): number {
    if (this.chunks.length < 2) return 0;
    const oldest = this.chunks.find((c) => !c.isInit);
    if (!oldest) return 0;
    return Date.now() - oldest.timestampMs;
  }

  hasData(): boolean {
    return this.initSegment !== null && this.chunks.length > 1;
  }

  /** Timestamp of the first data chunk (used to align multiple cameras) */
  getFirstChunkTimestamp(): number {
    const first = this.chunks.find((c) => !c.isInit);
    return first ? first.timestampMs : 0;
  }
}

export function useVideoBuffer() {
  const buffersRef = useRef<Map<number, VideoBuffer>>(new Map());
  const recordersRef = useRef<Map<number, MediaRecorder>>(new Map());
  const [bufferDurations, setBufferDurations] = useState<Map<number, number>>(new Map());
  const [recorderStatus, setRecorderStatus] = useState<Map<number, 'recording' | 'error' | 'idle'>>(new Map());

  const startRecording = useCallback((slotId: number, stream: MediaStream) => {
    // Cleanup existing
    recordersRef.current.get(slotId)?.stop();

    const buffer = new VideoBuffer();
    buffersRef.current.set(slotId, buffer);
    let isFirstChunk = true;

    // Use format from quality settings, with fallback to whatever is supported
    const mimeType = getRecordingMimeType();
    if (!mimeType) {
      console.error('No supported MediaRecorder mimeType found');
      return;
    }
    buffer.setMimeType(mimeType);

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: getBitrate(),
      // Chromium 121+ ; ignoré par les navigateurs qui ne le supportent pas
      videoKeyFrameIntervalDuration: KEYFRAME_INTERVAL_MS,
    } as MediaRecorderOptions & { videoKeyFrameIntervalDuration: number });

    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const arrayBuffer = await e.data.arrayBuffer();
        buffer.addChunk(arrayBuffer, isFirstChunk);
        isFirstChunk = false;

        // Un chunk toutes les 250 ms × 4 caméras = 16 re-renders/s si on publie à chaque fois :
        // on n'expose la durée qu'à la seconde entière (React ignore un state identique)
        setBufferDurations((prev) => {
          const roundedMs = Math.floor(buffer.getBufferDurationMs() / 1000) * 1000;
          if (prev.get(slotId) === roundedMs) return prev;
          const next = new Map(prev);
          next.set(slotId, roundedMs);
          return next;
        });
      }
    };

    recorder.onerror = (e: Event) => {
      console.error(`[MediaRecorder] Error on slot ${slotId}:`, e);
      setRecorderStatus((prev) => {
        const next = new Map(prev);
        next.set(slotId, 'error');
        return next;
      });
      // Try to restart
      try {
        if (recorder.state !== 'inactive') recorder.stop();
      } catch {}
      // Restart recording after a brief delay
      setTimeout(() => {
        try { startRecording(slotId, stream); } catch {}
      }, 1000);
    };

    try {
      recorder.start(CHUNK_INTERVAL_MS);
    } catch (e) {
      console.error(`[MediaRecorder] Failed to start on slot ${slotId}:`, e);
    }
    recordersRef.current.set(slotId, recorder);
    setRecorderStatus((prev) => {
      const next = new Map(prev);
      next.set(slotId, 'recording');
      return next;
    });
  }, []);

  const stopRecording = useCallback((slotId: number) => {
    const recorder = recordersRef.current.get(slotId);
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recordersRef.current.delete(slotId);
    setRecorderStatus((prev) => {
      const next = new Map(prev);
      next.set(slotId, 'idle');
      return next;
    });
  }, []);

  const pauseAllRecording = useCallback(() => {
    recordersRef.current.forEach((recorder) => {
      if (recorder.state === 'recording') {
        try { recorder.pause(); } catch {}
      }
    });
  }, []);

  const resumeAllRecording = useCallback(() => {
    recordersRef.current.forEach((recorder) => {
      if (recorder.state === 'paused') {
        try { recorder.resume(); } catch {}
      }
    });
  }, []);

  const getBuffer = useCallback((slotId: number): VideoBuffer | undefined => {
    return buffersRef.current.get(slotId);
  }, []);

  return { startRecording, stopRecording, pauseAllRecording, resumeAllRecording, getBuffer, bufferDurations, recorderStatus };
}
