/**
 * Analyse vidéo du buffer VAR — 100 % locale, sans modèle externe.
 *
 * Deux usages :
 * 1. Détection de touches candidates : les impacts (touche, parade, clash)
 *    produisent un pic brutal d'énergie de mouvement inter-frames. On marque
 *    ces pics sur la timeline pour que l'arbitre y saute directement.
 * 2. Synchro automatique : toutes les caméras filment la même scène, donc
 *    leurs signaux d'énergie de mouvement sont corrélés. La corrélation
 *    croisée donne le décalage temporel réel entre deux caméras.
 */

export interface MotionSignal {
  /** temps média (secondes) de chaque échantillon */
  times: number[];
  /** énergie de mouvement normalisée par seconde */
  values: number[];
}

export interface UniformSignal {
  start: number;
  dt: number;
  values: Float32Array;
}

// ==================== Fonctions pures (testées unitairement) ====================

/** Ré-échantillonne un signal irrégulier sur une grille uniforme (interpolation linéaire). */
export function resampleUniform(sig: MotionSignal, dt: number): UniformSignal | null {
  const { times, values } = sig;
  if (times.length < 2 || dt <= 0) return null;
  const start = times[0];
  const end = times[times.length - 1];
  const n = Math.floor((end - start) / dt) + 1;
  if (n < 2) return null;

  const out = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i * dt;
    while (j < times.length - 2 && times[j + 1] < t) j++;
    const t0 = times[j];
    const t1 = times[j + 1];
    const alpha = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0;
    out[i] = values[j] + alpha * (values[j + 1] - values[j]);
  }
  return { start, dt, values: out };
}

/** Normalisation z (moyenne 0, écart-type 1). Retourne un nouveau tableau. */
export function zNormalize(values: Float32Array): Float32Array {
  const n = values.length;
  const out = new Float32Array(n);
  if (n === 0) return out;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += values[i];
  mean /= n;
  let variance = 0;
  for (let i = 0; i < n; i++) variance += (values[i] - mean) ** 2;
  const std = Math.sqrt(variance / n);
  if (std < 1e-9) return out;
  for (let i = 0; i < n; i++) out[i] = (values[i] - mean) / std;
  return out;
}

export interface OffsetOptions {
  /** décalage maximal recherché en secondes (défaut 2.5) */
  maxLagSec?: number;
  /** pas de la grille en secondes (défaut 0.05) */
  dt?: number;
  /** corrélation minimale pour accepter le résultat (défaut 0.35) */
  minCorrelation?: number;
  /** recouvrement minimal en secondes pour que la corrélation soit fiable (défaut 3) */
  minOverlapSec?: number;
}

/**
 * Estime le décalage δ (secondes) tel que b(t + δ) ≈ a(t) :
 * un événement visible à l'instant t sur la caméra A apparaît à t + δ sur la caméra B.
 * Retourne null si les signaux ne se ressemblent pas assez pour conclure.
 */
export function estimateOffsetSec(a: MotionSignal, b: MotionSignal, opts: OffsetOptions = {}): number | null {
  const dt = opts.dt ?? 0.05;
  const maxLagSec = opts.maxLagSec ?? 2.5;
  const minCorrelation = opts.minCorrelation ?? 0.35;
  const minOverlapSec = opts.minOverlapSec ?? 3;

  const ua = resampleUniform(a, dt);
  const ub = resampleUniform(b, dt);
  if (!ua || !ub) return null;

  const va = zNormalize(ua.values);
  const vb = zNormalize(ub.values);
  const maxLagSteps = Math.round(maxLagSec / dt);
  const minOverlap = Math.ceil(minOverlapSec / dt);

  let bestCorr = -Infinity;
  let bestLagSteps = 0;
  const corrByLag = new Map<number, number>();

  for (let lag = -maxLagSteps; lag <= maxLagSteps; lag++) {
    // échantillon a[i] (temps ua.start + i*dt) comparé à b au temps (ta + lagSec)
    // → indice j = (ta + lagSec - ub.start) / dt = i + shift
    const shift = Math.round((ua.start + lag * dt - ub.start) / dt);
    let sum = 0;
    let count = 0;
    const iStart = Math.max(0, -shift);
    const iEnd = Math.min(va.length, vb.length - shift);
    for (let i = iStart; i < iEnd; i++) {
      sum += va[i] * vb[i + shift];
      count++;
    }
    if (count < minOverlap) continue;
    const corr = sum / count;
    corrByLag.set(lag, corr);
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLagSteps = lag;
    }
  }

  if (bestCorr < minCorrelation) return null;

  // Interpolation parabolique autour du pic pour une précision sous-échantillon
  const cPrev = corrByLag.get(bestLagSteps - 1);
  const cNext = corrByLag.get(bestLagSteps + 1);
  let refined = bestLagSteps;
  if (cPrev !== undefined && cNext !== undefined) {
    const denom = cPrev - 2 * bestCorr + cNext;
    if (Math.abs(denom) > 1e-9) {
      const delta = (0.5 * (cPrev - cNext)) / denom;
      if (Math.abs(delta) <= 1) refined = bestLagSteps + delta;
    }
  }
  return refined * dt;
}

/** En dessous de ce rapport max/médiane, le signal est considéré plat (aucun impact) */
export const FLAT_SIGNAL_RATIO = 2.5;

export interface SpikeOptions {
  /** pas de la grille en secondes (défaut 0.05) */
  dt?: number;
  /** z-score robuste minimal pour un pic (défaut 3) */
  threshold?: number;
  /** distance minimale entre deux pics en secondes (défaut 0.5) */
  minSeparationSec?: number;
  /** nombre maximal de pics retournés (défaut 12) */
  maxCount?: number;
}

/**
 * Détecte les pics d'énergie de mouvement (impacts candidats).
 * Baseline robuste (médiane + MAD) : les impacts, rares, ne polluent pas la référence.
 * Retourne les temps (secondes, référentiel du signal) triés par ordre chronologique.
 */
export function findImpactSpikes(sig: MotionSignal, opts: SpikeOptions = {}): number[] {
  const dt = opts.dt ?? 0.05;
  const threshold = opts.threshold ?? 3;
  const minSeparationSec = opts.minSeparationSec ?? 0.5;
  const maxCount = opts.maxCount ?? 12;

  const uni = resampleUniform(sig, dt);
  if (!uni) return [];
  const raw = uni.values;
  const n = raw.length;

  // Lissage 3 points pour tuer le bruit d'échantillonnage
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(n - 1, i + 1)];
    v[i] = (a + b + c) / 3;
  }

  const sorted = Array.from(v).sort((x, y) => x - y);
  const median = sorted[Math.floor(n / 2)];
  const max = sorted[n - 1];
  // Scène sans action (caméra statique, bruit de capteur) : le « plus fort » n'est que du
  // bruit, on n'invente pas de pics. Un impact réel dépasse largement le mouvement médian.
  if (median <= 0 || max < FLAT_SIGNAL_RATIO * median) return [];
  const absDev = sorted.map((x) => Math.abs(x - median)).sort((x, y) => x - y);
  const mad = absDev[Math.floor(n / 2)];
  const scale = 1.4826 * mad + 1e-9;

  interface Candidate { idx: number; z: number }
  const candidates: Candidate[] = [];
  for (let i = 1; i < n - 1; i++) {
    const z = (v[i] - median) / scale;
    if (z >= threshold && v[i] >= v[i - 1] && v[i] > v[i + 1]) {
      candidates.push({ idx: i, z });
    }
  }

  // Les plus forts d'abord, en respectant l'écart minimal
  candidates.sort((a, b) => b.z - a.z);
  const minSepSteps = Math.round(minSeparationSec / dt);
  const kept: number[] = [];
  for (const c of candidates) {
    if (kept.length >= maxCount) break;
    if (kept.every((k) => Math.abs(k - c.idx) >= minSepSteps)) kept.push(c.idx);
  }

  return kept
    .map((idx) => uni.start + idx * dt)
    .sort((a, b) => a - b);
}

/**
 * Courbe d'intensité du mouvement affichable sur la timeline : `bins` cases entre 0 et
 * `durationSec`, valeur max par case, normalisée sur le 95e percentile (0..1) pour qu'un
 * unique pic énorme n'écrase pas le reste. Les cases sans échantillon reprennent la
 * valeur précédente (l'échantillonnage à 8× est plus lâche que la grille).
 */
export function buildDisplayCurve(sig: MotionSignal, durationSec: number, bins = 300): Float32Array | null {
  if (sig.times.length < 2 || durationSec <= 0 || bins < 2) return null;
  const out = new Float32Array(bins);
  const filled = new Uint8Array(bins);
  for (let i = 0; i < sig.times.length; i++) {
    const t = sig.times[i];
    if (t < 0 || t > durationSec) continue;
    const b = Math.min(bins - 1, Math.floor((t / durationSec) * bins));
    if (!filled[b] || sig.values[i] > out[b]) out[b] = sig.values[i];
    filled[b] = 1;
  }
  let last = 0;
  for (let b = 0; b < bins; b++) {
    if (filled[b]) last = out[b];
    else out[b] = last;
  }
  const positive = Array.from(out).filter((v) => v > 0).sort((a, b) => a - b);
  if (positive.length === 0) return out;
  const p95 = positive[Math.min(positive.length - 1, Math.floor(positive.length * 0.95))];
  if (p95 <= 0) return out;
  for (let b = 0; b < bins; b++) out[b] = Math.min(1, out[b] / p95);
  return out;
}

// ==================== Extraction du signal (DOM, non testé unitairement) ====================

export interface ExtractOptions {
  /** vitesse de lecture pour l'analyse (défaut 8×) */
  playbackRate?: number;
  /** plus grande dimension du canvas d'analyse (défaut 96 px) */
  maxDim?: number;
  /** durée attendue du média en secondes (progression + garde-fou) */
  expectedDurationSec?: number;
  /** drapeau d'annulation coopérative */
  abort?: { aborted: boolean };
  onProgress?: (fraction: number) => void;
}

/**
 * Lit le blob en accéléré dans un <video> caché et calcule, à chaque frame
 * présentée (requestVideoFrameCallback), la différence moyenne de luminance
 * avec la frame précédente, normalisée par l'écart de temps média.
 */
export function extractMotionSignal(blobUrl: string, opts: ExtractOptions = {}): Promise<MotionSignal> {
  const playbackRate = opts.playbackRate ?? 8;
  const maxDim = opts.maxDim ?? 96;
  const expected = opts.expectedDurationSec ?? 0;

  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    // Doit rester composité pour que requestVideoFrameCallback tire à chaque frame
    Object.assign(video.style, {
      position: 'fixed', bottom: '0', right: '0', width: '2px', height: '2px',
      opacity: '0.01', pointerEvents: 'none', zIndex: '-1',
    });
    document.body.appendChild(video);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      video.remove();
      reject(new Error('Canvas 2D indisponible'));
      return;
    }

    const times: number[] = [];
    const values: number[] = [];
    let prevLuma: Float32Array | null = null;
    let prevMediaTime = -1;
    let lastFrameWallTime = Date.now();
    let finished = false;

    const cleanup = () => {
      finished = true;
      clearInterval(watchdog);
      try { video.pause(); } catch { /* déjà arrêtée */ }
      video.removeAttribute('src');
      video.remove();
    };

    const finish = () => {
      if (finished) return;
      cleanup();
      resolve({ times, values });
    };

    // Garde-fou : blob illisible, décodeur bloqué, ou annulation
    const watchdog = setInterval(() => {
      if (finished) return;
      if (opts.abort?.aborted) { finish(); return; }
      if (Date.now() - lastFrameWallTime > 4000) finish();
    }, 500);

    video.addEventListener('ended', finish);
    video.addEventListener('error', () => {
      if (times.length > 1) finish();
      else { cleanup(); reject(new Error('Lecture du blob impossible')); }
    });

    const hasRVFC = 'requestVideoFrameCallback' in video;
    if (!hasRVFC) {
      cleanup();
      reject(new Error('requestVideoFrameCallback non supporté'));
      return;
    }
    const rvfc = (cb: (now: number, meta: { mediaTime: number }) => void) =>
      (video as HTMLVideoElement & {
        requestVideoFrameCallback: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
      }).requestVideoFrameCallback(cb);

    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (finished) return;
      if (opts.abort?.aborted) { finish(); return; }
      lastFrameWallTime = Date.now();

      if (canvas.width === 0 || canvas.height === 0 || canvas.width > maxDim + 1) {
        const vw = video.videoWidth || 16;
        const vh = video.videoHeight || 9;
        const scale = maxDim / Math.max(vw, vh);
        canvas.width = Math.max(2, Math.round(vw * scale));
        canvas.height = Math.max(2, Math.round(vh * scale));
      }

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const nPix = canvas.width * canvas.height;
      const luma = new Float32Array(nPix);
      for (let i = 0; i < nPix; i++) {
        const o = i * 4;
        luma[i] = data[o] * 0.299 + data[o + 1] * 0.587 + data[o + 2] * 0.114;
      }

      if (prevLuma && meta.mediaTime > prevMediaTime) {
        let sum = 0;
        for (let i = 0; i < nPix; i++) sum += Math.abs(luma[i] - prevLuma[i]);
        const dtMedia = meta.mediaTime - prevMediaTime;
        times.push(meta.mediaTime);
        values.push(sum / nPix / dtMedia);
        if (expected > 0 && opts.onProgress) {
          opts.onProgress(Math.min(1, meta.mediaTime / expected));
        }
      }
      prevLuma = luma;
      prevMediaTime = meta.mediaTime;
      rvfc(onFrame);
    };

    rvfc(onFrame);
    video.src = blobUrl;
    video.play()
      .then(() => { video.playbackRate = playbackRate; })
      .catch(() => {
        cleanup();
        reject(new Error('Impossible de démarrer la lecture d\'analyse'));
      });
  });
}
