import type { Zone } from './fighters';

/** Ce que la vision a vu sur une image (coordonnées normalisées 0..1, pour l'affichage « Vue IA ») */
export interface VisionFrame {
  /** temps média (s) */
  t: number;
  /** personnes détectées dans l'image */
  persons: number;
  /** squelettes des deux tireurs : 33 points [x, y, visibilité] */
  fighters: [number, number, number][][];
  blades: { hilt: { x: number; y: number }; tip: { x: number; y: number }; owner: number }[];
  contact: { zone: Zone; gap: number; point: { x: number; y: number }; attacker: number } | null;
  clash: { x: number; y: number } | null;
  inferMs: number;
  totalMs: number;
}

export interface VisionStats {
  delegate: string | null;
  framesAnalysed: number;
  avgInferMs: number;
  /** part des images où deux tireurs sont identifiés / où au moins une lame est vue */
  fightersShare: number;
  bladeShare: number;
  contactFrames: number;
  clashFrames: number;
  error?: string;
  /** blocages du décodeur pendant l'analyse, raison de l'arrêt, secondes de vidéo lues */
  stalls?: number;
  endReason?: string;
  stallStates?: string[];
  /** trous de l'enregistrement [début (s), durée (s)] : le flux était gelé pendant le direct */
  holes?: [number, number][];
  coveredSec?: number;
}
