// THE REGISTRY, over one mechanism (ADR-0013): the service binding. A registry error is a tool error, said in
// the registry's words; there is no second store to ask.
import type { ArdSearchBody } from './plan.js';

export interface DiscoveryEnv { DISCOVERY?: Fetcher; REGISTRY_ORIGIN?: string }

export interface ArdSearchResult { results: Array<Record<string, unknown> & { score?: number; source?: string }>; referrals?: unknown[]; pageToken?: string }

export class RegistryError extends Error { constructor(readonly status: number, message: string) { super(message); this.name = 'RegistryError'; } }

function origin(env: DiscoveryEnv): string { return (env.REGISTRY_ORIGIN ?? 'https://discovery').replace(/\/$/, ''); }

async function call(env: DiscoveryEnv, path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const url = `${origin(env)}${path}`;
  const res = env.DISCOVERY ? await env.DISCOVERY.fetch(url, init) : await fetch(url, init);
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const err = (body?.error as { message?: string } | undefined)?.message ?? (typeof body?.error === 'string' ? body.error : null);
    throw new RegistryError(res.status, `the registry answered ${res.status}${err ? `: ${err}` : ''}`);
  }
  if (!body) throw new RegistryError(502, 'the registry answered with no JSON');
  return body;
}

export async function search(env: DiscoveryEnv, body: ArdSearchBody): Promise<ArdSearchResult> {
  const out = await call(env, '/search', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
  return { results: (Array.isArray(out.results) ? out.results : []) as ArdSearchResult['results'], ...(Array.isArray(out.referrals) ? { referrals: out.referrals } : {}), ...(typeof out.pageToken === 'string' ? { pageToken: out.pageToken } : {}) };
}

export async function getEntry(env: DiscoveryEnv, key: string): Promise<Record<string, unknown>> {
  return call(env, `/agent?key=${encodeURIComponent(key)}`, { method: 'GET', headers: { accept: 'application/json' } });
}
