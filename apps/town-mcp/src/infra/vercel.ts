// VERCEL — spec 437 §4. The latest production deployment per listed project every five minutes (`live`: readyState,
// age), and the billing charges stream (FOCUS JSONL, one day's granularity) for a rolling window daily — BILLED cost,
// grouped by project and SKU, a later read of the same day superseding the earlier (I1). Read-only token (I7).
import type { CostSampleV1, InfraSampleV1 } from '@ap-town/town-model';
import { type FetchLike, failedCost, failedInfra, infraSample, microUsd, num, readHttp, readJson } from './common';

export interface VercelCfg { token: string; teamId: string }
export const VERCEL_API = 'https://api.vercel.com';

interface Deployment { uid?: string; name?: string; state?: string; readyState?: string; created?: number; createdAt?: number; ready?: number; buildingAt?: number }
const statusOf = (state: string | undefined): InfraSampleV1['status'] => (state === 'READY' ? 'up' : state === 'ERROR' || state === 'CANCELED' ? 'down' : state ? 'degraded' : 'unknown');

/** One sample per project: the production deployment that is current, its state and how old it is. */
export async function collectVercelDeployments(cfg: VercelCfg, projects: string[], fetchImpl: FetchLike, at: string): Promise<InfraSampleV1[]> {
  const nowMs = Date.parse(at);
  return Promise.all(projects.map(async (project) => {
    const r = await readJson<{ deployments?: Deployment[] }>(fetchImpl, `${VERCEL_API}/v6/deployments?teamId=${encodeURIComponent(cfg.teamId)}&projectId=${encodeURIComponent(project)}&target=production&limit=1`, { headers: { authorization: `Bearer ${cfg.token}` } });
    if (!r.ok) return failedInfra('vercel', cfg.teamId, project, 'deployment', 'live', r.error, at);
    const d = r.data.deployments?.[0];
    if (!d) return failedInfra('vercel', cfg.teamId, project, 'deployment', 'live', 'no production deployment', at);
    const state = d.readyState ?? d.state; const created = num(d.createdAt ?? d.created); const ready = num(d.ready);
    return infraSample({ platform: 'vercel', account: cfg.teamId, resource: project, kind: 'deployment', at, asOf: at, lagClass: 'live', status: statusOf(state),
      metrics: { ready: state === 'READY' ? 1 : 0, deployAgeMs: ready ?? created ? nowMs - (ready ?? created!) : null, buildMs: ready !== null && created !== null ? ready - created : null } });
  }));
}

interface FocusRow { ChargePeriodStart?: string; ChargePeriodEnd?: string; BilledCost?: number | string; BillingCurrency?: string; ServiceName?: string; SkuId?: string; SkuPriceId?: string; ResourceName?: string; ResourceId?: string; Tags?: Record<string, string> }

/** Parse the charges stream (JSONL, or a JSON array) into FOCUS rows; a line that is not JSON is skipped and counted. */
export function parseFocus(text: string): { rows: FocusRow[]; skipped: number } {
  const t = text.trim();
  if (t.startsWith('[')) { try { return { rows: JSON.parse(t) as FocusRow[], skipped: 0 }; } catch { return { rows: [], skipped: 1 }; } }
  const rows: FocusRow[] = []; let skipped = 0;
  for (const line of t.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line) as FocusRow); } catch { skipped += 1; } }
  return { rows, skipped };
}

/** Billed cost per day × project (or service) × SKU over `[from, to]` (`YYYY-MM-DD`). One failed read is one failed row for the team. */
export async function collectVercelCharges(cfg: VercelCfg, from: string, to: string, fetchImpl: FetchLike, at: string): Promise<CostSampleV1[]> {
  const r = await readHttp(fetchImpl, `${VERCEL_API}/v1/billing/charges?teamId=${encodeURIComponent(cfg.teamId)}&from=${from}&to=${to}`, { headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/x-ndjson, application/json' } }, 60_000);
  if (!r.ok) return [failedCost('vercel', cfg.teamId, to, '*', 'billed', r.error, at)];
  const { rows, skipped } = parseFocus(r.data);
  const grouped = new Map<string, CostSampleV1>();
  let nonUsd = 0;
  for (const row of rows) {
    const day = (row.ChargePeriodStart ?? '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const cost = typeof row.BilledCost === 'string' ? Number(row.BilledCost) : row.BilledCost; if (typeof cost !== 'number' || !Number.isFinite(cost)) continue;
    if (row.BillingCurrency && row.BillingCurrency !== 'USD') nonUsd += 1;
    const resource = row.Tags?.project ?? row.ResourceName ?? row.ServiceName ?? 'unattributed'; const sku = row.SkuId ?? row.SkuPriceId ?? row.ServiceName ?? undefined;
    const k = `${day}|${resource}|${sku ?? ''}`;
    const cur = grouped.get(k) ?? { type: 'ap.cost-sample.v1', platform: 'vercel', account: cfg.teamId, day, resource, ...(sku ? { sku } : {}), amountMicroUsd: 0, basis: 'billed', asOf: at, complete: true, ok: true };
    cur.amountMicroUsd += microUsd(cost); grouped.set(k, cur);
  }
  const out = [...grouped.values()];
  if (skipped || nonUsd) for (const c of out) { c.complete = false; c.error = `${skipped ? `${skipped} unreadable line(s)` : ''}${skipped && nonUsd ? '; ' : ''}${nonUsd ? `${nonUsd} row(s) not in USD` : ''}`; }
  return out;
}
