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
  const [selectedSlot, setSelectedSlot] = useState<SlotId | null>(null);
  const [varMode, setVarMode] = useState(false);
  const [varPending, setVarPending] = useState(false);
  const pendingTimer = useRef<ReturnType<typeof setTimeout>>();
  const [playbackRate, setPlaybackRate] = useState(1);
  const [currentFrame, setCurrentFrame] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [currentTimeDisplay, setCurrentTimeDisplay] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const varVideoRef = useRef<HTMLVideoElement>(null);
  const frameUpdateRef = useRef<ReturnType<typeof setInterval>>();

  const { startRecording, stopRecording, getBuffer, bufferDurations } = useVideoBuffer();
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
            webrtc.connectToSlot(msg.slot.slotId);
          }
          break;
        case 'relay-offer':
          webrtc.handleOffer(msg.slotId, msg.sdp);
          break;
        case 'relay-ice':
          if (msg.from === 'camera') {
            webrtc.handleIceCandidate(msg.slotId, msg.candidate);
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

  // VAR mode: trigger
  const triggerVar = useCallback(() => {
    if (!selectedSlot) return;
    const buffer = getBuffer(selectedSlot);
    if (!buffer || !buffer.hasData()) return;

    const blob = buffer.getFullReplayBlob();
    if (!blob) return;

    setVarMode(true);
    const url = URL.createObjectURL(blob);

    if (varVideoRef.current) {
      varVideoRef.current.src = url;
      varVideoRef.current.onloadeddata = async () => {
        const fp = await initFramePlayer();
        if (fp && varVideoRef.current) {
          varVideoRef.current.pause();
          varVideoRef.current.currentTime = varVideoRef.current.duration;
          setTotalFrames(fp.getTotalFrames());
          setCurrentFrame(fp.getTotalFrames());
          setCurrentTimeDisplay(varVideoRef.current.duration);
        }
      };
    }
  }, [selectedSlot, getBuffer, initFramePlayer]);

  const handleVarPress = useCallback(() => {
    if (!selectedSlot) return;
    if (!varPending) {
      setVarPending(true);
      pendingTimer.current = setTimeout(() => setVarPending(false), 2000);
    } else {
      clearTimeout(pendingTimer.current);
      setVarPending(false);
      triggerVar();
    }
  }, [varPending, selectedSlot, triggerVar]);

  const exitVarMode = useCallback(() => {
    setVarMode(false);
    setIsPlaying(false);
    if (varVideoRef.current) {
      varVideoRef.current.pause();
      varVideoRef.current.src = '';
    }
    clearInterval(frameUpdateRef.current);
  }, []);

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
    if (varMode && player) {
      frameUpdateRef.current = setInterval(() => {
        setCurrentFrame(player.getCurrentFrameNumber());
        setTotalFrames(player.getTotalFrames());
        setCurrentTimeDisplay(player.currentTime);
      }, 50);
      return () => clearInterval(frameUpdateRef.current);
    }
  }, [varMode, player]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!varMode || !player) return;
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
          exitVarMode();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [varMode, player, togglePlayPause, exitVarMode]);

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

  // Select first slot with camera by default
  useEffect(() => {
    if (!selectedSlot) {
      const connected = slots.find((s) => s.cameraConnected);
      if (connected) setSelectedSlot(connected.slotId);
    }
  }, [slots, selectedSlot]);

  const selectedSlotInfo = slots.find((s) => s.slotId === selectedSlot);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          padding: '8px 16px',
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-ui)',
            fontWeight: 700,
            color: 'var(--cyan)',
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            fontSize: '1rem',
          }}
        >
          SABER VAR
        </span>
        <span className="text-muted" style={{ fontSize: '0.85rem', flex: 1 }}>
          {connected ? '● Connecté' : '○ Déconnecté'}
        </span>
        {varMode && selectedSlotInfo && (
          <span style={{ fontFamily: 'var(--font-ui)', fontWeight: 600, color: 'var(--text)', textTransform: 'uppercase' }}>
            CAMÉRA: {selectedSlotInfo.name}
          </span>
        )}
      </div>

      {varMode ? (
        /* VAR MODE */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#000' }}>
          {/* Back button */}
          <div style={{ padding: '8px 16px' }}>
            <button className="btn" onClick={exitVarMode}>
              ← REPRENDRE LE LIVE
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
                ◀◀ -10f
              </button>
              <button className="btn" onClick={() => player?.stepBackward(1)}>
                ◀ -1f
              </button>
              <button
                className="btn"
                onClick={togglePlayPause}
                style={{ minWidth: 60 }}
              >
                {isPlaying ? '⏸' : '▶'}
              </button>
              <button className="btn" onClick={() => player?.stepForward(1)}>
                +1f ▶
              </button>
              <button className="btn" onClick={() => player?.stepForward(10)}>
                +10f ▶▶
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
      ) : (
        /* LIVE MODE */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* Camera grid */}
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
                selected={selectedSlot === slot.slotId}
                onClick={() => setSelectedSlot(slot.slotId)}
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

          {/* VAR button bar */}
          <div
            style={{
              padding: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              background: 'var(--bg-surface)',
              borderTop: '1px solid var(--border)',
            }}
          >
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
                  // Aggregate stats across all slots
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

            {selectedSlot && (
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                Buffer : {Math.round((bufferDurations.get(selectedSlot) || 0) / 1000)}s
              </span>
            )}
            <button
              className={`btn-var ${varPending ? 'pending' : ''}`}
              onClick={handleVarPress}
              disabled={!selectedSlot}
            >
              {varPending ? 'CONFIRMER VAR ?' : 'VAR'}
            </button>
            {selectedSlot && selectedSlotInfo && (
              <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                {selectedSlotInfo.name}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Hidden video for VAR (rendered above when active) */}
    </div>
  );
}
