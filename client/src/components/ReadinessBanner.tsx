import React from 'react';
import type { Readiness, ChipTone } from '../lib/readiness';

const ICONS: Record<Readiness['level'], string> = {
  ready: '✅',
  warning: '⚠',
  blocked: '⛔',
  idle: '○',
};

const TONE_COLORS: Record<ChipTone, string> = {
  good: '#22c55e',
  degraded: 'var(--orange)',
  bad: 'var(--red)',
  off: 'var(--text-dim)',
};

/** Bandeau GO / NO-GO affiché au-dessus de la grille live */
export default function ReadinessBanner({ readiness }: { readiness: Readiness }) {
  return (
    <div className={`readiness ${readiness.level}`} role="status" aria-live="polite">
      <span className="readiness-icon">{ICONS[readiness.level]}</span>
      <div>
        <div className="readiness-title">{readiness.title}</div>
        {readiness.details.length > 0 && (
          <div className="readiness-details">{readiness.details.join(' · ')}</div>
        )}
      </div>
      {readiness.chips.length > 0 && (
        <div className="chips">
          {readiness.chips.map((c) => (
            <span key={c.slotId} className="chip" title={`Caméra ${c.name}`}>
              <span className="chip-dot" style={{ background: TONE_COLORS[c.tone] }} />
              {c.name} <span className="chip-val">{c.text}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
