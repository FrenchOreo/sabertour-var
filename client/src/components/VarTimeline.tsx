import React, { useRef, useEffect, useCallback, useState } from 'react';

interface VarTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  fps: number;
  onSeek: (timeMs: number) => void;
  /** Impacts détectés par l'analyse IA (ms) — cliquables, le clic s'aimante dessus */
  markers?: number[];
  /** Progression de l'analyse IA en cours (0..1) ; null/undefined si aucune analyse */
  analysisProgress?: number | null;
  /** Courbe d'intensité du mouvement (valeurs 0..1 réparties sur toute la durée) */
  curve?: Float32Array | null;
}

const MARKER_SNAP_PX = 10;
const MARKER_COLOR = '#ffb020';
const MARKER_ACTIVE_COLOR = '#ffd166';
/** Plus haute qu'avant (44 px) : scrubbing précis au doigt et place pour la poignée + légende */
export const TIMELINE_HEIGHT = 72;

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export default function VarTimeline({
  durationMs,
  currentTimeMs,
  fps,
  onSeek,
  markers,
  analysisProgress,
  curve,
}: VarTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; text: string } | null>(null);
  const isDragging = useRef(false);
  const frameMs = fps > 0 ? 1000 / fps : 1000 / 30;

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    ctx.scale(devicePixelRatio, devicePixelRatio);

    const w = rect.width;
    const h = rect.height;
    const trackTop = 16; // bande supérieure réservée à la poignée et à la légende

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    if (durationMs <= 0) return;

    const progress = Math.min(1, Math.max(0, currentTimeMs / durationMs));

    // Zone écoulée
    ctx.fillStyle = '#00d4ff14';
    ctx.fillRect(0, trackTop, progress * w, h - trackTop);

    // Courbe d'intensité du mouvement (analyse IA) : on voit où ça se passe avant même les pics
    if (curve && curve.length > 1) {
      const baseY = h - 6;
      const maxH = (h - trackTop) * 0.7;
      const xAt = (i: number) => (i / (curve.length - 1)) * w;
      ctx.beginPath();
      ctx.moveTo(0, baseY);
      for (let i = 0; i < curve.length; i++) ctx.lineTo(xAt(i), baseY - curve[i] * maxH);
      ctx.lineTo(w, baseY);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 176, 32, 0.22)';
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < curve.length; i++) {
        const x = xAt(i);
        const y = baseY - curve[i] * maxH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255, 176, 32, 0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Graduations temporelles
    const pxPerMs = w / durationMs;
    const secondPx = pxPerMs * 1000;
    let tickInterval = 1;
    if (secondPx < 5) tickInterval = 10;
    else if (secondPx < 15) tickInterval = 5;

    const totalSec = Math.ceil(durationMs / 1000);
    for (let s = 0; s <= totalSec; s++) {
      if (s % tickInterval !== 0) continue;
      const x = s * secondPx;
      if (x > w) break;

      const isBig = s % (tickInterval * 5) === 0 || s % 10 === 0;
      ctx.strokeStyle = isBig ? '#ffffff44' : '#ffffff18';
      ctx.lineWidth = isBig ? 1 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, isBig ? trackTop + 8 : h * 0.7);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (isBig && s > 0) {
        ctx.fillStyle = '#8888aa';
        ctx.font = '11px JetBrains Mono, monospace';
        ctx.fillText(`${s}s`, x + 4, h - 6);
      }
    }

    // Marqueurs d'impact (analyse IA)
    if (markers && markers.length > 0) {
      const diamondY = trackTop + 12;
      for (const m of markers) {
        if (m < 0 || m > durationMs) continue;
        const x = (m / durationMs) * w;
        const active = Math.abs(m - currentTimeMs) <= frameMs;
        const color = active ? MARKER_ACTIVE_COLOR : MARKER_COLOR;
        const size = active ? 7 : 5;

        ctx.strokeStyle = color;
        ctx.lineWidth = active ? 2 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x, diamondY);
        ctx.lineTo(x, h);
        ctx.stroke();

        if (active) {
          ctx.shadowColor = color;
          ctx.shadowBlur = 10;
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x, diamondY - size);
        ctx.lineTo(x + size, diamondY);
        ctx.lineTo(x, diamondY + size);
        ctx.lineTo(x - size, diamondY);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Légende
      ctx.fillStyle = MARKER_COLOR;
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.textAlign = 'right';
      ctx.fillText(`◆ ${markers.length} impact${markers.length > 1 ? 's' : ''}`, w - 6, 12);
      ctx.textAlign = 'left';
    }

    // Progression de l'analyse IA : barre en bas + libellé en haut à gauche
    if (analysisProgress !== null && analysisProgress !== undefined) {
      const p = Math.min(1, Math.max(0, analysisProgress));
      ctx.fillStyle = '#ffb02033';
      ctx.fillRect(0, h - 4, w, 4);
      ctx.fillStyle = MARKER_COLOR;
      ctx.fillRect(0, h - 4, p * w, 4);
      ctx.font = '11px JetBrains Mono, monospace';
      ctx.fillText(`ANALYSE IA … ${Math.round(p * 100)} %`, 6, 12);
    }

    // Curseur (position courante)
    const cursorX = progress * w;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, h);
    ctx.stroke();

    // Poignée : visible et attrapable au doigt
    ctx.fillStyle = '#ff3b3b';
    roundedRect(ctx, cursorX - 9, 1, 18, 12, 3);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cursorX - 6, 13);
    ctx.lineTo(cursorX + 6, 13);
    ctx.lineTo(cursorX, 20);
    ctx.closePath();
    ctx.fill();
  }, [durationMs, currentTimeMs, markers, analysisProgress, curve, frameMs]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => draw());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const getTimeFromX = useCallback(
    (clientX: number, snapToMarkers = false) => {
      const canvas = canvasRef.current;
      if (!canvas || durationMs <= 0) return 0;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = Math.max(0, Math.min(1, x / rect.width));
      const timeMs = ratio * durationMs;

      // Aimante le clic sur un marqueur d'impact proche
      if (snapToMarkers && markers && markers.length > 0) {
        let best: number | null = null;
        let bestDistPx = MARKER_SNAP_PX;
        for (const m of markers) {
          const distPx = Math.abs(((m - timeMs) / durationMs) * rect.width);
          if (distPx <= bestDistPx) {
            bestDistPx = distPx;
            best = m;
          }
        }
        if (best !== null) return best;
      }
      return timeMs;
    },
    [durationMs, markers]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    onSeek(getTimeFromX(e.clientX, true));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const rawTimeMs = getTimeFromX(e.clientX);
    const snappedMs = getTimeFromX(e.clientX, true);
    const onMarker = snappedMs !== rawTimeMs;
    const timeSec = (snappedMs / 1000).toFixed(1);
    const frame = Math.round((snappedMs / 1000) * fps);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltip({ x: e.clientX - rect.left, text: `${onMarker ? '⚡ Impact — ' : ''}${timeSec}s | Frame ${frame}` });
    }
    if (isDragging.current) {
      onSeek(rawTimeMs);
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleMouseLeave = () => {
    isDragging.current = false;
    setTooltip(null);
  };

  // Touch support for mobile scrubbing
  const handleTouchStart = (e: React.TouchEvent) => {
    isDragging.current = true;
    onSeek(getTimeFromX(e.touches[0].clientX, true));
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isDragging.current) {
      onSeek(getTimeFromX(e.touches[0].clientX));
    }
  };

  const handleTouchEnd = () => {
    isDragging.current = false;
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: TIMELINE_HEIGHT }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: 'pointer', display: 'block', touchAction: 'none' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            top: -30,
            left: tooltip.x,
            transform: 'translateX(-50%)',
            background: '#000000cc',
            color: 'var(--cyan)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.8rem',
            padding: '3px 10px',
            border: '1px solid var(--cyan-border)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
