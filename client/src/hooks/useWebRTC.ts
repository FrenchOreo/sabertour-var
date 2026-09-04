import { useRef, useCallback, useEffect, useState } from 'react';
import { SlotId, WsMessage } from 'shared/types';

const peerConfig: RTCConfiguration = {
  iceServers: [],
  iceTransportPolicy: 'all' as RTCIceTransportPolicy,
};

/** Côté téléphone : délai avant de réémettre une offre nous-mêmes (l'arbitre relance normalement avant) */
const CAMERA_REOFFER_DELAY_MS = 6000;
/** Une négociation qui traîne plus longtemps est considérée bloquée → on autorise une nouvelle tentative */
const NEGOTIATION_TIMEOUT_MS = 10000;

interface UseWebRTCCameraOptions {
  slotId: SlotId;
  stream: MediaStream | null;
  send: (msg: WsMessage) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
}

export function useWebRTCCamera({ slotId, stream, send, onStateChange }: UseWebRTCCameraOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const reofferTimer = useRef<ReturnType<typeof setTimeout>>();
  const [connectionState, setConnectionState] = useState<RTCPeerConnectionState>('new');
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  // createOffer dépend de `stream` : les timers passent par cette ref pour toujours utiliser la dernière version
  const createOfferRef = useRef<() => Promise<void>>(async () => {});

  const clearReoffer = () => {
    if (reofferTimer.current) {
      clearTimeout(reofferTimer.current);
      reofferTimer.current = undefined;
    }
  };

  const createOffer = useCallback(async () => {
    clearReoffer();
    // Cleanup existing connection
    pcRef.current?.close();

    const pc = new RTCPeerConnection(peerConfig);
    pcRef.current = pc;

    // Add local tracks and boost encoding quality
    if (stream) {
      for (const track of stream.getTracks()) {
        const sender = pc.addTrack(track, stream);
        // Set high initial bitrate and prefer resolution over framerate
        if (track.kind === 'video') {
          try {
            const params = sender.getParameters();
            if (!params.encodings || params.encodings.length === 0) {
              params.encodings = [{}];
            }
            params.encodings[0].maxBitrate = 8_000_000; // 8 Mbps
            // En cas de congestion WiFi, sacrifier la résolution plutôt que le
            // framerate : pour le VAR image par image, perdre des frames est
            // pire qu'une image plus douce (une touche dure 1-2 frames)
            params.degradationPreference = 'maintain-framerate';
            sender.setParameters(params);
          } catch (e) {
            console.warn('[WebRTC] Could not set sender parameters:', e);
          }
        }
      }
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: 'camera-ice', slotId, candidate: e.candidate.toJSON() });
      }
    };

    // Auto-réparation : si la connexion tombe et que l'arbitre n'a pas relancé
    // la négociation entre-temps, on réémet une offre nous-mêmes
    pc.onconnectionstatechange = () => {
      if (pcRef.current !== pc) return;
      const st = pc.connectionState;
      setConnectionState(st);
      onStateChangeRef.current?.(st);
      if (st === 'connected') {
        clearReoffer();
        return;
      }
      if (st === 'failed' || st === 'disconnected') {
        clearReoffer();
        reofferTimer.current = setTimeout(() => {
          if (pcRef.current === pc && pc.connectionState !== 'connected') {
            console.warn(`[WebRTC] Connexion ${st} — nouvelle offre`);
            createOfferRef.current();
          }
        }, CAMERA_REOFFER_DELAY_MS);
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'camera-offer', slotId, sdp: pc.localDescription! });
  }, [slotId, stream, send]);
  createOfferRef.current = createOffer;

  // Changement de flux (caméra retournée, résolution) : on remplace la piste dans la
  // connexion existante au lieu de renégocier — sinon l'arbitre garde l'ancienne piste
  // arrêtée et son image se fige
  useEffect(() => {
    const pc = pcRef.current;
    if (!pc || !stream || pc.connectionState === 'closed') return;
    const newTrack = stream.getVideoTracks()[0];
    if (!newTrack) return;
    for (const sender of pc.getSenders()) {
      if (sender.track?.kind === 'video' && sender.track !== newTrack) {
        sender.replaceTrack(newTrack).catch(() => {
          // replaceTrack refusé (codec/format) → renégociation complète
          createOfferRef.current();
        });
      }
    }
  }, [stream]);

  const handleAnswer = useCallback(async (sdp: RTCSessionDescriptionInit) => {
    if (pcRef.current) {
      await pcRef.current.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  }, []);

  const handleIceCandidate = useCallback(async (candidate: RTCIceCandidateInit) => {
    if (pcRef.current) {
      await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  const close = useCallback(() => {
    clearReoffer();
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  useEffect(() => () => clearReoffer(), []);

  return { createOffer, handleAnswer, handleIceCandidate, close, connectionState };
}

interface UseWebRTCArbitreOptions {
  send: (msg: WsMessage) => void;
  onTrack: (slotId: SlotId, stream: MediaStream) => void;
  /** Changement d'état de la connexion d'une caméra (auto-réparation, affichage) */
  onConnectionStateChange?: (slotId: SlotId, state: RTCPeerConnectionState) => void;
}

export function useWebRTCArbitre({ send, onTrack, onConnectionStateChange }: UseWebRTCArbitreOptions) {
  const pcsRef = useRef<Map<SlotId, RTCPeerConnection>>(new Map());
  const createdAtRef = useRef<Map<SlotId, number>>(new Map());
  // Demande de négociation envoyée, offre pas encore reçue : évite d'en émettre une seconde
  // (deux offres consécutives = réponses croisées et connexion bancale)
  const connectRequestedAtRef = useRef<Map<SlotId, number>>(new Map());
  const onStateRef = useRef(onConnectionStateChange);
  onStateRef.current = onConnectionStateChange;

  const handleOffer = useCallback(async (slotId: SlotId, sdp: RTCSessionDescriptionInit) => {
    // Cleanup existing
    pcsRef.current.get(slotId)?.close();

    const pc = new RTCPeerConnection(peerConfig);
    pcsRef.current.set(slotId, pc);
    createdAtRef.current.set(slotId, Date.now());
    connectRequestedAtRef.current.delete(slotId);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: 'arbitre-ice', slotId, candidate: e.candidate.toJSON() });
      }
    };

    pc.ontrack = (e) => {
      if (e.streams[0]) {
        onTrack(slotId, e.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      // Ignorer les événements d'une connexion déjà remplacée
      if (pcsRef.current.get(slotId) !== pc) return;
      onStateRef.current?.(slotId, pc.connectionState);
    };

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    send({ type: 'arbitre-answer', slotId, sdp: pc.localDescription! });
  }, [send, onTrack]);

  const handleIceCandidate = useCallback(async (slotId: SlotId, candidate: RTCIceCandidateInit) => {
    const pc = pcsRef.current.get(slotId);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }, []);

  /** Demande brute de (re)négociation : la caméra va émettre une nouvelle offre */
  const connectToSlot = useCallback((slotId: SlotId) => {
    connectRequestedAtRef.current.set(slotId, Date.now());
    send({ type: 'arbitre-connect', slotId });
  }, [send]);

  /** Vrai si une connexion vivante — ou une négociation récente / en attente d'offre — existe pour ce slot */
  const isSlotLive = useCallback((slotId: SlotId): boolean => {
    const pc = pcsRef.current.get(slotId);
    if (!pc) {
      const requestedAt = connectRequestedAtRef.current.get(slotId);
      return requestedAt !== undefined && Date.now() - requestedAt < NEGOTIATION_TIMEOUT_MS;
    }
    const st = pc.connectionState;
    if (st === 'connected') return true;
    if (st === 'new' || st === 'connecting') {
      const age = Date.now() - (createdAtRef.current.get(slotId) ?? 0);
      return age < NEGOTIATION_TIMEOUT_MS;
    }
    return false; // disconnected / failed / closed
  }, []);

  /**
   * Ne (re)négocie que si nécessaire. Le serveur ne suit pas l'état arbitre
   * (`arbitreConnected` reste toujours false) : sans ce garde-fou, chaque
   * changement de slot renégociait TOUTES les caméras et effaçait leurs buffers.
   */
  const ensureConnected = useCallback((slotId: SlotId): boolean => {
    if (isSlotLive(slotId)) return false;
    connectToSlot(slotId);
    return true;
  }, [isSlotLive, connectToSlot]);

  /** Renégociation forcée (flux gelé alors que la connexion se dit « connected ») */
  const reconnectSlot = useCallback((slotId: SlotId) => {
    pcsRef.current.get(slotId)?.close();
    pcsRef.current.delete(slotId);
    createdAtRef.current.delete(slotId);
    connectToSlot(slotId);
  }, [connectToSlot]);

  const closeSlot = useCallback((slotId: SlotId) => {
    pcsRef.current.get(slotId)?.close();
    pcsRef.current.delete(slotId);
    createdAtRef.current.delete(slotId);
    connectRequestedAtRef.current.delete(slotId);
  }, []);

  const closeAll = useCallback(() => {
    for (const pc of pcsRef.current.values()) {
      pc.close();
    }
    pcsRef.current.clear();
    createdAtRef.current.clear();
  }, []);

  const getPeerConnection = useCallback((slotId: SlotId): RTCPeerConnection | undefined => {
    return pcsRef.current.get(slotId);
  }, []);

  return { handleOffer, handleIceCandidate, connectToSlot, ensureConnected, reconnectSlot, isSlotLive, closeSlot, closeAll, getPeerConnection };
}
