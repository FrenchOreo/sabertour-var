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
