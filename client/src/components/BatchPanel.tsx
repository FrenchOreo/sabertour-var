import React, { useCallback, useRef, useState } from 'react';
import { analyzeClip } from '../lib/vision/analyzeClip';
import { acquireVision, visionFailure } from '../lib/vision/visionPool';
import { summarizeFile, batchTotals, BatchFileResult } from '../lib/vision/batch';
import { probeBlobDuration } from '../lib/videoDuration';
import { diagLog, exportDiagnostics } from '../lib/diagnostics';

/**
 * « Analyser un lot » : passe l'IA sur autant de vidéos qu'on veut, l'une après l'autre
 * (à lancer le soir), sans téléphones ni tournoi. Chaque résultat va dans le journal
 * (export → à m'envoyer) ; un clic sur une ligne ouvre la vidéo dans l'écran VAR.
 */

interface Props {
  onOpen: (files: File[]) => void;
  onClose: () => void;
  /** masqué sans être démonté : les résultats restent quand on ouvre une vidéo en VAR */
  hidden?: boolean;
}

type Row = { file: File; status: 'attente' | 'analyse' | 'fait' | 'erreur'; progress: number; result?: BatchFileResult };

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

export default function BatchPanel({ onOpen, onClose, hidden }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<{ aborted: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const update = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)));

  const run = useCallback(async (files: File[]) => {
    const abort = { aborted: false };
    abortRef.current = abort;
    setRunning(true);
    setRows(files.map((file) => ({ file, status: 'attente', progress: 0 })));
    diagLog('batch-start', { files: files.length, totalMB: Math.round(files.reduce((s, f) => s + f.size, 0) / 1048576) });
    const results: BatchFileResult[] = [];
    for (let i = 0; i < files.length && !abort.aborted; i++) {
      const file = files[i];
      update(i, { status: 'analyse' });
      const url = URL.createObjectURL(file);
      const t0 = performance.now();
      let lastP = 0;
      try {
        const durationSec = await probeBlobDuration(url);
        const lease = await acquireVision();
        try {
          const res = await analyzeClip(url, {
            worker: lease?.worker ?? null,
            durationSec: durationSec ?? 0,
            // Lot : lecture d'une traite, du début à la fin
            priorityTailSec: 0,
            abort,
            // la barre n'avance que par pas de 1 % (pas un rendu par image)
            onProgress: (p) => { if (p - lastP >= 0.01) { lastP = p; update(i, { progress: p }); } },
          });
          const result = summarizeFile(file.name, file.size, durationSec, Math.round(performance.now() - t0), res.frames, res.stats);
          if (!lease) result.error = `IA indisponible${visionFailure() ? ` (${visionFailure()})` : ''}`;
          results.push(result);
          diagLog('batch-file', { ...result });
          update(i, { status: result.error ? 'erreur' : 'fait', progress: 1, result });
        } finally {
          lease?.release();
        }
      } catch (err) {
        const error = String((err as Error)?.message ?? err);
        const empty = { delegate: null, framesAnalysed: 0, avgInferMs: 0, fightersShare: 0, bladeShare: 0, contactFrames: 0, clashFrames: 0 };
        const result = { ...summarizeFile(file.name, file.size, null, Math.round(performance.now() - t0), [], empty), error };
        results.push(result);
        diagLog('batch-file', { ...result });
        update(i, { status: 'erreur', progress: 1, result });
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    diagLog('batch-end', { ...batchTotals(results), aborted: abort.aborted });
    setRunning(false);
  }, []);

  const results = rows.map((r) => r.result).filter((r): r is BatchFileResult => !!r);
  const tot = batchTotals(results);
  const th: React.CSSProperties = { textAlign: 'left', padding: '3px 8px', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { padding: '3px 8px', whiteSpace: 'nowrap' };

  return (
    <div className="diag-panel" role="dialog" aria-label="Analyser un lot de vidéos" style={hidden ? { display: 'none' } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <strong style={{ fontFamily: 'var(--font-ui)', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--cyan)', flex: 1 }}>
          Banc d'essai — analyser un lot de vidéos
        </strong>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="video/*,.mp4,.mov,.m4v,.webm,.mkv"
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])].sort((a, b) => a.name.localeCompare(b.name));
            e.target.value = '';
            if (files.length) run(files);
          }}
        />
        {!running && <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => inputRef.current?.click()}>Choisir des vidéos…</button>}
        {running && <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => { if (abortRef.current) abortRef.current.aborted = true; }}>Arrêter</button>}
        <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => exportDiagnostics()}>Exporter le journal</button>
        <button className="btn" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => { if (abortRef.current) abortRef.current.aborted = true; onClose(); }}>Fermer</button>
      </div>

      {rows.length === 0 ? (
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Choisis tes vidéos de combats (enregistrements SABER VAR, vidéos de téléphone…). Chaque vidéo est analysée
          seule, l'une après l'autre : tireurs, lames, touches et croisements. Ça peut prendre du temps — à lancer le soir,
          le Mac branché. Les résultats s'ajoutent au journal : <b>Exporter le journal</b> à la fin et me l'envoyer.
          Un clic sur une vidéo analysée l'ouvre dans l'écran VAR avec la Vue IA (touche V).
        </div>
      ) : (
        <>
          <div className="font-mono" style={{ fontSize: '0.78rem', marginBottom: 8, lineHeight: 1.6 }}>
            {results.length} / {rows.length} vidéos{tot.failed ? ` · ${tot.failed} en erreur` : ''} · {fmt(tot.videoSec)} de vidéo en {fmt(tot.wallSec)}
            {' '}· tireurs vus {tot.fighterPct} % · lames vues {tot.bladePct} % des images · {tot.avgInferMs} ms par image
            {' '}· {tot.touches} touches, {tot.clashes} croisements
            {tot.lowBlade.length > 0 && <><br />Lames rarement vues : {tot.lowBlade.join(', ')}</>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="font-mono" style={{ borderCollapse: 'collapse', fontSize: '0.75rem' }}>
              <thead>
                <tr>
                  <th style={th}>Vidéo</th>
                  <th style={th}>Durée</th>
                  <th style={th}>État</th>
                  <th style={th}>Tireurs / lames vus</th>
                  <th style={th}>Touches · croisements</th>
                  <th style={th}>Vitesse</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const res = r.result;
                  return (
                    <tr key={i} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ ...td, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis' }} title={r.file.name}>{r.file.name}</td>
                      <td style={td}>{res?.durationSec != null ? fmt(res.durationSec) : '—'}</td>
                      <td style={{ ...td, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis' }} title={res?.error}>{r.status === 'analyse' ? `${Math.round(r.progress * 100)} %` : r.status}{res?.error ? ` : ${res.error}` : ''}</td>
                      <td style={td}>{res ? `${Math.round(res.stats.fightersShare * 100)} % / ${Math.round(res.stats.bladeShare * 100)} %` : '—'}</td>
                      <td style={td}>{res ? `${res.touches} · ${res.clashes}` : '—'}</td>
                      <td style={td}>{res?.speed != null ? `${res.speed}× · ${res.stats.avgInferMs} ms/img` : '—'}</td>
                      <td style={td}>
                        {r.status === 'fait' && !running && (
                          <button className="btn" style={{ fontSize: '0.7rem', padding: '2px 8px' }} onClick={() => onOpen([r.file])}>Ouvrir en VAR</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
