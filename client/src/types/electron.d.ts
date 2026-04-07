export interface ElectronAPI {
  selectRecordingFolder: () => Promise<string | null>;
  saveRecordingChunk: (args: {
    folder: string;
    slotName: string;
    chunkIndex: number;
    data: Uint8Array;
  }) => Promise<{ path: string; size: number }>;
  getRecordingFolder: () => Promise<string | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
