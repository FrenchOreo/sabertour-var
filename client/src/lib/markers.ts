/**
 * Navigation entre marqueurs d'impact sur la timeline.
 * Toutes les valeurs sont en millisecondes (référentiel timeline).
 */

/** Index du marqueur « courant » : le dernier marqueur ≤ currentMs + tolérance ; −1 si aucun. */
export function currentMarkerIndex(markersMs: number[], currentMs: number, toleranceMs = 40): number {
  const sorted = [...markersMs].sort((a, b) => a - b);
  let idx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] <= currentMs + toleranceMs) idx = i;
    else break;
  }
  return idx;
}

/**
 * Marqueur suivant (direction 1) ou précédent (−1) strictement au-delà de la tolérance,
 * pour qu'un appui répété avance bien d'un marqueur même quand on est posé dessus. null si aucun.
 */
export function adjacentMarker(
  markersMs: number[],
  currentMs: number,
  direction: 1 | -1,
  toleranceMs = 40
): number | null {
  const sorted = [...markersMs].sort((a, b) => a - b);
  if (direction > 0) {
    for (const m of sorted) {
      if (m > currentMs + toleranceMs) return m;
    }
    return null;
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i] < currentMs - toleranceMs) return sorted[i];
  }
  return null;
}
