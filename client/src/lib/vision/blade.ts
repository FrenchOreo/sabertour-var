import { Pt, angleBetween } from './geometry';

/**
 * Repérage des lames de sabre laser. Fonctions pures (testées).
 *
 * Une lame LED allumée est l'objet le plus lumineux et le plus fin de la scène : un trait de pixels
 * très clairs (cœur souvent saturé en blanc, halo coloré) qui part de la main du tireur.
 * 1. Masque des pixels « lame » : très lumineux ET (colorés OU saturés en blanc).
 * 2. Depuis chaque main détectée par le modèle de silhouettes, on lance des rayons dans toutes les
 *    directions et on garde celui qui rencontre un trait continu, long et étroit. Un objet clair mais
 *    large (veste blanche, fenêtre) allume beaucoup de directions à la fois : il est rejeté.
 */

export interface BladeMaskOptions {
  /** luminosité minimale (0..1) d'un pixel de lame */
  minValue?: number;
  /** saturation minimale (0..1) pour un pixel coloré */
  minSaturation?: number;
  /** au-delà de cette luminosité, un pixel blanc compte (cœur de lame surexposé) */
  whiteValue?: number;
}

export function bladeMask(rgba: ArrayLike<number>, w: number, h: number, opts: BladeMaskOptions = {}): Uint8Array {
  const minV = Math.round((opts.minValue ?? 0.78) * 255);
  const minS = opts.minSaturation ?? 0.35;
  const whiteV = Math.round((opts.whiteValue ?? 0.96) * 255);
  const out = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    if (mx < minV) continue;
    if (mx >= whiteV) { out[i] = 1; continue; }
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    if ((mx - mn) / mx >= minS) out[i] = 1;
  }
  return out;
}

export interface BladeTrace {
  hilt: Pt;
  tip: Pt;
  /** pixels de lame rencontrés le long du rayon retenu */
  support: number;
  /** support / longueur : 1 = trait continu */
  fill: number;
  /** rapport entre le meilleur rayon et le rayon médian : un trait fin donne un pic net */
  concentration: number;
  /** largeur médiane mesurée perpendiculairement au trait (px) */
  widthPx: number;
  angleDeg: number;
}

export interface TraceOptions {
  /** pas angulaire (degrés) */
  stepDeg?: number;
  /** longueur minimale de lame, en fraction de la taille du tireur */
  minLenFrac?: number;
  /** longueur maximale recherchée, en fraction de la taille du tireur */
  maxLenFrac?: number;
  /** la lame doit commencer à moins de cette distance de la main (fraction de la taille) */
  startFrac?: number;
  /** trou maximal toléré le long de la lame (px) */
  maxGapPx?: number;
  minFill?: number;
  minConcentration?: number;
  /** largeur maximale d'une lame : fraction de sa longueur (un aplat clair est large) */
  maxWidthFrac?: number;
  /** direction de l'avant-bras (main − coude) : les rayons qui remontent le bras sont exclus */
  forearm?: Pt | null;
}

function hitAt(mask: Uint8Array, w: number, h: number, x: number, y: number, nx: number, ny: number): boolean {
  // Tolérance d'épaisseur : le pixel du rayon ou ses voisins perpendiculaires
  for (let k = -1; k <= 1; k++) {
    const xi = Math.round(x + k * nx);
    const yi = Math.round(y + k * ny);
    if (xi >= 0 && yi >= 0 && xi < w && yi < h && mask[yi * w + xi]) return true;
  }
  return false;
}

export function traceBladeFromHand(
  mask: Uint8Array,
  w: number,
  h: number,
  hand: Pt,
  bodyHeightPx: number,
  opts: TraceOptions = {}
): BladeTrace | null {
  const step = opts.stepDeg ?? 4;
  const minLen = Math.max(8, (opts.minLenFrac ?? 0.2) * bodyHeightPx);
  const maxLen = Math.max(minLen + 4, (opts.maxLenFrac ?? 0.75) * bodyHeightPx);
  const startMax = Math.max(4, (opts.startFrac ?? 0.12) * bodyHeightPx);
  const maxGap = opts.maxGapPx ?? Math.max(3, Math.round(0.03 * bodyHeightPx));
  const minFill = opts.minFill ?? 0.5;
  const minConc = opts.minConcentration ?? 3;

  const supports: number[] = [];
  let best: BladeTrace | null = null;
  for (let a = 0; a < 360; a += step) {
    const rad = (a * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Le bras lui-même (manche clair) n'est pas une lame
    if (opts.forearm && angleBetween(dx, dy, -opts.forearm.x, -opts.forearm.y) < 25) {
      supports.push(0);
      continue;
    }
    let first = -1;
    let last = -1;
    let hits = 0;
    for (let r = 1; r <= maxLen; r++) {
      const hit = hitAt(mask, w, h, hand.x + r * dx, hand.y + r * dy, -dy, dx);
      if (hit) {
        if (first < 0) {
          if (r > startMax) break; // la lame doit partir de la main
          first = r;
        }
        last = r;
        hits++;
      } else if (first >= 0 && r - last > maxGap) {
        break;
      }
    }
    const len = first >= 0 ? last - first + 1 : 0;
    supports.push(hits);
    if (len >= minLen && hits / len >= minFill && (!best || hits > best.support)) {
      best = {
        hilt: { x: hand.x + first * dx, y: hand.y + first * dy },
        tip: { x: hand.x + last * dx, y: hand.y + last * dy },
        support: hits,
        fill: hits / len,
        concentration: 0,
        widthPx: 0,
        angleDeg: a,
      };
    }
  }
  if (!best) return null;
  const sorted = [...supports].sort((x, y) => x - y);
  const median = sorted[Math.floor(sorted.length / 2)];
  best.concentration = best.support / Math.max(1, median);
  if (best.concentration < minConc) return null;
  // Largeur du trait, mesurée perpendiculairement en trois points : une lame est fine,
  // une veste blanche ou une fenêtre est large
  const len = Math.hypot(best.tip.x - best.hilt.x, best.tip.y - best.hilt.y);
  const ux = (best.tip.x - best.hilt.x) / len;
  const uy = (best.tip.y - best.hilt.y) / len;
  const widths: number[] = [];
  for (const f of [0.3, 0.5, 0.7]) {
    const cx = best.hilt.x + f * (best.tip.x - best.hilt.x);
    const cy = best.hilt.y + f * (best.tip.y - best.hilt.y);
    let wdt = 1;
    for (const side of [-1, 1]) {
      for (let k = 1; k <= Math.ceil(len / 2); k++) {
        const xi = Math.round(cx + side * k * -uy);
        const yi = Math.round(cy + side * k * ux);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h || !mask[yi * w + xi]) break;
        wdt++;
      }
    }
    widths.push(wdt);
  }
  widths.sort((x, y) => x - y);
  best.widthPx = widths[1];
  const maxWidth = Math.max(6, (opts.maxWidthFrac ?? 0.15) * len);
  return best.widthPx <= maxWidth ? best : null;
}
