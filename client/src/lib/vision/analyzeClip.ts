import type { MotionSignal } from '../varAnalysis';
import type { VisionFrame, VisionStats } from './types';
import type { VisionWorker } from './visionPool';

/**
 * Lit UNE vidéo de la capture une seule fois et en tire :
 * - le signal d'intensité du mouvement (courbe orange, synchro entre caméras) à chaque image,
 * - si un worker de vision est fourni : silhouettes, lames et contacts sur ~12 images/s.
 * Les 15 dernières secondes sont lues EN PREMIER : l'action litigieuse est presque toujours juste
 * avant l'appui sur VAR, ses marqueurs apparaissent donc tout de suite.
 */

export interface AnalyzeClipOptions {
  worker?: VisionWorker | null;
  /** durée connue ou estimée (s) */
  durationSec: number;
  /** images analysées par seconde de vidéo par le modèle */
  visionFps?: number;
  /** largeur des images envoyées au modèle */
  visionWidth?: number;
  /** vitesse de lecture fixe ; par défaut elle s'adapte au temps d'analyse mesuré */
  playbackRate?: number;
  /** secondes lues en priorité à la fin */
  priorityTailSec?: number;
  abort?: { aborted: boolean };
  onProgress?: (fraction: number) => void;
  onVisionFrame?: (f: VisionFrame) => void;
}

export interface ClipAnalysis {
  motion: MotionSignal;
  frames: VisionFrame[];
  stats: VisionStats;
  wallMs: number;
}

export function analyzeClip(blobUrl: string, opts: AnalyzeClipOptions): Promise<ClipAnalysis> {
  const visionFps = opts.visionFps ?? 12;
  const visionWidth = opts.visionWidth ?? 512;
  // Sans modèle : 4× (mouvement seul). Avec modèle : aussi vite que possible tout en gardant
  // ~visionFps images analysées par seconde de vidéo ; la fin (action litigieuse) peut
  // descendre jusqu'à 1×, le reste pas sous 2×
  let rate = opts.playbackRate ?? (opts.worker ? 2 : 4);
  const adaptive = opts.playbackRate === undefined && !!opts.worker;
  let avgVisionMs = 0;
  const D = opts.durationSec;
  const tail = opts.priorityTailSec ?? 15;
  // Segments [début, fin] en temps média : la fin d'abord
  const segments: [number, number][] = tail > 0 && D > tail + 5 ? [[D - tail, Infinity], [0, D - tail]] : [[0, Infinity]];
  const started = performance.now();

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Doit rester composité pour que requestVideoFrameCallback tire à chaque image : AU-DESSUS de
    // l'interface (2 px quasi transparents) — derrière l'écran VAR, Chromium cesse de la composer
    Object.assign(video.style, { position: 'fixed', bottom: '0', right: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '2147483647' });
    document.body.appendChild(video);
    const small = document.createElement('canvas');
    const sctx = small.getContext('2d', { willReadFrequently: true })!;

    const motionPts: { t: number; v: number }[] = [];
    const frames: VisionFrame[] = [];
    let prevLuma: Float32Array | null = null;
    let prevT = -1;
    let seg = 0;
    let busy = false;
    let lastVisionT = -Infinity;
    let lastFrameWall = performance.now();
    let finished = false;
    let seekingSeg = false;
    let visionError: string | undefined;
    // Décodeur bloqué (machine saturée, saut dans un fichier sans index) : relances puis segment suivant
    let stalls = 0;
    let segStalls = 0;
    let endReason = 'fin';
    let seekStartWall = 0;
    const stallStates: string[] = [];
    // Trous dans l'enregistrement (aucune image pendant > 0,5 s de vidéo : flux gelé pendant le direct)
    const holes: [number, number][] = [];
    let lastCheckTime = -1;
    const covered: [number, number][] = [];
    let segStartT: number | null = null;

    const cleanup = () => {
      finished = true;
      clearInterval(watchdog);
      try { video.pause(); } catch { /* déjà arrêtée */ }
      video.removeAttribute('src');
      video.remove();
    };

    const finish = async () => {
      if (finished) return;
      closeSegment();
      cleanup();
      // Laisse le dernier envoi au worker se terminer
      for (let i = 0; busy && i < 50; i++) await new Promise((r) => setTimeout(r, 20));
      motionPts.sort((a, b) => a.t - b.t);
      const uniq = motionPts.filter((p, i) => i === 0 || p.t > motionPts[i - 1].t);
      frames.sort((a, b) => a.t - b.t);
      const n = frames.length;
      resolve({
        motion: { times: uniq.map((p) => p.t), values: uniq.map((p) => p.v) },
        frames,
        wallMs: Math.round(performance.now() - started),
        stats: {
          delegate: opts.worker?.delegate ?? null,
          framesAnalysed: n,
          avgInferMs: n ? Math.round(frames.reduce((s, f) => s + f.inferMs, 0) / n) : 0,
          fightersShare: n ? Math.round((frames.filter((f) => f.fighters.length === 2).length / n) * 100) / 100 : 0,
          bladeShare: n ? Math.round((frames.filter((f) => f.blades.length > 0).length / n) * 100) / 100 : 0,
          contactFrames: frames.filter((f) => f.contact).length,
          clashFrames: frames.filter((f) => f.clash).length,
          error: visionError,
          stalls,
          endReason,
          stallStates,
          holes,
          coveredSec: Math.round(covered.reduce((s, [a, b]) => s + Math.max(0, b - a), 0) * 10) / 10,
        },
      });
    };

    const closeSegment = () => {
      if (segStartT !== null && prevT >= 0) covered.push([segStartT, prevT]);
      segStartT = null;
    };

    const nextSegment = () => {
      closeSegment();
      seg++;
      segStalls = 0;
      if (seg >= segments.length) { finish(); return; }
      seekingSeg = true;
      seekStartWall = performance.now();
      prevLuma = null;
      prevT = -1;
      video.pause();
      video.currentTime = segments[seg][0];
      video.addEventListener('seeked', () => {
        seekingSeg = false;
        video.play().then(() => { video.playbackRate = rate; }).catch(() => finish());
      }, { once: true });
    };

    const watchdog = setInterval(() => {
      if (finished) return;
      if (opts.abort?.aborted) { endReason = 'annulée'; finish(); return; }
      // Saut jamais terminé : on rend ce qu'on a
      if (seekingSeg) {
        if (performance.now() - seekStartWall > 6000) { stalls++; endReason = 'saut bloqué'; finish(); }
        return;
      }
      if (performance.now() - lastFrameWall < 2500) return;
      // La lecture avance mais aucune image : trou dans le fichier, pas un blocage — on laisse filer
      const ct = video.currentTime;
      if (!video.paused && ct > lastCheckTime + 0.5) { lastCheckTime = ct; lastFrameWall = performance.now(); return; }
      lastCheckTime = ct;
      // Plus d'image depuis 2,5 s : on relance la lecture un peu plus loin (2 fois), puis on passe
      // au segment suivant — un blocage ne doit pas faire perdre toute l'analyse
      stalls++;
      segStalls++;
      lastFrameWall = performance.now();
      // État du lecteur au blocage (journal) : position, readyState, en pause ou non, segment
      if (stallStates.length < 6) stallStates.push(`${video.currentTime.toFixed(2)}s rs${video.readyState} ${video.paused ? 'pause' : 'lecture'} seg${seg}`);
      if (segStalls <= 2) {
        const from = prevT >= 0 ? prevT : video.currentTime;
        prevLuma = null; // pas de faux pic de mouvement à travers le saut
        video.currentTime = from + 0.2;
        video.play().then(() => { video.playbackRate = rate; }).catch(() => { /* le segment suivant prendra le relais */ });
      } else if (motionPts.length > 1 || seg + 1 < segments.length) {
        endReason = 'blocage';
        nextSegment();
      } else {
        endReason = 'blocage';
        finish();
      }
    }, 500);

    video.addEventListener('ended', () => { if (!finished) nextSegment(); });
    video.addEventListener('error', () => {
      if (motionPts.length > 1) finish();
      else { cleanup(); reject(new Error(`lecture du fichier impossible (code ${video.error?.code ?? '?'})`)); }
    });

    type RVFC = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
    const rvfc = (video as HTMLVideoElement & { requestVideoFrameCallback?: RVFC }).requestVideoFrameCallback?.bind(video);
    if (!rvfc) { cleanup(); reject(new Error('requestVideoFrameCallback non supporté')); return; }

    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (finished) return;
      lastFrameWall = performance.now();
      const t = meta.mediaTime;
      if (seekingSeg) { rvfc(onFrame); return; }
      if (segStartT === null) {
        segStartT = t;
        // Trou juste au début du segment (après un saut)
        if (t - segments[seg][0] > 0.5 && holes.length < 8) holes.push([Math.round(segments[seg][0] * 100) / 100, Math.round((t - segments[seg][0]) * 100) / 100]);
      }
      // Fin du segment prioritaire : on repart du début de la vidéo
      if (t >= segments[seg][1]) { nextSegment(); rvfc(onFrame); return; }

      // Intensité du mouvement (petite image 96 px)
      if (small.width === 0) {
        const s = 96 / Math.max(video.videoWidth || 16, video.videoHeight || 9);
        small.width = Math.max(2, Math.round((video.videoWidth || 16) * s));
        small.height = Math.max(2, Math.round((video.videoHeight || 9) * s));
      }
      sctx.drawImage(video, 0, 0, small.width, small.height);
      const d = sctx.getImageData(0, 0, small.width, small.height).data;
      const nPix = small.width * small.height;
      const luma = new Float32Array(nPix);
      for (let i = 0; i < nPix; i++) luma[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
      if (prevT >= 0 && t - prevT > 0.5 && holes.length < 8) holes.push([Math.round(prevT * 100) / 100, Math.round((t - prevT) * 100) / 100]);
      if (prevLuma && t > prevT) {
        let sum = 0;
        for (let i = 0; i < nPix; i++) sum += Math.abs(luma[i] - prevLuma[i]);
        motionPts.push({ t, v: sum / nPix / (t - prevT) });
      }
      prevLuma = luma;
      prevT = t;

      // Silhouettes + lames : une image à la fois dans le worker (les autres sont sautées)
      if (opts.worker && !busy && t - lastVisionT >= 1 / visionFps) {
        busy = true;
        lastVisionT = t;
        const vh = Math.round((visionWidth * (video.videoHeight || 9)) / (video.videoWidth || 16));
        createImageBitmap(video, { resizeWidth: visionWidth, resizeHeight: vh, resizeQuality: 'medium' })
          .then((bmp) => opts.worker!.analyse(bmp, performance.now(), t))
          .then((f) => {
            frames.push(f);
            opts.onVisionFrame?.(f);
            if (adaptive) {
              avgVisionMs = avgVisionMs ? avgVisionMs * 0.8 + f.totalMs * 0.2 : f.totalMs;
              const min = seg === 0 ? 1 : 2;
              const want = Math.max(min, Math.min(4, 1000 / (visionFps * (avgVisionMs + 8))));
              if (Math.abs(want - rate) / rate > 0.15) {
                rate = want;
                if (!seekingSeg && !video.paused) video.playbackRate = rate;
              }
            }
          })
          .catch((e) => { visionError = String(e?.message ?? e); })
          .finally(() => { busy = false; });
      }

      if (opts.onProgress && D > 0) {
        const done = covered.reduce((s, [a, b]) => s + (b - a), 0) + (segStartT !== null ? t - segStartT : 0);
        opts.onProgress(Math.min(1, done / D));
      }
      rvfc(onFrame);
    };

    rvfc(onFrame);
    video.src = blobUrl;
    const start = () => {
      video.play().then(() => { video.playbackRate = rate; }).catch(() => { cleanup(); reject(new Error("impossible de démarrer la lecture d'analyse")); });
    };
    if (segments[0][0] > 0) {
      seekingSeg = true;
      seekStartWall = performance.now();
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = segments[0][0];
        video.addEventListener('seeked', () => { seekingSeg = false; start(); }, { once: true });
      }, { once: true });
    } else {
      start();
    }
  });
}
