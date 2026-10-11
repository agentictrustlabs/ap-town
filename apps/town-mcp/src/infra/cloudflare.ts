// CLOUDFLARE — spec 437 §4. One GraphQL Analytics read PER DATASET per account per hour (Workers, Durable Objects, D1, KV,
// Queues, Workers AI, Pages Functions), so a dataset whose field names drift is unreadable ALONE and says so, while the
// others still read (I3). A daily storage read (D1 size, DO stored bytes, KV bytes). Cost is DERIVED — the day's meters
// times `pricing.json` — and labelled so (I2); Cloudflare publishes no live billing API. Minutes of lag: `hourly`.
// Field names are those of the Analytics schema as read on 2026-10-10; the P4 live gate is where they are proven.
import type { CostSampleV1, InfraResourceKind, InfraSampleV1, PricingV1 } from '@ap-town/town-model';
import { type FetchLike, failedInfra, infraSample, num, readJson, statusFromErrors } from './common';

export interface CloudflareAccountCfg { id: string; label: string; token: string }
export const CF_GRAPHQL = 'https://api.cloudflare.com/client/v4/graphql';

interface Dataset { key: string; kind: InfraResourceKind; field: string; select: string; map: (row: Row) => { resource: string; metrics: Record<string, number | null>; status?: InfraSampleV1['status'] } }
type Row = { dimensions?: Record<string, unknown>; sum?: Record<string, unknown>; quantiles?: Record<string, unknown>; max?: Record<string, unknown>; count?: unknown };
const dim = (r: Row, k: string): string => String(r.dimensions?.[k] ?? '?');
const sum = (r: Row, k: string): number | null => num(r.sum?.[k]);
const q = (r: Row, k: string): number | null => num(r.quantiles?.[k]);
/** The group's own row count. Some datasets (Workers AI) have no `requests` meter and count rows instead. */
const count = (r: Row): number | null => num(r.count);
const us2ms = (x: number | null): number | null => (x === null ? null : x / 1000);

export const HOURLY_DATASETS: Dataset[] = [
  { key: 'workers', kind: 'worker', field: 'workersInvocationsAdaptive', select: 'dimensions { scriptName } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 wallTimeP50 wallTimeP99 }',
    map: (r) => ({ resource: dim(r, 'scriptName'), metrics: { requests: sum(r, 'requests'), errors: sum(r, 'errors'), subrequests: sum(r, 'subrequests'), cpuP50Ms: us2ms(q(r, 'cpuTimeP50')), cpuP99Ms: us2ms(q(r, 'cpuTimeP99')), wallP50Ms: us2ms(q(r, 'wallTimeP50')), wallP99Ms: us2ms(q(r, 'wallTimeP99')) }, status: statusFromErrors(sum(r, 'requests'), sum(r, 'errors')) }) },
  { key: 'durableObjects', kind: 'durable-object', field: 'durableObjectsInvocationsAdaptiveGroups', select: 'dimensions { scriptName } sum { requests errors wallTime } quantiles { wallTimeP50 wallTimeP99 }',
    map: (r) => ({ resource: dim(r, 'scriptName'), metrics: { requests: sum(r, 'requests'), errors: sum(r, 'errors'), wallTimeMs: us2ms(sum(r, 'wallTime')), wallP50Ms: us2ms(q(r, 'wallTimeP50')), wallP99Ms: us2ms(q(r, 'wallTimeP99')) }, status: statusFromErrors(sum(r, 'requests'), sum(r, 'errors')) }) },
  // `queryBatchTimeMs` is a QUANTILE here, never a sum — asking for it under `sum` made the whole D1 dataset
  // unreadable ("unknown field") while every other dataset read fine (I3). Schema re-read live 2026-10-11.
  { key: 'd1', kind: 'd1', field: 'd1AnalyticsAdaptiveGroups', select: 'dimensions { databaseId } sum { readQueries writeQueries rowsRead rowsWritten queryBatchResponseBytes } quantiles { queryBatchTimeMsP50 queryBatchTimeMsP99 }',
    map: (r) => ({ resource: dim(r, 'databaseId'), metrics: { readQueries: sum(r, 'readQueries'), writeQueries: sum(r, 'writeQueries'), rowsRead: sum(r, 'rowsRead'), rowsWritten: sum(r, 'rowsWritten'), responseBytes: sum(r, 'queryBatchResponseBytes'), queryBatchTimeP50Ms: q(r, 'queryBatchTimeMsP50'), queryBatchTimeP99Ms: q(r, 'queryBatchTimeMsP99') } }) },
  { key: 'kv', kind: 'kv', field: 'kvOperationsAdaptiveGroups', select: 'dimensions { namespaceId actionType } sum { requests }',
    map: (r) => { const a = dim(r, 'actionType'); return { resource: dim(r, 'namespaceId'), metrics: { reads: a === 'read' ? sum(r, 'requests') : 0, writes: a === 'read' ? 0 : sum(r, 'requests') } }; } },
  { key: 'queues', kind: 'queue', field: 'queueMessageOperationsAdaptiveGroups', select: 'dimensions { queueId } sum { billableOperations }',
    map: (r) => ({ resource: dim(r, 'queueId'), metrics: { operations: sum(r, 'billableOperations') } }) },
  // Workers AI has no `requests` meter and no `totalTokensIn/Out`: the group's own `count` is the request count and
  // the tokens are `totalInputTokens` / `totalOutputTokens`. Schema re-read live 2026-10-11.
  { key: 'ai', kind: 'workers-ai', field: 'aiInferenceAdaptiveGroups', select: 'dimensions { modelId } count sum { totalInputTokens totalOutputTokens totalNeurons totalInferenceTimeMs }',
    map: (r) => ({ resource: dim(r, 'modelId'), metrics: { requests: count(r), tokensIn: sum(r, 'totalInputTokens'), tokensOut: sum(r, 'totalOutputTokens'), neurons: sum(r, 'totalNeurons'), inferenceTimeMs: sum(r, 'totalInferenceTimeMs') } }) },
  { key: 'pages', kind: 'pages', field: 'pagesFunctionsInvocationsAdaptiveGroups', select: 'dimensions { scriptName } sum { requests errors }',
    map: (r) => ({ resource: dim(r, 'scriptName'), metrics: { requests: sum(r, 'requests'), errors: sum(r, 'errors') }, status: statusFromErrors(sum(r, 'requests'), sum(r, 'errors')) }) },
];
export const STORAGE_DATASETS: Dataset[] = [
  { key: 'd1Storage', kind: 'd1', field: 'd1StorageAdaptiveGroups', select: 'dimensions { databaseId } max { databaseSizeBytes }', map: (r) => ({ resource: dim(r, 'databaseId'), metrics: { storageBytes: num(r.max?.databaseSizeBytes) } }) },
  { key: 'doStorage', kind: 'durable-object', field: 'durableObjectsStorageGroups', select: 'max { storedBytes }', map: (r) => ({ resource: '*', metrics: { storageBytes: num(r.max?.storedBytes) } }) },
  { key: 'kvStorage', kind: 'kv', field: 'kvStorageAdaptiveGroups', select: 'dimensions { namespaceId } max { byteCount keyCount }', map: (r) => ({ resource: dim(r, 'namespaceId'), metrics: { storageBytes: num(r.max?.byteCount), keys: num(r.max?.keyCount) } }) },
];

const queryFor = (d: Dataset, dateFilter: boolean): string => `query ($account: String!, $from: ${dateFilter ? 'Date' : 'Time'}!, $to: ${dateFilter ? 'Date' : 'Time'}!) { viewer { accounts(filter: {accountTag: $account}) { rows: ${d.field}(limit: 5000, filter: {${dateFilter ? 'date_geq: $from, date_leq: $to' : 'datetime_geq: $from, datetime_lt: $to'}}) { ${d.select} } } } }`;

async function readDataset(acct: CloudflareAccountCfg, d: Dataset, vars: { from: string; to: string }, dateFilter: boolean, lagClass: InfraSampleV1['lagClass'], at: string, fetchImpl: FetchLike): Promise<InfraSampleV1[]> {
  const r = await readJson<{ data?: { viewer?: { accounts?: Array<{ rows?: Row[] }> } }; errors?: Array<{ message: string }> }>(fetchImpl, CF_GRAPHQL, { method: 'POST', headers: { authorization: `Bearer ${acct.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ query: queryFor(d, dateFilter), variables: { account: acct.id, ...vars } }) });
  if (!r.ok) return [failedInfra('cloudflare', acct.id, `${d.key}:*`, d.kind, lagClass, `${d.key}: ${r.error}`, at)];
  if (r.data.errors?.length) return [failedInfra('cloudflare', acct.id, `${d.key}:*`, d.kind, lagClass, `${d.key}: ${r.data.errors.map((e) => e.message).join('; ').slice(0, 200)}`, at)];
  const rows = r.data.data?.viewer?.accounts?.[0]?.rows ?? [];
  // KV comes one row per (namespace, action); fold to one sample per namespace.
  const folded = new Map<string, { metrics: Record<string, number | null>; status: InfraSampleV1['status'] }>();
  for (const row of rows) {
    const m = d.map(row);
    const cur = folded.get(m.resource);
    if (!cur) { folded.set(m.resource, { metrics: m.metrics, status: m.status ?? 'up' }); continue; }
    for (const [k, v] of Object.entries(m.metrics)) cur.metrics[k] = v === null && cur.metrics[k] === null ? null : (cur.metrics[k] ?? 0) + (v ?? 0);
  }
  return [...folded.entries()].map(([resource, m]) => infraSample({ platform: 'cloudflare', account: acct.id, resource, kind: d.kind, at, asOf: vars.to, lagClass, status: m.status, metrics: m.metrics }));
}

/** The previous full hour, every dataset, every account. An account's token failing shows as every dataset unreadable for it. */
export async function collectCloudflareHourly(accounts: CloudflareAccountCfg[], window: { from: string; to: string }, fetchImpl: FetchLike, at: string): Promise<InfraSampleV1[]> {
  const out = await Promise.all(accounts.flatMap((a) => HOURLY_DATASETS.map((d) => readDataset(a, d, window, false, 'hourly', at, fetchImpl))));
  return out.flat();
}
/** Storage high-water marks for one day (`YYYY-MM-DD`). */
export async function collectCloudflareStorage(accounts: CloudflareAccountCfg[], day: string, fetchImpl: FetchLike, at: string): Promise<InfraSampleV1[]> {
  const out = await Promise.all(accounts.flatMap((a) => STORAGE_DATASETS.map((d) => readDataset(a, d, { from: day, to: day }, true, 'hourly', at, fetchImpl))));
  return out.flat();
}

// ── Derived cost ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Meter units for one sample: which pricing meters it feeds and by how much. Pages Functions bill as Workers requests. */
function metersOf(s: InfraSampleV1): Array<[string, number]> {
  const m = s.metrics; const v = (k: string): number => m[k] ?? 0;
  switch (s.kind) {
    case 'worker': return [['workers.requests', v('requests')], ['workers.cpuMs', (v('cpuP50Ms') || 0) * v('requests')]];
    case 'pages': return [['workers.requests', v('requests')]];
    case 'durable-object': return s.resource === '*' ? [['do.storageGbMonth', v('storageBytes') / 1e9 / 30]] : [['do.requests', v('requests')], ['do.gbSeconds', (v('wallTimeMs') / 1000) * 0.125]];
    case 'd1': return m.storageBytes !== undefined ? [['d1.storageGbMonth', v('storageBytes') / 1e9 / 30]] : [['d1.rowsRead', v('rowsRead')], ['d1.rowsWritten', v('rowsWritten')]];
    case 'kv': return m.storageBytes !== undefined ? [['kv.storageGbMonth', v('storageBytes') / 1e9 / 30]] : [['kv.reads', v('reads')], ['kv.writes', v('writes')]];
    case 'queue': return [['queues.operations', v('operations')]];
    default: return [];
  }
}

/**
 * One account's day: the day's hourly + storage samples × the published prices. The monthly included allowance is
 * prorated to the day (÷30) and taken off each meter's ACCOUNT total; what remains is shared across the meter's
 * resources by their units. `complete` is false when any sample of the day failed or the day has fewer than
 * `expectedHours` hours of readings — a partial day is partial, never a smaller total (I3). CPU-ms is approximated as
 * p50 × requests (the Analytics API gives quantiles, not a sum) and the note says so on the sku.
 */
export function deriveCloudflareCost(account: string, day: string, samples: InfraSampleV1[], pricing: PricingV1, at: string, expectedHours = 24): CostSampleV1[] {
  const mine = samples.filter((s) => s.platform === 'cloudflare' && s.account === account && s.at.startsWith(day));
  const failed = mine.filter((s) => !s.ok);
  const hours = new Set(mine.filter((s) => s.ok && s.lagClass === 'hourly').map((s) => s.asOf.slice(0, 13))).size;
  const complete = failed.length === 0 && hours >= expectedHours;
  const perMeter = new Map<string, Map<string, number>>();
  for (const s of mine.filter((x) => x.ok)) for (const [meter, units] of metersOf(s)) { const m = perMeter.get(meter) ?? new Map<string, number>(); m.set(s.resource, (m.get(s.resource) ?? 0) + units); perMeter.set(meter, m); }
  const out: CostSampleV1[] = [];
  for (const [meter, byResource] of perMeter) {
    const price = pricing.meters[meter]; if (!price) continue;
    const total = [...byResource.values()].reduce((a, b) => a + b, 0);
    const billable = Math.max(0, total - (price.includedPerMonth ?? 0) / 30);
    if (total <= 0) continue;
    for (const [resource, units] of byResource) {
      out.push({ type: 'ap.cost-sample.v1', platform: 'cloudflare', account, day, resource, sku: meter === 'workers.cpuMs' ? `${meter} (p50 × requests)` : meter, amountMicroUsd: Math.round(billable * (units / total) * price.microUsdPerUnit), basis: 'derived', asOf: at, complete, ok: true });
    }
  }
  if (!mine.length || failed.length) out.push({ type: 'ap.cost-sample.v1', platform: 'cloudflare', account, day, resource: '*', amountMicroUsd: 0, basis: 'derived', asOf: at, complete: false, ok: false, error: mine.length ? `${failed.length} of the day's reads failed: ${[...new Set(failed.map((f) => f.error))].slice(0, 3).join('; ')}` : 'no samples for this day' });
  return out;
}
