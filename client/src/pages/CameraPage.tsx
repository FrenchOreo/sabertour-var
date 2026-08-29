import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTCCamera } from '../hooks/useWebRTC';
import { SlotId, WsMessage } from 'shared/types';
import { getResolutionConstraints, getResolution, setResolution, RESOLUTION_OPTIONS, Resolution, getFrameRate, setFrameRate, FRAMERATE_OPTIONS, FrameRate } from '../lib/qualitySettings';

type CameraStatus = 'init' | 'permission' | 'connecting' | 'live' | 'reconnecting' | 'error';

async function getCameraStream(): Promise<MediaStream> {
  const res = getResolutionConstraints();
  const fps = getFrameRate();
  const constraints = [
    // Try exact resolution first (forces full quality from the start)
    { video: { facingMode: 'environment', width: { exact: res.width.ideal }, height: { exact: res.height.ideal }, frameRate: { ideal: fps } }, audio: false },
    // Fallback to ideal (browser picks closest match)
    { video: { facingMode: 'environment', ...res, frameRate: { ideal: fps } }, audio: false },
    // Fallback to just facing mode
    { video: { facingMode: 'environment' }, audio: false },
    // Last resort
    { video: true, audio: false },
  ];

  for (const constraint of constraints) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraint);
      // Le contenu est du mouvement rapide : l'encodeur WebRTC privilégie
      // la fluidité temporelle plutôt que le détail statique
      for (const track of stream.getVideoTracks()) {
        try { track.contentHint = 'motion'; } catch {}
      }
      return stream;
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

  // Store webrtc functions in refs so handleMessage always uses latest
  const webrtcRef = useRef<ReturnType<typeof useWebRTCCamera>>(null!);

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
            webrtcRef.current.createOffer();
          }
          break;
        case 'relay-answer':
          if (msg.slotId === slotId) {
            webrtcRef.current.handleAnswer(msg.sdp);
          }
          break;
        case 'relay-ice':
          if (msg.slotId === slotId && msg.from === 'arbitre') {
            webrtcRef.current.handleIceCandidate(msg.candidate);
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
  webrtcRef.current = webrtc;

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
      const res = getResolutionConstraints();
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: newMode, ...res, frameRate: { ideal: getFrameRate() } },
        audio: false,
      });
      for (const track of s.getVideoTracks()) {
        try { track.contentHint = 'motion'; } catch {}
      }
      stream?.getTracks().forEach((t) => t.stop());
      setStream(s);
      setFacingMode(newMode);
      if (videoRef.current) {
        videoRef.current.srcObject = s;
      }
    } catch {}
  };

  // Change resolution / framerate
  const [resolution, setResolutionState] = useState<Resolution>(getResolution);
  const [frameRate, setFrameRateState] = useState<FrameRate>(getFrameRate);
  const [showSettings, setShowSettings] = useState(false);

  const restartStream = async () => {
    try {
      const s = await getCameraStream();
      stream?.getTracks().forEach((t) => t.stop());
      setStream(s);
      if (videoRef.current) videoRef.current.srcObject = s;
    } catch {}
  };

  const handleResolutionChange = async (newRes: Resolution) => {
    setResolution(newRes);
    setResolutionState(newRes);
    await restartStream();
  };

  const handleFrameRateChange = async (newFps: FrameRate) => {
    setFrameRate(newFps);
    setFrameRateState(newFps);
    await restartStream();
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

        {/* Buttons */}
        {stream && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 24, flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={handleFlip}
              style={{ fontSize: '0.85rem' }}
            >
              ↕ Retourner
            </button>
            <button
              className="btn"
              onClick={() => setShowSettings((s) => !s)}
              style={{ fontSize: '0.85rem' }}
            >
              ⚙ Réglages
            </button>
          </div>
        )}

        {/* Settings panel */}
        {stream && showSettings && (
          <div style={{ marginTop: 16, padding: 16, background: '#000000aa', border: '1px solid var(--cyan-border)', borderRadius: 4, maxWidth: 320, margin: '16px auto 0' }}>
            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
              }}
            >
              Résolution :
            </label>
            <select
              className="input"
              value={resolution}
              onChange={(e) => handleResolutionChange(e.target.value as Resolution)}
              style={{ width: '100%' }}
            >
              {RESOLUTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <label
              style={{
                display: 'block',
                fontSize: '0.8rem',
                margin: '12px 0 6px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'var(--text-muted)',
              }}
            >
              Fluidité :
            </label>
            <select
              className="input"
              value={frameRate}
              onChange={(e) => handleFrameRateChange(Number(e.target.value) as FrameRate)}
              style={{ width: '100%' }}
            >
              {FRAMERATE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
