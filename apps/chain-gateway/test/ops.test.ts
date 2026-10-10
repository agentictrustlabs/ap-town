import { describe, it, expect } from 'vitest';
import { emptyRow, fold, summarize, bucketOf, type Sample, type MinuteRow } from '../src/ops';

const base = (patch: Partial<Sample>): Sample => ({ minute: 1000, app: 'runtime', estate: 'faithnet', kind: 'estate-app', method: 'eth_call', kind2: 'read', outcome: 'forwarded', upstreamMs: 120, ...patch });
const rowsOf = (samples: Sample[]): MinuteRow[] => {
  const m = new Map<string, MinuteRow>();
  for (const s of samples) { const k = `${s.minute}|${s.app}|${s.method}`; m.set(k, fold(m.get(k) ?? emptyRow(s), s)); }
  return [...m.values()];
};

describe('ops rollup', () => {
  it('folds samples into per-minute rows: reads/writes, denials by reason, cache, upstream errors, latency buckets', () => {
    const rows = rowsOf([
      base({}), base({ outcome: 'cacheHit', upstreamMs: undefined }), base({ outcome: 'denied', denied: 'rateLimited', upstreamMs: undefined }),
      base({ method: 'eth_sendRawTransaction', kind2: 'write', upstreamMs: 900 }), base({ outcome: 'upstreamError', upstreamMs: 3000 }),
    ]);
    const call = rows.find((r) => r.method === 'eth_call')!;
    expect(call.requests).toBe(4); expect(call.reads).toBe(4); expect(call.cacheHits).toBe(1); expect(call.cacheMisses).toBe(2); expect(call.upstreamErrors).toBe(1); expect(call.deniedRateLimited).toBe(1);
    expect(call.latencyBuckets[bucketOf(120)]).toBe(1);
    expect(call.latencyBuckets[bucketOf(3000)]).toBe(1);
    expect(rows.find((r) => r.method === 'eth_sendRawTransaction')?.writes).toBe(1);
  });
  it('summarizes totals, percentiles from buckets, by token / estate / method, the head and the block rate', () => {
    const now = 1000 * 60_000 + 30_000;
    const rows = rowsOf([base({}), base({ upstreamMs: 40 }), base({ upstreamMs: 1500, app: 'explorer', estate: null, kind: 'application' }), base({ outcome: 'denied', denied: 'badToken', app: '(unknown token)', estate: null })]);
    const s = summarize(rows, { from: 999 * 60_000, to: now, limits: { runtime: { readRps: 20, writeRps: 2 } }, head: { head: 5000, at: now - 1000, prev: { head: 4990, at: now - 21_000 } }, generation: '1', now });
    expect(s.totals.requests).toBe(4);
    expect(s.totals.denied.badToken).toBe(1);
    expect(s.latency.upstreamP50Ms).toBe(200);
    expect(s.latency.upstreamP95Ms).toBe(1600);
    expect(s.byToken[0]).toMatchObject({ app: 'runtime', estate: 'faithnet', requests: 2, limits: { readRps: 20, writeRps: 2 } });
    expect(s.byEstate).toEqual([{ estate: 'faithnet', requests: 2, reads: 2, writes: 0, denied: 0 }]);
    expect(s.byMethod[0]).toMatchObject({ method: 'eth_call', count: 4 });
    expect(s.chain).toMatchObject({ head: 5000, blockRateS: 2, generation: '1', nodeHealthy: true });
    expect(s.series).toHaveLength(1);
  });
  it('a stale head reads as an unhealthy node; an empty window has zero percentiles', () => {
    const now = 2000 * 60_000;
    const s = summarize([], { from: now - 60_000, to: now, head: { head: 1, at: now - 10 * 60_000 }, generation: '1', now });
    expect(s.chain.nodeHealthy).toBe(false);
    expect(s.latency.upstreamP95Ms).toBe(0);
    expect(s.totals.cacheHitRate).toBe(0);
  });
});
