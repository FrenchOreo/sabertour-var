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
  getSystemMetrics?: () => Promise<SystemMetrics>;
  appendDiagnostics?: (entries: unknown[]) => Promise<boolean>;
  exportDiagnostics?: () => Promise<string | null>;
  openDiagnosticsFolder?: () => Promise<void>;
}

export interface WifiInfo {
  interface: string | null;
  connected: boolean;
  ssid: string | null;
  channel: number | null;
  band: string | null;
  widthMHz: number | null;
  phyMode: string | null;
  rssiDbm: number | null;
  noiseDbm: number | null;
  snrDb: number | null;
  signalPct?: number | null;
  txRateMbps: number | null;
  rxRateMbps?: number | null;
  mcs: number | null;
  error?: string;
}

/** Mesures réelles de l'ordinateur arbitre (process Electron principal) */
export interface SystemMetrics {
  t: number;
  platform: string;
  cpuModel: string | null;
  cpuCount: number;
  systemCpuPct: number | null;
  loadAvg1: number | null;
  app: { totalPct: number; gpuPct: number; rendererPct: number; browserPct: number; otherPct: number; memMB: number };
  memFreeMB: number;
  memTotalMB: number;
  thermal: 'unknown' | 'nominal' | 'fair' | 'serious' | 'critical' | null;
  onBattery: boolean | null;
  wifi: WifiInfo | { error: string } | null;
  wifiAgeMs: number | null;
  lan: { name: string; address: string; isWifi: boolean | null } | null;
  appVersion: string;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}
