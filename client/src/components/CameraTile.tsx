import React, { useEffect, useRef, useState } from 'react';
import { SlotState } from 'shared/types';

interface CameraTileProps {
  slot: SlotState;
  stream: MediaStream | null;
  selected: boolean;
  onClick: () => void;
}

export default function CameraTile({ slot, stream, selected, onClick }: CameraTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stats, setStats] = useState<{ w: number; h: number; fps: number } | null>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Measure resolution + fps from the actual video track
  useEffect(() => {
    if (!stream) { setStats(null); return; }
    const videoTrack = stream.getVideoTracks()[0];
    if (!videoTrack) return;

    const measure = () => {
      const settings = videoTrack.getSettings();
      if (settings.width && settings.height) {
        setStats({
          w: settings.width,
          h: settings.height,
          fps: settings.frameRate ? Math.round(settings.frameRate) : 0,
        });
      }
    };

    // Measure after a short delay (track needs time to stabilize)
    const timer = setTimeout(measure, 2000);
    const interval = setInterval(measure, 5000);
    return () => { clearTimeout(timer); clearInterval(interval); };
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
      {/* Stream info overlay */}
      {stats && (
        <div style={{
          position: 'absolute',
          bottom: 6,
          right: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6rem',
          color: 'var(--text-muted)',
          background: '#000000aa',
          padding: '1px 5px',
          lineHeight: 1.4,
        }}>
          {stats.w}x{stats.h}{stats.fps > 0 ? ` ${stats.fps}fps` : ''}
        </div>
      )}
    </div>
  );
}
