// THE PERFORMANCE READ — spec 437 §5/§6. The infra, cost and performance views over the store's `infra` and `cost`
// samples and the estates' heartbeats: latest per resource with its lag class and `asOf` (I2); cost per day per owner
// with `complete` carried, a later read of the same day superseding the earlier (I1); the provenance half as each
// estate reported it (`EstateHeartbeatV1.performance`); cost per completed run with its two components and their lag
// labels (I6); the Unattributed bucket, SHOWN (I4). `detail: false` is the public read — status, lag, the provenance
// block (aggregate counts, as the heartbeat already is) and the unattributed list; amounts and metrics are the
// operator's (434 §10). Nothing here is a permission.
import { attributeResource, type AttributedOwner, type CostMonthV1, type CostSampleV1, type InfraSampleV1, type LagClass, type PerfReadV1, type TownManifest } from '@ap-town/town-model';
import type { EstateHeartbeatV1 } from '@agenticprimitives/harness/heartbeat';
import type { PulseSampleV1 } from './pulse';
import { SAMPLE_INTERVAL_MS } from './pulse';

export type PerfWindow = '24h' | '7d' | '30d' | '90d';
export const PERF_WINDOWS: PerfWindow[] = ['24h', '7d', '30d', '90d'];
export const windowMsOf = (w: string): number => (w === '90d' ? 90 : w === '30d' ? 30 : w === '7d' ? 7 : 1) * 86_400_000;

/** What the town MCP's store hands back (`GET /infra/read`): a sample filed by kind, with the moment it was taken. */
export interface InfraRowV1 { kind: 'infra' | 'cost' | 'cost-month'; id: string; at: string; ok: boolean; payload: InfraSampleV1 | CostSampleV1 | CostMonthV1; error?: string }

export type PerfViewV1 = PerfReadV1 & { detail: boolean; days: string[]; sources: Array<{ platform: InfraSampleV1['platform']; account: string; ok: boolean; asOf: string | null; lagClass: LagClass | null; error: string | null }> };

const dayOf = (iso: string): string => iso.slice(0, 10);
const lagOfCost = (c: CostSampleV1): LagClass => (c.basis === 'derived' ? 'hourly' : 'daily-restated');

/** The UTC days a window covers, oldest first, ending today. */
export function daysOf(window: PerfWindow, nowMs: number): string[] {
  const n = Math.round(windowMsOf(window) / 86_400_000);
  const today = Math.floor(nowMs / 86_400_000) * 86_400_000;
  return Array.from({ length: n }, (_, i) => dayOf(new Date(today - (n - 1 - i) * 86_400_000).toISOString()));
}

/**
 * The infra, cost and performance view. The heartbeat samples are the town agent's own (`HeartbeatDO`); the infra and
 * cost rows come from the TOWN MCP, which is the only thing that holds a platform credential and the only thing that
 * talks to a provider (spec 437 §4, the owner's rule: the town app does not retrieve this data). An empty `rows` is
 * "the MCP has nothing yet", which the tab says — never zeros.
 */
export function readPerformance(town: TownManifest, samples: PulseSampleV1[], rows: InfraRowV1[], opts: { window: PerfWindow; nowMs: number; detail: boolean }): PerfViewV1 {
  const ms = windowMsOf(opts.window); const from = opts.nowMs - ms; const days = daysOf(opts.window, opts.nowMs); const daySet = new Set(days);
  const stepMs = Math.max(SAMPLE_INTERVAL_MS, Math.round(ms / 96));
  const bucket = (at: string): string => new Date(Math.floor(Date.parse(at) / stepMs) * stepMs).toISOString();

  // ── Infrastructure: latest per resource AND CADENCE (any age — a quiet source still shows its last word) ──
  //
  // Per cadence, because a resource can be read by two passes and the faster one is always the newer row.
  // `infraId` is (platform, account, kind, resource) — no lag class — so an Azure VM's five-minute Resource
  // Health sample and its hourly Monitor metrics share one id, and "newest wins" meant the status row
  // permanently buried the metrics row: three VMs reporting real CPU, and the Performance tab saying "No VM
  // readings (Azure not configured or no VM listed)" (2026-10-13). GraphDB is read by both passes too.
  // One tile per cadence keeps I2 honest — each carries the `asOf` and lag class that are actually ITS OWN,
  // which a merged tile could not do with one label.
  const infra = rows.filter((s) => s.kind === 'infra');
  const cadence = (s: InfraRowV1): string => `${s.id}|${(s.payload as InfraSampleV1).lagClass}`;
  const latestInfra = new Map<string, InfraSampleV1>();
  const latestAt = new Map<string, string>();
  for (const s of infra) { const k = cadence(s); const cur = latestAt.get(k); if (cur === undefined || cur <= s.at) { latestInfra.set(k, s.payload as InfraSampleV1); latestAt.set(k, s.at); } }
  const seriesInfra = new Map<string, Map<string, InfraSampleV1>>();
  for (const s of infra) { if (Date.parse(s.at) < from || !s.ok) continue; const k = cadence(s); const m = seriesInfra.get(k) ?? new Map<string, InfraSampleV1>(); m.set(bucket(s.at), s.payload as InfraSampleV1); seriesInfra.set(k, m); }
  // A DATASET'S FAILURE IS SUPERSEDED BY THE DATASET READING AGAIN. A failed read is filed under a synthetic
  // id (`d1:*`, `ai:*`, `*`) while a successful one writes a row PER RESOURCE, so nothing newer ever lands on
  // the failure's id and it is still "the last word" months later. Three such rows were shouting on the Infra
  // page on 2026-10-13 — "ai: unknown field requests", "d1: unknown field queryBatchTimeMs", "no token for
  // this account" — every one of them fixed days earlier, with the same datasets reading perfectly beside
  // them. A synthetic row is dropped once a LATER successful read exists for its platform, account and kind;
  // a dataset that is genuinely still failing has nothing newer and keeps saying so.
  // Keyed by ACCOUNT, not by account-and-kind: every pass re-files a dataset failure under the same synthetic
  // id, so a failure older than the account's newest sample is one the pass has since stopped making. Keying
  // it by kind left two rows standing on an account with no resources of that kind to supersede them — an
  // "unknown field" from a collector bug fixed days earlier, with nothing able to retire it.
  const newestRead = new Map<string, string>();
  for (const [k, s] of latestInfra) { const g = `${s.platform}|${s.account}`; const at = latestAt.get(k) ?? ''; if (!newestRead.has(g) || newestRead.get(g)! < at) newestRead.set(g, at); }
  const superseded = (k: string, s: InfraSampleV1): boolean =>
    !s.ok && s.resource.endsWith('*') && (newestRead.get(`${s.platform}|${s.account}`) ?? '') > (latestAt.get(k) ?? '');

  const infrastructure: PerfReadV1['infrastructure'] = [...latestInfra.entries()].filter(([k, s]) => (s.resource !== '*' || !s.ok) && !superseded(k, s)).map(([id, s]) => ({
    platform: s.platform, account: s.account, resource: s.resource, kind: s.kind, owner: attributeResource(town, s.platform, s.resource, s.kind),
    latest: opts.detail ? s : { ...s, metrics: {} },
    series: opts.detail ? [...(seriesInfra.get(id)?.entries() ?? [])].sort(([a], [b]) => a.localeCompare(b)).map(([at, x]) => ({ at, metrics: x.metrics })) : [],
  })).sort((a, b) => a.platform.localeCompare(b.platform) || a.account.localeCompare(b.account) || a.resource.localeCompare(b.resource));

  // ── The MONTHS (spec 437 I1): the provider's own history, the baseline a window cannot give. The latest read
  //    of a month supersedes the earlier one — billed figures restate for months as they do for days — and the
  //    running month keeps its `toDate` so no surface compares it with a finished one. Not windowed: a baseline
  //    is the point, and it is a handful of rows.
  const latestMonth = new Map<string, { at: string; m: CostMonthV1 }>();
  for (const s of rows.filter((x) => x.kind === 'cost-month')) { const m = s.payload as CostMonthV1; const cur = latestMonth.get(s.id); if (!cur || cur.at <= s.at) latestMonth.set(s.id, { at: s.at, m }); }
  // THE PART THAT IS THE TOWN'S, computed HERE because attribution is the manifest's and this is where the
  // manifest is. A subscription pays for more than one thing — this one also carries an App Service and a
  // wallet that are nobody's business of the town's — so a month's total is not "what the town cost" and the
  // claimed part is carried beside it rather than left for a surface to re-derive (a surface tried, from the
  // portal's own TownData, which does not carry the declarations: every month read $0.00).
  const months = [...latestMonth.values()].map((x) => x.m).sort((a, b) => a.month.localeCompare(b.month)).map((m) => ({
    ...m,
    claimedMicroUsd: m.byScope.length ? m.byScope.filter((x) => attributeResource(town, m.platform, x.key)).reduce((n, x) => n + x.amountMicroUsd, 0) : null,
  }));

  // ── Cost: the latest read of every (platform, account, day, resource, sku) wins; days in the window only ──
  const latestCost = new Map<string, { at: string; c: CostSampleV1 }>();
  for (const s of rows.filter((x) => x.kind === 'cost')) { const c = s.payload as CostSampleV1; if (!daySet.has(c.day)) continue; const cur = latestCost.get(s.id); if (!cur || cur.at <= s.at) latestCost.set(s.id, { at: s.at, c }); }
  const costRows = [...latestCost.values()].map((x) => x.c);
  const ownerKey = (o: AttributedOwner | null): string => (o ? `${o.kind}:${o.id}` : 'unattributed');
  const costGroups = new Map<string, { platform: CostSampleV1['platform']; account: string; owner: AttributedOwner | null; basis: CostSampleV1['basis']; byDay: Map<string, { amountMicroUsd: number; asOf: string; complete: boolean }> }>();
  for (const c of costRows) {
    const owner = c.resource === '*' ? null : attributeResource(town, c.platform, c.resource);
    const k = `${c.platform}|${c.account}|${ownerKey(owner)}|${c.basis}`;
    const g = costGroups.get(k) ?? { platform: c.platform, account: c.account, owner, basis: c.basis, byDay: new Map() };
    const d = g.byDay.get(c.day) ?? { amountMicroUsd: 0, asOf: c.asOf, complete: true };
    d.amountMicroUsd += c.ok ? c.amountMicroUsd : 0; d.asOf = d.asOf > c.asOf ? d.asOf : c.asOf; d.complete = d.complete && c.complete && c.ok;
    g.byDay.set(c.day, d); costGroups.set(k, g);
  }
  const cost: PerfReadV1['cost'] = [...costGroups.values()].map((g) => ({ platform: g.platform, account: g.account, owner: g.owner, basis: g.basis, days: [...g.byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, d]) => ({ day, ...d })) }));

  // ── Provenance: the estate's own performance block, as reported ──
  const provenance: PerfReadV1['provenance'] = {}; const costPerCompletedRun: PerfReadV1['costPerCompletedRun'] = {};
  for (const e of town.estates) {
    const beats = samples.filter((s) => s.kind === 'estate' && s.id === e.id && s.ok).sort((a, b) => a.at.localeCompare(b.at));
    const latest = beats[beats.length - 1];
    provenance[e.id] = (latest?.payload as EstateHeartbeatV1 | undefined)?.performance ?? null;
    // Each heartbeat counts a trailing 24 h; the last heartbeat of each day stands for that day (adjacent days overlap by the
    // hours before that beat — a bound, said here, not a hidden rounding).
    const lastOfDay = new Map<string, EstateHeartbeatV1>();
    for (const b of beats) if (daySet.has(dayOf(b.at))) lastOfDay.set(dayOf(b.at), b.payload as EstateHeartbeatV1);
    const hbs = [...lastOfDay.values()];
    const completedRuns = hbs.reduce((n, h) => n + h.runs.completed, 0);
    const inferenceKnown = hbs.filter((h) => h.inferenceMicroUsd !== null);
    const inferenceMicroUsd = inferenceKnown.reduce((n, h) => n + (h.inferenceMicroUsd ?? 0), 0);
    const ours = costRows.filter((c) => { const o = c.resource === '*' ? null : attributeResource(town, c.platform, c.resource); return o?.kind === 'estate' && o.id === e.id; });
    // ONE basis, named — never the sum of two (I1). A provider that invoiced nothing because the usage sat inside
    // a plan's allowance still consumed something, so `effective` is preferred over a true but useless $0.00
    // `billed`; our own `derived` estimate is the last resort.
    const nonZero = (b: CostSampleV1['basis']): boolean => ours.some((c) => c.basis === b && c.ok && c.amountMicroUsd > 0);
    const infraBasis: CostSampleV1['basis'] | null = !ours.length ? null : (nonZero('billed') ? 'billed' : nonZero('effective') ? 'effective' : nonZero('derived') ? 'derived' : ours[0]!.basis);
    const mine = infraBasis ? ours.filter((c) => c.basis === infraBasis) : [];
    const infraMicroUsd = mine.length ? mine.reduce((n, c) => n + (c.ok ? c.amountMicroUsd : 0), 0) : null;
    const daysWithCost = new Set(mine.map((c) => c.day));
    const complete = hbs.length === days.length && inferenceKnown.length === hbs.length && mine.length > 0 && mine.every((c) => c.complete && c.ok) && days.filter((d) => d !== days[days.length - 1]).every((d) => daysWithCost.has(d));
    const lag = [...new Set<LagClass>(['5min', ...mine.map(lagOfCost)])];
    const total = completedRuns > 0 && (inferenceKnown.length || infraMicroUsd !== null) ? Math.round((inferenceMicroUsd + (infraMicroUsd ?? 0)) / completedRuns) : null;
    costPerCompletedRun[e.id] = { microUsd: opts.detail ? total : null, inferenceMicroUsd: opts.detail ? inferenceMicroUsd : 0, infraMicroUsd: opts.detail ? infraMicroUsd : null, infraBasis, completedRuns, complete, lag };
  }

  const unattributed: PerfReadV1['unattributed'] = infrastructure.filter((r) => r.owner === null && r.latest?.ok && r.resource !== '*').map((r) => ({ platform: r.platform, account: r.account, resource: r.resource, kind: r.kind }));
  // A source's standing is its MOST RECENT word, not its worst. A source-level failure is written as a single
  // `resource: '*'` row and success writes per-resource rows instead, so nothing ever overwrites that failure —
  // preferring any failure over any success meant a source that had since been configured went on reporting
  // "not configured" until the row aged out of retention (30 d). Seen live 2026-10-10: Cloudflare had just
  // collected 67 readings and still read as unset. Ties go to the failure, so a genuine outage is never hidden
  // by a reading taken in the same instant.
  const sourceMap = new Map<string, PerfViewV1['sources'][number]>();
  const seenAt = new Map<string, string>();
  for (const [id, s] of latestInfra.entries()) {
    const k = `${s.platform}|${s.account}`;
    const at = latestAt.get(id) ?? s.asOf ?? '';
    const cur = sourceMap.get(k); const curAt = seenAt.get(k) ?? '';
    const row = { platform: s.platform, account: s.account, ok: s.ok, asOf: s.asOf, lagClass: s.lagClass, error: s.error ?? null };
    if (!cur || at > curAt || (at === curAt && !s.ok)) { sourceMap.set(k, row); seenAt.set(k, at); }
  }
  const complete = [...latestInfra.values()].every((s) => s.ok) && costRows.every((c) => c.complete && c.ok);
  return { window: { from: new Date(from).toISOString(), to: new Date(opts.nowMs).toISOString() }, infrastructure, cost: opts.detail ? cost : [], months: opts.detail ? months : [], provenance, costPerCompletedRun, unattributed, complete, detail: opts.detail, days, sources: [...sourceMap.values()] };
}

/** The operator's read: the one town ops token, compared in constant time; unset ⇒ nobody has detail. */
export function operatorAuthorized(token: string | undefined, authorization: string | null): boolean {
  if (!token) return false;
  const given = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (given.length !== token.length) return false;
  let diff = 0; for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
