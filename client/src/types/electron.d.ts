export interface ElectronAPI {
  selectRecordingFolder: () => Promise<string | null>;
  saveRecordingChunk: (args: {
    folder: string;
    slotName: string;
    chunkIndex: number;
    data: Uint8Array;
    fileName?: string;
  }) => Promise<{ path: string; size: number }>;
  getRecordingFolder: () => Promise<string | null>;
  readRecordingFile: (filePath: string) => Promise<{ data: Uint8Array; size: number } | null>;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
