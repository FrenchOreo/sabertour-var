import React, { useEffect, useRef, useState } from 'react';
import { SlotState } from 'shared/types';
import { ConnectionStats, getHealth } from '../hooks/useConnectionStats';

interface CameraTileProps {
  slot: SlotState;
  stream: MediaStream | null;
  selected: boolean;
  onClick: () => void;
  connectionStats?: ConnectionStats;
  /** flux perdu / gelé : overlay + bordure rouge pulsée (reconnexion automatique en cours) */
  frozen?: boolean;
}

const HEALTH_COLORS = { good: '#22c55e', degraded: '#ff8c00', bad: '#ff3b3b' } as const;

export default function CameraTile({ slot, stream, selected, onClick, connectionStats, frozen }: CameraTileProps) {
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
  const tileClass = `camera-tile ${statusClass} ${selected ? 'selected' : ''} ${frozen ? 'frozen' : ''}`;

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
      {frozen && (
        <div className="tile-frozen-overlay">
          <div>⚠ Flux perdu</div>
          <div className="sub">Reconnexion automatique en cours…</div>
        </div>
      )}
      {/* Stream info overlay — stats réseau WebRTC si dispo, sinon réglages du track */}
      {connectionStats ? (
        <div style={{
          position: 'absolute',
          bottom: 6,
          right: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
          color: 'var(--text-muted)',
          background: '#000000aa',
          padding: '1px 5px',
          lineHeight: 1.4,
        }}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: HEALTH_COLORS[getHealth(connectionStats)],
          }} />
          {connectionStats.width > 0 && `${connectionStats.width}x${connectionStats.height} `}
          {connectionStats.fps > 0 && `${connectionStats.fps}fps `}
          {connectionStats.bitrateKbps > 0 && `${(connectionStats.bitrateKbps / 1000).toFixed(1)}Mb/s`}
          {connectionStats.lossPct > 0.5 && (
            <span style={{ color: HEALTH_COLORS[getHealth(connectionStats)] }}>
              {connectionStats.lossPct.toFixed(1)}% perte
            </span>
          )}
        </div>
      ) : stats && (
        <div style={{
          position: 'absolute',
          bottom: 6,
          right: 6,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.75rem',
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
