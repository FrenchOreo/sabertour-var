import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTCArbitre } from '../hooks/useWebRTC';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import { useRecording } from '../hooks/useRecording';
import CameraTile from '../components/CameraTile';
import VarTimeline from '../components/VarTimeline';
import FrameCounter from '../components/FrameCounter';
import { SlotId, SlotState, WsMessage } from 'shared/types';

const FPS_DEFAULT = 30;

export default function ArbitragePage() {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [streams, setStreams] = useState<Map<SlotId, MediaStream>>(new Map());
  const [expandedSlot, setExpandedSlot] = useState<SlotId | null>(null);
  const [varMode, setVarMode] = useState(false);
  const [varBlobs, setVarBlobs] = useState<Map<SlotId, string>>(new Map());
  const [varDurationMs, setVarDurationMs] = useState(0);
  const [varError, setVarError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoZoom, setVideoZoom] = useState(1);
  const [fps] = useState(FPS_DEFAULT);

  // Persistent VAR video refs — one per camera, never unmounted during VAR
  const varVideoRefs = useRef<Map<SlotId, HTMLVideoElement>>(new Map());
  // Which slot is the "active" one for frame control (first available or expanded)
  const activeVarSlotRef = useRef<SlotId | null>(null);
  const frameUpdateRef = useRef<ReturnType<typeof setInterval>>();
  const wasRecordingBeforeVar = useRef(false);
  const recordingFolderBeforeVar = useRef<string | null>(null);

  const { startRecording: startBufferRecording, stopRecording: stopBufferRecording, getBuffer, bufferDurations } = useVideoBuffer();
  const recording = useRecording();

  const frameInterval = 1 / fps;
  const varDurationSec = varDurationMs / 1000;
  const varTotalFrames = Math.round(varDurationSec * fps);

  // Get the active video element (expanded one, or first available)
  const getActiveVideo = useCallback((): HTMLVideoElement | null => {
    if (expandedSlot !== null) {
      return varVideoRefs.current.get(expandedSlot) || null;
    }
    // In grid mode, use first available
    for (const [, el] of varVideoRefs.current) {
      if (el.src) return el;
    }
    return null;
  }, [expandedSlot]);

  // Set time on ALL var videos at once
  const setAllVarTime = useCallback((time: number) => {
    varVideoRefs.current.forEach((v) => {
      v.currentTime = time;
    });
  }, []);

  const playAll = useCallback(() => {
    varVideoRefs.current.forEach((v) => {
      v.playbackRate = playbackRate;
      v.play().catch(() => {});
    });
    setIsPlaying(true);
  }, [playbackRate]);

  const pauseAll = useCallback(() => {
    varVideoRefs.current.forEach((v) => v.pause());
    setIsPlaying(false);
  }, []);

  // ============ Signaling + WebRTC (unchanged) ============
  const onTrack = useCallback(
    (slotId: SlotId, stream: MediaStream) => {
      setStreams((prev) => new Map(prev).set(slotId, stream));
      startBufferRecording(slotId, stream);
    },
    [startBufferRecording]
  );

  const webrtcRef = useRef<ReturnType<typeof useWebRTCArbitre>>(null!);
  const handleMessage = useCallback((msg: WsMessage) => {
    switch (msg.type) {
      case 'slots-state': setSlots(msg.slots); break;
      case 'slot-updated':
        setSlots((prev) => prev.map((s) => (s.slotId === msg.slot.slotId ? msg.slot : s)));
        if (msg.slot.cameraConnected && !msg.slot.arbitreConnected) webrtcRef.current.connectToSlot(msg.slot.slotId);
        break;
      case 'relay-offer': webrtcRef.current.handleOffer(msg.slotId, msg.sdp); break;
      case 'relay-ice': if (msg.from === 'camera') webrtcRef.current.handleIceCandidate(msg.slotId, msg.candidate); break;
      case 'error': console.error('[Signaling error]', msg.message); break;
    }
  }, []);

  const { send, connected } = useSignaling({ onMessage: handleMessage });
  const webrtc = useWebRTCArbitre({ send, onTrack });
  webrtcRef.current = webrtc;

  useEffect(() => { if (connected) send({ type: 'arbitre-join' }); }, [connected, send]);
  useEffect(() => {
    for (const slot of slots) {
      if (slot.cameraConnected && !slot.arbitreConnected) webrtc.connectToSlot(slot.slotId);
    }
  }, [slots]);

  // ============ VAR trigger ============
  const handleVarPress = useCallback(() => {
    let hasAnyData = false;
    const blobs = new Map<SlotId, string>();
    let maxDurationMs = 0;

    for (const slot of slots) {
      const buffer = getBuffer(slot.slotId);
      if (buffer && buffer.hasData()) {
        hasAnyData = true;
        const blob = buffer.getFullReplayBlob();
        if (blob) blobs.set(slot.slotId, URL.createObjectURL(blob));
        const dur = buffer.getReplayDurationMs();
        if (dur > maxDurationMs) maxDurationMs = dur;
      }
    }

    if (!hasAnyData) {
      setVarError('Buffer vide — attendre 30s après connexion des caméras');
      setTimeout(() => setVarError(null), 4000);
      return;
    }

    for (const slot of slots) stopBufferRecording(slot.slotId);
    wasRecordingBeforeVar.current = recording.isRecording;
    recordingFolderBeforeVar.current = recording.recordingFolder;
    if (recording.isRecording) recording.stopAll();

    setVarDurationMs(maxDurationMs);
    setVarBlobs(blobs);
    setVarMode(true);
    setExpandedSlot(null);
    setVideoZoom(1);
    setPlaybackRate(1);
    setCurrentTimeDisplay(maxDurationMs / 1000);
    setCurrentFrame(Math.round((maxDurationMs / 1000) * FPS_DEFAULT));
    setTotalFrames(Math.round((maxDurationMs / 1000) * FPS_DEFAULT));
  }, [slots, getBuffer, stopBufferRecording, recording]);

  const exitVarMode = useCallback(() => {
    setVarMode(false);
    setIsPlaying(false);
    setExpandedSlot(null);
    setVideoZoom(1);
    for (const url of varBlobs.values()) URL.revokeObjectURL(url);
    setVarBlobs(new Map());
    varVideoRefs.current.clear();
    clearInterval(frameUpdateRef.current);

    for (const slot of slots) {
      const stream = streams.get(slot.slotId);
      if (stream && slot.cameraConnected) startBufferRecording(slot.slotId, stream);
    }
    if (wasRecordingBeforeVar.current && recordingFolderBeforeVar.current) {
      const folder = recordingFolderBeforeVar.current;
      for (const slot of slots) {
        const stream = streams.get(slot.slotId);
        if (slot.cameraConnected && stream) recording.startRecording(slot.slotId, slot.name, stream, folder);
      }
    }
    wasRecordingBeforeVar.current = false;
  }, [varBlobs, slots, streams, startBufferRecording, recording]);

  // ============ Frame stepping (direct, no FramePlayer) ============
  const stepForward = useCallback((frames: number) => {
    const video = getActiveVideo();
    if (!video) return;
    const target = Math.min(video.currentTime + frameInterval * frames, varDurationSec);
    setAllVarTime(target);
    pauseAll();
  }, [getActiveVideo, frameInterval, varDurationSec, setAllVarTime, pauseAll]);

  const stepBackward = useCallback((frames: number) => {
    const video = getActiveVideo();
    if (!video) return;
    const target = Math.max(0, video.currentTime - frameInterval * frames);
    setAllVarTime(target);
    pauseAll();
  }, [getActiveVideo, frameInterval, setAllVarTime, pauseAll]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      pauseAll();
    } else {
      // Sync all to same time before playing
      const video = getActiveVideo();
      if (video) setAllVarTime(video.currentTime);
      playAll();
    }
  }, [isPlaying, pauseAll, playAll, getActiveVideo, setAllVarTime]);

  const handleSeek = useCallback((timeMs: number) => {
    setAllVarTime(timeMs / 1000);
  }, [setAllVarTime]);

  const handleSpeedChange = useCallback((rate: number) => {
    setPlaybackRate(rate);
    varVideoRefs.current.forEach((v) => { v.playbackRate = rate; });
  }, []);

  // Update frame counter
  useEffect(() => {
    if (!varMode) return;
    frameUpdateRef.current = setInterval(() => {
      const video = getActiveVideo();
      if (!video) return;
      const time = Math.min(video.currentTime, varDurationSec);
      setCurrentFrame(Math.min(Math.round(time * fps), varTotalFrames));
      setTotalFrames(varTotalFrames);
      setCurrentTimeDisplay(time);
    }, 50);
    return () => clearInterval(frameUpdateRef.current);
  }, [varMode, getActiveVideo, varDurationSec, varTotalFrames, fps]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!varMode) return;
      switch (e.key) {
        case 'ArrowRight': stepForward(1); e.preventDefault(); break;
        case 'ArrowLeft': stepBackward(1); e.preventDefault(); break;
        case 'ArrowUp': stepForward(10); e.preventDefault(); break;
        case 'ArrowDown': stepBackward(10); e.preventDefault(); break;
        case ' ': togglePlayPause(); e.preventDefault(); break;
        case '1': handleSpeedChange(1); break;
        case '2': handleSpeedChange(0.5); break;
        case '3': handleSpeedChange(0.25); break;
        case '4': handleSpeedChange(0.1); break;
        case 'Escape':
          if (expandedSlot) { setExpandedSlot(null); setVideoZoom(1); pauseAll(); }
          else exitVarMode();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [varMode, expandedSlot, stepForward, stepBackward, togglePlayPause, handleSpeedChange, pauseAll, exitVarMode]);

  // Recording toggle
  const handleRecordToggle = useCallback(async () => {
    if (recording.isRecording) { recording.stopAll(); return; }
    let folder = recording.recordingFolder;
    if (!folder) { folder = await recording.selectFolder(); if (!folder) return; }
    for (const slot of slots) {
      const stream = streams.get(slot.slotId);
      if (slot.cameraConnected && stream) recording.startRecording(slot.slotId, slot.name, stream, folder);
    }
  }, [recording, slots, streams]);

  const handleVideoWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setVideoZoom((z) => Math.max(1, Math.min(5, z + (e.deltaY < 0 ? 0.25 : -0.25))));
  }, []);

  const expandedSlotInfo = slots.find((s) => s.slotId === expandedSlot);
  const isLiveGrid = !varMode && !expandedSlot;
  const isLiveExpanded = !varMode && expandedSlot !== null;

  const renderVarControls = () => (
    <div style={{
      padding: '8px 12px', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 0,
    }}>
      <div className="flex items-center gap-2">
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => stepBackward(10)}>{'\u25C0\u25C0'} -10</button>
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => stepBackward(1)}>{'\u25C0'} -1</button>
        <button className="btn" style={{ padding: '6px 16px', fontSize: '0.9rem' }} onClick={togglePlayPause}>{isPlaying ? '\u23F8' : '\u25B6'}</button>
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => stepForward(1)}>+1 {'\u25B6'}</button>
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => stepForward(10)}>+10 {'\u25B6\u25B6'}</button>
      </div>
      <div className="font-mono text-cyan" style={{ fontSize: '0.85rem' }}>{currentFrame} / {totalFrames}</div>
      <div className="flex items-center gap-2">
        {[0.1, 0.25, 0.5, 1].map((rate) => (
          <button key={rate} className={`speed-btn ${playbackRate === rate ? 'active' : ''}`}
            style={{ padding: '4px 8px', fontSize: '0.75rem' }} onClick={() => handleSpeedChange(rate)}>{rate}x</button>
        ))}
      </div>
      <button className="btn-live" onClick={exitVarMode} style={{ padding: '8px 20px', fontSize: '0.85rem', marginLeft: 8 }}>
        REPRENDRE LE LIVE
      </button>
    </div>
  );

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div className={varMode ? 'var-header' : ''} style={{
        padding: '6px 16px', background: varMode ? undefined : 'var(--bg-surface)',
        borderBottom: varMode ? undefined : '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
      }}>
        <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 700, color: varMode ? 'var(--red)' : 'var(--cyan)', textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.9rem' }}>
          {varMode ? 'MODE VAR' : 'SABER VAR'}
        </span>
        <span className="text-muted" style={{ fontSize: '0.8rem', flex: 1 }}>
          {connected ? '\u25CF Connecté' : '\u25CB Déconnecté'}
        </span>
        {(isLiveExpanded || (varMode && expandedSlot)) && (
          <button className="btn" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => { setExpandedSlot(null); setVideoZoom(1); if (varMode) pauseAll(); }}>
            {'\u2190'} 4 Caméras
          </button>
        )}
        <a href="/setup" className="btn" style={{ textDecoration: 'none', fontSize: '0.7rem', padding: '4px 10px' }}>Setup</a>
        <a href="/settings" className="btn" style={{ textDecoration: 'none', fontSize: '0.7rem', padding: '4px 10px' }}>Paramètres</a>
      </div>

      {/* ============ LIVE GRID ============ */}
      {isLiveGrid && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 4, padding: 4, minHeight: 0 }}>
          {slots.map((slot) => (
            <CameraTile key={slot.slotId} slot={slot} stream={streams.get(slot.slotId) || null} selected={false} onClick={() => setExpandedSlot(slot.slotId)} />
          ))}
          {slots.length === 0 && (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase' }}>
              En attente... <a href="/setup" style={{ color: 'var(--cyan)', marginLeft: 8 }}>Page setup</a>
            </div>
          )}
        </div>
      )}

      {/* ============ LIVE EXPANDED ============ */}
      {isLiveExpanded && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }} onWheel={handleVideoWheel}>
          {(() => {
            const stream = expandedSlot !== null ? streams.get(expandedSlot) : null;
            if (stream) return <LiveExpandedVideo stream={stream} zoom={videoZoom} />;
            const slotInfo = slots.find((s) => s.slotId === expandedSlot);
            return <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase' }}>{slotInfo?.cameraConnected ? 'Connexion...' : 'Hors ligne'}</div>;
          })()}
          {expandedSlotInfo && (
            <div style={{ position: 'absolute', top: 8, left: 8, fontFamily: 'var(--font-ui)', fontWeight: 600, fontSize: '0.9rem', textTransform: 'uppercase', color: 'var(--cyan)', background: '#000000aa', padding: '2px 10px', border: '1px solid var(--cyan-border)' }}>
              {expandedSlotInfo.name}
            </div>
          )}
          {videoZoom > 1 && (
            <div style={{ position: 'absolute', bottom: 8, right: 8, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--cyan)', background: '#000000aa', padding: '2px 8px', border: '1px solid var(--cyan-border)' }}>
              {videoZoom.toFixed(1)}x zoom
            </div>
          )}
        </div>
      )}

      {/* ============ VAR MODE — SINGLE PERSISTENT BLOCK ============ */}
      {varMode && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, background: '#000' }}>
          {/* Video area — persistent videos, CSS switches layout */}
          <div
            style={{
              flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden',
              display: expandedSlot ? 'flex' : 'grid',
              gridTemplateColumns: expandedSlot ? undefined : 'repeat(2, 1fr)',
              gridTemplateRows: expandedSlot ? undefined : 'repeat(2, 1fr)',
              gap: expandedSlot ? 0 : 4,
              padding: expandedSlot ? 0 : 4,
              alignItems: expandedSlot ? 'center' : undefined,
              justifyContent: expandedSlot ? 'center' : undefined,
            }}
            onWheel={expandedSlot ? handleVideoWheel : undefined}
          >
            {slots.map((slot) => {
              const blobUrl = varBlobs.get(slot.slotId);
              const isExpanded = expandedSlot === slot.slotId;
              const isHidden = expandedSlot !== null && !isExpanded;

              if (!blobUrl) {
                // No data for this slot
                return (
                  <div key={slot.slotId} className="camera-tile offline"
                    style={{ display: isHidden ? 'none' : 'flex', ...(isExpanded ? { position: 'absolute', inset: 0 } : {}) }}>
                    <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', fontSize: '0.85rem' }}>Pas de données</div>
                    <div className="label">{slot.name}</div>
                  </div>
                );
              }

              return (
                <div
                  key={slot.slotId}
                  className={`camera-tile var-available`}
                  style={{
                    display: isHidden ? 'none' : 'flex',
                    cursor: expandedSlot ? 'default' : 'pointer',
                    ...(isExpanded ? { position: 'absolute', inset: 0, border: 'none' } : {}),
                  }}
                  onClick={() => { if (!expandedSlot) setExpandedSlot(slot.slotId); }}
                >
                  <PersistentVarVideo
                    slotId={slot.slotId}
                    blobUrl={blobUrl}
                    initialTime={varDurationSec}
                    registerRef={(el) => { if (el) varVideoRefs.current.set(slot.slotId, el); else varVideoRefs.current.delete(slot.slotId); }}
                    zoom={isExpanded ? videoZoom : 1}
                  />
                  {!expandedSlot && (
                    <div className="label" style={{ color: 'var(--red)' }}>{slot.name}</div>
                  )}
                </div>
              );
            })}

            {/* Frame counter overlay in expanded mode */}
            {expandedSlot && (
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}>
                <FrameCounter currentFrame={currentFrame} totalFrames={totalFrames} currentTime={currentTimeDisplay} />
              </div>
            )}
            {expandedSlot && videoZoom > 1 && (
              <div style={{ position: 'absolute', bottom: 8, right: 8, zIndex: 2, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--cyan)', background: '#000000aa', padding: '2px 8px', border: '1px solid var(--cyan-border)' }}>
                {videoZoom.toFixed(1)}x zoom
              </div>
            )}
          </div>

          {/* Timeline */}
          <div style={{ padding: '4px 12px', flexShrink: 0 }}>
            <VarTimeline durationMs={varDurationMs} currentTimeMs={currentTimeDisplay * 1000} fps={fps} onSeek={handleSeek} />
          </div>

          {/* Controls */}
          {renderVarControls()}
        </div>
      )}

      {/* Floating overlay (live only) */}
      {!varMode && (
        <div style={{ position: 'fixed', bottom: 16, left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: 12, zIndex: 50, pointerEvents: 'none' }}>
          {recording.isElectron && (
            <button onClick={handleRecordToggle} style={{
              pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 16px', border: recording.isRecording ? '2px solid #ff4444' : '2px solid var(--border)',
              borderRadius: 24, background: recording.isRecording ? 'rgba(255, 68, 68, 0.2)' : 'rgba(18, 18, 26, 0.9)',
              color: recording.isRecording ? '#ff4444' : 'var(--text)', cursor: 'pointer',
              fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: '0.85rem', textTransform: 'uppercase', backdropFilter: 'blur(8px)',
            }}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: recording.isRecording ? '#ff4444' : '#666', animation: recording.isRecording ? 'rec-blink 1s ease-in-out infinite' : 'none' }} />
              {recording.isRecording ? 'STOP' : 'REC'}
            </button>
          )}
          <button className="btn-var" onClick={handleVarPress} style={{ pointerEvents: 'auto', padding: '14px 40px', fontSize: '1.4rem' }}>VAR</button>
        </div>
      )}

      {varError && <div className="toast-error">{varError}</div>}
    </div>
  );
}

/** Live expanded video with stats overlay */
function LiveExpandedVideo({ stream, zoom }: { stream: MediaStream; zoom: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stats, setStats] = useState('');

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, [stream]);
  useEffect(() => {
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const measure = () => { const s = track.getSettings(); if (s.width && s.height) setStats(`${s.width}x${s.height}${s.frameRate ? ` ${Math.round(s.frameRate)}fps` : ''}`); };
    const t = setTimeout(measure, 1000);
    const i = setInterval(measure, 5000);
    return () => { clearTimeout(t); clearInterval(i); };
  }, [stream]);

  return (
    <>
      <video ref={videoRef} autoPlay muted playsInline style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.1s' }} />
      {stats && <div style={{ position: 'absolute', bottom: 8, left: 8, fontFamily: 'var(--font-mono)', fontSize: '0.7rem', color: 'var(--text-muted)', background: '#000000aa', padding: '2px 6px' }}>{stats}</div>}
    </>
  );
}

/** Persistent VAR video — mounted ONCE, never re-created during VAR mode */
function PersistentVarVideo({ slotId, blobUrl, initialTime, registerRef, zoom }: {
  slotId: SlotId;
  blobUrl: string;
  initialTime: number;
  registerRef: (el: HTMLVideoElement | null) => void;
  zoom: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || initialized.current) return;
    initialized.current = true;
    registerRef(el);
    el.src = blobUrl;
    el.preload = 'auto';
    el.onloadeddata = () => {
      el.currentTime = initialTime;
    };
    return () => { registerRef(null); initialized.current = false; };
  }, [blobUrl, initialTime, registerRef]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      style={{
        width: '100%', height: '100%', objectFit: 'cover',
        transform: zoom !== 1 ? `scale(${zoom})` : undefined,
        transformOrigin: 'center center',
        transition: 'transform 0.1s',
      }}
    />
  );
}
