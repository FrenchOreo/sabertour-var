import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTCArbitre } from '../hooks/useWebRTC';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import { useFramePlayer, FramePlayer } from '../hooks/useFramePlayer';
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
  const [varError, setVarError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  // Main video ref (used for expanded VAR view and as timing reference)
  const varVideoRef = useRef<HTMLVideoElement>(null);
  const frameUpdateRef = useRef<ReturnType<typeof setInterval>>();
  // Refs for each grid VAR video (keyed by slotId)
  const gridVideoRefs = useRef<Map<SlotId, HTMLVideoElement>>(new Map());

  const { startRecording, getBuffer, bufferDurations } = useVideoBuffer();
  const { player, fps, init: initFramePlayer } = useFramePlayer(varVideoRef);
  const recording = useRecording();
  const [recElapsed, setRecElapsed] = useState(0);
  const recTimerRef = useRef<ReturnType<typeof setInterval>>();

  // Update recording elapsed time every second
  useEffect(() => {
    if (recording.isRecording) {
      recTimerRef.current = setInterval(() => setRecElapsed(Date.now()), 1000);
      return () => clearInterval(recTimerRef.current);
    } else {
      setRecElapsed(0);
      clearInterval(recTimerRef.current);
    }
  }, [recording.isRecording]);

  const onTrack = useCallback(
    (slotId: SlotId, stream: MediaStream) => {
      setStreams((prev) => new Map(prev).set(slotId, stream));
      startRecording(slotId, stream);
    },
    [startRecording]
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
    if (connected) {
      send({ type: 'arbitre-join' });
    }
  }, [connected, send]);

  useEffect(() => {
    for (const slot of slots) {
      if (slot.cameraConnected && !slot.arbitreConnected) {
        webrtc.connectToSlot(slot.slotId);
      }
    }
  }, [slots]);

  // === VAR trigger: single-click, captures all cameras ===
  const handleVarPress = useCallback(() => {
    let hasAnyData = false;
    const blobs = new Map<SlotId, string>();

    for (const slot of slots) {
      const buffer = getBuffer(slot.slotId);
      if (buffer && buffer.hasData()) {
        hasAnyData = true;
        const blob = buffer.getFullReplayBlob();
        if (blob) {
          blobs.set(slot.slotId, URL.createObjectURL(blob));
        }
      }
    }

    if (!hasAnyData) {
      setVarError('Buffer vide — attendre 30s après connexion des caméras');
      setTimeout(() => setVarError(null), 4000);
      return;
    }

    setVarBlobs(blobs);
    setVarMode(true);
    setExpandedSlot(null);
  }, [slots, getBuffer]);

  const exitVarMode = useCallback(() => {
    setVarMode(false);
    setIsPlaying(false);
    setExpandedSlot(null);
    for (const url of varBlobs.values()) {
      URL.revokeObjectURL(url);
    }
    setVarBlobs(new Map());
    if (varVideoRef.current) {
      varVideoRef.current.pause();
      varVideoRef.current.src = '';
    }
    clearInterval(frameUpdateRef.current);
  }, [varBlobs]);

  // Sync all grid videos to a target time
  const syncGridVideos = useCallback((time: number) => {
    gridVideoRefs.current.forEach((video) => {
      if (Math.abs(video.currentTime - time) > 0.05) {
        video.currentTime = time;
      }
    });
  }, []);

  // === VAR expanded: load blob into main video ===
  useEffect(() => {
    if (!varMode || !expandedSlot) return;
    const blobUrl = varBlobs.get(expandedSlot);
    const video = varVideoRef.current;
    if (!blobUrl || !video) return;

    video.src = blobUrl;
    video.onloadeddata = async () => {
      const fp = await initFramePlayer();
      if (fp && varVideoRef.current) {
        varVideoRef.current.pause();
        varVideoRef.current.currentTime = varVideoRef.current.duration;
        setTotalFrames(fp.getTotalFrames());
        setCurrentFrame(fp.getTotalFrames());
        setCurrentTimeDisplay(varVideoRef.current.duration);
      }
    };
  }, [varMode, expandedSlot, varBlobs, initFramePlayer]);

  // === VAR grid: init first blob into hidden video for timing reference ===
  useEffect(() => {
    if (!varMode || expandedSlot) return;
    const video = varVideoRef.current;
    if (!video) return;

    // Use the first available blob as reference
    const firstBlob = varBlobs.values().next().value;
    if (!firstBlob) return;

    video.src = firstBlob;
    video.onloadeddata = async () => {
      const fp = await initFramePlayer();
      if (fp && varVideoRef.current) {
        varVideoRef.current.pause();
        varVideoRef.current.currentTime = varVideoRef.current.duration;
        setTotalFrames(fp.getTotalFrames());
        setCurrentFrame(fp.getTotalFrames());
        setCurrentTimeDisplay(varVideoRef.current.duration);
        // Sync grid videos to end too
        syncGridVideos(varVideoRef.current.duration);
      }
    };
  }, [varMode, expandedSlot, varBlobs, initFramePlayer, syncGridVideos]);

  const togglePlayPause = useCallback(() => {
    if (!player) return;
    if (player.paused) {
      player.play();
      // Also play all grid videos
      gridVideoRefs.current.forEach((v) => {
        v.playbackRate = playbackRate;
        v.play();
      });
      setIsPlaying(true);
    } else {
      player.pause();
      gridVideoRefs.current.forEach((v) => v.pause());
      setIsPlaying(false);
    }
  }, [player, playbackRate]);

  // Update frame counter + sync grid videos periodically
  useEffect(() => {
    if (varMode && player) {
      frameUpdateRef.current = setInterval(() => {
        setCurrentFrame(player.getCurrentFrameNumber());
        setTotalFrames(player.getTotalFrames());
        setCurrentTimeDisplay(player.currentTime);
        // Sync grid videos to reference
        if (!expandedSlot && varVideoRef.current) {
          syncGridVideos(varVideoRef.current.currentTime);
        }
      }, 50);
      return () => clearInterval(frameUpdateRef.current);
    }
  }, [varMode, expandedSlot, player, syncGridVideos]);

  // Keyboard shortcuts (work in both VAR grid and VAR expanded)
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
        case '1':
          player.setPlaybackRate(1);
          setPlaybackRate(1);
          gridVideoRefs.current.forEach((v) => { v.playbackRate = 1; });
          break;
        case '2':
          player.setPlaybackRate(0.5);
          setPlaybackRate(0.5);
          gridVideoRefs.current.forEach((v) => { v.playbackRate = 0.5; });
          break;
        case '3':
          player.setPlaybackRate(0.25);
          setPlaybackRate(0.25);
          gridVideoRefs.current.forEach((v) => { v.playbackRate = 0.25; });
          break;
        case '4':
          player.setPlaybackRate(0.1);
          setPlaybackRate(0.1);
          gridVideoRefs.current.forEach((v) => { v.playbackRate = 0.1; });
          break;
        case 'Escape':
          if (expandedSlot) {
            setExpandedSlot(null);
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
    gridVideoRefs.current.forEach((v) => v.pause());
    setIsPlaying(false);
    // Sync after a tick to let the reference video update
    setTimeout(() => {
      if (varVideoRef.current) syncGridVideos(varVideoRef.current.currentTime);
    }, 30);
  }, [player, syncGridVideos]);

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

  const expandedSlotInfo = slots.find((s) => s.slotId === expandedSlot);

  const isLiveGrid = !varMode && !expandedSlot;
  const isLiveExpanded = !varMode && expandedSlot !== null;
  const isVarGrid = varMode && !expandedSlot;
  const isVarExpanded = varMode && expandedSlot !== null;

  // Shared VAR controls (used in both grid and expanded)
  const renderVarControls = () => (
    <div
      style={{
        padding: '12px 16px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      {/* Frame controls */}
      <div className="flex items-center gap-2">
        <button className="btn" onClick={() => handleStepBackward(10)}>
          {'\u25C0\u25C0'} -10f
        </button>
        <button className="btn" onClick={() => handleStepBackward(1)}>
          {'\u25C0'} -1f
        </button>
        <button className="btn" onClick={togglePlayPause} style={{ minWidth: 60 }}>
          {isPlaying ? '\u23F8' : '\u25B6'}
        </button>
        <button className="btn" onClick={() => handleStepForward(1)}>
          +1f {'\u25B6'}
        </button>
        <button className="btn" onClick={() => handleStepForward(10)}>
          +10f {'\u25B6\u25B6'}
        </button>
      </div>

      {/* Frame info */}
      <div className="font-mono text-cyan" style={{ fontSize: '0.9rem' }}>
        FRAME : {currentFrame} / {totalFrames}
      </div>

      {/* Speed controls */}
      <div className="flex items-center gap-2">
        <span className="text-muted" style={{ fontSize: '0.8rem', textTransform: 'uppercase' }}>
          Vitesse :
        </span>
        {[0.1, 0.25, 0.5, 1].map((rate) => (
          <button
            key={rate}
            className={`speed-btn ${playbackRate === rate ? 'active' : ''}`}
            onClick={() => handleSpeedChange(rate)}
          >
            {rate}x
          </button>
        ))}
      </div>
    </div>
  );

  // Shared timeline (used in both grid and expanded)
  const renderTimeline = () => (
    <div style={{ padding: '8px 16px' }}>
      <VarTimeline
        durationMs={(varVideoRef.current?.duration || 0) * 1000}
        currentTimeMs={currentTimeDisplay * 1000}
        bufferDurationMs={(varVideoRef.current?.duration || 0) * 1000}
        fps={fps}
        onSeek={handleSeek}
      />
    </div>
  );

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Hidden reference video for VAR grid mode (invisible when expanded — the expanded view uses it directly) */}
      {isVarGrid && (
        <video ref={varVideoRef} style={{ position: 'absolute', width: 0, height: 0, opacity: 0, pointerEvents: 'none' }} playsInline muted />
      )}

      {/* Header */}
      <div
        className={varMode ? 'var-header' : ''}
        style={{
          padding: '8px 16px',
          background: varMode ? undefined : 'var(--bg-surface)',
          borderBottom: varMode ? undefined : '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            color: varMode ? 'var(--red)' : 'var(--cyan)',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            fontSize: '1rem',
          }}
        >
          {varMode ? 'MODE VAR' : 'SABER VAR'}
        </span>
        <span className="text-muted" style={{ fontSize: '0.85rem', flex: 1 }}>
          {connected ? '\u25CF Connecté' : '\u25CB Déconnecté'}
        </span>
        <a href="/setup" className="btn" style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '6px 12px' }}>
          Setup
        </a>
        <a href="/settings" className="btn" style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '6px 12px' }}>
          Paramètres
        </a>
        {isVarExpanded && expandedSlotInfo && (
          <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase' }}>
            Caméra: {expandedSlotInfo.name}
          </span>
        )}
      </div>

      {/* ============ MODE 1: Live Grid ============ */}
      {isLiveGrid && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 4,
              padding: 4,
            }}
          >
            {slots.map((slot) => (
              <CameraTile
                key={slot.slotId}
                slot={slot}
                stream={streams.get(slot.slotId) || null}
                selected={false}
                onClick={() => setExpandedSlot(slot.slotId)}
              />
            ))}
            {slots.length === 0 && (
              <div
                style={{
                  gridColumn: '1 / -1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-dim)',
                  fontFamily: 'var(--font-ui)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                }}
              >
                En attente de la configuration...
                <br />
                <a href="/setup" style={{ color: 'var(--cyan)', marginLeft: 8 }}>
                  Page setup
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ MODE 2: Live Expanded ============ */}
      {isLiveExpanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '8px 16px' }}>
            <button className="btn" onClick={() => setExpandedSlot(null)}>
              {'\u2190'} 4 Caméras
            </button>
          </div>
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000' }}>
            {(() => {
              const stream = expandedSlot !== null ? streams.get(expandedSlot) : null;
              const slotInfo = slots.find((s) => s.slotId === expandedSlot);
              if (stream) {
                return <LiveExpandedVideo stream={stream} />;
              }
              return (
                <div style={{ color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {slotInfo?.cameraConnected ? 'Connexion...' : 'Hors ligne'}
                </div>
              );
            })()}
            {expandedSlotInfo && (
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 12,
                  fontFamily: 'var(--font-ui)',
                  fontWeight: 600,
                  fontSize: '1rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.1em',
                  color: 'var(--cyan)',
                  background: '#000000aa',
                  padding: '4px 12px',
                  border: '1px solid var(--cyan-border)',
                }}
              >
                {expandedSlotInfo.name}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============ MODE 3: VAR Grid — 4 replays simultanés ============ */}
      {isVarGrid && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              flex: 1,
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 4,
              padding: 4,
            }}
          >
            {slots.map((slot) => {
              const blobUrl = varBlobs.get(slot.slotId);
              return (
                <div
                  key={slot.slotId}
                  className={`camera-tile ${blobUrl ? 'var-available' : 'offline'}`}
                  onClick={() => blobUrl && setExpandedSlot(slot.slotId)}
                  style={{ cursor: blobUrl ? 'pointer' : 'default' }}
                >
                  {blobUrl ? (
                    <VarGridVideo
                      blobUrl={blobUrl}
                      registerRef={(el) => {
                        if (el) gridVideoRefs.current.set(slot.slotId, el);
                        else gridVideoRefs.current.delete(slot.slotId);
                      }}
                    />
                  ) : (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontFamily: 'var(--font-ui)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.1em',
                      color: 'var(--text-dim)',
                      fontSize: '0.9rem',
                    }}>
                      Pas de données
                    </div>
                  )}
                  <div className="label" style={{ color: blobUrl ? 'var(--red)' : undefined }}>
                    {slot.name}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Timeline + controls shared across all 4 cameras */}
          {renderTimeline()}
          {renderVarControls()}
        </div>
      )}

      {/* ============ MODE 4: VAR Expanded ============ */}
      {isVarExpanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000' }}>
          <div style={{ padding: '8px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="btn" onClick={() => {
              setExpandedSlot(null);
              if (varVideoRef.current) varVideoRef.current.pause();
              setIsPlaying(false);
            }}>
              {'\u2190'} Autres caméras
            </button>
          </div>

          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              ref={varVideoRef}
              style={{ maxWidth: '100%', maxHeight: '100%', background: '#000', display: 'block' }}
              playsInline
            />
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
              <FrameCounter
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                currentTime={currentTimeDisplay}
              />
            </div>
          </div>

          {renderTimeline()}
          {renderVarControls()}
        </div>
      )}

      {/* ============ Bottom Action Bar (always visible) ============ */}
      <div style={{
        padding: '12px 16px',
        background: 'var(--bg-surface)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        flexWrap: 'wrap',
      }}>
        {/* Recording controls */}
        {recording.isElectron && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={handleRecordToggle}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                border: recording.isRecording ? '1px solid #ff4444' : '1px solid var(--border)',
                borderRadius: 4,
                background: recording.isRecording ? 'rgba(255, 68, 68, 0.15)' : 'var(--bg-surface)',
                color: recording.isRecording ? '#ff4444' : 'var(--text)',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontWeight: 700,
                fontSize: '0.85rem',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: recording.isRecording ? '#ff4444' : '#666',
                  animation: recording.isRecording ? 'rec-blink 1s ease-in-out infinite' : 'none',
                }}
              />
              {recording.isRecording ? 'STOP' : 'REC'}
            </button>
            {recording.isRecording && (() => {
              let totalFiles = 0;
              let totalBytes = 0;
              let earliestStart = Date.now();
              recording.statuses.forEach((status) => {
                totalFiles += status.fileCount;
                totalBytes += status.totalSize;
                if (status.startTime < earliestStart) earliestStart = status.startTime;
              });
              const elapsed = Math.floor((Date.now() - earliestStart) / 1000);
              const hours = String(Math.floor(elapsed / 3600)).padStart(2, '0');
              const minutes = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
              const seconds = String(elapsed % 60).padStart(2, '0');
              const sizeMB = Math.round(totalBytes / (1024 * 1024));
              return (
                <span className="font-mono" style={{ fontSize: '0.8rem', color: '#ff4444' }}>
                  {hours}:{minutes}:{seconds} | {totalFiles} fichier{totalFiles !== 1 ? 's' : ''} | {sizeMB} MB
                </span>
              );
            })()}
            {recording.recordingFolder && !recording.isRecording && (
              <span className="text-muted" style={{ fontSize: '0.75rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {recording.recordingFolder}
              </span>
            )}
          </div>
        )}

        {/* Buffer info */}
        {!varMode && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {slots.filter((s) => s.cameraConnected).map((slot) => (
              <span key={slot.slotId} className="text-muted" style={{ fontSize: '0.75rem' }}>
                {slot.name}: {Math.round((bufferDurations.get(slot.slotId) || 0) / 1000)}s
              </span>
            ))}
          </div>
        )}

        {/* VAR button */}
        {!varMode && (
          <button className="btn-var" onClick={handleVarPress}>
            VAR
          </button>
        )}

        {/* Frame counter in bottom bar during VAR grid */}
        {isVarGrid && (
          <FrameCounter
            currentFrame={currentFrame}
            totalFrames={totalFrames}
            currentTime={currentTimeDisplay}
          />
        )}

        {/* REPRENDRE LE LIVE */}
        {varMode && (
          <button className="btn-live" onClick={exitVarMode}>
            REPRENDRE LE LIVE
          </button>
        )}
      </div>

      {/* Error toast */}
      {varError && (
        <div className="toast-error">
          {varError}
        </div>
      )}
    </div>
  );
}

/** Live expanded video */
function LiveExpandedVideo({ stream }: { stream: MediaStream }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      muted
      playsInline
      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
    />
  );
}

/** VAR grid video tile — plays a blob URL */
function VarGridVideo({ blobUrl, registerRef }: { blobUrl: string; registerRef: (el: HTMLVideoElement | null) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    registerRef(el);
    el.src = blobUrl;
    el.currentTime = 9999; // seek to end
    return () => registerRef(null);
  }, [blobUrl, registerRef]);

  return (
    <video
      ref={videoRef}
      muted
      playsInline
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  );
}
