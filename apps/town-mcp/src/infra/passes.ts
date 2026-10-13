// THE THREE PASSES AND THE ATTRIBUTION — spec 437 §4/§5 (I1, I4, I7). Status every five minutes, metrics hourly, cost
// daily; each pass is a pure function of the manifest, the secrets and an injected fetch, and returns the samples it
// took plus the sources it could not read. A source that is not configured is NOT CONFIGURED on the tab — a failed
// sample per declared account — never a zero. Attribution is DECLARED in `town.yaml`; a resource listed nowhere is
// `null` here and lands in the Unattributed bucket the Pulse SHOWS (I4).
import type { CostMonthV1, CostSampleV1, InfraSampleV1, PricingV1, TownManifest } from '@ap-town/town-model';
import { type FetchLike, dayOf, monthsBack, nowIso, previousHour, rollingDays } from './common';
import { declaredResources } from '@ap-town/town-model';
import { type CloudflareAccountCfg, collectCloudflareHourly, collectCloudflareStorage, deriveCloudflareCost } from './cloudflare';
import { collectVercelCharges, collectVercelDeployments } from './vercel';
import { azureAccessToken, collectAzureCost, collectAzureHealth, collectAzureMonths, collectAzureVmMetrics } from './azure';
import { collectGraphdbHealth, collectGraphdbRepositories } from './graphdb';
import pricingJson from './pricing.json';

export const PRICING: PricingV1 = pricingJson as PricingV1;

export interface InfraEnv {
  /** JSON `[{ "id": "<account id>", "label": "...", "token": "<analytics read token>" }]`; ids must match `town.yaml` `accounts.cloudflare`. */
  CLOUDFLARE_ACCOUNTS?: string;
  VERCEL_TOKEN?: string;
  AZURE_TENANT_ID?: string;
  AZURE_CLIENT_ID?: string;
  AZURE_CLIENT_SECRET?: string;
  AZURE_SUBSCRIPTION_ID?: string;
  /** The full Authorization header value for GraphDB's monitor endpoints (`Basic …` or `GDB …`). */
  GRAPHDB_MONITOR_TOKEN?: string;
}

export interface InfraPass { samples: InfraSampleV1[]; costs: CostSampleV1[]; unreadable: string[]; months?: CostMonthV1[] }

const parseAccounts = (env: InfraEnv): { ok: true; accounts: CloudflareAccountCfg[] } | { ok: false; error: string } => {
  if (!env.CLOUDFLARE_ACCOUNTS) return { ok: false, error: 'CLOUDFLARE_ACCOUNTS unset' };
  try { const a = JSON.parse(env.CLOUDFLARE_ACCOUNTS) as CloudflareAccountCfg[]; return Array.isArray(a) && a.every((x) => x.id && x.token) ? { ok: true, accounts: a } : { ok: false, error: 'CLOUDFLARE_ACCOUNTS: expected [{id,label,token}]' }; } catch { return { ok: false, error: 'CLOUDFLARE_ACCOUNTS is not JSON' }; }
};
const azureCfg = (env: InfraEnv) => (env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET && env.AZURE_SUBSCRIPTION_ID ? { tenantId: env.AZURE_TENANT_ID, clientId: env.AZURE_CLIENT_ID, clientSecret: env.AZURE_CLIENT_SECRET, subscriptionId: env.AZURE_SUBSCRIPTION_ID } : null);


/** Status pass (every five minutes): Vercel deployments, Azure Resource Health, GraphDB health. */
export async function collectStatusPass(town: TownManifest, env: InfraEnv, fetchImpl: FetchLike, nowMs = Date.now()): Promise<InfraPass> {
  const at = nowIso(nowMs); const out: InfraPass = { samples: [], costs: [], unreadable: [] };
  const declared = declaredResources(town);
  if (town.accounts?.vercel && declared.vercelProjects.length) {
    if (env.VERCEL_TOKEN) out.samples.push(...await collectVercelDeployments({ token: env.VERCEL_TOKEN, teamId: town.accounts.vercel.teamId }, declared.vercelProjects, fetchImpl, at));
    else { out.unreadable.push('vercel: VERCEL_TOKEN unset'); out.samples.push(...declared.vercelProjects.map((p) => ({ type: 'ap.infra-sample.v1' as const, platform: 'vercel' as const, account: town.accounts!.vercel!.teamId, resource: p, kind: 'deployment' as const, at, asOf: at, lagClass: 'live' as const, status: 'unknown' as const, metrics: {}, ok: false, error: 'not configured: VERCEL_TOKEN unset' }))); }
  }
  if (town.accounts?.azure && declared.azureResources.length) {
    const cfg = azureCfg(env);
    if (!cfg) { out.unreadable.push('azure: AZURE_* unset'); out.samples.push(...declared.azureResources.map((rid) => ({ type: 'ap.infra-sample.v1' as const, platform: 'azure' as const, account: town.accounts!.azure!.subscriptionId, resource: rid.split('/').pop() ?? rid, kind: (/virtualMachines/i.test(rid) ? 'vm' : 'node') as 'vm' | 'node', at, asOf: at, lagClass: 'live' as const, status: 'unknown' as const, metrics: {}, ok: false, error: 'not configured: AZURE_* unset' }))); }
    else { const t = await azureAccessToken(cfg, fetchImpl); if (!t.ok) { out.unreadable.push(`azure: ${t.error}`); out.samples.push(...declared.azureResources.map((rid) => ({ type: 'ap.infra-sample.v1' as const, platform: 'azure' as const, account: cfg.subscriptionId, resource: rid.split('/').pop() ?? rid, kind: (/virtualMachines/i.test(rid) ? 'vm' : 'node') as 'vm' | 'node', at, asOf: at, lagClass: 'live' as const, status: 'unknown' as const, metrics: {}, ok: false, error: t.error }))); } else out.samples.push(...await collectAzureHealth(cfg, t.token, declared.azureResources, fetchImpl, at)); }
  }
  if (town.accounts?.graphdb) out.samples.push(await collectGraphdbHealth({ url: town.accounts.graphdb.url, ...(env.GRAPHDB_MONITOR_TOKEN ? { authorization: env.GRAPHDB_MONITOR_TOKEN } : {}) }, fetchImpl, at));
  return out;
}

/** Metrics pass (hourly, for the previous full hour): Cloudflare analytics per account, Azure VM metrics, GraphDB repositories. */
export async function collectHourlyPass(town: TownManifest, env: InfraEnv, fetchImpl: FetchLike, nowMs = Date.now()): Promise<InfraPass> {
  const at = nowIso(nowMs); const out: InfraPass = { samples: [], costs: [], unreadable: [] }; const window = previousHour(nowMs);
  if (town.accounts?.cloudflare?.length) {
    const a = parseAccounts(env);
    if (!a.ok) { out.unreadable.push(`cloudflare: ${a.error}`); out.samples.push(...town.accounts.cloudflare.map((acct) => ({ type: 'ap.infra-sample.v1' as const, platform: 'cloudflare' as const, account: acct.id, resource: '*', kind: 'worker' as const, at, asOf: at, lagClass: 'hourly' as const, status: 'unknown' as const, metrics: {}, ok: false, error: `not configured: ${a.error}` }))); }
    else {
      const missing = town.accounts.cloudflare.filter((d) => !a.accounts.some((x) => x.id === d.id));
      for (const m of missing) { out.unreadable.push(`cloudflare ${m.label}: no token in CLOUDFLARE_ACCOUNTS`); out.samples.push({ type: 'ap.infra-sample.v1', platform: 'cloudflare', account: m.id, resource: '*', kind: 'worker', at, asOf: at, lagClass: 'hourly', status: 'unknown', metrics: {}, ok: false, error: 'not configured: no token for this account' }); }
      out.samples.push(...await collectCloudflareHourly(a.accounts.filter((x) => town.accounts!.cloudflare!.some((d) => d.id === x.id)), window, fetchImpl, at));
    }
  }
  const declared = declaredResources(town); const vms = declared.azureResources.filter((r) => /virtualMachines/i.test(r));
  if (town.accounts?.azure && vms.length) { const cfg = azureCfg(env); if (cfg) { const t = await azureAccessToken(cfg, fetchImpl); if (t.ok) out.samples.push(...await Promise.all(vms.map((rid) => collectAzureVmMetrics(cfg, t.token, rid, window, fetchImpl, at)))); else out.unreadable.push(`azure: ${t.error}`); } else out.unreadable.push('azure: AZURE_* unset'); }
  if (town.accounts?.graphdb) out.samples.push(...await collectGraphdbRepositories({ url: town.accounts.graphdb.url, ...(env.GRAPHDB_MONITOR_TOKEN ? { authorization: env.GRAPHDB_MONITOR_TOKEN } : {}) }, fetchImpl, at));
  for (const s of out.samples) if (!s.ok && !out.unreadable.includes(`${s.platform} ${s.resource}: ${s.error}`) && !s.error?.startsWith('not configured')) out.unreadable.push(`${s.platform} ${s.resource}: ${s.error}`);
  return out;
}

/**
 * Cost pass (daily): Vercel charges and Azure cost over a rolling seven days ending yesterday (a later read supersedes,
 * I1); Cloudflare storage for yesterday, then yesterday's cost DERIVED from the hourly samples the caller hands in
 * (`priorSamples` — the store's Cloudflare rows for that day) plus the storage read.
 */
export async function collectCostPass(town: TownManifest, env: InfraEnv, fetchImpl: FetchLike, nowMs = Date.now(), priorSamples: InfraSampleV1[] = []): Promise<InfraPass> {
  const at = nowIso(nowMs); const out: InfraPass = { samples: [], costs: [], unreadable: [] };
  const roll = rollingDays(nowMs, 7); const yesterday = roll.to;
  if (town.accounts?.vercel) { if (env.VERCEL_TOKEN) out.costs.push(...await collectVercelCharges({ token: env.VERCEL_TOKEN, teamId: town.accounts.vercel.teamId }, roll.from, roll.to, fetchImpl, at)); else { out.unreadable.push('vercel: VERCEL_TOKEN unset'); out.costs.push({ type: 'ap.cost-sample.v1', platform: 'vercel', account: town.accounts.vercel.teamId, day: yesterday, resource: '*', amountMicroUsd: 0, basis: 'billed', asOf: at, complete: false, ok: false, error: 'not configured: VERCEL_TOKEN unset' }); } }
  if (town.accounts?.azure) { const cfg = azureCfg(env); if (!cfg) { out.unreadable.push('azure: AZURE_* unset'); out.costs.push({ type: 'ap.cost-sample.v1', platform: 'azure', account: town.accounts.azure.subscriptionId, day: yesterday, resource: '*', amountMicroUsd: 0, basis: 'billed', asOf: at, complete: false, ok: false, error: 'not configured: AZURE_* unset' }); } else { const t = await azureAccessToken(cfg, fetchImpl); if (t.ok) { out.costs.push(...await collectAzureCost(cfg, t.token, { from: roll.from, to: roll.to }, fetchImpl, at)); // THROUGH TODAY, not yesterday: the daily rows stop at yesterday because a part-day is not a day, but a
      // month-to-date that silently omits today disagrees with the provider's own console by a day's spend and
      // sends whoever compares them looking for a bug (2026-10-13: $311.21 here against Azure's $323.85).
      out.months = await collectAzureMonths(cfg, t.token, { from: monthsBack(nowMs, 12), to: dayOf(at) }, fetchImpl, at); for (const m of out.months.filter((x) => !x.ok)) out.unreadable.push(`azure months: ${m.error}`); } else { out.unreadable.push(`azure: ${t.error}`); out.costs.push({ type: 'ap.cost-sample.v1', platform: 'azure', account: cfg.subscriptionId, day: yesterday, resource: '*', amountMicroUsd: 0, basis: 'billed', asOf: at, complete: false, ok: false, error: t.error }); } } }
  if (town.accounts?.cloudflare?.length) {
    const a = parseAccounts(env);
    if (!a.ok) { out.unreadable.push(`cloudflare: ${a.error}`); for (const acct of town.accounts.cloudflare) out.costs.push({ type: 'ap.cost-sample.v1', platform: 'cloudflare', account: acct.id, day: yesterday, resource: '*', amountMicroUsd: 0, basis: 'derived', asOf: at, complete: false, ok: false, error: `not configured: ${a.error}` }); }
    else {
      const accounts = a.accounts.filter((x) => town.accounts!.cloudflare!.some((d) => d.id === x.id));
      const storage = await collectCloudflareStorage(accounts, yesterday, fetchImpl, at);
      // Storage samples are stamped on the day they describe so the derivation and the store file them with that day.
      const stamped = storage.map((s) => ({ ...s, at: `${yesterday}T23:59:59.000Z`, asOf: `${yesterday}T23:59:59.000Z` }));
      out.samples.push(...stamped);
      for (const acct of accounts) out.costs.push(...deriveCloudflareCost(acct.id, yesterday, [...priorSamples.filter((s) => s.account === acct.id), ...stamped.filter((s) => s.account === acct.id)], PRICING, at));
    }
  }
  return out;
}

export { dayOf };
export { declaredResources };
