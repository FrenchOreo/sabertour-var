import { useRef, useCallback, useState } from 'react';

const BUFFER_DURATION_MS = 60_000;
const CHUNK_INTERVAL_MS = 100;

interface TimedChunk {
  data: Uint8Array;
  timestampMs: number;
  isInit: boolean;
}

export class VideoBuffer {
  private initSegment: Uint8Array | null = null;
  private chunks: TimedChunk[] = [];

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
    const cutoff = Date.now() - BUFFER_DURATION_MS;
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
    return new Blob(parts, { type: 'video/webm; codecs=vp8' });
  }

  getFullReplayBlob(): Blob | null {
    if (!this.initSegment) return null;

    const dataChunks = this.chunks.filter((c) => !c.isInit);
    if (dataChunks.length === 0) return null;

    const parts: BlobPart[] = [this.initSegment as BlobPart, ...dataChunks.map((c) => c.data as BlobPart)];
    return new Blob(parts, { type: 'video/webm; codecs=vp8' });
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
}

export function useVideoBuffer() {
  const buffersRef = useRef<Map<number, VideoBuffer>>(new Map());
  const recordersRef = useRef<Map<number, MediaRecorder>>(new Map());
  const [bufferDurations, setBufferDurations] = useState<Map<number, number>>(new Map());

  const startRecording = useCallback((slotId: number, stream: MediaStream) => {
    // Cleanup existing
    recordersRef.current.get(slotId)?.stop();

    const buffer = new VideoBuffer();
    buffersRef.current.set(slotId, buffer);
    let isFirstChunk = true;

    // Pick supported mime type
    const mimeTypes = [
      'video/webm; codecs=vp8',
      'video/webm',
      'video/mp4',
    ];
    let mimeType = '';
    for (const mt of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mt)) {
        mimeType = mt;
        break;
      }
    }

    if (!mimeType) {
      console.error('No supported MediaRecorder mimeType found');
      return;
    }

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 2_500_000,
    });

    recorder.ondataavailable = async (e) => {
      if (e.data.size > 0) {
        const arrayBuffer = await e.data.arrayBuffer();
        buffer.addChunk(arrayBuffer, isFirstChunk);
        isFirstChunk = false;

        setBufferDurations((prev) => {
          const next = new Map(prev);
          next.set(slotId, buffer.getBufferDurationMs());
          return next;
        });
      }
    };

    recorder.start(CHUNK_INTERVAL_MS);
    recordersRef.current.set(slotId, recorder);
  }, []);

  const stopRecording = useCallback((slotId: number) => {
    const recorder = recordersRef.current.get(slotId);
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    recordersRef.current.delete(slotId);
  }, []);

  const getBuffer = useCallback((slotId: number): VideoBuffer | undefined => {
    return buffersRef.current.get(slotId);
  }, []);

  return { startRecording, stopRecording, getBuffer, bufferDurations };
}
