import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTCArbitre } from '../hooks/useWebRTC';
import { useVideoBuffer } from '../hooks/useVideoBuffer';
import { useRecording } from '../hooks/useRecording';
import { useConnectionStats, getHealth, STALL_POLLS_FROZEN } from '../hooks/useConnectionStats';
import { extractMotionSignal, findImpactSpikes, estimateOffsetSec, buildDisplayCurve, MotionSignal } from '../lib/varAnalysis';
import { probeBlobDuration } from '../lib/videoDuration';
import { computeReadiness } from '../lib/readiness';
import { adjacentMarker, currentMarkerIndex } from '../lib/markers';
import { getBufferDurationSec } from '../lib/qualitySettings';
import CameraTile from '../components/CameraTile';
import VarTimeline from '../components/VarTimeline';
import FrameCounter from '../components/FrameCounter';
import ReadinessBanner from '../components/ReadinessBanner';
import { SlotId, SlotState, WsMessage } from 'shared/types';

const FPS_DEFAULT = 30;
/** Délai minimal entre deux renégociations forcées d'une même caméra */
const RECONNECT_COOLDOWN_MS = 15000;
/** Un état « disconnected » qui dure plus longtemps est traité comme une perte de flux */
const DISCONNECT_GRACE_MS = 4000;

/** Cale le fps mesuré (fluctuant) sur la cadence de capture la plus proche */
function snapFps(measured: number | undefined): number {
  if (!measured || measured < 10) return FPS_DEFAULT;
  const COMMON = [24, 25, 30, 50, 60];
  let best = COMMON[0];
  for (const c of COMMON) {
    if (Math.abs(c - measured) < Math.abs(best - measured)) best = c;
  }
  return best;
}

/** mm:ss.d pour l'affichage de la position dans le replay */
function formatTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

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
  // Cadence du replay : mesurée sur la caméra maître à l'appui VAR (plus de 30 fps codé en dur)
  const [fps, setFps] = useState(FPS_DEFAULT);

  // Analyse IA (détection d'impacts + synchro auto)
  const [impactMarkers, setImpactMarkers] = useState<number[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);
  const analysisAbortRef = useRef<{ aborted: boolean } | null>(null);
  const [analysisProgress, setAnalysisProgress] = useState<number | null>(null);
  const lastProgressUpdate = useRef(0);

  // Auto-réparation des flux : caméras dont le flux est perdu/gelé (overlay + renégociation)
  const [frozenSlots, setFrozenSlots] = useState<Set<SlotId>>(new Set());
  const lastReconnectAt = useRef<Map<SlotId, number>>(new Map());
  const disconnectTimers = useRef<Map<SlotId, ReturnType<typeof setTimeout>>>(new Map());

  // Durée RÉELLE de chaque vidéo de la capture (sondée sur le fichier, pas estimée par les chunks)
  const [probedDurations, setProbedDurations] = useState<Map<SlotId, number>>(new Map());
  const probeGenRef = useRef(0);
  // Signal de mouvement de la caméra maître (référentiel timeline) → courbe affichée
  const [motionSignal, setMotionSignal] = useState<MotionSignal | null>(null);
  // Calibration du fps sur les vraies images : écarts de temps média mesurés à chaque pas image par image
  const frameDeltaSamples = useRef<number[]>([]);
  // L'analyse IA se lance toute seule à l'entrée en VAR
  const autoAnalysisArmed = useRef(false);

  // Persistent VAR video refs — one per camera, never unmounted during VAR
  const varVideoRefs = useRef<Map<SlotId, HTMLVideoElement>>(new Map());
  const frameUpdateRef = useRef<ReturnType<typeof setInterval>>();
  // Track time in JS (source of truth, not video.currentTime which is async on WebM)
  const varTimeRef = useRef(0);
  // Deterministic frame counter — incremented/decremented by step functions, not derived from currentTime
  const frameCounterRef = useRef(0);
  // Per-camera time offsets for synchronization (seconds)
  const [varOffsets, setVarOffsets] = useState<Map<SlotId, number>>(new Map());
  const wasRecordingBeforeVar = useRef(false);
  const recordingFolderBeforeVar = useRef<string | null>(null);

  const { startRecording: startBufferRecording, stopRecording: stopBufferRecording, pauseAllRecording, resumeAllRecording, getBuffer, bufferDurations } = useVideoBuffer();
  const recording = useRecording();
  const [bufferPaused, setBufferPaused] = useState(false);

  // VAR history: store last N captures
  interface VarCapture {
    id: string;
    timestamp: number;
    durationMs: number;
    blobs: Map<SlotId, string>; // blob URLs (kept alive until cleared)
    offsets: Map<SlotId, number>;
    fps: number;
  }
  const [varHistory, setVarHistory] = useState<VarCapture[]>([]);
  const MAX_HISTORY = 5;

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

  // Set time on ALL var videos with per-camera offset for sync
  const seekAllTo = useCallback((time: number) => {
    varVideoRefs.current.forEach((v, slotId) => {
      const offset = varOffsets.get(slotId) || 0;
      v.currentTime = time + offset;
    });
  }, [varOffsets]);

  // Get the "master" video (first one) and its slot for RVFC-based stepping
  const getMasterEntry = useCallback((): [SlotId, HTMLVideoElement] | null => {
    for (const [slotId, el] of varVideoRefs.current) {
      if (el.src) return [slotId, el];
    }
    return null;
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
      // Un nouveau flux arrive : la caméra n'est plus gelée
      setFrozenSlots((prev) => {
        if (!prev.has(slotId)) return prev;
        const next = new Set(prev);
        next.delete(slotId);
        return next;
      });
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
        // ensureConnected : ne renégocie que si aucune connexion vivante n'existe pour ce slot
        if (msg.slot.cameraConnected) webrtcRef.current.ensureConnected(msg.slot.slotId);
        break;
      case 'relay-offer': webrtcRef.current.handleOffer(msg.slotId, msg.sdp); break;
      case 'relay-ice': if (msg.from === 'camera') webrtcRef.current.handleIceCandidate(msg.slotId, msg.candidate); break;
      case 'error': console.error('[Signaling error]', msg.message); break;
    }
  }, []);

  // ============ Auto-réparation des flux ============
  const markFrozen = useCallback((slotId: SlotId) => {
    setFrozenSlots((prev) => (prev.has(slotId) ? prev : new Set(prev).add(slotId)));
  }, []);

  const tryRecover = useCallback((slotId: SlotId, reason: string) => {
    const last = lastReconnectAt.current.get(slotId) ?? 0;
    if (Date.now() - last < RECONNECT_COOLDOWN_MS) return;
    lastReconnectAt.current.set(slotId, Date.now());
    console.warn(`[VAR] Flux caméra ${slotId} perdu (${reason}) — renégociation`);
    webrtcRef.current.reconnectSlot(slotId);
  }, []);

  const onConnectionStateChange = useCallback((slotId: SlotId, state: RTCPeerConnectionState) => {
    const timers = disconnectTimers.current;
    if (state === 'connected') {
      const t = timers.get(slotId);
      if (t) { clearTimeout(t); timers.delete(slotId); }
      return;
    }
    if (state === 'failed') {
      markFrozen(slotId);
      tryRecover(slotId, 'failed');
      return;
    }
    // « disconnected » est souvent transitoire (micro-coupure WiFi) : délai de grâce avant d'agir
    if (state === 'disconnected' && !timers.has(slotId)) {
      timers.set(slotId, setTimeout(() => {
        timers.delete(slotId);
        const pc = webrtcRef.current.getPeerConnection(slotId);
        if (pc && pc.connectionState !== 'connected') {
          markFrozen(slotId);
          tryRecover(slotId, 'disconnected');
        }
      }, DISCONNECT_GRACE_MS));
    }
  }, [markFrozen, tryRecover]);

  const { send, connected } = useSignaling({ onMessage: handleMessage });
  const webrtc = useWebRTCArbitre({ send, onTrack, onConnectionStateChange });
  webrtcRef.current = webrtc;

  // Télémétrie WebRTC : santé réseau affichée en direct + latence par caméra pour la synchro VAR
  const { stats: connStats, getStatsSnapshot } = useConnectionStats(webrtc.getPeerConnection);

  // Flux gelé : la connexion se dit établie mais plus aucun octet n'arrive (téléphone rechargé, app en arrière-plan…)
  useEffect(() => {
    connStats.forEach((st, slotId) => {
      const slot = slots.find((x) => x.slotId === slotId);
      if (!slot?.cameraConnected) return;
      if (st.stalledPolls >= STALL_POLLS_FROZEN) {
        markFrozen(slotId);
        tryRecover(slotId, 'flux gelé');
      } else if (st.stalledPolls === 0 && st.bitrateKbps > 0 && frozenSlots.has(slotId)) {
        // Les données sont revenues d'elles-mêmes, sans renégociation
        setFrozenSlots((prev) => { const next = new Set(prev); next.delete(slotId); return next; });
      }
    });
  }, [connStats, slots, frozenSlots, markFrozen, tryRecover]);

  useEffect(() => () => { disconnectTimers.current.forEach((t) => clearTimeout(t)); }, []);

  // Filet de sécurité : toutes les 10 s, chaque caméra déclarée connectée doit avoir une connexion
  // vivante (un message de signalisation perdu ne doit pas laisser une tuile noire indéfiniment).
  // No-op quand tout va bien ; « disconnected » est laissé au délai de grâce ci-dessus.
  const slotsRef = useRef<SlotState[]>([]);
  useEffect(() => { slotsRef.current = slots; }, [slots]);
  useEffect(() => {
    const id = setInterval(() => {
      for (const slot of slotsRef.current) {
        if (!slot.cameraConnected) continue;
        const pc = webrtcRef.current.getPeerConnection(slot.slotId);
        if (pc?.connectionState === 'disconnected') continue;
        webrtcRef.current.ensureConnected(slot.slotId);
      }
    }, 10000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => { if (connected) send({ type: 'arbitre-join' }); }, [connected, send]);
  useEffect(() => {
    for (const slot of slots) {
      if (slot.cameraConnected) webrtc.ensureConnected(slot.slotId);
    }
  }, [slots]);

  // Sonde la durée réelle des blobs d'une capture (les heures d'arrivée des chunks sous-estiment
  // la vidéo dès que le réseau hoquette → timeline trop courte, compteur qui dépasse le total)
  const probeDurations = useCallback((urls: Map<SlotId, string>) => {
    const gen = ++probeGenRef.current;
    setProbedDurations(new Map());
    urls.forEach((url, slotId) => {
      probeBlobDuration(url).then((d) => {
        if (d === null || probeGenRef.current !== gen) return;
        setProbedDurations((prev) => {
          const next = new Map(prev);
          next.set(slotId, d);
          return next;
        });
      });
    });
  }, []);

  // ============ VAR trigger ============
  const handleVarPress = useCallback(async () => {
    // Stop buffer recording
    for (const slot of slots) stopBufferRecording(slot.slotId);

    // Save recording state and stop file recording
    wasRecordingBeforeVar.current = recording.isRecording;
    recordingFolderBeforeVar.current = recording.recordingFolder;
    if (recording.isRecording) recording.stopAll();

    // Build blobs + compute sync offsets
    const urls = new Map<SlotId, string>();
    const startTimes = new Map<SlotId, number>();
    let maxDurationMs = 0;

    for (const slot of slots) {
      const buffer = getBuffer(slot.slotId);
      if (buffer && buffer.hasData()) {
        const blob = buffer.getFullReplayBlob();
        if (blob) urls.set(slot.slotId, URL.createObjectURL(blob));
        const dur = buffer.getReplayDurationMs();
        if (dur > maxDurationMs) maxDurationMs = dur;
        const firstTs = buffer.getFirstChunkTimestamp();
        if (firstTs > 0) {
          // Les timestamps de chunks sont des heures d'ARRIVÉE : chaque caméra a sa
          // propre latence réseau (WiFi). On la soustrait pour approcher l'heure de capture.
          const latencyMs = getStatsSnapshot(slot.slotId)?.latencyMs ?? 0;
          startTimes.set(slot.slotId, firstTs - latencyMs);
        }
      }
    }

    if (urls.size === 0) {
      setVarError('Buffer vide — attendre 30s après connexion des caméras');
      setTimeout(() => setVarError(null), 4000);
      for (const slot of slots) {
        const stream = streams.get(slot.slotId);
        if (stream && slot.cameraConnected) startBufferRecording(slot.slotId, stream);
      }
      return;
    }

    // Offsets par caméra : la timeline 0 = début de capture de la caméra la plus ancienne.
    // Une caméra qui a commencé à bufferiser PLUS TARD possède moins de passé : à l'instant
    // timeline t elle doit afficher son temps média t − (t_i − minStart), donc offset NÉGATIF
    // (currentTime = t + offset). L'ancien code inversait le signe et doublait la désynchro.
    const offsets = new Map<SlotId, number>();
    if (startTimes.size > 1) {
      const minStart = Math.min(...startTimes.values());
      for (const [id, t] of startTimes) {
        offsets.set(id, (minStart - t) / 1000); // secondes, ≤ 0
      }
    }

    // Cadence réelle de la caméra maître (première avec des données)
    const masterSlotId = urls.keys().next().value as SlotId | undefined;
    const nextFps = snapFps(masterSlotId !== undefined ? getStatsSnapshot(masterSlotId)?.fps : undefined);
    setFps(nextFps);

    // Réinitialiser l'analyse IA de la capture précédente
    if (analysisAbortRef.current) analysisAbortRef.current.aborted = true;
    setAnalysisStatus(null);
    setAnalysisProgress(null);
    setAnalysisSummary(null);
    setImpactMarkers([]);
    setMotionSignal(null);

    probeDurations(urls);
    frameDeltaSamples.current = [];
    autoAnalysisArmed.current = true;

    setVarOffsets(offsets);
    setVarDurationMs(maxDurationMs);
    setVarBlobs(urls);
    setVarMode(true);
    setExpandedSlot(null);
    setVideoZoom(1);
    setPlaybackRate(1);
    varTimeRef.current = 0;
    frameCounterRef.current = 0;
    setCurrentTimeDisplay(0);
    setCurrentFrame(0);
    setTotalFrames(Math.round((maxDurationMs / 1000) * nextFps));
  }, [slots, getBuffer, stopBufferRecording, recording, streams, startBufferRecording, getStatsSnapshot, probeDurations]);

  const exitVarMode = useCallback(() => {
    autoAnalysisArmed.current = false;
    probeGenRef.current++;
    setVarMode(false);
    setIsPlaying(false);
    setExpandedSlot(null);
    setVideoZoom(1);

    // Stopper une analyse IA en cours
    if (analysisAbortRef.current) analysisAbortRef.current.aborted = true;
    setAnalysisStatus(null);
    setAnalysisProgress(null);
    setAnalysisSummary(null);
    setImpactMarkers([]);
    setMotionSignal(null);

    // Save current capture to history (blobs kept alive)
    if (varBlobs.size > 0) {
      const capture: VarCapture = {
        id: `var-${Date.now()}`,
        timestamp: Date.now(),
        durationMs: varDurationMs,
        blobs: new Map(varBlobs),
        offsets: new Map(varOffsets),
        fps,
      };
      setVarHistory((prev) => {
        // Keep only last MAX_HISTORY, revoke old ones
        const trimmed = [capture, ...prev];
        const overflow = trimmed.slice(MAX_HISTORY);
        for (const old of overflow) {
          for (const url of old.blobs.values()) URL.revokeObjectURL(url);
        }
        return trimmed.slice(0, MAX_HISTORY);
      });
    }

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
  }, [varBlobs, varDurationMs, varOffsets, fps, slots, streams, startBufferRecording, recording]);

  // Replay a past VAR capture
  const replayHistoryCapture = useCallback((capture: VarCapture) => {
    // Stop buffer recording
    for (const slot of slots) stopBufferRecording(slot.slotId);

    wasRecordingBeforeVar.current = recording.isRecording;
    recordingFolderBeforeVar.current = recording.recordingFolder;
    if (recording.isRecording) recording.stopAll();

    if (analysisAbortRef.current) analysisAbortRef.current.aborted = true;
    setAnalysisStatus(null);
    setAnalysisProgress(null);
    setAnalysisSummary(null);
    setImpactMarkers([]);
    setMotionSignal(null);

    probeDurations(capture.blobs);
    frameDeltaSamples.current = [];
    autoAnalysisArmed.current = true;

    setFps(capture.fps);
    setVarOffsets(capture.offsets);
    setVarDurationMs(capture.durationMs);
    setVarBlobs(capture.blobs);
    setVarMode(true);
    setExpandedSlot(null);
    setVideoZoom(1);
    setPlaybackRate(1);
    varTimeRef.current = 0;
    frameCounterRef.current = 0;
    setCurrentTimeDisplay(0);
    setCurrentFrame(0);
    setTotalFrames(Math.round((capture.durationMs / 1000) * capture.fps));
  }, [slots, stopBufferRecording, recording, probeDurations]);

  // Pause/resume buffer recording (between fights)
  const toggleBufferPause = useCallback(() => {
    if (bufferPaused) {
      resumeAllRecording();
      setBufferPaused(false);
    } else {
      pauseAllRecording();
      setBufferPaused(true);
    }
  }, [bufferPaused, pauseAllRecording, resumeAllRecording]);

  // ============ Analyse IA : détection d'impacts + synchro auto ============
  const runAnalysis = useCallback(async () => {
    if (analysisStatus || varBlobs.size === 0) return;
    const abort = { aborted: false };
    analysisAbortRef.current = abort;
    setAnalysisProgress(0);
    const expected = varDurationMs / 1000;
    const entries = [...varBlobs.entries()];
    const masterSlotId = getMasterEntry()?.[0] ?? entries[0][0];

    try {
      const signals = new Map<SlotId, MotionSignal>();
      let done = 0;
      for (const [slotId, url] of entries) {
        if (abort.aborted) return;
        done++;
        setAnalysisStatus(`Analyse caméra ${done}/${entries.length}…`);
        try {
          const camIndex = done - 1;
          const sig = await extractMotionSignal(url, {
            expectedDurationSec: expected,
            abort,
            onProgress: (f) => {
              // ~10 mises à jour/s suffisent pour la barre de progression de la timeline
              const now = performance.now();
              if (now - lastProgressUpdate.current < 100) return;
              lastProgressUpdate.current = now;
              setAnalysisProgress((camIndex + f) / entries.length);
            },
          });
          if (sig.times.length > 10) signals.set(slotId, sig);
        } catch {
          // caméra illisible — on continue avec les autres
        }
      }
      if (abort.aborted) return;

      const masterSig = signals.get(masterSlotId);
      const masterOffset = varOffsets.get(masterSlotId) || 0;

      // Signaux ramenés dans le référentiel timeline (temps média − offset courant) :
      // la corrélation ne mesure alors que le RÉSIDU de désynchro, ce qui reste
      // valide même si une caméra s'est connectée bien après les autres
      const toTimeline = (sig: MotionSignal, offset: number): MotionSignal => ({
        times: sig.times.map((t) => t - offset),
        values: sig.values,
      });

      let markerCount = 0;
      let synced = 0;
      if (masterSig) {
        const masterAdj = toTimeline(masterSig, masterOffset);
        setMotionSignal(masterAdj);

        // Marqueurs d'impacts (déjà en temps timeline)
        const spikes = findImpactSpikes(masterAdj);
        // Pas de borne haute : la durée réelle peut n'être connue qu'après l'analyse,
        // et c'est justement la fin du replay qui manquait à l'estimation
        const markers = spikes.map((s) => s * 1000).filter((ms) => ms >= 0);
        setImpactMarkers(markers);
        markerCount = markers.length;

        // Synchro auto : les caméras filment la même scène, la corrélation croisée
        // de leurs signaux de mouvement donne le décalage réel entre elles
        const newOffsets = new Map(varOffsets);
        for (const [slotId, sig] of signals) {
          if (slotId === masterSlotId) continue;
          const currentOffset = varOffsets.get(slotId) || 0;
          const residual = estimateOffsetSec(masterAdj, toTimeline(sig, currentOffset));
          if (residual !== null && Math.abs(residual) > 0.01) {
            newOffsets.set(slotId, currentOffset + residual);
            synced++;
          }
        }
        if (synced > 0) {
          setVarOffsets(newOffsets);
          varVideoRefs.current.forEach((v, slotId) => {
            v.currentTime = Math.max(0, varTimeRef.current + (newOffsets.get(slotId) || 0));
          });
        }
      }

      if (!masterSig) {
        setAnalysisSummary('Analyse impossible sur cette capture');
      } else {
        const syncTxt = synced > 0 ? ` · ${synced} caméra${synced > 1 ? 's' : ''} resynchronisée${synced > 1 ? 's' : ''}` : '';
        if (markerCount === 0) {
          setAnalysisSummary(`Aucun mouvement brusque détecté${syncTxt}`);
        } else {
          setAnalysisSummary(`⚡ ${markerCount} pic${markerCount > 1 ? 's' : ''} de mouvement${syncTxt} — ◆ pour naviguer`);
        }
      }
    } finally {
      if (analysisAbortRef.current === abort) {
        setAnalysisStatus(null);
        setAnalysisProgress(null);
        analysisAbortRef.current = null;
      }
    }
  }, [analysisStatus, varBlobs, varDurationMs, varOffsets, getMasterEntry]);

  // Ajustement manuel de synchro : décale une caméra de ±1 frame
  const nudgeCamera = useCallback((slotId: SlotId, deltaFrames: number) => {
    const newOffset = (varOffsets.get(slotId) || 0) + deltaFrames * frameInterval;
    const next = new Map(varOffsets);
    next.set(slotId, newOffset);
    setVarOffsets(next);
    const el = varVideoRefs.current.get(slotId);
    if (el) el.currentTime = Math.max(0, varTimeRef.current + newOffset);
  }, [varOffsets, frameInterval]);

  // Durée réelle : dès qu'une sonde répond, la timeline et le total d'images suivent la vidéo
  // (fin de timeline = fin de la caméra qui couvre le plus de passé, offsets inclus)
  useEffect(() => {
    if (!varMode || probedDurations.size === 0) return;
    let end = 0;
    probedDurations.forEach((d, slotId) => {
      end = Math.max(end, d - (varOffsets.get(slotId) || 0));
    });
    if (end > 0) setVarDurationMs(Math.round(end * 1000));
  }, [varMode, probedDurations, varOffsets]);

  // Total d'images = durée × fps : suit la durée réelle ET la recalibration du fps
  useEffect(() => {
    if (varMode) setTotalFrames(varTotalFrames);
  }, [varMode, varTotalFrames]);

  // Analyse IA automatique à l'entrée en VAR (l'arbitre n'a rien à comprendre ni à cliquer)
  useEffect(() => {
    if (!varMode || varBlobs.size === 0 || !autoAnalysisArmed.current || analysisStatus) return;
    const t = setTimeout(() => {
      if (!autoAnalysisArmed.current) return;
      autoAnalysisArmed.current = false;
      runAnalysis();
    }, 800);
    return () => clearTimeout(t);
  }, [varMode, varBlobs, analysisStatus, runAnalysis]);

  // Courbe affichée sur la timeline, recalculée si la durée réelle change
  const motionCurve = useMemo(
    () => (motionSignal ? buildDisplayCurve(motionSignal, varDurationSec) : null),
    [motionSignal, varDurationSec]
  );

  // ============ Frame stepping — deterministic counter + camera sync ============

  // Helper: update display from frameCounterRef
  const updateDisplay = useCallback(() => {
    const t = frameCounterRef.current * frameInterval;
    setCurrentFrame(frameCounterRef.current);
    setCurrentTimeDisplay(t);
  }, [frameInterval]);

  // Step forward N frames: RVFC on ALL cameras in parallel
  const stepForward = useCallback(async (frames: number) => {
    varVideoRefs.current.forEach((v) => v.pause());

    const master = getMasterEntry();
    if (!master) return;
    const [masterSlotId, masterBefore] = master;
    const timeBefore = masterBefore.currentTime;

    for (let i = 0; i < frames; i++) {
      // Advance ALL cameras via RVFC in parallel (each advances one real decoded frame)
      const promises: Promise<void>[] = [];
      varVideoRefs.current.forEach((el) => {
        const p = new Promise<void>((resolve) => {
          const hasRVFC = typeof (el as any).requestVideoFrameCallback === 'function';
          if (hasRVFC) {
            (el as any).requestVideoFrameCallback(() => {
              el.pause();
              resolve();
            });
          } else {
            setTimeout(() => { el.pause(); resolve(); }, 60);
          }
          el.playbackRate = 1;
          el.play().catch(() => resolve());
        });
        promises.push(p);
      });
      await Promise.all(promises);
      frameCounterRef.current += 1;
    }

    // Read master's actual time for the counter
    const masterEl = varVideoRefs.current.get(masterSlotId);
    if (masterEl) {
      const masterOffset = varOffsets.get(masterSlotId) || 0;
      varTimeRef.current = masterEl.currentTime - masterOffset;

      // Calibration du fps sur les vraies images : chaque pas avance d'exactement une image
      // décodée, l'écart de temps média mesuré donne la cadence réelle de l'enregistrement
      const delta = (masterEl.currentTime - timeBefore) / frames;
      if (delta > 0.004 && delta < 0.2) {
        const samples = frameDeltaSamples.current;
        samples.push(delta);
        if (samples.length > 40) samples.shift();
        if (samples.length >= 6) {
          const sorted = [...samples].sort((a, b) => a - b);
          const measured = snapFps(1 / sorted[Math.floor(sorted.length / 2)]);
          if (Math.abs(measured - fps) >= 2) setFps(measured);
        }
      }
    }

    setIsPlaying(false);
    updateDisplay();
  }, [getMasterEntry, varOffsets, updateDisplay, fps]);

  // Step backward N frames: decrement counter, seek all videos
  const stepBackward = useCallback((frames: number) => {
    varVideoRefs.current.forEach((v) => v.pause());
    frameCounterRef.current = Math.max(0, frameCounterRef.current - frames);
    const target = frameCounterRef.current * frameInterval;
    varTimeRef.current = target;
    seekAllTo(target);
    setIsPlaying(false);
    updateDisplay();
  }, [frameInterval, seekAllTo, updateDisplay]);

  // Seek via timeline click
  const seekTo = useCallback((time: number) => {
    const clamped = Math.max(0, Math.min(time, varDurationSec));
    varTimeRef.current = clamped;
    frameCounterRef.current = Math.round(clamped * fps);
    seekAllTo(clamped);
    updateDisplay();
  }, [varDurationSec, fps, seekAllTo, updateDisplay]);

  const togglePlayPause = useCallback(() => {
    if (isPlaying) {
      varVideoRefs.current.forEach((v) => v.pause());
      setIsPlaying(false);
      // Recalibrate from master video
      const master = getMasterEntry();
      if (master) {
        const [masterSlotId, masterEl] = master;
        const masterOffset = varOffsets.get(masterSlotId) || 0;
        const realTime = masterEl.currentTime - masterOffset;
        varTimeRef.current = realTime;
        frameCounterRef.current = Math.round(realTime * fps);
        updateDisplay();
      }
    } else {
      // Sync all videos to current time with offsets, then play
      varVideoRefs.current.forEach((v, slotId) => {
        const offset = varOffsets.get(slotId) || 0;
        v.currentTime = varTimeRef.current + offset;
        v.playbackRate = playbackRate;
        v.play().catch(() => {});
      });
      setIsPlaying(true);
    }
  }, [isPlaying, getMasterEntry, varOffsets, playbackRate, fps, updateDisplay]);

  const handleSeek = useCallback((timeMs: number) => {
    seekTo(timeMs / 1000);
  }, [seekTo]);

  // Navigation par impacts : saute au marqueur IA suivant / précédent (boutons ◆ et Maj+←/→)
  const goToImpact = useCallback((direction: 1 | -1) => {
    const target = adjacentMarker(impactMarkers, varTimeRef.current * 1000, direction, frameInterval * 1000);
    if (target === null) return;
    varVideoRefs.current.forEach((v) => v.pause());
    setIsPlaying(false);
    seekTo(target / 1000);
  }, [impactMarkers, seekTo, frameInterval]);

  const handleSpeedChange = useCallback((rate: number) => {
    setPlaybackRate(rate);
    varVideoRefs.current.forEach((v) => { v.playbackRate = rate; });
  }, []);

  // Update frame counter during play — recalibrate from master video
  useEffect(() => {
    if (!varMode) return;
    frameUpdateRef.current = setInterval(() => {
      if (!isPlaying) return;
      const master = getMasterEntry();
      if (!master) return;
      const [masterSlotId, masterEl] = master;
      const masterOffset = varOffsets.get(masterSlotId) || 0;
      const realTime = masterEl.currentTime - masterOffset;
      varTimeRef.current = realTime;
      frameCounterRef.current = Math.round(realTime * fps);
      setCurrentFrame(frameCounterRef.current);
      setTotalFrames(varTotalFrames);
      setCurrentTimeDisplay(realTime);
    }, 50);
    return () => clearInterval(frameUpdateRef.current);
  }, [varMode, isPlaying, getActiveVideo, varDurationSec, varTotalFrames, fps]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!varMode) return;
      // Maj + flèches : impact précédent / suivant
      if (e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        goToImpact(e.key === 'ArrowRight' ? 1 : -1);
        e.preventDefault();
        return;
      }
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
        case 'a': case 'A': runAnalysis(); break;
        case 'Escape':
          if (expandedSlot) { setExpandedSlot(null); setVideoZoom(1); pauseAll(); }
          else exitVarMode();
          break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [varMode, expandedSlot, stepForward, stepBackward, togglePlayPause, handleSpeedChange, pauseAll, exitVarMode, runAnalysis, goToImpact]);

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

  // GO/NO-GO : synthèse de l'état des caméras et des buffers avant un assaut
  const readiness = computeReadiness(
    slots.map((s) => {
      const st = connStats.get(s.slotId);
      return {
        slotId: s.slotId,
        name: s.name,
        cameraConnected: s.cameraConnected,
        health: st ? getHealth(st) : undefined,
        frozen: frozenSlots.has(s.slotId),
        bufferMs: bufferDurations.get(s.slotId) ?? 0,
      };
    }),
    { bufferTargetMs: getBufferDurationSec() * 1000, bufferPaused }
  );

  const impactIndex = currentMarkerIndex(impactMarkers, currentTimeDisplay * 1000, frameInterval * 1000);

  // Commandes VAR : cibles ≥ 48 px, groupées (transport · impacts · vitesse · analyse)
  const renderVarControls = () => {
    const impactCount = impactMarkers.length;
    const analysing = analysisStatus !== null;
    return (
      <div className="var-controls">
        <div className="var-group">
          <button className="var-ctl" onClick={() => stepBackward(10)} title="−10 images (↓)">{'\u25C0\u25C0'} 10</button>
          <button className="var-ctl" onClick={() => stepBackward(1)} title="−1 image (←)">{'\u25C0'} 1</button>
          <button className="var-ctl primary" onClick={togglePlayPause} title="Lecture / Pause (Espace)">{isPlaying ? '\u23F8' : '\u25B6'}</button>
          <button className="var-ctl" onClick={() => stepForward(1)} title="+1 image (→)">1 {'\u25B6'}</button>
          <button className="var-ctl" onClick={() => stepForward(10)} title="+10 images (↑)">10 {'\u25B6\u25B6'}</button>
        </div>
        <div className="var-frame font-mono" title="position · image / total">
          {formatTime(currentTimeDisplay)} · {Math.min(currentFrame, totalFrames)} / {totalFrames}
        </div>
        <div className="var-group">
          <button className="var-ctl impact" disabled={impactCount === 0} onClick={() => goToImpact(-1)} title="Impact précédent (Maj + ←)">{'\u25C0'} ◆</button>
          <span className="var-impact-count font-mono">
            {impactCount > 0 ? `impact ${impactIndex >= 0 ? impactIndex + 1 : '–'} / ${impactCount}` : 'aucun impact'}
          </span>
          <button className="var-ctl impact" disabled={impactCount === 0} onClick={() => goToImpact(1)} title="Impact suivant (Maj + →)">◆ {'\u25B6'}</button>
        </div>
        <div className="var-group">
          {[0.1, 0.25, 0.5, 1].map((rate) => (
            <button key={rate} className={`speed-btn lg ${playbackRate === rate ? 'active' : ''}`} onClick={() => handleSpeedChange(rate)} title={`Vitesse ${rate}x`}>{rate}x</button>
          ))}
        </div>
        <button
          className="var-ctl analyse"
          onClick={runAnalysis}
          disabled={analysing}
          title="Lancée automatiquement à l'entrée en VAR : mesure l'intensité du mouvement (courbe orange), marque les pics brusques (◆) et resynchronise les caméras. Touche A pour relancer."
        >
          {analysing ? `⏳ ${Math.round((analysisProgress ?? 0) * 100)} %` : motionSignal ? '↻ RELANCER L\'ANALYSE' : '⚡ ANALYSE IA'}
        </button>
        {analysisSummary && <span className="var-summary font-mono">{analysisSummary}</span>}
        <button className="btn-live var-ctl-live" onClick={exitVarMode} title="Retour au direct (Échap)">
          REPRENDRE LE LIVE
        </button>
      </div>
    );
  };

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
        <>
          <ReadinessBanner readiness={readiness} />
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)', gap: 4, padding: 4, minHeight: 0 }}>
          {slots.map((slot) => (
            <CameraTile key={slot.slotId} slot={slot} stream={streams.get(slot.slotId) || null} selected={false} onClick={() => setExpandedSlot(slot.slotId)} connectionStats={connStats.get(slot.slotId)} frozen={frozenSlots.has(slot.slotId)} />
          ))}
          {slots.length === 0 && (
            <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-dim)', fontFamily: 'var(--font-ui)', textTransform: 'uppercase' }}>
              En attente... <a href="/setup" style={{ color: 'var(--cyan)', marginLeft: 8 }}>Page setup</a>
            </div>
          )}
          </div>
        </>
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
                    registerRef={(el) => { if (el) varVideoRefs.current.set(slot.slotId, el); else varVideoRefs.current.delete(slot.slotId); }}
                    zoom={isExpanded ? videoZoom : 1}
                  />
                  {!expandedSlot && (
                    <div className="label" style={{ color: 'var(--red)' }}>{slot.name}</div>
                  )}
                  {/* Ajustement fin de synchro par caméra (±1 frame) */}
                  {!expandedSlot && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        position: 'absolute', bottom: 6, left: 6, zIndex: 2,
                        display: 'flex', alignItems: 'center', gap: 4,
                        background: '#000000aa', padding: '2px 6px', border: '1px solid var(--border)',
                        cursor: 'default',
                      }}
                    >
                      <button className="btn nudge-btn"
                        title="Retarder cette caméra d'une frame"
                        onClick={() => nudgeCamera(slot.slotId, -1)}>−1f</button>
                      <span className="font-mono" style={{ fontSize: '0.65rem', color: 'var(--text-muted)', minWidth: 44, textAlign: 'center' }}>
                        {Math.round((varOffsets.get(slot.slotId) || 0) * 1000)}ms
                      </span>
                      <button className="btn nudge-btn"
                        title="Avancer cette caméra d'une frame"
                        onClick={() => nudgeCamera(slot.slotId, 1)}>+1f</button>
                    </div>
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
            <VarTimeline durationMs={varDurationMs} currentTimeMs={currentTimeDisplay * 1000} fps={fps} onSeek={handleSeek} markers={impactMarkers} analysisProgress={analysisProgress} curve={motionCurve} />
            {motionCurve && (
              <div className="var-legend">
                <b>Courbe orange</b> = intensité du mouvement · <b>◆</b> = pic brusque (touche, parade ou clash) · l'analyse pointe les moments à regarder, l'arbitre décide
              </div>
            )}
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
          {/* Pause buffer button (save CPU between fights) */}
          <button onClick={toggleBufferPause} style={{
            pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px',
            border: bufferPaused ? '2px solid #ff8c00' : '2px solid var(--border)',
            borderRadius: 24,
            background: bufferPaused ? 'rgba(255, 140, 0, 0.2)' : 'rgba(18, 18, 26, 0.9)',
            color: bufferPaused ? '#ff8c00' : 'var(--text)', cursor: 'pointer',
            fontFamily: 'var(--font-ui)', fontWeight: 700, fontSize: '0.8rem',
            textTransform: 'uppercase', backdropFilter: 'blur(8px)',
          }}>
            {bufferPaused ? '▶ REPRENDRE' : '⏸ PAUSE'}
          </button>
          <button className="btn-var" onClick={handleVarPress} style={{ pointerEvents: 'auto', padding: '14px 40px', fontSize: '1.4rem' }}>VAR</button>
        </div>
      )}

      {/* VAR history — top right when live */}
      {!varMode && varHistory.length > 0 && (
        <div style={{
          position: 'fixed', top: 60, right: 16, zIndex: 40,
          background: 'rgba(18, 18, 26, 0.9)', border: '1px solid var(--border)',
          padding: 10, maxWidth: 220, backdropFilter: 'blur(8px)',
        }}>
          <div style={{ fontFamily: 'var(--font-ui)', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
            Historique VAR
          </div>
          {varHistory.map((c) => {
            const d = new Date(c.timestamp);
            const timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
            return (
              <button key={c.id} onClick={() => replayHistoryCapture(c)}
                style={{
                  display: 'block', width: '100%', marginBottom: 4,
                  padding: '6px 10px', border: '1px solid var(--red-border)',
                  background: 'transparent', color: 'var(--red)', cursor: 'pointer',
                  fontFamily: 'var(--font-mono)', fontSize: '0.75rem', textAlign: 'left',
                }}>
                {timeStr} — {Math.round(c.durationMs / 1000)}s
              </button>
            );
          })}
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
function PersistentVarVideo({ slotId, blobUrl, registerRef, zoom }: {
  slotId: SlotId;
  blobUrl: string;
  registerRef: (el: HTMLVideoElement | null) => void;
  zoom: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const srcSet = useRef(false);

  // Set src ONCE on mount — never re-set regardless of parent re-renders
  useEffect(() => {
    const el = videoRef.current;
    if (!el || srcSet.current) return;
    srcSet.current = true;
    registerRef(el);
    el.src = blobUrl;
    el.preload = 'auto';
    // Cleanup only on unmount
    return () => {
      registerRef(null);
      srcSet.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty deps: only runs on mount/unmount

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
