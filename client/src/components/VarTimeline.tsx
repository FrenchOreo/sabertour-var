import React, { useRef, useEffect, useCallback, useState } from 'react';

interface VarTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  fps: number;
  onSeek: (timeMs: number) => void;
  /** Impacts détectés par l'analyse IA (ms) — cliquables, le clic s'aimante dessus */
  markers?: number[];
}

const MARKER_SNAP_PX = 8;

export default function VarTimeline({
  durationMs,
  currentTimeMs,
  fps,
  onSeek,
  markers,
}: VarTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; text: string } | null>(null);
  const isDragging = useRef(false);

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

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, w, h);

    if (durationMs <= 0) return;

    const progress = Math.min(1, Math.max(0, currentTimeMs / durationMs));

    // Filled progress bar
    ctx.fillStyle = '#00d4ff18';
    ctx.fillRect(0, 0, progress * w, h);

    // Time markers — simple, no zoom/scroll
    const pxPerMs = w / durationMs;
    const secondPx = pxPerMs * 1000;

    // Adapt tick interval to avoid clutter
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
      ctx.moveTo(x, isBig ? 0 : h * 0.6);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (isBig && s > 0) {
        ctx.fillStyle = '#8888aa';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`${s}s`, x + 3, 12);
      }
    }

    // Impact markers (analyse IA)
    if (markers && markers.length > 0) {
      for (const m of markers) {
        if (m < 0 || m > durationMs) continue;
        const x = (m / durationMs) * w;
        ctx.strokeStyle = '#ffb020';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h * 0.25);
        ctx.lineTo(x, h);
        ctx.stroke();
        // Losange en tête de marqueur
        ctx.fillStyle = '#ffb020';
        ctx.beginPath();
        ctx.moveTo(x, h * 0.08);
        ctx.lineTo(x + 4, h * 0.2);
        ctx.lineTo(x, h * 0.32);
        ctx.lineTo(x - 4, h * 0.2);
        ctx.closePath();
        ctx.fill();
      }
    }

    // Cursor (current position)
    const cursorX = progress * w;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, h);
    ctx.stroke();

    // Cursor head (triangle)
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.moveTo(cursorX - 6, 0);
    ctx.lineTo(cursorX + 6, 0);
    ctx.lineTo(cursorX, 8);
    ctx.closePath();
    ctx.fill();
  }, [durationMs, currentTimeMs, markers]);

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
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 44 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: 'pointer', display: 'block' }}
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
            top: -28,
            left: tooltip.x,
            transform: 'translateX(-50%)',
            background: '#000000cc',
            color: 'var(--cyan)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.75rem',
            padding: '2px 8px',
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
