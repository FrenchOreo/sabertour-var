import { useState, useCallback, useRef } from 'react';
import type { SlotId } from 'shared/types';
import { getBitrate, getRecordingMimeType, getRecordingExtension } from '../lib/qualitySettings';

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`;
}

interface SlotRecordingState {
  recorder: MediaRecorder;
  stream: MediaStream;
  slotName: string;
  sessionTimestamp: string; // e.g. "2026-04-07_14-30-05"
  chunkIndex: number;
  accumulatedSize: number;
  totalSize: number;
  fileCount: number;
  chunks: Blob[];
  startTime: number;
}

export interface RecordingStatus {
  isRecording: boolean;
  fileCount: number;
  totalSize: number;
  startTime: number;
  slotName: string;
}

export function useRecording() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingFolder, setRecordingFolder] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Map<SlotId, RecordingStatus>>(new Map());
  const recordingsRef = useRef<Map<SlotId, SlotRecordingState>>(new Map());

  const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (!window.electronAPI) return null;
    const folder = await window.electronAPI.selectRecordingFolder();
    if (folder) setRecordingFolder(folder);
    return folder;
  }, []);

  const saveChunks = useCallback(async (state: SlotRecordingState, folder: string) => {
    if (state.chunks.length === 0) return;
    const blob = new Blob(state.chunks, { type: getRecordingMimeType() });
    const arrayBuffer = await blob.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const ext = getRecordingExtension();
    const partSuffix = state.chunkIndex > 0 ? `_part${state.chunkIndex + 1}` : '';
    const fileName = `${state.slotName}_${state.sessionTimestamp}${partSuffix}.${ext}`;

    try {
      const result = await window.electronAPI!.saveRecordingChunk({
        folder,
        slotName: state.slotName,
        chunkIndex: state.chunkIndex,
        data,
        fileName,
      });
      state.totalSize += result.size;
      state.fileCount += 1;
      state.chunkIndex += 1;
      state.chunks = [];
      state.accumulatedSize = 0;
    } catch (err) {
      console.error('[Recording] Failed to save chunk:', err);
    }
  }, []);

  const updateStatus = useCallback((slotId: SlotId) => {
    const state = recordingsRef.current.get(slotId);
    if (!state) return;
    setStatuses((prev) => {
      const next = new Map(prev);
      next.set(slotId, {
        isRecording: true,
        fileCount: state.fileCount,
        totalSize: state.totalSize,
        startTime: state.startTime,
        slotName: state.slotName,
      });
      return next;
    });
  }, []);

  const createRecorder = useCallback(
    (slotId: SlotId, state: SlotRecordingState, folder: string) => {
      const mimeType = getRecordingMimeType();
      if (!mimeType) {
        console.error('[Recording] No supported MediaRecorder mimeType');
        return null;
      }

      const recorder = new MediaRecorder(state.stream, {
        mimeType,
        videoBitsPerSecond: getBitrate(),
      });

      recorder.ondataavailable = async (e) => {
        if (e.data.size > 0) {
          state.chunks.push(e.data);
          state.accumulatedSize += e.data.size;
          updateStatus(slotId);

          if (state.accumulatedSize >= MAX_FILE_SIZE) {
            // Stop current recorder to finalize the WebM file segment
            recorder.stop();
            // Save will happen in onstop
          }
        }
      };

      recorder.onstop = async () => {
        // Save accumulated chunks
        await saveChunks(state, folder);
        updateStatus(slotId);

        // If still in the recordings map, start a new recorder for the next segment
        if (recordingsRef.current.has(slotId)) {
          const newRecorder = createRecorder(slotId, state, folder);
          if (newRecorder) {
            state.recorder = newRecorder;
            newRecorder.start(1000);
          }
        }
      };

      return recorder;
    },
    [saveChunks, updateStatus]
  );

  const startRecording = useCallback(
    async (slotId: SlotId, slotName: string, stream: MediaStream, folder: string) => {
      if (!window.electronAPI) return;

      // Stop existing recording on this slot
      const existing = recordingsRef.current.get(slotId);
      if (existing && existing.recorder.state !== 'inactive') {
        // Remove from map first so onstop doesn't restart
        recordingsRef.current.delete(slotId);
        existing.recorder.stop();
      }

      const state: SlotRecordingState = {
        recorder: null as unknown as MediaRecorder,
        stream,
        slotName,
        sessionTimestamp: formatTimestamp(new Date()),
        chunkIndex: 0,
        accumulatedSize: 0,
        totalSize: 0,
        fileCount: 0,
        chunks: [],
        startTime: Date.now(),
      };

      recordingsRef.current.set(slotId, state);

      const recorder = createRecorder(slotId, state, folder);
      if (!recorder) {
        recordingsRef.current.delete(slotId);
        return;
      }

      state.recorder = recorder;
      recorder.start(1000);
      setIsRecording(true);
      updateStatus(slotId);
    },
    [createRecorder, updateStatus]
  );

  const stopRecording = useCallback(
    (slotId: SlotId) => {
      const state = recordingsRef.current.get(slotId);
      if (!state) return;

      // Remove from map first so onstop doesn't restart
      recordingsRef.current.delete(slotId);

      if (state.recorder.state !== 'inactive') {
        state.recorder.stop();
        // onstop will handle saving remaining chunks
      }

      setStatuses((prev) => {
        const next = new Map(prev);
        next.delete(slotId);
        return next;
      });

      if (recordingsRef.current.size === 0) {
        setIsRecording(false);
      }
    },
    []
  );

  const stopAll = useCallback(() => {
    const slotIds = Array.from(recordingsRef.current.keys());
    for (const slotId of slotIds) {
      stopRecording(slotId);
    }
    setIsRecording(false);
  }, [stopRecording]);

  return {
    isElectron,
    isRecording,
    recordingFolder,
    statuses,
    selectFolder,
    startRecording,
    stopRecording,
    stopAll,
  };
}
