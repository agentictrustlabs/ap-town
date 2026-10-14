// AZURE — spec 437 §4. A client-credentials token (Reader + Cost Management Reader, I7); Resource Health per listed
// resource every five minutes (`live`); Monitor metrics for a VM hourly; Cost Management at subscription scope grouped
// by resource group, daily granularity, over a rolling window — BILLED, refreshed every 4 h with 8–72 h of usage lag
// and RESTATED, so `daily-restated` and a later read supersedes (I1/I2). A 429 backs off once on the service's
// retry-after; a second refusal leaves the window `complete: false` (I3).
import type { CostMonthV1, CostSampleV1, InfraSampleV1 } from '@ap-town/town-model';
import { type FetchLike, failedCost, failedInfra, infraSample, microUsd, num, readJson } from './common';

export interface AzureCfg { tenantId: string; clientId: string; clientSecret: string; subscriptionId: string }
export const AZURE_ARM = 'https://management.azure.com';

export async function azureAccessToken(cfg: AzureCfg, fetchImpl: FetchLike): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: `${AZURE_ARM}/.default` });
  const r = await readJson<{ access_token?: string }>(fetchImpl, `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!r.ok) return { ok: false, error: `token: ${r.error}` };
  return r.data.access_token ? { ok: true, token: r.data.access_token } : { ok: false, error: 'token: no access_token in the answer' };
}

const kindOf = (resourceId: string): InfraSampleV1['kind'] => (/\/virtualMachines\//i.test(resourceId) ? 'vm' : 'node');
const shortName = (resourceId: string): string => resourceId.split('/').pop() ?? resourceId;
const auth = (token: string): HeadersInit => ({ authorization: `Bearer ${token}` });

/** Resource Health answers 409 AuthError when its PROVIDER is not registered on the subscription, and its message
 *  opens with "authentication or authorization" — which reads as a bad credential and is not one. Reader cannot
 *  register a provider (`/register/action` is a write), so the remedy belongs to the subscription's owner and the
 *  sample should say so rather than send whoever reads the Pulse back to the service principal. Seen 2026-10-13:
 *  the same token read every resource group, every VM metric and the whole cost query. */
const healthError = (error: string): string =>
  /resource provider has been registered/i.test(error)
    ? 'Microsoft.ResourceHealth is not registered on this subscription, so no resource reports a status. The subscription\'s owner registers it once: az provider register --namespace Microsoft.ResourceHealth. The credential is fine — metrics and cost read with it.'
    : error;

/** Resource Health's availability state per resource. */
export async function collectAzureHealth(cfg: Pick<AzureCfg, 'subscriptionId'>, token: string, resourceIds: string[], fetchImpl: FetchLike, at: string): Promise<InfraSampleV1[]> {
  return Promise.all(resourceIds.map(async (rid) => {
    const r = await readJson<{ properties?: { availabilityState?: string; summary?: string; reportedTime?: string } }>(fetchImpl, `${AZURE_ARM}${rid}/providers/Microsoft.ResourceHealth/availabilityStatuses/current?api-version=2022-10-01`, { headers: auth(token) });
    if (!r.ok) return failedInfra('azure', cfg.subscriptionId, shortName(rid), kindOf(rid), 'live', healthError(r.error), at);
    const state = r.data.properties?.availabilityState;
    const status: InfraSampleV1['status'] = state === 'Available' ? 'up' : state === 'Unavailable' ? 'down' : state === 'Degraded' ? 'degraded' : 'unknown';
    return infraSample({ platform: 'azure', account: cfg.subscriptionId, resource: shortName(rid), kind: kindOf(rid), at, asOf: r.data.properties?.reportedTime ?? at, lagClass: 'live', status, metrics: { available: status === 'up' ? 1 : 0 } });
  }));
}

const VM_METRICS = ['Percentage CPU', 'Available Memory Bytes', 'Network In Total', 'Network Out Total', 'Disk Read Bytes', 'Disk Write Bytes'];
const METRIC_KEY: Record<string, [string, 'average' | 'maximum' | 'total']> = { 'Percentage CPU': ['cpuPercent', 'average'], 'Available Memory Bytes': ['memoryAvailableBytes', 'average'], 'Network In Total': ['networkInBytes', 'total'], 'Network Out Total': ['networkOutBytes', 'total'], 'Disk Read Bytes': ['diskReadBytes', 'total'], 'Disk Write Bytes': ['diskWriteBytes', 'total'] };

/** Monitor metrics for one VM over `[from, to)` at one-hour grain; the last point of each metric is the sample. */
export async function collectAzureVmMetrics(cfg: Pick<AzureCfg, 'subscriptionId'>, token: string, resourceId: string, window: { from: string; to: string }, fetchImpl: FetchLike, at: string): Promise<InfraSampleV1> {
  const url = `${AZURE_ARM}${resourceId}/providers/microsoft.insights/metrics?api-version=2023-10-01&metricnames=${encodeURIComponent(VM_METRICS.join(','))}&timespan=${encodeURIComponent(`${window.from}/${window.to}`)}&interval=PT1H&aggregation=Average,Maximum,Total`;
  const r = await readJson<{ value?: Array<{ name?: { value?: string }; timeseries?: Array<{ data?: Array<{ timeStamp?: string; average?: number; maximum?: number; total?: number }> }> }> }>(fetchImpl, url, { headers: auth(token) });
  if (!r.ok) return failedInfra('azure', cfg.subscriptionId, shortName(resourceId), 'vm', 'hourly', r.error, at);
  const metrics: Record<string, number | null> = {}; let asOf = window.to;
  for (const m of r.data.value ?? []) {
    const spec = METRIC_KEY[m.name?.value ?? '']; if (!spec) continue;
    const pts = (m.timeseries?.[0]?.data ?? []).filter((p) => p[spec[1]] !== undefined); const last = pts[pts.length - 1];
    metrics[spec[0]] = last ? num(last[spec[1]]) : null;
    if (spec[0] === 'cpuPercent') metrics.cpuMaxPercent = last ? num(last.maximum) : null;
    if (last?.timeStamp) asOf = last.timeStamp;
  }
  const cpu = metrics.cpuPercent;
  return infraSample({ platform: 'azure', account: cfg.subscriptionId, resource: shortName(resourceId), kind: 'vm', at, asOf, lagClass: 'hourly', status: cpu === null || cpu === undefined ? 'unknown' : cpu >= 90 ? 'degraded' : 'up', metrics });
}

/** Cost per day × resource group over `[from, to]` (`YYYY-MM-DD`). Backs off once on 429; `complete:false` when the scope still refuses. */
export async function collectAzureCost(cfg: Pick<AzureCfg, 'subscriptionId'>, token: string, window: { from: string; to: string }, fetchImpl: FetchLike, at: string, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<CostSampleV1[]> {
  const url = `${AZURE_ARM}/subscriptions/${encodeURIComponent(cfg.subscriptionId)}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  // PER RESOURCE, not per group: "rg-akcs-pilot-westus costs $20 a day" does not say which machine, and the
  // first question anybody asks of a cost is which machine. Two groupings is the API's limit, so the group
  // rides along as the row's SCOPE — attribution needs it, because the manifest claims whole groups and only
  // three of the twenty-one billed resources are declared individually.
  const body = JSON.stringify({ type: 'ActualCost', timeframe: 'Custom', timePeriod: { from: `${window.from}T00:00:00Z`, to: `${window.to}T23:59:59Z` }, dataset: { granularity: 'Daily', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }, grouping: [{ type: 'Dimension', name: 'ResourceId' }, { type: 'Dimension', name: 'ResourceGroupName' }] } });
  type Answer = { properties?: { columns?: Array<{ name: string }>; rows?: unknown[][] } };
  let r = await readJson<Answer>(fetchImpl, url, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body }, 60_000);
  if (!r.ok && r.status === 429) {
    const retry = Number(r.headers?.get('x-ms-ratelimit-microsoft.consumption-retry-after') ?? r.headers?.get('retry-after') ?? '10');
    await sleep(Math.min(Math.max(retry, 1), 30) * 1000);
    r = await readJson<Answer>(fetchImpl, url, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body }, 60_000);
  }
  if (!r.ok) return [failedCost('azure', cfg.subscriptionId, window.to, '*', 'billed', r.error, at)];
  const cols = (r.data.properties?.columns ?? []).map((c) => c.name);
  const ix = (names: string[]): number => cols.findIndex((c) => names.includes(c));
  const iCost = ix(['Cost', 'PreTaxCost', 'CostUSD']), iDay = ix(['UsageDate', 'BillingPeriod']), iRg = ix(['ResourceGroupName', 'ResourceGroup']), iCur = ix(['Currency']), iRid = ix(['ResourceId']);
  if (iCost < 0 || iDay < 0) return [failedCost('azure', cfg.subscriptionId, window.to, '*', 'billed', `unexpected columns: ${cols.join(', ')}`, at)];
  const out: CostSampleV1[] = []; let nonUsd = 0;
  for (const row of r.data.properties?.rows ?? []) {
    const cost = num(row[iCost]); const d = String(row[iDay] ?? ''); const day = /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : d.slice(0, 10);
    if (cost === null || !/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (iCur >= 0 && row[iCur] && row[iCur] !== 'USD') nonUsd += 1;
    const group = String(iRg >= 0 ? row[iRg] ?? 'unattributed' : 'subscription');
    // The resource id's last segment is its name, which is what the manifest and the metrics both use.
    const resource = iRid >= 0 && row[iRid] ? String(row[iRid]).split('/').pop() || group : group;
    // A DAY IS NOT FINISHED WHEN IT ENDS — Azure keeps rating it for about two more. Measured on 2026-10-14:
    // the bastion read 6.96, 6.96, 6.96, 6.96, 6.96, 6.67, 4.93 for the seven days to yesterday. The first five
    // are the same number; the last two are the same machine with its charges still arriving. Calling those
    // complete made every flat resource look like it varied by a third and dragged every per-day mean down.
    // So a day is complete two days after it ends, and until then it is a partial read that says so.
    const settled = day <= new Date(Date.parse(`${at.slice(0, 10)}T00:00:00Z`) - 2 * 86_400_000).toISOString().slice(0, 10);
    out.push({ type: 'ap.cost-sample.v1', platform: 'azure', account: cfg.subscriptionId, day, resource, ...(group !== resource ? { scope: group } : {}), amountMicroUsd: microUsd(cost), basis: 'billed', asOf: at, complete: settled, ok: true });
  }
  if (nonUsd) for (const c of out) { c.complete = false; c.error = `${nonUsd} row(s) not in USD`; }
  return out;
}

/** One Cost Management query at MONTH granularity, grouped by one dimension. `null` when the scope refused. */
async function monthlyBy(cfg: Pick<AzureCfg, 'subscriptionId'>, token: string, dimension: 'ServiceName' | 'ResourceGroupName', window: { from: string; to: string }, fetchImpl: FetchLike, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): Promise<{ rows: Array<{ month: string; key: string; usd: number }> } | { error: string }> {
  const url = `${AZURE_ARM}/subscriptions/${encodeURIComponent(cfg.subscriptionId)}/providers/Microsoft.CostManagement/query?api-version=2023-11-01`;
  const body = JSON.stringify({ type: 'ActualCost', timeframe: 'Custom', timePeriod: { from: `${window.from}T00:00:00Z`, to: `${window.to}T23:59:59Z` }, dataset: { granularity: 'Monthly', aggregation: { totalCost: { name: 'Cost', function: 'Sum' } }, grouping: [{ type: 'Dimension', name: dimension }] } });
  type Answer = { properties?: { columns?: Array<{ name: string }>; rows?: unknown[][] } };
  // THE COST API IS RATE-LIMITED PER SUBSCRIPTION, and the cost pass asks it three times in a row (the days,
  // then the months by service and by scope). Without the same backoff the daily query has, the month history
  // is the one that loses the race and the whole baseline comes back as one 429 (seen 2026-10-13).
  let r = await readJson<Answer>(fetchImpl, url, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body }, 60_000);
  if (!r.ok && r.status === 429) {
    const retry = Number(r.headers?.get('x-ms-ratelimit-microsoft.consumption-retry-after') ?? r.headers?.get('retry-after') ?? '10');
    await sleep(Math.min(Math.max(retry, 1), 30) * 1000);
    r = await readJson<Answer>(fetchImpl, url, { method: 'POST', headers: { ...auth(token), 'content-type': 'application/json' }, body }, 60_000);
  }
  if (!r.ok) return { error: r.error };
  const cols = (r.data.properties?.columns ?? []).map((c) => c.name);
  const iCost = cols.findIndex((c) => ['Cost', 'PreTaxCost', 'CostUSD'].includes(c));
  // Monthly answers name the period `BillingMonth` where daily ones say `UsageDate`; take either.
  const iMonth = cols.findIndex((c) => ['BillingMonth', 'UsageDate', 'BillingPeriod'].includes(c));
  const iKey = cols.indexOf(dimension);
  if (iCost < 0 || iMonth < 0) return { error: `unexpected columns: ${cols.join(', ')}` };
  const rows: Array<{ month: string; key: string; usd: number }> = [];
  for (const row of r.data.properties?.rows ?? []) {
    const usd = num(row[iCost]); if (usd === null) continue;
    const raw = String(row[iMonth] ?? '');
    const month = /^\d{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}` : raw.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    rows.push({ month, key: String(iKey >= 0 ? row[iKey] ?? 'unattributed' : 'all'), usd });
  }
  return { rows };
}

/** THE MONTHS THEMSELVES — spec 437 I1, the baseline. Two queries (by service, by resource group) over whole
 *  months, folded into one row per month: the total, what was bought, and which scope it was billed to. The
 *  running month is marked `toDate` rather than quietly compared with finished ones. A refusal yields one failed
 *  row for the window rather than a smaller history (I3). */
export async function collectAzureMonths(cfg: Pick<AzureCfg, 'subscriptionId'>, token: string, window: { from: string; to: string }, fetchImpl: FetchLike, at: string, sleep?: (ms: number) => Promise<void>): Promise<CostMonthV1[]> {
  const base = { type: 'ap.cost-month.v1' as const, platform: 'azure' as const, account: cfg.subscriptionId, basis: 'billed' as const, asOf: at, throughDay: window.to };
  const svc = await monthlyBy(cfg, token, 'ServiceName', window, fetchImpl, sleep);
  if ('error' in svc) return [{ ...base, month: window.to.slice(0, 7), amountMicroUsd: 0, byService: [], byScope: [], toDate: true, ok: false, error: svc.error }];
  const scope = await monthlyBy(cfg, token, 'ResourceGroupName', window, fetchImpl, sleep);
  const thisMonth = at.slice(0, 7);
  const months = [...new Set(svc.rows.map((r) => r.month))].sort();
  const biggestFirst = (xs: Array<{ key: string; usd: number }>): Array<{ key: string; amountMicroUsd: number }> =>
    [...xs].sort((a, b) => b.usd - a.usd).map((x) => ({ key: x.key, amountMicroUsd: microUsd(x.usd) }));
  return months.map((month) => {
    const mine = svc.rows.filter((r) => r.month === month);
    return {
      ...base, month,
      amountMicroUsd: microUsd(mine.reduce((n, r) => n + r.usd, 0)),
      byService: biggestFirst(mine),
      byScope: 'error' in scope ? [] : biggestFirst(scope.rows.filter((r) => r.month === month)),
      toDate: month === thisMonth,
      throughDay: month === thisMonth ? window.to : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10),
      ok: true,
      ...('error' in scope ? { error: `the scope split could not be read: ${scope.error}` } : {}),
    };
  });
}
