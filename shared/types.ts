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

export type WsMessage =
  // === Caméra → Serveur ===
  | { type: 'camera-join'; slotId: SlotId; token: string; name: string }
  | { type: 'camera-leave'; slotId: SlotId }
  | { type: 'camera-offer'; slotId: SlotId; sdp: SDP }
  | { type: 'camera-ice'; slotId: SlotId; candidate: ICE }

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
  | { type: 'error'; message: string };
