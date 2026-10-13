// Use `any` for WebRTC types so this file can be imported by the server (no DOM lib)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SDP = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ICE = any;

export type SlotId = 1 | 2 | 3 | 4;

export interface SlotState {
  slotId: SlotId;
  name: string;
  cameraConnected: boolean;
  arbitreConnected: boolean;
  token: string;
}

/**
 * Mesures RÉELLES remontées par le téléphone (getStats côté émetteur + réglages de la piste caméra).
 * Rien n'est estimé : chaque champ vient d'un compteur du navigateur ou est null s'il n'existe pas.
 */
export interface CameraTelemetry {
  /** horloge du téléphone (ms) au moment de la mesure */
  t: number;
  /** cadence demandée dans les réglages (30 ou 60) */
  requestedFps: number;
  /** réglages effectifs de la piste caméra (track.getSettings) */
  trackWidth: number | null;
  trackHeight: number | null;
  trackFps: number | null;
  /** cadence maximale annoncée par le capteur (track.getCapabilities) */
  maxFps: number | null;
  /** images/s réellement produites par la caméra (media-source.framesPerSecond) */
  sourceFps: number | null;
  /** images/s réellement encodées et envoyées (outbound-rtp.framesPerSecond) */
  encodedFps: number | null;
  /** débit réellement envoyé (delta bytesSent, kb/s) */
  sentKbps: number | null;
  /** débit visé par l'encodeur (outbound-rtp.targetBitrate, kb/s) */
  targetKbps: number | null;
  /** ce qui bride l'encodeur selon le navigateur du téléphone */
  limitation: 'none' | 'cpu' | 'bandwidth' | 'other' | null;
  /** part du dernier intervalle passée bridée par le réseau / par le processeur (0..1) */
  bandwidthLimitedShare: number | null;
  cpuLimitedShare: number | null;
  /** temps d'encodage moyen par image (ms) sur le dernier intervalle */
  encodeMsPerFrame: number | null;
  /** aller-retour mesuré par RTCP (remote-inbound-rtp.roundTripTime, ms) */
  rttMs: number | null;
  /** pertes rapportées par le récepteur via RTCP (%) */
  remoteLossPct: number | null;
  /** demandes de renvoi / d'image clé reçues sur l'intervalle */
  nacks: number | null;
  plis: number | null;
  /** batterie (Android/Chrome seulement ; null sur iPhone) */
  batteryPct: number | null;
  charging: boolean | null;
}

export type WsMessage =
  // === Caméra → Serveur ===
  | { type: 'camera-join'; slotId: SlotId; token: string; name: string }
  | { type: 'camera-leave'; slotId: SlotId }
  | { type: 'camera-offer'; slotId: SlotId; sdp: SDP }
  | { type: 'camera-ice'; slotId: SlotId; candidate: ICE }
  | { type: 'camera-stats'; slotId: SlotId; stats: CameraTelemetry }

  // === Arbitre → Serveur ===
  | { type: 'arbitre-join' }
  | { type: 'arbitre-connect'; slotId: SlotId }
  | { type: 'arbitre-answer'; slotId: SlotId; sdp: SDP }
  | { type: 'arbitre-ice'; slotId: SlotId; candidate: ICE }

  // === Serveur → Clients ===
  | { type: 'slots-state'; slots: SlotState[] }
  | { type: 'slot-updated'; slot: SlotState }
  | { type: 'relay-offer'; slotId: SlotId; sdp: SDP }
  | { type: 'relay-answer'; slotId: SlotId; sdp: SDP }
  | { type: 'relay-ice'; slotId: SlotId; candidate: ICE; from: 'camera' | 'arbitre' }
  | { type: 'relay-connect-request'; slotId: SlotId }
  | { type: 'relay-camera-stats'; slotId: SlotId; stats: CameraTelemetry }
  | { type: 'error'; message: string };
