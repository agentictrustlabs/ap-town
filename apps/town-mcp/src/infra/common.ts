// Shared by the collectors (spec 437 §4). Every sample names its source, its `asOf` and lag class (I2); a failed read is
// `ok:false` + `error`, never zeros (I3). Nothing here acts (I8).
import type { CostSampleV1, InfraPlatform, InfraResourceKind, InfraSampleV1, LagClass } from '@ap-town/town-model';

export type FetchLike = typeof fetch;
export const nowIso = (ms = Date.now()): string => new Date(ms).toISOString();
export const dayOf = (iso: string): string => iso.slice(0, 10);
export const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
export const microUsd = (usd: number): number => Math.round(usd * 1_000_000);

export function infraSample(p: Omit<InfraSampleV1, 'type' | 'ok'> & { ok?: boolean }): InfraSampleV1 {
  return { type: 'ap.infra-sample.v1', ok: p.ok ?? true, ...p };
}
export function failedInfra(platform: InfraPlatform, account: string, resource: string, kind: InfraResourceKind, lagClass: LagClass, error: string, at: string): InfraSampleV1 {
  return { type: 'ap.infra-sample.v1', platform, account, resource, kind, at, asOf: at, lagClass, status: 'unknown', metrics: {}, ok: false, error };
}
export function failedCost(platform: InfraPlatform, account: string, day: string, resource: string, basis: CostSampleV1['basis'], error: string, at: string): CostSampleV1 {
  return { type: 'ap.cost-sample.v1', platform, account, day, resource, amountMicroUsd: 0, basis, asOf: at, complete: false, ok: false, error };
}

export type Read<T> = { ok: true; data: T; status: number; headers: Headers } | { ok: false; error: string; status?: number; headers?: Headers };

/** One HTTP read with a timeout; a non-2xx answer or a thrown fetch is the error, with the body's first line when it says anything. */
export async function readHttp(fetchImpl: FetchLike, url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Read<string>> {
  try {
    const r = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `answered ${r.status}${text ? `: ${text.split('\n')[0]!.slice(0, 160)}` : ''}`, status: r.status, headers: r.headers };
    return { ok: true, data: text, status: r.status, headers: r.headers };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}
export async function readJson<T>(fetchImpl: FetchLike, url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<Read<T>> {
  const r = await readHttp(fetchImpl, url, init, timeoutMs);
  if (!r.ok) return r;
  try { return { ...r, data: JSON.parse(r.data) as T }; } catch { return { ok: false, error: 'not JSON', status: r.status, headers: r.headers }; }
}

/** Up under 5% errors, degraded at or above, unknown when nothing was served. */
export function statusFromErrors(requests: number | null, errors: number | null): InfraSampleV1['status'] {
  if (!requests) return 'unknown';
  return (errors ?? 0) / requests >= 0.05 ? 'degraded' : 'up';
}

/** The previous full hour `[from, to)` for an hourly pass. */
export function previousHour(nowMs: number): { from: string; to: string } {
  const to = Math.floor(nowMs / 3_600_000) * 3_600_000;
  return { from: nowIso(to - 3_600_000), to: nowIso(to) };
}
/** The first day of the month `n` months back — the start of a history window whose months are WHOLE. A window
 *  that began mid-month would report a partial first month as if it were a month, which is the one thing a
 *  baseline must not do.
 *
 *  KEEP `n` AT 12 OR LESS for Azure: Cost Management refuses a range over one year outright ("The time period for
 *  pulling the data cannot exceed 1 year(s)", seen on 13 — the whole history then came back as one failed row). */
export function monthsBack(nowMs: number, n: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - (n - 1), 1)).toISOString().slice(0, 10);
}
/** `[day − days + 1, day]` as `YYYY-MM-DD` for a rolling cost window ending yesterday. */
export function rollingDays(nowMs: number, days: number): { from: string; to: string; days: string[] } {
  const end = Math.floor(nowMs / 86_400_000) * 86_400_000 - 86_400_000;
  const list = Array.from({ length: days }, (_, i) => dayOf(nowIso(end - (days - 1 - i) * 86_400_000)));
  return { from: list[0]!, to: list[list.length - 1]!, days: list };
}
