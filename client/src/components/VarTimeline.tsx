import React, { useRef, useEffect, useCallback, useState } from 'react';

interface VarTimelineProps {
  durationMs: number;
  currentTimeMs: number;
  bufferDurationMs: number;
  fps: number;
  onSeek: (timeMs: number) => void;
}

export default function VarTimeline({
  durationMs,
  currentTimeMs,
  bufferDurationMs,
  fps,
  onSeek,
}: VarTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
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

    const totalW = w * zoom;
    const progress = durationMs > 0 ? currentTimeMs / durationMs : 0;
    const scrollOffset = Math.max(0, progress * totalW - w / 2);

    // Buffer zone
    const bufferRatio = Math.min(1, bufferDurationMs / durationMs);
    const bufferW = bufferRatio * totalW;
    const bufferX = totalW - bufferW - scrollOffset;
    ctx.fillStyle = '#00d4ff12';
    ctx.fillRect(Math.max(0, bufferX), 0, Math.min(bufferW, w), h);

    // Time markers
    const pxPerMs = totalW / durationMs;
    const secondPx = pxPerMs * 1000;

    // Draw second markers
    const startSec = Math.floor(scrollOffset / secondPx);
    const endSec = Math.ceil((scrollOffset + w) / secondPx);

    for (let s = startSec; s <= endSec; s++) {
      const x = s * secondPx - scrollOffset;
      if (x < -1 || x > w + 1) continue;

      const isTen = s % 10 === 0;
      ctx.strokeStyle = isTen ? '#ffffff44' : '#ffffff18';
      ctx.lineWidth = isTen ? 1.5 : 0.5;
      ctx.beginPath();
      ctx.moveTo(x, isTen ? 0 : h * 0.6);
      ctx.lineTo(x, h);
      ctx.stroke();

      if (isTen && s > 0) {
        ctx.fillStyle = '#8888aa';
        ctx.font = '10px JetBrains Mono, monospace';
        ctx.fillText(`${s}s`, x + 3, 12);
      }
    }

    // Cursor (current position)
    const cursorX = progress * totalW - scrollOffset;
    ctx.strokeStyle = '#ff3b3b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cursorX, 0);
    ctx.lineTo(cursorX, h);
    ctx.stroke();

    // Cursor head
    ctx.fillStyle = '#ff3b3b';
    ctx.beginPath();
    ctx.moveTo(cursorX - 5, 0);
    ctx.lineTo(cursorX + 5, 0);
    ctx.lineTo(cursorX, 6);
    ctx.closePath();
    ctx.fill();
  }, [durationMs, currentTimeMs, bufferDurationMs, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => draw();
    const observer = new ResizeObserver(handleResize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const getTimeFromX = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current;
      if (!canvas || durationMs <= 0) return 0;
      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const ratio = x / rect.width;
      return Math.max(0, Math.min(durationMs, ratio * durationMs));
    },
    [durationMs]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    isDragging.current = true;
    onSeek(getTimeFromX(e.clientX));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const timeMs = getTimeFromX(e.clientX);
    const timeSec = (timeMs / 1000).toFixed(1);
    const frame = Math.round((timeMs / 1000) * fps);
    const rect = canvasRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltip({ x: e.clientX - rect.left, text: `T-${timeSec}s | Frame ${frame}` });
    }
    if (isDragging.current) {
      onSeek(timeMs);
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const handleMouseLeave = () => {
    isDragging.current = false;
    setTooltip(null);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.max(1, Math.min(20, z + (e.deltaY > 0 ? -0.5 : 0.5))));
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: 40 }}>
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', cursor: 'pointer', display: 'block' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onWheel={handleWheel}
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
