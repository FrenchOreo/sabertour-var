import { describe, it, expect } from 'vitest';
import { computeCameraTelemetry, SenderCounters } from '../lib/telemetry';
import { diagnoseCamera, diagnoseMac, worstCause } from '../lib/diagnosis';
import { getHealth, ConnectionStats } from '../hooks/useConnectionStats';
import type { CameraTelemetry } from 'shared/types';
import type { SystemMetrics } from '../types/electron';

const track = { requestedFps: 60, trackWidth: 1280, trackHeight: 720, trackFps: 30, maxFps: 30 };

function senderReport(o: Partial<Record<string, unknown>> = {}) {
  return [
    { type: 'media-source', kind: 'video', framesPerSecond: 30 },
    {
      type: 'outbound-rtp', kind: 'video', framesPerSecond: 29, bytesSent: 1_000_000, framesEncoded: 300,
      totalEncodeTime: 3, targetBitrate: 2_500_000, nackCount: 2, pliCount: 1,
      qualityLimitationReason: 'bandwidth', qualityLimitationDurations: { none: 5, cpu: 0, bandwidth: 5, other: 0 },
      ...o,
    },
    { type: 'remote-inbound-rtp', kind: 'video', roundTripTime: 0.042, fractionLost: 0.03 },
  ];
}

describe('computeCameraTelemetry (mesures réelles du téléphone)', () => {
  it('reads sensor fps, encoder target, RTCP round trip and loss on the first poll', () => {
    const { telemetry, counters } = computeCameraTelemetry(senderReport(), undefined, track, 10_000);
    expect(telemetry).toMatchObject({ sourceFps: 30, encodedFps: 29, targetKbps: 2500, rttMs: 42, remoteLossPct: 3, limitation: 'bandwidth', maxFps: 30 });
    // Pas de delta au premier sondage : pas de débit inventé
    expect(telemetry.sentKbps).toBeNull();
    expect(telemetry.bandwidthLimitedShare).toBeNull();
    expect(counters).toBeDefined();
  });

  it('computes real deltas between two polls (bitrate, encode time, limitation share)', () => {
    const first = computeCameraTelemetry(senderReport(), undefined, track, 10_000).counters as SenderCounters;
    const { telemetry } = computeCameraTelemetry(
      senderReport({ bytesSent: 1_500_000, framesEncoded: 360, totalEncodeTime: 3.6, nackCount: 5, pliCount: 1, qualityLimitationDurations: { none: 5.5, cpu: 0, bandwidth: 6.5, other: 0 } }),
      first, track, 12_000
    );
    expect(telemetry.sentKbps).toBe(2000); // 500 000 octets en 2 s
    expect(telemetry.encodeMsPerFrame).toBe(10); // 0,6 s pour 60 images
    expect(telemetry.nacks).toBe(3);
    expect(telemetry.bandwidthLimitedShare).toBe(0.75); // 1,5 s bridée sur 2 s
    expect(telemetry.cpuLimitedShare).toBe(0);
  });

  it('ignores counters that went backwards (new connection)', () => {
    const first = computeCameraTelemetry(senderReport({ bytesSent: 9_000_000 }), undefined, track, 10_000).counters;
    const { telemetry } = computeCameraTelemetry(senderReport({ bytesSent: 100 }), first, track, 12_000);
    expect(telemetry.sentKbps).toBeNull();
  });

  it('returns nulls without an outbound video stream', () => {
    const { telemetry, counters } = computeCameraTelemetry([], undefined, track, 1);
    expect(telemetry.encodedFps).toBeNull();
    expect(telemetry.limitation).toBeNull();
    expect(counters).toBeUndefined();
  });
});

const rxBase: ConnectionStats = {
  bitrateKbps: 3000, fps: 30, width: 1280, height: 720, lossPct: 0, rttMs: 20, jitterBufferMs: 30, latencyMs: 40,
  peakFps: 60, fpsSmooth: 30, stalledPolls: 0, connectionState: 'connected', updatedAt: 0,
  receivedFps: 30, decodedFps: 30, droppedPerSec: 0, decodeMsPerFrame: 4, freezeMs: 0,
};

const phone30: CameraTelemetry = {
  t: 0, requestedFps: 60, trackWidth: 1280, trackHeight: 720, trackFps: 30, maxFps: 30, sourceFps: 30, encodedFps: 30,
  sentKbps: 3000, targetKbps: 3000, limitation: 'none', bandwidthLimitedShare: 0, cpuLimitedShare: 0, encodeMsPerFrame: 5,
  rttMs: 20, remoteLossPct: 0, nacks: 0, plis: 0, batteryPct: null, charging: null,
};

describe('getHealth with phone measurements', () => {
  it('does not flag a 30 fps sensor as a network problem (old logic compared to a 60 fps peak)', () => {
    expect(getHealth({ ...rxBase, fps: 28, fpsSmooth: 28 })).toBe('bad'); // sans mesures du téléphone : 28 / 60
    expect(getHealth({ ...rxBase, fps: 28, fpsSmooth: 28 }, phone30)).toBe('good');
  });

  it('flags frames lost between phone and Mac, and real packet loss', () => {
    expect(getHealth({ ...rxBase, fps: 14, fpsSmooth: 14 }, phone30)).toBe('bad');
    expect(getHealth({ ...rxBase, lossPct: 2 }, phone30)).toBe('degraded');
    expect(getHealth({ ...rxBase, lossPct: 7 }, phone30)).toBe('bad');
    expect(getHealth(rxBase, { ...phone30, bandwidthLimitedShare: 0.8, limitation: 'bandwidth' })).toBe('degraded');
  });
});

describe('diagnoseCamera', () => {
  it('reports a sensor capped below the requested rate as information, not a fault', () => {
    const causes = diagnoseCamera(rxBase, phone30);
    expect(causes).toEqual([{ kind: 'capteur', severity: 'info', text: 'Capteur limité à 30 images/s (réglage 60)' }]);
  });

  it('separates WiFi, phone and Mac causes from their own counters', () => {
    const causes = diagnoseCamera(
      { ...rxBase, lossPct: 6, droppedPerSec: 8, decodeMsPerFrame: 40 },
      { ...phone30, maxFps: 60, bandwidthLimitedShare: 0.8, cpuLimitedShare: 0.5, encodeMsPerFrame: 25 },
      { maxGapMs: 6500, chunks: 2 }
    );
    const kinds = causes.map((c) => `${c.kind}:${c.severity}`);
    expect(kinds).toContain('wifi:bad'); // bridage WiFi 80 % et pertes 6 %
    expect(kinds).toContain('telephone:warn');
    expect(kinds).toContain('mac:bad'); // 8 images jetées/s et buffer interrompu 6,5 s
    expect(causes.some((c) => c.text === 'Enregistrement du buffer interrompu 6.5 s')).toBe(true);
    expect(causes.find((c) => c.text.startsWith('Le Mac jette'))!.text).toContain('40 ms/image');
    expect(worstCause(causes)!.severity).toBe('bad');
  });

  it('reports a live sensor slower than its capability (e.g. low light) with the measured value', () => {
    const causes = diagnoseCamera(rxBase, { ...phone30, maxFps: 60, sourceFps: 24 });
    expect(causes[0]).toMatchObject({ kind: 'capteur', severity: 'warn', text: 'La caméra ne produit que 24 images/s (réglage 60)' });
  });

  it('says nothing when nothing measured is wrong', () => {
    expect(diagnoseCamera(rxBase, { ...phone30, maxFps: 60, sourceFps: 59, requestedFps: 60 })).toEqual([]);
  });

  it('does not flag the normal 0.4–1 s fragment rhythm of MP4 recording', () => {
    expect(diagnoseCamera(rxBase, null, { maxGapMs: 1200, medianGapMs: 520, chunks: 9, mime: 'video/mp4' })).toEqual([]);
  });
});

const mac: SystemMetrics = {
  t: 0, platform: 'darwin', cpuModel: 'Apple M1', cpuCount: 8, systemCpuPct: 40, loadAvg1: 2,
  app: { totalPct: 150, gpuPct: 30, rendererPct: 100, browserPct: 10, otherPct: 10, memMB: 900 },
  memFreeMB: 3000, memTotalMB: 8192, thermal: 'nominal', onBattery: false,
  wifi: { interface: 'en0', connected: true, ssid: 'x', channel: 36, band: '5 GHz', widthMHz: 80, phyMode: '802.11ac', rssiDbm: -55, noiseDbm: -92, snrDb: 37, txRateMbps: 866, mcs: 9 },
  wifiAgeMs: 1000, lan: { name: 'en0', address: '192.168.1.10', isWifi: true }, appVersion: '1.2.2',
};

describe('diagnoseMac', () => {
  it('is quiet on a healthy Mac on 5 GHz', () => {
    expect(diagnoseMac(mac, { lagMaxMs: 40, lagP95Ms: 10, longTaskMs: 0, longTaskCount: 0, windowMs: 5000 })).toEqual([]);
  });

  it('reports CPU saturation, thermal throttling, weak 2.4 GHz WiFi and a frozen interface', () => {
    const causes = diagnoseMac(
      { ...mac, systemCpuPct: 92, thermal: 'serious', wifi: { ...(mac.wifi as object), band: '2,4 GHz', channel: 6, rssiDbm: -80, snrDb: 12, txRateMbps: 58 } as SystemMetrics['wifi'] },
      { lagMaxMs: 1400, lagP95Ms: 300, longTaskMs: 2600, longTaskCount: 9, windowMs: 5000 }
    );
    const texts = causes.map((c) => c.text);
    expect(texts).toContain("Processeur du Mac à 92 % (SABER VAR : 150 % d'un cœur)");
    expect(texts.some((t) => t.includes('surchauffe'))).toBe(true);
    expect(texts.some((t) => t.includes('2,4 GHz'))).toBe(true);
    expect(texts).toContain('Signal WiFi du Mac faible : -80 dBm');
    expect(texts.some((t) => t.startsWith('Interface bloquée jusqu\'à 1400 ms'))).toBe(true);
  });

  it('notes a wired Mac and ignores its WiFi radio', () => {
    const causes = diagnoseMac({ ...mac, lan: { name: 'en7', address: '192.168.1.10', isWifi: false }, wifi: { ...(mac.wifi as object), rssiDbm: -85 } as SystemMetrics['wifi'] }, null);
    expect(causes).toEqual([{ kind: 'wifi', severity: 'info', text: 'Mac relié par câble (en7)' }]);
  });
});
