/// <reference lib="webworker" />
/**
 * Vision dans un Web Worker : le modèle de silhouettes et la recherche des lames tournent HORS du
 * fil principal, l'affichage et la navigation image par image restent fluides pendant l'analyse.
 * Messages : init → ready | error ; frame → result (une image à la fois, l'appelant attend la réponse).
 */
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { bladeMask } from './blade';
import { analyzeFrame } from './fighters';
import type { VisionFrame } from './types';

declare const self: DedicatedWorkerGlobalScope;

// MediaPipe écrit ses messages d'information (« INFO: … », « W1013 … gl_context… ») sur la console
// d'erreurs : on les filtre pour que les vraies erreurs restent visibles
const quiet = (fn: (...a: unknown[]) => void) => (...a: unknown[]) => {
  if (typeof a[0] === 'string' && /^(INFO: |[IW]\d{4} [\d:.]+ +\d+ [\w.]+:\d+\] |Graph successfully)/.test(a[0])) return;
  fn(...a);
};
console.error = quiet(console.error.bind(console));
console.warn = quiet(console.warn.bind(console));
console.log = quiet(console.log.bind(console));
console.info = quiet(console.info.bind(console));

type InMsg =
  | { type: 'init'; wasmBase: string; modelUrl: string; preferGpu: boolean }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; tsMs: number; mediaT: number };

let landmarker: PoseLandmarker | null = null;
let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let lastTs = 0;

async function init(wasmBase: string, modelUrl: string, preferGpu: boolean) {
  const fileset = await FilesetResolver.forVisionTasks(wasmBase);
  // Dans un worker « module », MediaPipe charge son chargeur WASM par import() : le script n'y
  // définit pas `ModuleFactory` globalement (« ModuleFactory not set »). On l'exécute nous-mêmes
  // dans la portée globale du worker, comme le ferait importScripts — avant CHAQUE création, car
  // MediaPipe efface `ModuleFactory` une fois le modèle instancié.
  const res = await fetch(fileset.wasmLoaderPath);
  if (!res.ok) throw new Error(`chargeur du modèle introuvable (${res.status})`);
  const loader = await res.text();
  const make = (delegate: 'GPU' | 'CPU') => {
    if (!(self as unknown as { ModuleFactory?: unknown }).ModuleFactory) (0, eval)(loader);
    return PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numPoses: 6,
      minPoseDetectionConfidence: 0.4,
      minPosePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
  };
  // Le GPU n'est pas toujours le plus rapide (pilote logiciel, Mac Intel ancien) : on mesure
  // chaque mode sur une image d'essai et on garde le plus rapide
  const bench = async (lm: PoseLandmarker) => {
    const c = new OffscreenCanvas(512, 288);
    const g = c.getContext('2d')!;
    g.fillStyle = '#222';
    g.fillRect(0, 0, 512, 288);
    let best = Infinity;
    for (let i = 0; i < 4; i++) {
      const bmp = c.transferToImageBitmap();
      g.fillRect(0, 0, 512, 288);
      const ts = (lastTs = lastTs + 40);
      const t0 = performance.now();
      lm.detectForVideo(bmp, ts);
      const ms = performance.now() - t0;
      bmp.close();
      if (i > 0) best = Math.min(best, ms);
      // Déjà trop lent : inutile d'insister
      if (i > 0 && ms > 150) break;
    }
    return best;
  };
  let gpuMs = Infinity;
  if (preferGpu) {
    try {
      landmarker = await make('GPU');
      gpuMs = await bench(landmarker);
      if (gpuMs <= 40) return { delegate: 'GPU', gpuMs: Math.round(gpuMs), cpuMs: null };
    } catch {
      // Pas de WebGL utilisable dans ce worker : processeur (la fermeture d'une instance GPU
      // à moitié créée peut elle-même échouer)
      try { landmarker?.close(); } catch { /* contexte GL absent */ }
      landmarker = null;
    }
  }
  const cpu = await make('CPU');
  const cpuMs = await bench(cpu);
  if (landmarker && gpuMs <= cpuMs) {
    try { cpu.close(); } catch { /* sans effet */ }
    return { delegate: 'GPU', gpuMs: Math.round(gpuMs), cpuMs: Math.round(cpuMs) };
  }
  try { landmarker?.close(); } catch { /* sans effet */ }
  landmarker = cpu;
  return { delegate: 'CPU', gpuMs: Number.isFinite(gpuMs) ? Math.round(gpuMs) : null, cpuMs: Math.round(cpuMs) };
}

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      const r = await init(msg.wasmBase, msg.modelUrl, msg.preferGpu);
      self.postMessage({ type: 'ready', ...r });
    } catch (err) {
      const m = String((err as Error)?.message ?? err);
      self.postMessage({ type: 'error', error: /activeTexture|WebGL|OpenGL|kGpuService/.test(m) ? `WebGL indisponible (${m})` : m });
    }
    return;
  }
  if (msg.type === 'frame') {
    const { bitmap, id, mediaT } = msg;
    const t0 = performance.now();
    try {
      if (!landmarker) throw new Error('modèle non chargé');
      const w = bitmap.width;
      const h = bitmap.height;
      if (!canvas || canvas.width !== w || canvas.height !== h) {
        canvas = new OffscreenCanvas(w, h);
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      ctx!.drawImage(bitmap, 0, 0);
      const pixels = ctx!.getImageData(0, 0, w, h).data;
      const mask = bladeMask(pixels, w, h);
      // Le mode VIDEO exige des horodatages strictement croissants
      const ts = Math.max(msg.tsMs, lastTs + 1);
      lastTs = ts;
      const t1 = performance.now();
      const res = landmarker.detectForVideo(bitmap, ts);
      const inferMs = performance.now() - t1;
      const a = analyzeFrame(res.landmarks, mask, w, h);
      const n = (p: { x: number; y: number }) => ({ x: p.x / w, y: p.y / h });
      const frame: VisionFrame = {
        t: mediaT,
        persons: a.persons.length,
        fighters: a.fighters.map((i) => a.persons[i].lm.map((p) => [p.x / w, p.y / h, p.v] as [number, number, number])),
        blades: a.blades.map((b) => ({ hilt: n(b.hilt), tip: n(b.tip), owner: a.fighters.indexOf(b.owner) })),
        contact: a.contacts.length
          ? (() => {
              const c = a.contacts.reduce((m, x) => (x.gap < m.gap ? x : m));
              return { zone: c.zone, gap: c.gap, point: n(c.point), attacker: a.fighters.indexOf(c.attacker) };
            })()
          : null,
        clash: a.clash ? n(a.clash) : null,
        inferMs: Math.round(inferMs),
        totalMs: Math.round(performance.now() - t0),
      };
      self.postMessage({ type: 'result', id, frame });
    } catch (err) {
      self.postMessage({ type: 'result', id, error: String((err as Error)?.message ?? err) });
    } finally {
      bitmap.close();
    }
  }
};
