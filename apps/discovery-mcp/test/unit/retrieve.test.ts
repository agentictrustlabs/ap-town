// Spec 413 W1 — /kb/retrieve: one fixed floor, empty is an answer, a vector from another model is never scored.
import { describe, it, expect } from 'vitest';
import { retrievePassages, SCORE_FLOOR, EMBEDDING_MODEL, embeddedText, type VectorIndex } from '../../src/retrieve.js';

function env(matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }>) {
  const seen: { text?: string[]; topK?: number } = {};
  const AI = { async run(_m: string, inputs: Record<string, unknown>) { seen.text = inputs.text as string[]; return { data: [[0.1, 0.2, 0.3]] }; } };
  const KB_VECTORS: VectorIndex = { async query(_v, opts) { seen.topK = opts.topK; return { matches }; } };
  return { env: { AI, KB_VECTORS }, seen };
}
const md = (over: Record<string, unknown> = {}) => ({ model: EMBEDDING_MODEL, kind: 'shelf', subject: '0xabc', title: 'On grief', text: 'Grief is love persevering.', releaseId: '0x01', commitment: '0x02', ...over });

describe('retrievePassages', () => {
  it('says it cannot look when no index is bound — not "nothing found"', async () => {
    const r = await retrievePassages({}, { query: 'grief' });
    expect(r.ok).toBe(false);
  });

  it('keeps passages at or above the floor, with their citations', async () => {
    const { env: e } = env([{ id: 'a', score: 0.8, metadata: md() }, { id: 'b', score: SCORE_FLOOR - 0.01, metadata: md({ title: 'far' }) }]);
    const r = await retrievePassages(e, { query: 'grief' });
    expect(r.ok && r.passages.map((p) => p.title)).toEqual(['On grief']);
    expect(r.ok && r.passages[0]!.releaseId).toBe('0x01');
  });

  it('an empty result is the answer — the floor is reported and never lowered', async () => {
    const { env: e } = env([{ id: 'b', score: 0.1, metadata: md() }]);
    const r = await retrievePassages(e, { query: 'grief' });
    expect(r).toMatchObject({ ok: true, passages: [], floor: SCORE_FLOOR });
  });

  it('drops (and counts) a vector embedded by another model instead of scoring it', async () => {
    const { env: e } = env([{ id: 'x', score: 0.99, metadata: md({ model: 'other' }) }]);
    const r = await retrievePassages(e, { query: 'grief' });
    expect(r).toMatchObject({ ok: true, passages: [], dropped: 1 });
  });

  it('clamps topK and embeds declared topics as such', async () => {
    const { env: e, seen } = env([]);
    await retrievePassages(e, { query: 'pay', topK: 99, topics: ['Treasury'] });
    expect(seen.topK).toBe(10);
    expect(seen.text).toEqual([embeddedText('pay', ['Treasury'])]);
    expect(seen.text![0]).toContain('topics: Treasury');
  });
});
