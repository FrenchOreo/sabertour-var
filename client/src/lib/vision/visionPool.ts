import type { VisionFrame } from './types';

/**
 * Workers de vision réutilisés d'une capture à l'autre (le modèle ne se charge qu'une fois).
 * Au plus MAX_WORKERS en parallèle : au-delà, le Mac décode trop de vidéos à la fois.
 */
export const MAX_WORKERS = 2;

export interface VisionWorker {
  delegate: string;
  /** temps mesuré d'une image d'essai (ms) par mode, au chargement */
  benchMs: { gpu: number | null; cpu: number | null };
  analyse: (bitmap: ImageBitmap, tsMs: number, mediaT: number) => Promise<VisionFrame>;
}

interface Slot {
  ready: Promise<VisionWorker>;
  busy: boolean;
}

const slots: Slot[] = [];
let failure: string | null = null;

function spawn(): Promise<VisionWorker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./visionWorker.ts', import.meta.url), { type: 'module' });
    let nextId = 1;
    const pending = new Map<number, { resolve: (f: VisionFrame) => void; reject: (e: Error) => void }>();
    const timeout = setTimeout(() => reject(new Error('chargement du modèle trop long (> 30 s)')), 30000);
    worker.onerror = (e) => { clearTimeout(timeout); reject(new Error(e.message || 'worker en erreur')); };
    worker.onmessage = (e: MessageEvent) => {
      const m = e.data;
      if (m.type === 'ready') {
        clearTimeout(timeout);
        resolve({
          delegate: m.delegate,
          benchMs: { gpu: m.gpuMs ?? null, cpu: m.cpuMs ?? null },
          analyse: (bitmap, tsMs, mediaT) =>
            new Promise<VisionFrame>((res, rej) => {
              const id = nextId++;
              pending.set(id, { resolve: res, reject: rej });
              worker.postMessage({ type: 'frame', id, bitmap, tsMs, mediaT }, [bitmap]);
            }),
        });
      } else if (m.type === 'error') {
        clearTimeout(timeout);
        reject(new Error(m.error));
      } else if (m.type === 'result') {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (!p) return;
        if (m.error) p.reject(new Error(m.error));
        else p.resolve(m.frame);
      }
    };
    worker.postMessage({
      type: 'init',
      wasmBase: new URL('/mediapipe/wasm', location.href).href,
      modelUrl: new URL('/models/pose_landmarker_lite.task', location.href).href,
      preferGpu: true,
    });
  });
}

/**
 * Précharge les workers (la 1re analyse VAR ne paie pas le chargement). Au démarrage on n'en
 * charge qu'un : le chargement occupe le processeur et ne doit pas geler le direct.
 */
export function warmUpVision(count = MAX_WORKERS): void {
  while (slots.length < Math.min(count, MAX_WORKERS) && !failure) {
    const ready = spawn();
    ready.catch((e) => { failure = String(e?.message ?? e); });
    slots.push({ ready, busy: false });
  }
}

/** Emprunte un worker libre ; null si la vision est indisponible sur cette machine */
export async function acquireVision(): Promise<{ worker: VisionWorker; release: () => void } | null> {
  if (slots.length === 0) warmUpVision(1);
  for (;;) {
    if (failure) return null;
    const free = slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      try {
        const worker = await free.ready;
        return { worker, release: () => { free.busy = false; } };
      } catch {
        free.busy = false;
        return null;
      }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

export function visionFailure(): string | null {
  return failure;
}
