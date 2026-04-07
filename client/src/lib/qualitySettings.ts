export type Resolution = '720p' | '1080p';
export type BitrateLevel = 'low' | 'medium' | 'high';

const RESOLUTION_KEY = 'saber-var-camera-resolution';
const BITRATE_KEY = 'saber-var-recording-bitrate';

const RESOLUTION_MAP: Record<Resolution, { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

const BITRATE_MAP: Record<BitrateLevel, number> = {
  low: 2_500_000,
  medium: 5_000_000,
  high: 8_000_000,
};

export function getResolution(): Resolution {
  const stored = localStorage.getItem(RESOLUTION_KEY);
  if (stored === '720p' || stored === '1080p') return stored;
  return '720p';
}

export function setResolution(res: Resolution): void {
  localStorage.setItem(RESOLUTION_KEY, res);
}

export function getResolutionConstraints(): { width: { ideal: number }; height: { ideal: number } } {
  const res = RESOLUTION_MAP[getResolution()];
  return { width: { ideal: res.width }, height: { ideal: res.height } };
}

export function getBitrateLevel(): BitrateLevel {
  const stored = localStorage.getItem(BITRATE_KEY);
  if (stored === 'low' || stored === 'medium' || stored === 'high') return stored;
  return 'medium';
}

export function setBitrateLevel(level: BitrateLevel): void {
  localStorage.setItem(BITRATE_KEY, level);
}

export function getBitrate(): number {
  return BITRATE_MAP[getBitrateLevel()];
}

export const RESOLUTION_OPTIONS: { value: Resolution; label: string }[] = [
  { value: '720p', label: '720p (1280×720)' },
  { value: '1080p', label: '1080p (1920×1080)' },
];

export const BITRATE_OPTIONS: { value: BitrateLevel; label: string }[] = [
  { value: 'low', label: 'Bas (2.5 Mbps)' },
  { value: 'medium', label: 'Moyen (5 Mbps)' },
  { value: 'high', label: 'Haut (8 Mbps)' },
];
