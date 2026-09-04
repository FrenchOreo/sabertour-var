import { describe, it, expect } from 'vitest';
import { computeReadiness, SlotReadinessInput } from '../lib/readiness';

const opts = { bufferTargetMs: 60000, bufferPaused: false };

function cam(over: Partial<SlotReadinessInput> & { slotId: number }): SlotReadinessInput {
  return { name: `CAM${over.slotId}`, cameraConnected: true, health: 'good', frozen: false, bufferMs: 60000, ...over };
}

describe('computeReadiness', () => {
  it('is idle without configured slots', () => {
    const r = computeReadiness([], opts);
    expect(r.level).toBe('idle');
    expect(r.chips).toEqual([]);
  });

  it('is ready when every camera is connected, healthy and buffered', () => {
    const r = computeReadiness([cam({ slotId: 1 }), cam({ slotId: 2 }), cam({ slotId: 3 }), cam({ slotId: 4 })], opts);
    expect(r.level).toBe('ready');
    expect(r.title).toContain('4 caméras OK');
    expect(r.title).toContain('replay 60 s');
    expect(r.chips.every((c) => c.tone === 'good')).toBe(true);
  });

  it('reports the shortest replay window across cameras', () => {
    const r = computeReadiness([cam({ slotId: 1, bufferMs: 60000 }), cam({ slotId: 2, bufferMs: 42000 })], opts);
    expect(r.level).toBe('ready');
    expect(r.title).toContain('replay 42 s');
  });

  it('warns (not blocks) when a position is offline but others are fine', () => {
    const r = computeReadiness([cam({ slotId: 1 }), cam({ slotId: 2, name: 'FOND', cameraConnected: false })], opts);
    expect(r.level).toBe('warning');
    expect(r.title).toBe('Caméra FOND hors ligne');
    expect(r.chips[1]).toMatchObject({ tone: 'off', text: 'hors ligne' });
  });

  it('blocks when no camera is connected at all', () => {
    const r = computeReadiness([cam({ slotId: 1, cameraConnected: false }), cam({ slotId: 2, cameraConnected: false })], opts);
    expect(r.level).toBe('blocked');
    expect(r.title).toBe('Aucune caméra connectée');
  });

  it('blocks on a frozen stream — the operator believes it films, it does not', () => {
    const r = computeReadiness([cam({ slotId: 1 }), cam({ slotId: 3, name: 'FOND', frozen: true })], opts);
    expect(r.level).toBe('blocked');
    expect(r.title).toBe('Caméra FOND : flux perdu');
    expect(r.chips[1]).toMatchObject({ tone: 'bad', text: 'gelé' });
  });

  it('blocks on critical network health', () => {
    const r = computeReadiness([cam({ slotId: 1, name: 'GAUCHE', health: 'bad' })], opts);
    expect(r.level).toBe('blocked');
    expect(r.title).toBe('Caméra GAUCHE : réseau critique');
  });

  it('warns on degraded network health', () => {
    const r = computeReadiness([cam({ slotId: 1, name: 'DROITE', health: 'degraded' })], opts);
    expect(r.level).toBe('warning');
    expect(r.title).toBe('Caméra DROITE dégradée');
    expect(r.chips[0].tone).toBe('degraded');
  });

  it('warns while the buffer is still filling', () => {
    const r = computeReadiness([cam({ slotId: 1, bufferMs: 5000 }), cam({ slotId: 2, bufferMs: 9000 })], opts);
    expect(r.level).toBe('warning');
    expect(r.title).toBe('Buffer en cours 5 s / 60 s');
  });

  it('treats a full short buffer as ready when the configured window is short', () => {
    const r = computeReadiness([cam({ slotId: 1, bufferMs: 12000 })], { bufferTargetMs: 12000, bufferPaused: false });
    expect(r.level).toBe('ready');
  });

  it('warns when the buffer is paused', () => {
    const r = computeReadiness([cam({ slotId: 1 })], { ...opts, bufferPaused: true });
    expect(r.level).toBe('warning');
    expect(r.title).toContain('Buffer en pause');
  });

  it('gives precedence to blockers and keeps warnings in details', () => {
    const r = computeReadiness(
      [cam({ slotId: 1, name: 'A', frozen: true }), cam({ slotId: 2, name: 'B', health: 'degraded' }), cam({ slotId: 3, name: 'C', bufferMs: 2000 })],
      opts
    );
    expect(r.level).toBe('blocked');
    expect(r.title).toBe('Caméra A : flux perdu');
    expect(r.details).toContain('Caméra B dégradée');
    expect(r.details.some((d) => d.startsWith('Buffer en cours 2 s'))).toBe(true);
  });

  it('does not judge cameras whose stats have not arrived yet', () => {
    const r = computeReadiness([cam({ slotId: 1, health: undefined })], opts);
    expect(r.level).toBe('ready');
  });
});
