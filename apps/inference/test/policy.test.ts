import { describe, it, expect } from 'vitest';
import { seededPolicy, sha256Hex } from '../src/policy-store.js';
import { mergeSummaries } from '../src/index.js';
import type { InferenceOpsSummaryV1 } from '@agenticprimitives/model-gateway';

describe('seeds', () => {
  it('every seeded profile and catalog entry validates, and every profile candidate is in the catalog', () => {
    const s = seededPolicy();
    expect(s.errors).toEqual([]);
    expect(s.profiles.map((p) => p.id)).toContain('planner-fast');
    const keys = new Set(s.catalog.map((c) => `${c.provider}/${c.model}`));
    for (const p of s.profiles) for (const m of p.models) expect(keys.has(`${m.provider}/${m.model}`), `${p.id} names ${m.provider}/${m.model}`).toBe(true);
  });
  it('private-analysis names no-retention candidates only and no fallback', () => {
    const p = seededPolicy().profiles.find((x) => x.id === 'private-analysis')!;
    expect(p.privacy).toBe('no-retention');
    expect(p.fallbackOn).toEqual([]);
  });
  it('sha256Hex is stable', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('mergeSummaries', () => {
  const slice = (key: string, requests: number) => ({ key, requests, answered: requests, failed: 0, refused: 0, tokensIn: 10 * requests, tokensOut: requests, costMicroUsd: 5 * requests, fallbacks: 0, latencyP50Ms: 100, latencyP95Ms: 200 });
  const part = (principal: string, estate: string, n: number): InferenceOpsSummaryV1 => ({ window: { from: 'a', to: 'b' }, totals: slice('total', n), byClient: [slice(principal, n)], byProfile: [slice('planner-fast', n)], byProvider: [slice('anthropic', n)], byModel: [slice('anthropic/haiku', n)], byEstate: [slice(estate, n)], pendingReconciliation: 0 });
  it('adds across principals and narrows by estate', () => {
    const all = mergeSummaries([part('0xa', 'faithnet', 2), part('0xb', 'richcanvas', 3)], { from: 'a', to: 'b' }, null);
    expect(all.totals.requests).toBe(5);
    expect(all.byProfile[0]).toMatchObject({ key: 'planner-fast', requests: 5 });
    const one = mergeSummaries([part('0xa', 'faithnet', 2), part('0xb', 'richcanvas', 3)], { from: 'a', to: 'b' }, 'richcanvas');
    expect(one.totals.requests).toBe(3);
    expect(one.byEstate).toEqual([slice('richcanvas', 3)]);
  });
});
