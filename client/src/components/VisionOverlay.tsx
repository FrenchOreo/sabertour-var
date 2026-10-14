import { useEffect, useRef } from 'react';
import type { VisionFrame } from '../lib/vision/types';

/**
 * « Vue IA » : dessine par-dessus une vidéo VAR ce que l'analyse a vu à cet instant
 * (squelettes des deux tireurs, lames retrouvées, point de contact / croisement).
 * Sert à vérifier d'un coup d'œil si l'IA suit bien les tireurs, sans rien annoter.
 */

// Segments du squelette BlazePose (33 points)
const BONES: [number, number][] = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [12, 14], [14, 16],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const COLORS = ['#22d3ee', '#f472b6'];

interface Props {
  video: HTMLVideoElement | null;
  /** images analysées pour cette caméra (triées ou non) */
  getFrames: () => VisionFrame[] | undefined;
  zoom: number;
}

export default function VisionOverlay({ video, getFrames, zoom }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Lu à chaque image : la boucle d'affichage n'est pas relancée à chaque rendu du parent
  const framesRef = useRef(getFrames);
  framesRef.current = getFrames;

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvasRef.current;
      if (!c || !video) return;
      const W = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const frames = framesRef.current();
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!frames || frames.length === 0 || !vw || !vh) return;

      // Image analysée la plus proche de l'image affichée (au plus 0,15 s d'écart)
      const t = video.currentTime;
      let best: VisionFrame | null = null;
      for (const f of frames) if (!best || Math.abs(f.t - t) < Math.abs(best.t - t)) best = f;
      if (!best || Math.abs(best.t - t) > 0.15) return;

      // object-fit: cover — même cadrage que la vidéo
      const s = Math.max(W / vw, H / vh);
      const ox = (W - vw * s) / 2;
      const oy = (H - vh * s) / 2;
      const X = (x: number) => ox + x * vw * s;
      const Y = (y: number) => oy + y * vh * s;

      ctx.lineWidth = 2;
      best.fighters.forEach((lm, i) => {
        ctx.strokeStyle = COLORS[i % 2];
        ctx.fillStyle = COLORS[i % 2];
        for (const [a, b] of BONES) {
          if (lm[a][2] < 0.3 || lm[b][2] < 0.3) continue;
          ctx.beginPath();
          ctx.moveTo(X(lm[a][0]), Y(lm[a][1]));
          ctx.lineTo(X(lm[b][0]), Y(lm[b][1]));
          ctx.stroke();
        }
        if (lm[0][2] >= 0.3) {
          ctx.beginPath();
          ctx.arc(X(lm[0][0]), Y(lm[0][1]), 6, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      ctx.lineWidth = 4;
      for (const b of best.blades) {
        ctx.strokeStyle = '#fde047';
        ctx.beginPath();
        ctx.moveTo(X(b.hilt.x), Y(b.hilt.y));
        ctx.lineTo(X(b.tip.x), Y(b.tip.y));
        ctx.stroke();
      }
      const mark = (p: { x: number; y: number }, color: string, label: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(X(p.x), Y(p.y), 14, 0, Math.PI * 2);
        ctx.stroke();
        ctx.font = 'bold 13px sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(label, X(p.x) + 16, Y(p.y) - 8);
      };
      if (best.contact) mark(best.contact.point, '#ef4444', `TOUCHE ${best.contact.zone}`);
      if (best.clash) mark(best.clash, '#f97316', 'CROISEMENT');

      ctx.font = '11px monospace';
      ctx.fillStyle = '#ffffffcc';
      const info = `IA : ${best.persons} pers. · ${best.fighters.length} tireurs · ${best.blades.length} lames`;
      ctx.fillText(info, W - ctx.measureText(info).width - 8, H - 8);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1,
        transform: zoom !== 1 ? `scale(${zoom})` : undefined, transformOrigin: 'center center',
      }}
    />
  );
}
