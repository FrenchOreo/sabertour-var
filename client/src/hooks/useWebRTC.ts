import { useRef, useCallback } from 'react';
import { SlotId, WsMessage } from 'shared/types';

const peerConfig: RTCConfiguration = {
  iceServers: [],
  iceTransportPolicy: 'all' as RTCIceTransportPolicy,
};

interface UseWebRTCCameraOptions {
  slotId: SlotId;
  stream: MediaStream | null;
  send: (msg: WsMessage) => void;
}

export function useWebRTCCamera({ slotId, stream, send }: UseWebRTCCameraOptions) {
  const pcRef = useRef<RTCPeerConnection | null>(null);

  const createOffer = useCallback(async () => {
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

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    send({ type: 'camera-offer', slotId, sdp: pc.localDescription! });
  }, [slotId, stream, send]);

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
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  return { createOffer, handleAnswer, handleIceCandidate, close };
}

interface UseWebRTCArbitreOptions {
  send: (msg: WsMessage) => void;
  onTrack: (slotId: SlotId, stream: MediaStream) => void;
}

export function useWebRTCArbitre({ send, onTrack }: UseWebRTCArbitreOptions) {
  const pcsRef = useRef<Map<SlotId, RTCPeerConnection>>(new Map());

  const handleOffer = useCallback(async (slotId: SlotId, sdp: RTCSessionDescriptionInit) => {
    // Cleanup existing
    pcsRef.current.get(slotId)?.close();

    const pc = new RTCPeerConnection(peerConfig);
    pcsRef.current.set(slotId, pc);

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

  const connectToSlot = useCallback((slotId: SlotId) => {
    send({ type: 'arbitre-connect', slotId });
  }, [send]);

  const closeSlot = useCallback((slotId: SlotId) => {
    pcsRef.current.get(slotId)?.close();
    pcsRef.current.delete(slotId);
  }, []);

  const closeAll = useCallback(() => {
    for (const pc of pcsRef.current.values()) {
      pc.close();
    }
    pcsRef.current.clear();
  }, []);

  const getPeerConnection = useCallback((slotId: SlotId): RTCPeerConnection | undefined => {
    return pcsRef.current.get(slotId);
  }, []);

  return { handleOffer, handleIceCandidate, connectToSlot, closeSlot, closeAll, getPeerConnection };
}
