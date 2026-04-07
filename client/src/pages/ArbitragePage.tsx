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
  const [varError, setVarError] = useState<string | null>(null);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const varVideoRef = useRef<HTMLVideoElement>(null);
  const frameUpdateRef = useRef<ReturnType<typeof setInterval>>();

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

  // Store webrtc functions in refs so handleMessage always uses latest
  const webrtcRef = useRef<ReturnType<typeof useWebRTCArbitre>>(null!);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      switch (msg.type) {
        case 'slots-state':
          setSlots(msg.slots);
          break;
        case 'slot-updated':
          setSlots((prev) => prev.map((s) => (s.slotId === msg.slot.slotId ? msg.slot : s)));
          // Auto-connect if camera comes online
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

  // Join as arbitre
  useEffect(() => {
    if (connected) {
      send({ type: 'arbitre-join' });
    }
  }, [connected, send]);

  // Auto-connect to all available cameras
  useEffect(() => {
    for (const slot of slots) {
      if (slot.cameraConnected && !slot.arbitreConnected) {
        webrtc.connectToSlot(slot.slotId);
      }
    }
  }, [slots]);

  // VAR mode: single-click trigger
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
      setVarError('Buffer vide \u2014 attendre 30s apr\u00e8s connexion des cam\u00e9ras');
      setTimeout(() => setVarError(null), 4000);
      return;
    }

    setVarBlobs(blobs);
    setVarMode(true);
    setExpandedSlot(null); // start in grid view
  }, [slots, getBuffer]);

  const exitVarMode = useCallback(() => {
    setVarMode(false);
    setIsPlaying(false);
    setExpandedSlot(null);
    // Cleanup blob URLs
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

  const selectVarCamera = useCallback((slotId: SlotId) => {
    const blobUrl = varBlobs.get(slotId);
    if (!blobUrl) return;
    setExpandedSlot(slotId);
  }, [varBlobs]);

  // When VAR expanded slot changes, load the blob into the video element (runs after mount)
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

  const togglePlayPause = useCallback(() => {
    if (!player) return;
    if (player.paused) {
      player.play();
      setIsPlaying(true);
    } else {
      player.pause();
      setIsPlaying(false);
    }
  }, [player]);

  // Update frame counter periodically in VAR mode
  useEffect(() => {
    if (varMode && expandedSlot && player) {
      frameUpdateRef.current = setInterval(() => {
        setCurrentFrame(player.getCurrentFrameNumber());
        setTotalFrames(player.getTotalFrames());
        setCurrentTimeDisplay(player.currentTime);
      }, 50);
      return () => clearInterval(frameUpdateRef.current);
    }
  }, [varMode, expandedSlot, player]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!varMode || !expandedSlot || !player) return;
      switch (e.key) {
        case 'ArrowRight':
          player.stepForward(1);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case 'ArrowLeft':
          player.stepBackward(1);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case 'ArrowUp':
          player.stepForward(10);
          setIsPlaying(false);
          e.preventDefault();
          break;
        case 'ArrowDown':
          player.stepBackward(10);
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
          break;
        case '2':
          player.setPlaybackRate(0.5);
          setPlaybackRate(0.5);
          break;
        case '3':
          player.setPlaybackRate(0.25);
          setPlaybackRate(0.25);
          break;
        case '4':
          player.setPlaybackRate(0.1);
          setPlaybackRate(0.1);
          break;
        case 'Escape':
          if (expandedSlot) {
            // If expanded in VAR, go back to VAR grid
            setExpandedSlot(null);
            if (varVideoRef.current) {
              varVideoRef.current.pause();
            }
            setIsPlaying(false);
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [varMode, expandedSlot, player, togglePlayPause]);

  const handleSeek = useCallback(
    (timeMs: number) => {
      if (varVideoRef.current) {
        varVideoRef.current.currentTime = timeMs / 1000;
      }
    },
    []
  );

  const handleSpeedChange = useCallback(
    (rate: number) => {
      if (player) {
        player.setPlaybackRate(rate);
        setPlaybackRate(rate);
      }
    },
    [player]
  );

  // Recording: start all connected streams
  const handleRecordToggle = useCallback(async () => {
    if (recording.isRecording) {
      recording.stopAll();
      return;
    }

    let folder = recording.recordingFolder;
    if (!folder) {
      folder = await recording.selectFolder();
      if (!folder) return; // user cancelled
    }

    // Start recording all connected camera streams
    for (const slot of slots) {
      const stream = streams.get(slot.slotId);
      if (slot.cameraConnected && stream) {
        recording.startRecording(slot.slotId, slot.name, stream, folder);
      }
    }
  }, [recording, slots, streams]);

  const expandedSlotInfo = slots.find((s) => s.slotId === expandedSlot);

  // Determine current mode
  const isLiveGrid = !varMode && !expandedSlot;
  const isLiveExpanded = !varMode && expandedSlot !== null;
  const isVarGrid = varMode && !expandedSlot;
  const isVarExpanded = varMode && expandedSlot !== null;

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
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
          {connected ? '\u25cf Connect\u00e9' : '\u25cb D\u00e9connect\u00e9'}
        </span>
        <a href="/setup" className="btn" style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '6px 12px' }}>
          Setup
        </a>
        <a href="/settings" className="btn" style={{ textDecoration: 'none', fontSize: '0.75rem', padding: '6px 12px' }}>
          Param\u00e8tres
        </a>
        {isVarExpanded && expandedSlotInfo && (
          <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase' }}>
            CAM\u00c9RA: {expandedSlotInfo.name}
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
          {/* Back to grid button */}
          <div style={{ padding: '8px 16px' }}>
            <button className="btn" onClick={() => setExpandedSlot(null)}>
              \u2190 4 Cam\u00e9ras
            </button>
          </div>

          {/* Full-screen video of expanded camera */}
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

      {/* ============ MODE 3: VAR Grid ============ */}
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
              const hasBlob = varBlobs.has(slot.slotId);
              return (
                <div
                  key={slot.slotId}
                  className={`camera-tile ${hasBlob ? 'var-available' : 'offline'}`}
                  onClick={() => hasBlob && selectVarCamera(slot.slotId)}
                  style={{ cursor: hasBlob ? 'pointer' : 'default' }}
                >
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    fontFamily: 'var(--font-ui)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.1em',
                  }}>
                    <span style={{
                      color: hasBlob ? 'var(--red)' : 'var(--text-dim)',
                      fontWeight: 700,
                      fontSize: '1.1rem',
                    }}>
                      CAM\u00c9RA {slot.name}
                    </span>
                    {hasBlob && (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                        Cliquer pour agrandir
                      </span>
                    )}
                    {!hasBlob && (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                        Pas de donn\u00e9es
                      </span>
                    )}
                  </div>
                  <div className="label">{slot.name}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ============ MODE 4: VAR Expanded ============ */}
      {isVarExpanded && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000' }}>
          {/* Back to VAR grid button */}
          <div style={{ padding: '8px 16px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="btn" onClick={() => {
              setExpandedSlot(null);
              if (varVideoRef.current) {
                varVideoRef.current.pause();
              }
              setIsPlaying(false);
            }}>
              \u2190 Autres cam\u00e9ras
            </button>
          </div>

          {/* Video area */}
          <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <video
              ref={varVideoRef}
              style={{ maxWidth: '100%', maxHeight: '100%', background: '#000' }}
              playsInline
            />
            {/* Frame counter overlay */}
            <div style={{ position: 'absolute', top: 12, right: 12 }}>
              <FrameCounter
                currentFrame={currentFrame}
                totalFrames={totalFrames}
                currentTime={currentTimeDisplay}
              />
            </div>
          </div>

          {/* Timeline */}
          <div style={{ padding: '8px 16px' }}>
            <VarTimeline
              durationMs={(varVideoRef.current?.duration || 0) * 1000}
              currentTimeMs={currentTimeDisplay * 1000}
              bufferDurationMs={(varVideoRef.current?.duration || 0) * 1000}
              fps={fps}
              onSeek={handleSeek}
            />
          </div>

          {/* Controls */}
          <div
            style={{
              padding: '12px 16px 16px',
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
              <button className="btn" onClick={() => player?.stepBackward(10)}>
                \u25c0\u25c0 -10f
              </button>
              <button className="btn" onClick={() => player?.stepBackward(1)}>
                \u25c0 -1f
              </button>
              <button
                className="btn"
                onClick={togglePlayPause}
                style={{ minWidth: 60 }}
              >
                {isPlaying ? '\u23f8' : '\u25b6'}
              </button>
              <button className="btn" onClick={() => player?.stepForward(1)}>
                +1f \u25b6
              </button>
              <button className="btn" onClick={() => player?.stepForward(10)}>
                +10f \u25b6\u25b6
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
                <span
                  className="font-mono"
                  style={{ fontSize: '0.8rem', color: '#ff4444' }}
                >
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

        {/* Buffer info — compact display for all cameras */}
        {!varMode && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {slots.filter((s) => s.cameraConnected).map((slot) => (
              <span key={slot.slotId} className="text-muted" style={{ fontSize: '0.75rem' }}>
                {slot.name}: {Math.round((bufferDurations.get(slot.slotId) || 0) / 1000)}s
              </span>
            ))}
          </div>
        )}

        {/* VAR button — only in live mode */}
        {!varMode && (
          <button className="btn-var" onClick={handleVarPress}>
            VAR
          </button>
        )}

        {/* REPRENDRE LE LIVE button — only in VAR mode */}
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

/** Helper component: renders a live video stream in the expanded view */
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
