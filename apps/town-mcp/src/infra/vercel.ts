// VERCEL — spec 437 §4. The latest production deployment per listed project every five minutes (`live`: readyState,
// age), and the billing charges stream (FOCUS JSONL, one day's granularity) for a rolling window daily — BILLED cost,
// grouped by project and SKU, a later read of the same day superseding the earlier (I1). Read-only token (I7).
import type { CostSampleV1, InfraSampleV1 } from '@ap-town/town-model';
import { type FetchLike, failedCost, failedInfra, infraSample, microUsd, num, readHttp, readJson } from './common';

export interface VercelCfg { token: string; teamId: string }
export const VERCEL_API = 'https://api.vercel.com';

interface Deployment { uid?: string; name?: string; state?: string; readyState?: string; created?: number; createdAt?: number; ready?: number; buildingAt?: number }
const statusOf = (state: string | undefined): InfraSampleV1['status'] => (state === 'READY' ? 'up' : state === 'ERROR' || state === 'CANCELED' ? 'down' : state ? 'degraded' : 'unknown');

/**
 * One sample per project: WHAT IS SERVING, and what has happened since.
 *
 * The newest deployment record is not the site. A canceled build — somebody pushed twice and the first was
 * dropped — is the newest record and nothing is wrong: the previous READY deployment is still serving. Taking
 * the newest regardless of state reported `imb-home` as DOWN, "built in 0 ms", while the site was up and the
 * ready build was 32 minutes old (2026-10-13). So the STATUS comes from the newest READY deployment, and the
 * newest record is reported beside it when it is not that one — a failed build is worth seeing, as a build
 * that failed rather than as an outage.
 */
export async function collectVercelDeployments(cfg: VercelCfg, projects: string[], fetchImpl: FetchLike, at: string): Promise<InfraSampleV1[]> {
  const nowMs = Date.parse(at);
  return Promise.all(projects.map(async (project) => {
    const r = await readJson<{ deployments?: Deployment[] }>(fetchImpl, `${VERCEL_API}/v6/deployments?teamId=${encodeURIComponent(cfg.teamId)}&projectId=${encodeURIComponent(project)}&target=production&limit=10`, { headers: { authorization: `Bearer ${cfg.token}` } });
    if (!r.ok) return failedInfra('vercel', cfg.teamId, project, 'deployment', 'live', r.error, at);
    const all = r.data.deployments ?? [];
    const stateOf = (x: Deployment): string | undefined => x.readyState ?? x.state;
    const serving = all.find((x) => stateOf(x) === 'READY');
    const newest = all[0];
    if (!serving && !newest) return failedInfra('vercel', cfg.teamId, project, 'deployment', 'live', 'no production deployment', at);
    const d = serving ?? newest!;
    const state = stateOf(d); const created = num(d.createdAt ?? d.created); const ready = num(d.ready);
    // A newer record that is NOT the one serving: say what it was, so a failed or canceled build is visible
    // without being read as the site being down.
    const since = newest && newest !== d ? stateOf(newest) : undefined;
    return infraSample({ platform: 'vercel', account: cfg.teamId, resource: project, kind: 'deployment', at, asOf: at, lagClass: 'live', status: statusOf(state),
      metrics: { ready: state === 'READY' ? 1 : 0, deployAgeMs: ready ?? created ? nowMs - (ready ?? created!) : null, buildMs: ready !== null && created !== null ? ready - created : null },
      ...(since ? { error: `the newest build is ${since.toLowerCase()}; this is the one serving` } : {}) });
  }));
}

interface FocusRow { ChargePeriodStart?: string; ChargePeriodEnd?: string; BilledCost?: number | string; EffectiveCost?: number | string; BillingCurrency?: string; ServiceName?: string; SkuId?: string; SkuPriceId?: string; ResourceName?: string; ResourceId?: string; Tags?: Record<string, string> }

/**
 * Which project a charge belongs to. Vercel tags the row `Tags.ProjectName` (capitalised) and leaves FOCUS's own
 * `ResourceName` empty — reading the lower-case `project` key sent EVERY row to the Unattributed bucket while the
 * attribution sat right there (2026-10-10: $9.78/wk of faithnet-home read as unowned). Rows with no project are
 * genuinely team-level — a seat, a plan, a subscription — and are left unattributed on purpose.
 */
export const projectOf = (row: FocusRow): string => row.Tags?.ProjectName ?? row.Tags?.projectName ?? row.Tags?.project ?? row.ResourceName ?? row.ServiceName ?? 'unattributed';

/** Parse the charges stream (JSONL, or a JSON array) into FOCUS rows; a line that is not JSON is skipped and counted. */
export function parseFocus(text: string): { rows: FocusRow[]; skipped: number } {
  const t = text.trim();
  if (t.startsWith('[')) { try { return { rows: JSON.parse(t) as FocusRow[], skipped: 0 }; } catch { return { rows: [], skipped: 1 }; } }
  const rows: FocusRow[] = []; let skipped = 0;
  for (const line of t.split('\n')) { if (!line.trim()) continue; try { rows.push(JSON.parse(line) as FocusRow); } catch { skipped += 1; } }
  return { rows, skipped };
}

/**
 * Cost per day × project (or service) × SKU over `[from, to]` (`YYYY-MM-DD`), on BOTH of FOCUS's bases.
 *
 * `BilledCost` is what Vercel invoiced for the period and `EffectiveCost` is what the period consumed once
 * committed and subscription spend is amortised. On a plan with included allowance they diverge completely —
 * a Pro team reads `BilledCost: 0` on every row while `EffectiveCost` carries the real figure — so emitting
 * only the billed half would report a live estate as free. Each basis becomes its OWN row and the two are
 * never added together (I1); a basis whose rows are all zero is dropped rather than shown as a true $0.00.
 * One failed read is one failed row for the team.
 */
export async function collectVercelCharges(cfg: VercelCfg, from: string, to: string, fetchImpl: FetchLike, at: string): Promise<CostSampleV1[]> {
  const r = await readHttp(fetchImpl, `${VERCEL_API}/v1/billing/charges?teamId=${encodeURIComponent(cfg.teamId)}&from=${from}&to=${to}`, { headers: { authorization: `Bearer ${cfg.token}`, accept: 'application/x-ndjson, application/json' } }, 60_000);
  if (!r.ok) return [failedCost('vercel', cfg.teamId, to, '*', 'billed', r.error, at)];
  const { rows, skipped } = parseFocus(r.data);
  const grouped = new Map<string, CostSampleV1>();
  let nonUsd = 0;
  const num = (v: number | string | undefined): number | null => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null; };
  const seen: Record<'billed' | 'effective', boolean> = { billed: false, effective: false };
  for (const row of rows) {
    const day = (row.ChargePeriodStart ?? '').slice(0, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const costs: Array<['billed' | 'effective', number | null]> = [['billed', num(row.BilledCost)], ['effective', num(row.EffectiveCost)]];
    if (costs.every(([, c]) => c === null)) continue;
    if (row.BillingCurrency && row.BillingCurrency !== 'USD') nonUsd += 1;
    const resource = projectOf(row); const sku = row.SkuId ?? row.SkuPriceId ?? row.ServiceName ?? undefined;
    for (const [basis, cost] of costs) {
      if (cost === null) continue;
      if (cost !== 0) seen[basis] = true;
      const k = `${basis}|${day}|${resource}|${sku ?? ''}`;
      const cur = grouped.get(k) ?? { type: 'ap.cost-sample.v1', platform: 'vercel', account: cfg.teamId, day, resource, ...(sku ? { sku } : {}), amountMicroUsd: 0, basis, asOf: at, complete: true, ok: true };
      cur.amountMicroUsd += microUsd(cost); grouped.set(k, cur);
    }
  }
  // A basis the stream reports as zero everywhere is absent, not free — keep the other rather than show $0.00 as
  // if it were the answer. If BOTH are all-zero the team really did spend nothing and both are kept.
  const anyNonZero = seen.billed || seen.effective;
  const out = [...grouped.values()].filter((c) => !anyNonZero || seen[c.basis as 'billed' | 'effective']);
  if (skipped || nonUsd) for (const c of out) { c.complete = false; c.error = `${skipped ? `${skipped} unreadable line(s)` : ''}${skipped && nonUsd ? '; ' : ''}${nonUsd ? `${nonUsd} row(s) not in USD` : ''}`; }
  return out;
}
