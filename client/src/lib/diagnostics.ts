/**
 * Journal de diagnostic + mesures réelles de l'interface (fil principal du navigateur).
 * - Retard de la boucle d'événements : écart mesuré entre l'heure prévue et l'heure réelle d'un minuteur
 * - Tâches longues : PerformanceObserver('longtask'), durées réelles > 50 ms qui bloquent l'interface
 * Le journal part dans un fichier sur le Mac (application) ; dans un navigateur il reste en mémoire
 * et peut être téléchargé.
 */

export interface RendererSample {
  /** pire retard constaté de la boucle d'événements sur la fenêtre (ms) */
  lagMaxMs: number;
  /** 95e centile du retard (ms) */
  lagP95Ms: number;
  /** temps total passé dans des tâches longues (ms) et leur nombre */
  longTaskMs: number;
  longTaskCount: number;
  windowMs: number;
}

const LAG_TICK_MS = 250;
const FLUSH_MS = 5000;
const MEMORY_MAX = 4000;

let started = false;
let lags: number[] = [];
let longTaskMs = 0;
let longTaskCount = 0;
let windowStart = 0;
const queue: Record<string, unknown>[] = [];
const memory: Record<string, unknown>[] = [];

export function startRendererMonitor(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  windowStart = performance.now();
  let expected = performance.now() + LAG_TICK_MS;
  setInterval(() => {
    const now = performance.now();
    lags.push(Math.max(0, now - expected));
    if (lags.length > 400) lags.shift();
    expected = now + LAG_TICK_MS;
  }, LAG_TICK_MS);
  try {
    const obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        longTaskMs += e.duration;
        longTaskCount++;
      }
    });
    obs.observe({ type: 'longtask', buffered: false });
  } catch {
    // longtask non supporté (Safari) : seule la mesure de retard reste disponible
  }
  setInterval(flushLog, FLUSH_MS);
}

/** Mesures depuis le précédent appel, puis remise à zéro */
export function takeRendererSample(): RendererSample {
  const now = performance.now();
  const sorted = [...lags].sort((a, b) => a - b);
  const sample: RendererSample = {
    lagMaxMs: Math.round(sorted.length ? sorted[sorted.length - 1] : 0),
    lagP95Ms: Math.round(sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0),
    longTaskMs: Math.round(longTaskMs),
    longTaskCount,
    windowMs: Math.round(now - windowStart),
  };
  lags = [];
  longTaskMs = 0;
  longTaskCount = 0;
  windowStart = now;
  return sample;
}

/** Ajoute une entrée au journal (horodatée) */
export function diagLog(type: string, data: Record<string, unknown> = {}): void {
  const entry = { t: Date.now(), type, ...data };
  queue.push(entry);
  memory.push(entry);
  if (memory.length > MEMORY_MAX) memory.splice(0, memory.length - MEMORY_MAX);
}

function flushLog(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  const api = window.electronAPI;
  if (api?.appendDiagnostics) api.appendDiagnostics(batch).catch(() => {});
}

/** Entrées récentes (panneau, export navigateur) */
export function recentLog(): Record<string, unknown>[] {
  return memory;
}

/** Export : fichier sur le Mac (application) ou téléchargement (navigateur) */
export async function exportDiagnostics(): Promise<void> {
  flushLog();
  const api = window.electronAPI;
  if (api?.exportDiagnostics) {
    await api.exportDiagnostics();
    return;
  }
  const blob = new Blob([memory.map((e) => JSON.stringify(e)).join('\n') + '\n'], { type: 'application/x-ndjson' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `saber-var-diagnostic-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jsonl`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
