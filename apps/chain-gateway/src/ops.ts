// THE CHAIN GATEWAY'S OPS ROLLUP — spec 436 §6, pure. Every request through the gateway is one `Sample`: who (the
// token's app, its estate and kind), what (the method, or `batch`), how it went (served from cache, forwarded, denied —
// and why), how long the upstream took. Samples are folded into per-minute rows (one per app × method) so a 30-day
// window is a few thousand rows, never a log; percentiles come from fixed latency buckets so a row stays a row. The
// Durable Object keeps the rows; this file is what it and the tests both run.

export type DeniedReason = 'rateLimited' | 'disallowedMethod' | 'badToken' | 'batchShape';
export interface Sample {
  minute: number;
  app: string;
  estate: string | null;
  kind: string;
  method: string;
  kind2: 'read' | 'write' | 'mixed';
  outcome: 'cacheHit' | 'forwarded' | 'denied' | 'upstreamError';
  denied?: DeniedReason;
  upstreamMs?: number;
  gasCapInjected?: number;
}

/** Latency buckets (ms, upper bounds); the last is open-ended. A percentile is the bucket's upper bound it lands in. */
export const BUCKETS = [25, 50, 100, 200, 400, 800, 1600, 3200, 6400, Infinity] as const;
export const bucketOf = (ms: number): number => BUCKETS.findIndex((b) => ms <= b);

export interface MinuteRow {
  minute: number; app: string; estate: string | null; kind: string; method: string;
  requests: number; reads: number; writes: number;
  deniedRateLimited: number; deniedDisallowedMethod: number; deniedBadToken: number; deniedBatchShape: number;
  cacheHits: number; cacheMisses: number; upstreamErrors: number; gasCapInjected: number;
  latencyBuckets: number[];
}
export const emptyRow = (s: Pick<Sample, 'minute' | 'app' | 'estate' | 'kind' | 'method'>): MinuteRow => ({ minute: s.minute, app: s.app, estate: s.estate, kind: s.kind, method: s.method, requests: 0, reads: 0, writes: 0, deniedRateLimited: 0, deniedDisallowedMethod: 0, deniedBadToken: 0, deniedBatchShape: 0, cacheHits: 0, cacheMisses: 0, upstreamErrors: 0, gasCapInjected: 0, latencyBuckets: BUCKETS.map(() => 0) });

export function fold(row: MinuteRow, s: Sample): MinuteRow {
  const r = { ...row, latencyBuckets: [...row.latencyBuckets] };
  r.requests += 1;
  if (s.kind2 === 'read') r.reads += 1; else if (s.kind2 === 'write') r.writes += 1; else { r.reads += 1; r.writes += 1; }
  if (s.outcome === 'denied') {
    if (s.denied === 'rateLimited') r.deniedRateLimited += 1; else if (s.denied === 'disallowedMethod') r.deniedDisallowedMethod += 1; else if (s.denied === 'badToken') r.deniedBadToken += 1; else r.deniedBatchShape += 1;
  }
  if (s.outcome === 'cacheHit') r.cacheHits += 1;
  if (s.outcome === 'forwarded' || s.outcome === 'upstreamError') r.cacheMisses += 1;
  if (s.outcome === 'upstreamError') r.upstreamErrors += 1;
  r.gasCapInjected += s.gasCapInjected ?? 0;
  if (typeof s.upstreamMs === 'number') r.latencyBuckets[bucketOf(s.upstreamMs)]! += 1;
  return r;
}

const percentileOf = (buckets: number[], p: number): number => {
  const total = buckets.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let acc = 0;
  for (let i = 0; i < buckets.length; i++) { acc += buckets[i]!; if (acc / total >= p / 100) return Number.isFinite(BUCKETS[i]) ? (BUCKETS[i] as number) : 6400; }
  return 6400;
};
const sumBuckets = (rows: MinuteRow[]): number[] => rows.reduce((acc, r) => acc.map((v, i) => v + (r.latencyBuckets[i] ?? 0)), BUCKETS.map(() => 0));

export interface ChainGatewayOpsSummaryV1 {
  window: { from: string; to: string };
  totals: { requests: number; reads: number; writes: number; denied: { rateLimited: number; disallowedMethod: number; badToken: number; batchShape: number }; cacheHits: number; cacheMisses: number; cacheHitRate: number; upstreamErrors: number; gasCapInjected: number };
  latency: { upstreamP50Ms: number; upstreamP95Ms: number };
  byToken: Array<{ app: string; estate: string | null; kind: string; requests: number; reads: number; writes: number; denied: number; upstreamErrors: number; p95Ms: number; limits?: { readRps: number; writeRps: number } }>;
  byEstate: Array<{ estate: string; requests: number; reads: number; writes: number; denied: number }>;
  byMethod: Array<{ method: string; count: number; cacheHitRate: number; p95Ms: number }>;
  chain: { head: number | null; headAt: string | null; blockRateS: number | null; generation: string; nodeHealthy: boolean };
  series: Array<{ at: string; requests: number; reads: number; writes: number; denied: number; upstreamErrors: number }>;
}

const sum = (rows: MinuteRow[], f: (r: MinuteRow) => number): number => rows.reduce((n, r) => n + f(r), 0);
const denied = (r: MinuteRow): number => r.deniedRateLimited + r.deniedDisallowedMethod + r.deniedBadToken + r.deniedBatchShape;
const groupBy = <K extends string>(rows: MinuteRow[], key: (r: MinuteRow) => K): Map<K, MinuteRow[]> => { const m = new Map<K, MinuteRow[]>(); for (const r of rows) { const k = key(r); m.set(k, [...(m.get(k) ?? []), r]); } return m; };

export function summarize(rows: MinuteRow[], input: { from: number; to: number; limits?: Record<string, { readRps: number; writeRps: number }>; head?: { head: number; at: number; prev?: { head: number; at: number } } | null; generation: string; now: number; seriesStepMinutes?: number }): ChainGatewayOpsSummaryV1 {
  const inWin = rows.filter((r) => r.minute * 60_000 >= input.from && r.minute * 60_000 <= input.to);
  const all = sumBuckets(inWin);
  const hits = sum(inWin, (r) => r.cacheHits), misses = sum(inWin, (r) => r.cacheMisses);
  const step = input.seriesStepMinutes ?? Math.max(1, Math.round((input.to - input.from) / 60_000 / 96));
  const series = [...groupBy(inWin, (r) => String(Math.floor(r.minute / step) * step)).entries()].map(([m, rs]) => ({ at: new Date(Number(m) * 60_000).toISOString(), requests: sum(rs, (r) => r.requests), reads: sum(rs, (r) => r.reads), writes: sum(rs, (r) => r.writes), denied: sum(rs, denied), upstreamErrors: sum(rs, (r) => r.upstreamErrors) })).sort((a, b) => a.at.localeCompare(b.at));
  const headHealthy = !!input.head && input.now - input.head.at < 2 * 60_000 + 30_000;
  const blockRate = input.head?.prev && input.head.head > input.head.prev.head && input.head.at > input.head.prev.at ? (input.head.at - input.head.prev.at) / 1000 / (input.head.head - input.head.prev.head) : null;
  return {
    window: { from: new Date(input.from).toISOString(), to: new Date(input.to).toISOString() },
    totals: { requests: sum(inWin, (r) => r.requests), reads: sum(inWin, (r) => r.reads), writes: sum(inWin, (r) => r.writes), denied: { rateLimited: sum(inWin, (r) => r.deniedRateLimited), disallowedMethod: sum(inWin, (r) => r.deniedDisallowedMethod), badToken: sum(inWin, (r) => r.deniedBadToken), batchShape: sum(inWin, (r) => r.deniedBatchShape) }, cacheHits: hits, cacheMisses: misses, cacheHitRate: hits + misses ? hits / (hits + misses) : 0, upstreamErrors: sum(inWin, (r) => r.upstreamErrors), gasCapInjected: sum(inWin, (r) => r.gasCapInjected) },
    latency: { upstreamP50Ms: percentileOf(all, 50), upstreamP95Ms: percentileOf(all, 95) },
    byToken: [...groupBy(inWin, (r) => r.app).entries()].map(([app, rs]) => ({ app, estate: rs[0]?.estate ?? null, kind: rs[0]?.kind ?? 'application', requests: sum(rs, (r) => r.requests), reads: sum(rs, (r) => r.reads), writes: sum(rs, (r) => r.writes), denied: sum(rs, denied), upstreamErrors: sum(rs, (r) => r.upstreamErrors), p95Ms: percentileOf(sumBuckets(rs), 95), ...(input.limits?.[app] ? { limits: input.limits[app]! } : {}) })).sort((a, b) => b.requests - a.requests),
    byEstate: [...groupBy(inWin.filter((r) => r.estate), (r) => r.estate as string).entries()].map(([estate, rs]) => ({ estate, requests: sum(rs, (r) => r.requests), reads: sum(rs, (r) => r.reads), writes: sum(rs, (r) => r.writes), denied: sum(rs, denied) })).sort((a, b) => b.requests - a.requests),
    byMethod: [...groupBy(inWin, (r) => r.method).entries()].map(([method, rs]) => { const h = sum(rs, (r) => r.cacheHits), m = sum(rs, (r) => r.cacheMisses); return { method, count: sum(rs, (r) => r.requests), cacheHitRate: h + m ? h / (h + m) : 0, p95Ms: percentileOf(sumBuckets(rs), 95) }; }).sort((a, b) => b.count - a.count).slice(0, 20),
    chain: { head: input.head?.head ?? null, headAt: input.head ? new Date(input.head.at).toISOString() : null, blockRateS: blockRate, generation: input.generation, nodeHealthy: headHealthy },
    series,
  };
}
