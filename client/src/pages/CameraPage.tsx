import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTCCamera } from '../hooks/useWebRTC';
import { SlotId, WsMessage } from 'shared/types';

type CameraStatus = 'init' | 'permission' | 'connecting' | 'live' | 'reconnecting' | 'error';

async function getCameraStream(): Promise<MediaStream> {
  const constraints = [
    { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: 'environment' }, audio: false },
    { video: true, audio: false },
  ];

  for (const constraint of constraints) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraint);
    } catch {
      continue;
    }
  }
  throw new Error('Aucune caméra accessible');
}

async function requestWakeLock(): Promise<void> {
  try {
    if ('wakeLock' in navigator) {
      await (navigator as any).wakeLock.request('screen');
    }
  } catch {}
}

export default function CameraPage() {
  const params = new URLSearchParams(window.location.search);
  const slotId = Number(params.get('slot')) as SlotId;
  const token = params.get('token') || '';

  const [status, setStatus] = useState<CameraStatus>('init');
  const [errorMsg, setErrorMsg] = useState('');
  const [slotName, setSlotName] = useState('');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      switch (msg.type) {
        case 'slots-state':
          const slot = msg.slots.find((s) => s.slotId === slotId);
          if (slot) setSlotName(slot.name);
          setStatus('live');
          break;
        case 'slot-updated':
          if (msg.slot.slotId === slotId) setSlotName(msg.slot.name);
          break;
        case 'relay-connect-request':
          if (msg.slotId === slotId) {
            webrtc.createOffer();
          }
          break;
        case 'relay-answer':
          if (msg.slotId === slotId) {
            webrtc.handleAnswer(msg.sdp);
          }
          break;
        case 'relay-ice':
          if (msg.slotId === slotId && msg.from === 'arbitre') {
            webrtc.handleIceCandidate(msg.candidate);
          }
          break;
        case 'error':
          setStatus('error');
          setErrorMsg(msg.message);
          break;
      }
    },
    [slotId]
  );

  const { send, connected } = useSignaling({ onMessage: handleMessage });

  const webrtc = useWebRTCCamera({ slotId, stream, send });

  // Get camera and join
  useEffect(() => {
    if (!slotId || !token) {
      setStatus('error');
      setErrorMsg('Paramètres manquants (slot ou token)');
      return;
    }

    setStatus('permission');

    getCameraStream()
      .then((s) => {
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
        setStatus('connecting');
      })
      .catch((e) => {
        setStatus('error');
        setErrorMsg(e.message);
      });

    requestWakeLock();
  }, [slotId, token]);

  // Join when connected
  useEffect(() => {
    if (connected && stream && slotId && token) {
      send({ type: 'camera-join', slotId, token, name: '' });
    }
  }, [connected, stream, slotId, token, send]);

  // Flip camera
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const handleFlip = async () => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment';
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode },
        audio: false,
      });
      stream?.getTracks().forEach((t) => t.stop());
      setStream(s);
      setFacingMode(newMode);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {}
  };

  const statusConfig: Record<CameraStatus, { color: string; text: string; animate: boolean }> = {
    init: { color: 'var(--text-dim)', text: 'INITIALISATION', animate: true },
    permission: { color: 'var(--text-dim)', text: 'EN ATTENTE DE PERMISSION', animate: false },
    connecting: { color: 'var(--text-dim)', text: 'CONNEXION AU SERVEUR...', animate: true },
    live: { color: 'var(--cyan)', text: 'EN DIRECT', animate: false },
    reconnecting: { color: 'var(--orange)', text: 'RECONNEXION...', animate: true },
    error: { color: 'var(--red)', text: `ERREUR`, animate: false },
  };

  const currentStatus = statusConfig[status];

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      {/* Hidden video for stream preview */}
      <video
        ref={videoRef}
        autoPlay
        muted
        playsInline
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          opacity: status === 'live' ? 0.2 : 0,
          transition: 'opacity 0.5s',
        }}
      />

      {/* Status overlay */}
      <div style={{ position: 'relative', zIndex: 1, textAlign: 'center', padding: 24 }}>
        {/* Status dot */}
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: currentStatus.color,
            margin: '0 auto 16px',
            animation: status === 'live' ? 'blink 1.5s infinite' : currentStatus.animate ? 'blink 1s infinite' : 'none',
          }}
        />

        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            fontSize: '1.4rem',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: currentStatus.color,
            marginBottom: 8,
          }}
        >
          {slotName ? `CAMÉRA ${slotName}` : `CAMÉRA ${slotId}`}
        </div>

        <div
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 600,
            fontSize: '1.1rem',
            textTransform: 'uppercase',
            letterSpacing: '0.2em',
            color: currentStatus.color,
            marginBottom: 16,
          }}
        >
          {currentStatus.text}
        </div>

        {status === 'error' && (
          <div style={{ color: 'var(--red)', fontFamily: 'var(--font-mono)', fontSize: '0.85rem', marginBottom: 16 }}>
            {errorMsg}
          </div>
        )}

        {status === 'permission' && (
          <div className="text-muted" style={{ fontSize: '0.9rem', maxWidth: 300, margin: '0 auto' }}>
            Autorisez l'accès à la caméra quand le navigateur le demande
          </div>
        )}

        {/* Flip button */}
        {stream && (
          <button
            className="btn"
            onClick={handleFlip}
            style={{ marginTop: 24, fontSize: '0.85rem' }}
          >
            ↕ Retourner
          </button>
        )}
      </div>
    </div>
  );
}
