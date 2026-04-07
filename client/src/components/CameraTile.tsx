import React, { useEffect, useRef } from 'react';
import { SlotState } from 'shared/types';

interface CameraTileProps {
  slot: SlotState;
  stream: MediaStream | null;
  selected: boolean;
  onClick: () => void;
}

export default function CameraTile({ slot, stream, selected, onClick }: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  const statusClass = slot.cameraConnected ? 'connected' : 'offline';
  const tileClass = `camera-tile ${statusClass} ${selected ? 'selected' : ''}`;

  return (
    <div className={tileClass} onClick={onClick} style={{ cursor: 'pointer' }}>
      {stream ? (
        <video ref={videoRef} autoPlay muted playsInline />
      ) : (
        <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {slot.cameraConnected ? 'Connexion...' : 'Hors ligne'}
        </div>
      )}
      <div className="label">{slot.name}</div>
      <div className={`status-dot ${slot.cameraConnected ? 'live' : 'offline'}`} />
    </div>
  );
}
