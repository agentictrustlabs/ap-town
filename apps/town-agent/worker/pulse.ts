// THE PULSE — spec 434 §10 / spec 436 §5.3. Every five minutes the town SAMPLES what it can read without holding
// anyone's record: each listed service's probe, the chain gateway's ops summary, the model gateway's ops summary, the
// town of names in counts per root, and each estate's heartbeat (counts over a token-gated endpoint; never a name). Samples go into `HeartbeatDO` (SQL, 30
// days, pruned by alarm) — a SERVING PLANE: wiping it loses trend lines, never a record. `/api/pulse` serves the latest
// sample per kind and the series for a window. Pulled, aggregate, historical; the town never pushes into an estate.
import { laneBindingFor, type TownManifest } from '@ap-town/town-model';
import { validateEstateHeartbeat, heartbeatIsStale, type EstateHeartbeatV1 } from '@agenticprimitives/harness/heartbeat';
import type { Probe } from './signals';

export const SAMPLE_INTERVAL_MS = 5 * 60_000;
export const RETENTION_MS = 30 * 86_400_000;
/** Spec 437 I1 — cost rows keep 400 days (one row per source per day, the latest read superseding). */
export const COST_RETENTION_MS = 400 * 86_400_000;

/** Spec 437 adds `infra` (an `InfraSampleV1` per platform resource) and `cost` (a `CostSampleV1` per source per day). The
 *  performance block rides on the estate heartbeat (`payload.performance`) — a separate kind would be a copy. */
export type PulseKind = 'service' | 'chain' | 'inference' | 'estate' | 'infra' | 'cost' | 'names';
export interface PulseSampleV1 { kind: PulseKind; id: string; at: string; ok: boolean; payload: unknown; error?: string }

export interface PulseServiceSample { status: number | null; up: boolean; ms: number }
/**
 * THE TOWN OF NAMES, SAMPLED (spec 430). The naming service is probed like every other service — up or down —
 * and that is all the Pulse used to keep of it, so "how many people are named here?" was a question the town
 * could answer live and could not answer from a record. This is the answer in counts: one row per root, the
 * ending, what it names and how many names are under it. No name and no owner: a count, never a person.
 */
export interface PulseNamesSample { chainId: number | null; block: number | null; total: number; roots: Array<{ tld: string; kind: string | null; names: string | null; count: number }> }

/** The naming service's own town summary, as much of it as the Pulse keeps. */
export function namesSampleOf(data: unknown): PulseNamesSample {
  const d = (data ?? {}) as { chainId?: unknown; block?: unknown; roots?: unknown };
  const roots = (Array.isArray(d.roots) ? d.roots : []).map((r) => {
    const x = (r ?? {}) as { tld?: unknown; kind?: unknown; names?: unknown; count?: unknown };
    return {
      tld: String(x.tld ?? ''),
      kind: typeof x.kind === 'string' ? x.kind : null,
      names: typeof x.names === 'string' ? x.names : null,
      count: typeof x.count === 'number' && Number.isFinite(x.count) ? x.count : 0,
    };
  }).filter((r) => r.tld);
  return {
    chainId: typeof d.chainId === 'number' ? d.chainId : null,
    block: typeof d.block === 'number' ? d.block : null,
    total: roots.reduce((n, r) => n + r.count, 0),
    roots,
  };
}
export interface PulseReadV1 {
  town: string;
  sampledAt: string | null;
  window: { from: string; to: string; stepMs: number };
  services: Record<string, { latest: PulseSampleV1 | null; series: Array<{ at: string; up: boolean | null }> }>;
  chain: { latest: PulseSampleV1 | null; series: Array<{ at: string; requests: number; denied: number; upstreamErrors: number; p95Ms: number | null }> };
  inference: { latest: PulseSampleV1 | null; series: Array<{ at: string; requests: number; costMicroUsd: number; fallbacks: number; failed: number }> };
  estates: Record<string, { latest: PulseSampleV1 | null; stale: boolean; series: Array<{ at: string; runsCompleted: number; runsFailed: number; runsParked: number; modelCalls: number; vaultCalls: number; askP95Ms: number | null }> }>;
  names: { latest: PulseSampleV1 | null; series: Array<{ at: string; total: number }> };
}

export interface PulseEnv {
  CHAIN?: { fetch(req: Request): Promise<Response> };
  INFERENCE?: { fetch(req: Request): Promise<Response> };
  /** The naming service, for the town of names in counts. Public and keyless — the same read the portal does. */
  NAMING?: { fetch(req: Request): Promise<Response> };
  TOWN_OPS_TOKEN?: string;
  /** JSON `estate id → token`; an estate without one is sampled as "unreadable", never as zeros. */
  ESTATE_HEARTBEAT_TOKENS?: string;
  /** Set by `pnpm gen:town` from the manifest's lanes: `<host>=<binding>,…` (see laneBindingFor). */
  LANE_ROUTES?: string;
  HEARTBEAT?: DurableObjectNamespace;
}

const now = (): string => new Date().toISOString();

async function readJson<T>(svc: { fetch(req: Request): Promise<Response> } | undefined, url: string, token?: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  if (!svc) return { ok: false, error: 'not bound on this deployment' };
  try {
    const r = await svc.fetch(new Request(url, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(15_000) }));
    if (!r.ok) return { ok: false, error: `answered ${r.status}` };
    return { ok: true, data: (await r.json()) as T };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** One sampling pass. Returns the samples it took (for the store and for tests); nothing here guesses a missing source. */
export async function samplePulse(town: TownManifest, env: PulseEnv, probe: Probe, fetchImpl: typeof fetch = fetch, selfHost: string | null = null): Promise<PulseSampleV1[]> {
  const at = now();
  const out: PulseSampleV1[] = [];
  // A Worker cannot fetch its own host (CF-1042): the town agent's own probe is the hourly CI check's, not the sampler's.
  await Promise.all(town.services.filter((s) => s.probe && !(selfHost && new URL(s.probe).host === selfHost)).map(async (s) => {
    const t0 = Date.now();
    const r = await probe(s.probe!);
    const ms = Date.now() - t0;
    const payload: PulseServiceSample = 'status' in r ? { status: r.status, up: r.status >= 200 && r.status < 400, ms } : { status: null, up: false, ms };
    out.push({ kind: 'service', id: s.id, at, ok: payload.up, payload, ...('error' in r ? { error: r.error } : {}) });
  }));
  const chain = await readJson<unknown>(env.CHAIN, 'https://chain/ops/summary?window=24h', env.TOWN_OPS_TOKEN);
  out.push({ kind: 'chain', id: 'chain-gateway', at, ok: chain.ok, payload: chain.ok ? chain.data : null, ...(chain.ok ? {} : { error: chain.error }) });
  const inf = await readJson<unknown>(env.INFERENCE, 'https://inference/v1/ops/summary?window=24h', env.TOWN_OPS_TOKEN);
  out.push({ kind: 'inference', id: 'inference', at, ok: inf.ok, payload: inf.ok ? inf.data : null, ...(inf.ok ? {} : { error: inf.error }) });
  // The town of names, in counts (spec 430). Keyless: `/api/town` is the naming service's own public summary.
  const names = await readJson<unknown>(env.NAMING, 'https://naming/api/town');
  out.push({ kind: 'names', id: 'naming', at, ok: names.ok, payload: names.ok ? namesSampleOf(names.data) : null, ...(names.ok ? {} : { error: names.error }) });
  const tokens = (() => { try { return JSON.parse(env.ESTATE_HEARTBEAT_TOKENS ?? '{}') as Record<string, string>; } catch { return {}; } })();
  await Promise.all(town.estates.map(async (e) => {
    const token = tokens[e.id];
    if (!token) { out.push({ kind: 'estate', id: e.id, at, ok: false, payload: null, error: 'no heartbeat token for this estate' }); return; }
    try {
      // An estate with no zone of its own answers on a workers.dev host, which a same-account Worker cannot
      // fetch (the request returns 404 — indistinguishable from "that endpoint is gone", which is how imbnet
      // first read as down while it was serving). The manifest declares such a host as a public LANE and
      // `pnpm gen:town` binds it; reach goes through the binding, authority still through the estate's door.
      const url = `${e.a2a.replace(/\/$/, '')}/ops/heartbeat`;
      const req = new Request(url, { headers: { accept: 'application/json', authorization: `Bearer ${token}`, 'user-agent': 'ap-town-agent' }, signal: AbortSignal.timeout(15_000) });
      const lane = laneBindingFor(env, new URL(url).hostname);
      const r = lane ? await lane.fetch(req) : await fetchImpl(req);
      if (!r.ok) { out.push({ kind: 'estate', id: e.id, at, ok: false, payload: null, error: `answered ${r.status}` }); return; }
      const v = validateEstateHeartbeat(await r.json());
      out.push(v.ok ? { kind: 'estate', id: e.id, at, ok: true, payload: v.heartbeat } : { kind: 'estate', id: e.id, at, ok: false, payload: null, error: `unreadable heartbeat: ${v.errors.join('; ')}` });
    } catch (err) { out.push({ kind: 'estate', id: e.id, at, ok: false, payload: null, error: (err as Error).message }); }
  }));
  return out;
}

// ── The read: latest per kind/id + a series per window, from the stored samples ────────────────────────────────────

const windowMs = (w: string): number => (w === '30d' ? 30 * 86_400_000 : w === '7d' ? 7 * 86_400_000 : 86_400_000);
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export function readPulse(town: TownManifest, samples: PulseSampleV1[], window: string, nowMs = Date.now()): PulseReadV1 {
  const ms = windowMs(window);
  const from = nowMs - ms;
  const stepMs = Math.max(SAMPLE_INTERVAL_MS, Math.round(ms / 96));
  const inWin = samples.filter((s) => Date.parse(s.at) >= from).sort((a, b) => a.at.localeCompare(b.at));
  const latestOf = (kind: PulseKind, id: string): PulseSampleV1 | null => { const xs = samples.filter((s) => s.kind === kind && s.id === id); return xs.length ? xs[xs.length - 1]! : null; };
  const bucket = (at: string): string => new Date(Math.floor(Date.parse(at) / stepMs) * stepMs).toISOString();
  const byBucket = <T,>(xs: PulseSampleV1[], fold: (bucketSamples: PulseSampleV1[], at: string) => T): T[] => {
    const m = new Map<string, PulseSampleV1[]>();
    for (const s of xs) { const b = bucket(s.at); m.set(b, [...(m.get(b) ?? []), s]); }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([at, bs]) => fold(bs, at));
  };
  const services: PulseReadV1['services'] = {};
  for (const s of town.services) {
    const xs = inWin.filter((x) => x.kind === 'service' && x.id === s.id);
    services[s.id] = { latest: latestOf('service', s.id), series: byBucket(xs, (bs, at) => ({ at, up: bs.length ? bs.every((b) => b.ok) : null })) };
  }
  const chainXs = inWin.filter((x) => x.kind === 'chain' && x.ok);
  const chain = { latest: latestOf('chain', 'chain-gateway'), series: byBucket(chainXs, (bs, at) => { const p = bs[bs.length - 1]!.payload as { totals?: { requests?: number; denied?: Record<string, number>; upstreamErrors?: number }; latency?: { upstreamP95Ms?: number } }; const d = p.totals?.denied ?? {}; return { at, requests: num(p.totals?.requests), denied: Object.values(d).reduce((a, b) => a + num(b), 0), upstreamErrors: num(p.totals?.upstreamErrors), p95Ms: p.latency?.upstreamP95Ms ?? null }; }) };
  const infXs = inWin.filter((x) => x.kind === 'inference' && x.ok);
  const inference = { latest: latestOf('inference', 'inference'), series: byBucket(infXs, (bs, at) => { const p = bs[bs.length - 1]!.payload as { totals?: { requests?: number; costMicroUsd?: number; fallbacks?: number; failed?: number } }; return { at, requests: num(p.totals?.requests), costMicroUsd: num(p.totals?.costMicroUsd), fallbacks: num(p.totals?.fallbacks), failed: num(p.totals?.failed) }; }) };
  const estates: PulseReadV1['estates'] = {};
  for (const e of town.estates) {
    const xs = inWin.filter((x) => x.kind === 'estate' && x.id === e.id && x.ok);
    const latest = latestOf('estate', e.id);
    const hb = latest?.ok ? (latest.payload as EstateHeartbeatV1) : null;
    estates[e.id] = { latest, stale: !hb || heartbeatIsStale(hb, nowMs, SAMPLE_INTERVAL_MS), series: byBucket(xs, (bs, at) => { const h = bs[bs.length - 1]!.payload as EstateHeartbeatV1; return { at, runsCompleted: h.runs.completed, runsFailed: h.runs.failed, runsParked: h.runs.parked, modelCalls: h.modelCalls, vaultCalls: h.vaultCalls, askP95Ms: h.askLatencyP95Ms }; }) };
  }
  const nameXs = inWin.filter((x) => x.kind === 'names' && x.ok);
  const names = { latest: latestOf('names', 'naming'), series: byBucket(nameXs, (bs, at) => ({ at, total: num((bs[bs.length - 1]!.payload as PulseNamesSample | null)?.total) })) };
  const last = samples.length ? samples.reduce((a, b) => (a.at > b.at ? a : b)).at : null;
  return { town: town.town, sampledAt: last, window: { from: new Date(from).toISOString(), to: new Date(nowMs).toISOString(), stepMs }, services, chain, inference, estates, names };
}

// ── The store ──────────────────────────────────────────────────────────────────────────────────────────────────────

export class HeartbeatDO {
  private readonly sql: SqlStorage;
  constructor(private readonly state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS samples (kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS samples_at ON samples(at); CREATE INDEX IF NOT EXISTS samples_kind_id_at ON samples(kind, id, at);`);
    // Spec 437: a store created before cost rows gains the `day` column in place ("duplicate column" = it has one).
    try { this.sql.exec('ALTER TABLE samples ADD COLUMN day TEXT'); } catch (e) { if (!/duplicate column/i.test(e instanceof Error ? e.message : String(e))) throw e; }
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/put') {
      const samples = (await req.json()) as PulseSampleV1[];
      for (const s of samples) this.sql.exec('INSERT INTO samples (kind, id, at, ok, json, day) VALUES (?, ?, ?, ?, ?, ?)', s.kind, s.id, Date.parse(s.at), s.ok ? 1 : 0, JSON.stringify(s), s.kind === 'cost' ? String((s.payload as { day?: string })?.day ?? '') : null);
      if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + 60 * 60_000);
      return Response.json({ ok: true, stored: samples.length });
    }
    if (url.pathname === '/read') {
      const from = Number(url.searchParams.get('from') ?? Date.now() - 86_400_000);
      const to = Number(url.searchParams.get('to') ?? Number.MAX_SAFE_INTEGER);
      const kind = url.searchParams.get('kind');
      // One kind in a range (the cost pass reading yesterday's infra rows): rows only, no ride-along.
      if (kind) return Response.json(this.sql.exec<{ json: string }>('SELECT json FROM samples WHERE kind = ? AND at >= ? AND at <= ? ORDER BY at', kind, from, to).toArray().map((r) => JSON.parse(r.json) as PulseSampleV1));
      const rows = this.sql.exec<{ json: string }>('SELECT json FROM samples WHERE at >= ? ORDER BY at', from).toArray();
      // The latest of every (kind, id) rides along even when older than the window, so a quiet estate still shows its last word.
      const latest = this.sql.exec<{ json: string }>('SELECT json FROM samples s WHERE at = (SELECT MAX(at) FROM samples WHERE kind = s.kind AND id = s.id)').toArray();
      const seen = new Set<string>();
      const all = [...rows, ...latest].map((r) => JSON.parse(r.json) as PulseSampleV1).filter((s) => { const k = `${s.kind}|${s.id}|${s.at}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return Response.json(all);
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  async alarm(): Promise<void> {
    this.sql.exec("DELETE FROM samples WHERE kind != 'cost' AND at < ?", Date.now() - RETENTION_MS);
    this.sql.exec("DELETE FROM samples WHERE kind = 'cost' AND at < ?", Date.now() - COST_RETENTION_MS);
    await this.state.storage.setAlarm(Date.now() + 60 * 60_000);
  }
}
