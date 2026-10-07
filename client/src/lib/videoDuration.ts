/**
 * Durée réelle d'un blob vidéo.
 *
 * Les fichiers produits par MediaRecorder (WebM comme MP4 fragmenté) annoncent
 * `duration = Infinity`. La durée estimée à partir des heures d'arrivée des chunks
 * est fausse dès que le réseau hoquette (les images arrivent en rafale : plus de
 * vidéo que de temps écoulé) → timeline trop courte, compteur « 1011 / 910 ».
 *
 * Astuce Chromium : un seek « très loin » force la lecture jusqu'à la fin et
 * `durationchange` livre la vraie durée. On sonde sur un <video> caché pour ne
 * pas perturber les lecteurs visibles.
 */
export function probeBlobDuration(blobUrl: string, timeoutMs = 8000): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement('video');
    el.preload = 'auto';
    el.muted = true;
    let done = false;

    const finish = (d: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      el.removeAttribute('src');
      try { el.load(); } catch { /* libération des ressources, best effort */ }
      resolve(d !== null && isFinite(d) && d > 0 ? d : null);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);

    el.addEventListener('error', () => finish(null));
    el.addEventListener('loadedmetadata', () => {
      if (isFinite(el.duration) && el.duration > 0) {
        finish(el.duration);
        return;
      }
      el.addEventListener('durationchange', () => {
        if (isFinite(el.duration) && el.duration > 0) finish(el.duration);
      });
      el.currentTime = 1e101;
    });
    el.src = blobUrl;
  });
}

/** Cadence commune la plus proche d'une mesure (24/25/30/50/60) ; la mesure brute si elle en est loin */
export function snapFrameRate(measured: number): number {
  const COMMON = [24, 25, 30, 50, 60];
  let best = COMMON[0];
  for (const c of COMMON) {
    if (Math.abs(c - measured) < Math.abs(best - measured)) best = c;
  }
  return Math.abs(best - measured) <= 2 ? best : Math.round(measured * 10) / 10;
}

/** Cadence (images/s) déduite des écarts de temps média entre images présentées : médiane, robuste aux images sautées */
export function frameRateFromMediaTimes(mediaTimes: number[]): number | null {
  const deltas: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const d = mediaTimes[i] - mediaTimes[i - 1];
    if (d > 0.004 && d < 0.2) deltas.push(d);
  }
  if (deltas.length < 8) return null;
  deltas.sort((a, b) => a - b);
  // Quand le PC est chargé, des images sont sautées : les écarts valent alors 2 ou 3 intervalles.
  // On ne garde que les écarts d'UNE image (moins de 1,6 × le 10e centile, ce qui absorbe une gigue
  // d'horodatage de ±20 %) et on prend leur moyenne : il suffit qu'un dixième des images soient
  // présentées sans saut pour retrouver la vraie cadence.
  const p10 = deltas[Math.floor(deltas.length * 0.1)];
  const single = deltas.filter((d) => d <= p10 * 1.6);
  // Moyenne (et non médiane) : une gigue alternée ±x ferait tomber la médiane sur un seul des deux modes
  const interval = single.reduce((a, b) => a + b, 0) / single.length;
  return interval > 0 ? 1 / interval : null;
}

/**
 * Cadence réelle d'un blob vidéo, mesurée sur ses propres images : lecture muette à vitesse 1× dans
 * un <video> caché, `requestVideoFrameCallback` donne le temps média de chaque image présentée.
 * La cadence annoncée par WebRTC est celle de la réception, pas forcément celle de l'enregistrement
 * (un PC chargé encode moins d'images qu'il n'en reçoit) — et c'est elle qui fixe le pas « ±1 image ».
 */
export function probeBlobFrameRate(blobUrl: string, opts: { maxFrames?: number; timeoutMs?: number } = {}): Promise<number | null> {
  const maxFrames = opts.maxFrames ?? 90;
  const timeoutMs = opts.timeoutMs ?? 4000;
  return new Promise((resolve) => {
    const el = document.createElement('video');
    if (!('requestVideoFrameCallback' in el)) { resolve(null); return; }
    el.preload = 'auto';
    el.muted = true;
    el.playsInline = true;
    // Doit rester composité pour que requestVideoFrameCallback tire
    Object.assign(el.style, { position: 'fixed', bottom: '0', right: '0', width: '2px', height: '2px', opacity: '0.01', pointerEvents: 'none', zIndex: '-1' });
    document.body.appendChild(el);
    const mediaTimes: number[] = [];
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { el.pause(); } catch { /* déjà arrêtée */ }
      el.removeAttribute('src');
      el.remove();
      resolve(frameRateFromMediaTimes(mediaTimes));
    };
    const timer = setTimeout(finish, timeoutMs);
    const rvfc = (el as HTMLVideoElement & { requestVideoFrameCallback: (cb: (now: number, meta: { mediaTime: number }) => void) => number }).requestVideoFrameCallback.bind(el);
    const onFrame = (_now: number, meta: { mediaTime: number }) => {
      if (done) return;
      mediaTimes.push(meta.mediaTime);
      if (mediaTimes.length >= maxFrames) { finish(); return; }
      rvfc(onFrame);
    };
    el.addEventListener('error', finish);
    el.addEventListener('ended', finish);
    rvfc(onFrame);
    el.src = blobUrl;
    el.play().catch(finish);
  });
}
