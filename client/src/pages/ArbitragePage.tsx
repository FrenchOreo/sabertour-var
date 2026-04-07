import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTCArbitre } from '../hooks/useWebRTC';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import { useFramePlayer } from '../hooks/useFramePlayer';
import { useRecording } from '../hooks/useRecording';
import CameraTile from '../components/CameraTile';
import VarTimeline from '../components/VarTimeline';
import FrameCounter from '../components/FrameCounter';
import { SlotId, SlotState, WsMessage } from 'shared/types';

export default function ArbitragePage() {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [streams, setStreams] = useState<Map<SlotId, MediaStream>>(new Map());
  const [expandedSlot, setExpandedSlot] = useState<SlotId | null>(null);
  const [varMode, setVarMode] = useState(false);
  const [varBlobs, setVarBlobs] = useState<Map<SlotId, string>>(new Map());
  const [varDurationMs, setVarDurationMs] = useState(0); // known duration from chunk timestamps
  const [varError, setVarError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [videoZoom, setVideoZoom] = useState(1);

  const varVideoRef = useRef<HTMLVideoElement>(null);
  const frameUpdateRef = useRef<ReturnType<typeof setInterval>>();
  const gridVideoRefs = useRef<Map<SlotId, HTMLVideoElement>>(new Map());
  const wasRecordingBeforeVar = useRef(false);
  const recordingFolderBeforeVar = useRef<string | null>(null);

  const { startRecording: startBufferRecording, stopRecording: stopBufferRecording, getBuffer, bufferDurations } = useVideoBuffer();
  const { player, fps, init: initFramePlayer } = useFramePlayer(varVideoRef);
  const recording = useRecording();

  const onTrack = useCallback(
    (slotId: SlotId, stream: MediaStream) => {
      setStreams((prev) => new Map(prev).set(slotId, stream));
      startBufferRecording(slotId, stream);
    },
    [startBufferRecording]
  );

  const webrtcRef = useRef<ReturnType<typeof useWebRTCArbitre>>(null!);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      switch (msg.type) {
        case 'slots-state':
          setSlots(msg.slots);
          break;
        case 'slot-updated':
          setSlots((prev) => prev.map((s) => (s.slotId === msg.slot.slotId ? msg.slot : s)));
          if (msg.slot.cameraConnected && !msg.slot.arbitreConnected) {
            webrtcRef.current.connectToSlot(msg.slot.slotId);
          }
          break;
        case 'relay-offer':
          webrtcRef.current.handleOffer(msg.slotId, msg.sdp);
          break;
        case 'relay-ice':
          if (msg.from === 'camera') {
            webrtcRef.current.handleIceCandidate(msg.slotId, msg.candidate);
          }
          break;
        case 'error':
          console.error('[Signaling error]', msg.message);
          break;
      }
    },
    []
  );

  const { send, connected } = useSignaling({ onMessage: handleMessage });
  const webrtc = useWebRTCArbitre({ send, onTrack });
  webrtcRef.current = webrtc;

  useEffect(() => {
    if (connected) send({ type: 'arbitre-join' });
  }, [connected, send]);

  useEffect(() => {
    for (const slot of slots) {
      if (slot.cameraConnected && !slot.arbitreConnected) {
        webrtc.connectToSlot(slot.slotId);
      }
    }
  }, [slots]);

  // === VAR trigger ===
  const handleVarPress = useCallback(() => {
    let hasAnyData = false;
    const blobs = new Map<SlotId, string>();
    let maxDurationMs = 0;

    for (const slot of slots) {
      const buffer = getBuffer(slot.slotId);
      if (buffer && buffer.hasData()) {
        hasAnyData = true;
        const blob = buffer.getFullReplayBlob();
        if (blob) {
          blobs.set(slot.slotId, URL.createObjectURL(blob));
        }
        const dur = buffer.getReplayDurationMs();
        if (dur > maxDurationMs) maxDurationMs = dur;
      }
    }

    if (!hasAnyData) {
      setVarError('Buffer vide — attendre 30s après connexion des caméras');
      setTimeout(() => setVarError(null), 4000);
      return;
    }

    // Stop buffer + file recording so blobs are stable
    for (const slot of slots) {
      stopBufferRecording(slot.slotId);
    }
    // Save recording state to auto-restart on exit
    wasRecordingBeforeVar.current = recording.isRecording;
    recordingFolderBeforeVar.current = recording.recordingFolder;
    if (recording.isRecording) {
      recording.stopAll();
    }

    setVarDurationMs(maxDurationMs);
    setVarBlobs(blobs);
    setVarMode(true);
    setExpandedSlot(null);
    setVideoZoom(1);
  }, [slots, getBuffer, stopBufferRecording, recording]);

  const exitVarMode = useCallback(() => {
    setVarMode(false);
    setIsPlaying(false);
    setExpandedSlot(null);
    setVideoZoom(1);
    for (const url of varBlobs.values()) {
      URL.revokeObjectURL(url);
    }
    setVarBlobs(new Map());
    if (varVideoRef.current) {
      varVideoRef.current.pause();
      varVideoRef.current.src = '';
    }
    clearInterval(frameUpdateRef.current);

    // Restart buffer recording
    for (const slot of slots) {
      const stream = streams.get(slot.slotId);
      if (stream && slot.cameraConnected) {
        startBufferRecording(slot.slotId, stream);
      }
    }

    // Auto-restart file recording if it was active before VAR (new files)
    if (wasRecordingBeforeVar.current && recordingFolderBeforeVar.current) {
      const folder = recordingFolderBeforeVar.current;
      for (const slot of slots) {
        const stream = streams.get(slot.slotId);
        if (slot.cameraConnected && stream) {
          recording.startRecording(slot.slotId, slot.name, stream, folder);
        }
      }
    }
    wasRecordingBeforeVar.current = false;
  }, [varBlobs, slots, streams, startBufferRecording, recording]);

  // Sync grid videos
  const syncGridVideos = useCallback((time: number) => {
    gridVideoRefs.current.forEach((video) => {
      if (Math.abs(video.currentTime - time) > 0.05) {
        video.currentTime = time;
      }
    });
  }, []);

  // Known duration in seconds
  const varDurationSec = varDurationMs / 1000;
  const varTotalFrames = Math.round(varDurationSec * fps);

  // Helper to compute frame from currentTime, clamped to known total
  const getFrameFromTime = useCallback((time: number) => {
    const frame = Math.round(time * fps);
    return Math.min(frame, varTotalFrames);
  }, [fps, varTotalFrames]);

  // === VAR expanded: load blob ===
  useEffect(() => {
    if (!varMode || !expandedSlot) return;
    const blobUrl = varBlobs.get(expandedSlot);
    const video = varVideoRef.current;
    if (!blobUrl || !video) return;

    video.src = blobUrl;
    video.onloadeddata = async () => {
      await initFramePlayer();
      if (varVideoRef.current) {
        varVideoRef.current.pause();
        // Seek to end using known duration
        varVideoRef.current.currentTime = varDurationSec;
        setTotalFrames(varTotalFrames);
        setCurrentFrame(varTotalFrames);
        setCurrentTimeDisplay(varDurationSec);
      }
    };
  }, [varMode, expandedSlot, varBlobs, initFramePlayer, varDurationSec, varTotalFrames]);

  // === VAR grid: init reference video ===
  useEffect(() => {
    if (!varMode || expandedSlot) return;
    const video = varVideoRef.current;
    if (!video) return;

    const firstBlob = varBlobs.values().next().value;
    if (!firstBlob) return;

    video.src = firstBlob;
    video.onloadeddata = async () => {
      await initFramePlayer();
      if (varVideoRef.current) {
        varVideoRef.current.pause();
        varVideoRef.current.currentTime = varDurationSec;
        setTotalFrames(varTotalFrames);
        setCurrentFrame(varTotalFrames);
        setCurrentTimeDisplay(varDurationSec);
        syncGridVideos(varDurationSec);
      }
    };
  }, [varMode, expandedSlot, varBlobs, initFramePlayer, varDurationSec, varTotalFrames, syncGridVideos]);

  const togglePlayPause = useCallback(() => {
    if (!player) return;
    if (player.paused) {
      // Sync grid videos to reference time BEFORE playing
      const refTime = varVideoRef.current?.currentTime || 0;
      gridVideoRefs.current.forEach((v) => {
        v.currentTime = refTime;
        v.playbackRate = playbackRate;
        v.play();
      });
      player.play();
      setIsPlaying(true);
    } else {
      player.pause();
      gridVideoRefs.current.forEach((v) => v.pause());
      setIsPlaying(false);
    }
  }, [player, playbackRate]);

  // Update frame counter using known duration
  useEffect(() => {
    if (varMode && player) {
      frameUpdateRef.current = setInterval(() => {
        const time = Math.min(varVideoRef.current?.currentTime || 0, varDurationSec);
        setCurrentFrame(getFrameFromTime(time));
        setTotalFrames(varTotalFrames);
        setCurrentTimeDisplay(time);
        if (!expandedSlot && varVideoRef.current) {
          syncGridVideos(varVideoRef.current.currentTime);
        }
      }, 50);
      return () => clearInterval(frameUpdateRef.current);
    }
  }, [varMode, expandedSlot, player, syncGridVideos, varTotalFrames, getFrameFromTime]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!varMode || !player) return;
      switch (e.key) {
        case 'ArrowRight':
          player.stepForward(1);
          if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          player.stepBackward(1);
          if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case 'ArrowUp':
          player.stepForward(10);
          if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case 'ArrowDown':
          player.stepBackward(10);
          if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case ' ':
          togglePlayPause();
          e.preventDefault();
          break;
        case '1': player.setPlaybackRate(1); setPlaybackRate(1); gridVideoRefs.current.forEach((v) => { v.playbackRate = 1; }); break;
        case '2': player.setPlaybackRate(0.5); setPlaybackRate(0.5); gridVideoRefs.current.forEach((v) => { v.playbackRate = 0.5; }); break;
        case '3': player.setPlaybackRate(0.25); setPlaybackRate(0.25); gridVideoRefs.current.forEach((v) => { v.playbackRate = 0.25; }); break;
        case '4': player.setPlaybackRate(0.1); setPlaybackRate(0.1); gridVideoRefs.current.forEach((v) => { v.playbackRate = 0.1; }); break;
        case 'Escape':
          if (expandedSlot) {
            setExpandedSlot(null);
            setVideoZoom(1);
            if (varVideoRef.current) varVideoRef.current.pause();
            setIsPlaying(false);
          } else {
            exitVarMode();
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [varMode, expandedSlot, player, togglePlayPause, exitVarMode, syncGridVideos]);

  const handleSeek = useCallback(
    (timeMs: number) => {
      if (varVideoRef.current) {
        varVideoRef.current.currentTime = timeMs / 1000;
        syncGridVideos(timeMs / 1000);
      }
    },
    [syncGridVideos]
  );

  const handleSpeedChange = useCallback(
    (rate: number) => {
      if (player) {
        player.setPlaybackRate(rate);
        setPlaybackRate(rate);
        gridVideoRefs.current.forEach((v) => { v.playbackRate = rate; });
      }
    },
    [player]
  );

  const handleStepForward = useCallback((frames: number) => {
    if (!player) return;
    player.stepForward(frames);
    // Clamp to known duration
    if (varVideoRef.current && varVideoRef.current.currentTime > varDurationSec) {
      varVideoRef.current.currentTime = varDurationSec;
    }
    gridVideoRefs.current.forEach((v) => v.pause());
    setIsPlaying(false);
    setTimeout(() => {
      if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
    }, 30);
  }, [player, syncGridVideos, varDurationSec]);

  const handleStepBackward = useCallback((frames: number) => {
    if (!player) return;
    player.stepBackward(frames);
    gridVideoRefs.current.forEach((v) => v.pause());
    setIsPlaying(false);
    setTimeout(() => {
      if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
    }, 30);
  }, [player, syncGridVideos]);

  // Recording toggle
  const handleRecordToggle = useCallback(async () => {
    if (recording.isRecording) {
      recording.stopAll();
      return;
    }
    let folder = recording.recordingFolder;
    if (!folder) {
      folder = await recording.selectFolder();
      if (!folder) return;
    }
    for (const slot of slots) {
      const stream = streams.get(slot.slotId);
      if (slot.cameraConnected && stream) {
        recording.startRecording(slot.slotId, slot.name, stream, folder);
      }
    }
  }, [recording, slots, streams]);

  // Zoom on expanded video (scroll wheel)
  const handleVideoWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setVideoZoom((z) => Math.max(1, Math.min(5, z + (e.deltaY < 0 ? 0.25 : -0.25))));
  }, []);

  const expandedSlotInfo = slots.find((s) => s.slotId === expandedSlot);
  const isLiveGrid = !varMode && !expandedSlot;
  const isLiveExpanded = !varMode && expandedSlot !== null;
  const isVarGrid = varMode && !expandedSlot;
  const isVarExpanded = varMode && expandedSlot !== null;

  // Shared VAR controls (includes REPRENDRE LE LIVE to avoid overlap with floating buttons)
  const renderVarControls = () => (
    <div style={{
      padding: '8px 12px',
      background: 'var(--bg-surface)',
      borderTop: '1px solid var(--border)',
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      flexShrink: 0,
    }}>
      <div className="flex items-center gap-2">
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleStepBackward(10)}>
          {'\u25C0\u25C0'} -10
        </button>
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleStepBackward(1)}>
          {'\u25C0'} -1
        </button>
        <button className="btn" style={{ padding: '6px 16px', fontSize: '0.9rem' }} onClick={togglePlayPause}>
          {isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleStepForward(1)}>
          +1 {'\u25B6'}
        </button>
        <button className="btn" style={{ padding: '6px 12px', fontSize: '0.8rem' }} onClick={() => handleStepForward(10)}>
          +10 {'\u25B6\u25B6'}
        </button>
      </div>

      <div className="font-mono text-cyan" style={{ fontSize: '0.85rem' }}>
        {currentFrame} / {totalFrames}
      </div>

      <div className="flex items-center gap-2">
        {[0.1, 0.25, 0.5, 1].map((rate) => (
          <button
            key={rate}
            className={`speed-btn ${playbackRate === rate ? 'active' : ''}`}
            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
            onClick={() => handleSpeedChange(rate)}
          >
            {rate}x
          </button>
        ))}
      </div>

      <button className="btn-live" onClick={exitVarMode} style={{ padding: '8px 20px', fontSize: '0.85rem', marginLeft: 8 }}>
        REPRENDRE LE LIVE
      </button>
    </div>
  );

  const renderTimeline = () => (
    <div style={{ padding: '4px 12px' }}>
      <VarTimeline
        durationMs={varDurationMs}
        currentTimeMs={currentTimeDisplay * 1000}
        fps={fps}
        onSeek={handleSeek}
      />
    </div>
  );

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Hidden ref video for VAR grid */}
      {isVarGrid && (
        <video ref={varVideoRef} style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} playsInline muted />
      )}

      {/* Header */}
      <div
        className={varMode ? 'var-header' : ''}
        style={{
          padding: '6px 16px',
          background: varMode ? undefined : 'var(--bg-surface)',
          borderBottom: varMode ? undefined : '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexShrink: 0,
        }}
      >
        <span style={{
          fontFamily: 'var(--font-ui)', fontWeight: 700,
          color: varMode ? 'var(--red)' : 'var(--cyan)',
          textTransform: 'uppercase', letterSpacing: '0.15em', fontSize: '0.9rem',
        }}>
          {varMode ? 'MODE VAR' : 'SABER VAR'}
        </span>
        <span className="text-muted" style={{ fontSize: '0.8rem', flex: 1 }}>
          {connected ? '\u25CF Connecté' : '\u25CB Déconnecté'}
        </span>
        {(isLiveExpanded || isVarExpanded) && (
          <button className="btn" style={{ padding: '4px 10px', fontSize: '0.75rem' }} onClick={() => {
            setExpandedSlot(null);
            setVideoZoom(1);
            if (varMode && varVideoRef.current) { varVideoRef.current.pause(); setIsPlaying(false); }
          }}>
            {'\u2190'} 4 Caméras
          </button>
        )}
        <a href="/setup" className="btn" style={{ textDecoration: 'none', fontSize: '0.7rem', padding: '4px 10px' }}>Setup</a>
        <a href="/settings" className="btn" style={{ textDecoration: 'none', fontSize: '0.7rem', padding: '4px 10px' }}>Paramètres</a>
      </div>

      {/* ============ MODE 1: Live Grid ============ */}
      {isLiveGrid && (
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 4, padding: 4, minHeight: 0 }}>
          {slots.map((slot) => (
            <CameraTile key={slot.slotId} slot={slot} stream={streams.get(slot.slotId) || null} selected={false} onClick={() => setExpandedSlot(slot.slotId)} />
          ))}
          {slots.length === 0 && (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              En attente... <a href="/setup" style={{ color: 'var(--cyan)', marginLeft: 8 }}>Page setup</a>
            </div>
          )}
        </div>
      )}

      {/* ============ MODE 2: Live Expanded ============ */}
      {isLiveExpanded && (
        <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}
          onWheel={handleVideoWheel}
        >
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

      {/* ============ MODE 3: VAR Grid ============ */}
      {isVarGrid && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 4, padding: 4, minHeight: 0 }}>
            {slots.map((slot) => {
              const blobUrl = varBlobs.get(slot.slotId);
              return (
                <div key={slot.slotId} className={`camera-tile ${blobUrl ? 'var-available' : 'offline'}`} onClick={() => blobUrl && setExpandedSlot(slot.slotId)} style={{ cursor: blobUrl ? 'pointer' : 'default' }}>
                  {blobUrl ? (
                    <VarGridVideo blobUrl={blobUrl} registerRef={(el) => { if (el) gridVideoRefs.current.set(slot.slotId, el); else gridVideoRefs.current.delete(slot.slotId); }} />
                  ) : (
                    <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', fontSize: '0.85rem' }}>Pas de données</div>
                  )}
                  <div className="label" style={{ color: blobUrl ? 'var(--red)' : undefined }}>{slot.name}</div>
                </div>
              );
            })}
          </div>
          {renderTimeline()}
          {renderVarControls()}
        </div>
      )}

      {/* ============ MODE 4: VAR Expanded ============ */}
      {isVarExpanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000', minHeight: 0 }}>
          <div style={{ flex: 1, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
            onWheel={handleVideoWheel}
          >
            <video
              ref={varVideoRef}
              style={{ maxWidth: '100%', maxHeight: '100%', background: '#000', display: 'block', transform: `scale(${videoZoom})`, transformOrigin: 'center center', transition: 'transform 0.1s' }}
              playsInline
            />
            <div style={{ position: 'absolute', top: 8, right: 8 }}>
              <FrameCounter currentFrame={currentFrame} totalFrames={totalFrames} currentTime={currentTimeDisplay} />
            </div>
            {videoZoom > 1 && (
              <div style={{ position: 'absolute', bottom: 8, right: 8, fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--cyan)', background: '#000000aa', padding: '2px 8px', border: '1px solid var(--cyan-border)' }}>
                {videoZoom.toFixed(1)}x zoom
              </div>
            )}
          </div>
          {renderTimeline()}
          {renderVarControls()}
        </div>
      )}

      {/* ============ Floating overlay buttons (live mode only) ============ */}
      {!varMode && (
        <div style={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 50,
          pointerEvents: 'none',
        }}>
          {recording.isElectron && (
            <button
              onClick={handleRecordToggle}
              style={{
                pointerEvents: 'auto',
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 16px',
                border: recording.isRecording ? '2px solid #ff4444' : '2px solid var(--border)',
                borderRadius: 24,
                background: recording.isRecording ? 'rgba(255, 68, 68, 0.2)' : 'rgba(18, 18, 26, 0.9)',
                color: recording.isRecording ? '#ff4444' : 'var(--text)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: '0.85rem',
                textTransform: 'uppercase', letterSpacing: '0.05em',
                backdropFilter: 'blur(8px)',
              }}
            >
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: recording.isRecording ? '#ff4444' : '#666',
                animation: recording.isRecording ? 'rec-blink 1s ease-in-out infinite' : 'none',
              }} />
              {recording.isRecording ? 'STOP' : 'REC'}
            </button>
          )}
          <button className="btn-var" onClick={handleVarPress} style={{ pointerEvents: 'auto', padding: '14px 40px', fontSize: '1.4rem' }}>
            VAR
          </button>
        </div>
      )}

      {/* Error toast */}
      {varError && <div className="toast-error">{varError}</div>}
    </div>
  );
}

function LiveExpandedVideo({ stream, zoom }: { stream: MediaStream; zoom: number }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream]);
  return (
    <video ref={videoRef} autoPlay muted playsInline
      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', transform: `scale(${zoom})`, transformOrigin: 'center center', transition: 'transform 0.1s' }}
    />
  );
}

function VarGridVideo({ blobUrl, registerRef }: { blobUrl: string; registerRef: (el: HTMLVideoElement | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    registerRef(el);
    el.src = blobUrl;
    el.currentTime = 9999;
    return () => registerRef(null);
  }, [blobUrl, registerRef]);
  return <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}
