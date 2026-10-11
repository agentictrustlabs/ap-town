import { describe, it, expect } from 'vitest';
import worker, { TOOLS, authorized, batched, infraSources, toRow, PUT_MAX_BYTES, PUT_MAX_ROWS, type Env } from '../src/index';
import type { CostSampleV1, InfraSampleV1 } from '@ap-town/town-model';

const TOKEN = 'town-ops-token-abc';
const infra = (p: Partial<InfraSampleV1> = {}): InfraSampleV1 => ({ type: 'ap.infra-sample.v1', platform: 'cloudflare', account: 'acctA', resource: 'demo-a2a-faithnet', kind: 'worker', at: '2026-10-10T12:00:00.000Z', asOf: '2026-10-10T11:00:00.000Z', lagClass: 'hourly', status: 'up', metrics: { requests: 100, errors: 1, cpuP50Ms: 2 }, ok: true, ...p });
const cost = (p: Partial<CostSampleV1> = {}): CostSampleV1 => ({ type: 'ap.cost-sample.v1', platform: 'vercel', account: 'team_1', day: '2026-10-09', resource: 'faithnet-home', sku: 'pro', amountMicroUsd: 1_500_000, basis: 'billed', asOf: '2026-10-10T06:30:00.000Z', complete: true, ok: true, ...p });

/** A stand-in for `InfraDO` that answers `/read` from a fixed set of rows. */
const storeOf = (rows: unknown[]) => ({
  idFromName: () => 'id',
  get: () => ({ fetch: async (u: string | Request) => { const url = new URL(typeof u === 'string' ? u : u.url); return url.pathname === '/read' ? Response.json(rows) : Response.json({ ok: true }); } }),
});
const envOf = (rows: unknown[], extra: Partial<Env> = {}): Env => ({ TOWN: 'faithchain', TOWN_OPS_TOKEN: TOKEN, INFRA: storeOf(rows) as unknown as DurableObjectNamespace, ...extra });
const call = (env: Env, body: unknown, token: string | null = TOKEN) =>
  worker.fetch(new Request('https://town-mcp/mcp', { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) }), env, {} as ExecutionContext);
const tool = async (env: Env, name: string, args: Record<string, unknown> = {}) => {
  const r = await call(env, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  const j = (await r.json()) as { result?: { structuredContent?: unknown }; error?: { message: string } };
  if (j.error) throw new Error(j.error.message);
  return j.result!.structuredContent as Record<string, unknown>;
};

describe('the town MCP door (spec 437 §4 — the only thing that holds a platform credential)', () => {
  it('names which sources are configured and never the value; health needs no token', async () => {
    expect(infraSources({ GRAPHDB_MONITOR_TOKEN: 'Basic zzz', VERCEL_TOKEN: 'v' })).toEqual({ configured: ['vercel', 'graphdb'], unconfigured: ['cloudflare', 'azure'] });
    const r = await worker.fetch(new Request('https://town-mcp/health'), envOf([], { GRAPHDB_MONITOR_TOKEN: 'Basic zzz' }), {} as ExecutionContext);
    const j = (await r.json()) as { sources: { configured: string[] }; crons: string[] };
    expect(r.status).toBe(200);
    expect(j.sources.configured).toEqual(['graphdb']);
    expect(j.crons).toEqual(['*/5 * * * *', '7 * * * *', '30 6 * * *']);
    expect(JSON.stringify(j)).not.toContain('zzz');
  });
  it('the ops token is compared in constant time; a wrong one is refused and an unset one closes the door', async () => {
    expect(authorized({ TOWN: 't', TOWN_OPS_TOKEN: TOKEN }, `Bearer ${TOKEN}`)).toEqual({ ok: true });
    expect(authorized({ TOWN: 't', TOWN_OPS_TOKEN: TOKEN }, 'Bearer town-ops-token-abX')).toMatchObject({ ok: false, status: 401 });
    expect(authorized({ TOWN: 't' }, `Bearer ${TOKEN}`)).toMatchObject({ ok: false, status: 503 });
    expect((await call(envOf([]), { jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)).status).toBe(401);
    expect((await worker.fetch(new Request('https://town-mcp/infra/read'), envOf([]), {} as ExecutionContext)).status).toBe(401);
  });
  it('lists its tools and refuses one it does not have', async () => {
    const r = await call(envOf([]), { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const j = (await r.json()) as { result: { tools: Array<{ name: string }> } };
    expect(j.result.tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(j.result.tools.map((t) => t.name)).toContain('infra_config');
    await expect(tool(envOf([]), 'infra_drop_everything')).rejects.toThrow('no such tool');
  });
  it('infra_status is status without metrics; infra_metrics carries the reading; both name the owner and the lag', async () => {
    const env = envOf([toRow(infra()), toRow(infra({ resource: 'pokernight-api', status: 'degraded' })), toRow(infra({ platform: 'graphdb', account: 'https://g', resource: 'graphdb', kind: 'node', ok: false, status: 'unknown', error: 'answered 503', metrics: {} }))]);
    const status = await tool(env, 'infra_status');
    const rows = status.resources as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.resource === 'demo-a2a-faithnet')).toMatchObject({ owner: 'estate:faithnet', status: 'up', lag: 'hourly', readable: true });
    expect(rows.find((r) => r.resource === 'pokernight-api')).toMatchObject({ owner: null, status: 'degraded' });
    expect(rows.find((r) => r.resource === 'graphdb')).toMatchObject({ readable: false, error: 'answered 503' });
    expect(rows[0]).not.toHaveProperty('metrics');
    expect(status.unreadable).toBe(1);
    const metrics = await tool(env, 'infra_metrics', { platform: 'cloudflare' });
    expect((metrics.resources as Array<Record<string, unknown>>)[0]).toHaveProperty('metrics');
    expect(((await tool(env, 'infra_metrics', { owner: 'faithnet' })).resources as unknown[]).length).toBe(1);
  });
  it('infra_cost groups by platform × owner × basis, keeps the later read of a day, and says derived is not a bill', async () => {
    const env = envOf([
      toRow(cost({ amountMicroUsd: 1_000_000, asOf: '2026-10-10T01:00:00.000Z' })),
      toRow(cost({ amountMicroUsd: 1_500_000, asOf: '2026-10-10T06:30:00.000Z' })),
      toRow(cost({ platform: 'cloudflare', account: 'acctA', resource: 'demo-a2a-faithnet', sku: 'workers.requests', basis: 'derived', amountMicroUsd: 90_000 })),
      toRow(cost({ platform: 'azure', account: 'sub1', resource: 'rg-faithnet', amountMicroUsd: 4_000_000, complete: false, error: 'partial' })),
    ]);
    const out = await tool(env, 'infra_cost', { window: '7d' });
    const rows = out.rows as Array<Record<string, unknown>>;
    expect(rows.find((r) => r.platform === 'vercel')).toMatchObject({ owner: 'estate:faithnet', basis: 'billed', microUsd: 1_500_000, days: 1, complete: true });
    expect(rows.find((r) => r.platform === 'cloudflare')).toMatchObject({ owner: 'estate:faithnet', basis: 'derived', microUsd: 90_000 });
    expect(rows.find((r) => r.platform === 'azure')).toMatchObject({ complete: false });
    expect(out.complete).toBe(false);
    expect(String(out.note)).toContain('never summed without the label');
    expect(((await tool(env, 'infra_cost', { owner: 'service:town-agent' })).rows as unknown[]).length).toBe(0);
  });
  it('infra_config is the agent\'s own account of its servers and its security: accounts and resources declared, credentials by NAME, what has been read', async () => {
    const env = envOf([toRow(infra())], { GRAPHDB_MONITOR_TOKEN: 'Basic zzz' });
    const all = await tool(env, 'infra_config');
    expect((all.credentials as { configured: string[]; notConfigured: string[] })).toMatchObject({ configured: ['graphdb'], notConfigured: ['cloudflare', 'vercel', 'azure'] });
    expect(JSON.stringify(all)).not.toContain('zzz');
    expect((all.accounts as { cloudflare: unknown[] }).cloudflare).toBeDefined();
    const estate = (all.owners as Array<Record<string, unknown>>).find((o) => o.owner === 'estate:faithnet')!;
    expect(estate.declared).toBeGreaterThan(5);
    expect(estate.readable).toBe(1); // only demo-a2a-faithnet has a reading
    const resources = estate.resources as Array<{ resource: string; lastRead: boolean; platform: string }>;
    expect(resources.find((r) => r.resource === 'demo-a2a-faithnet')).toMatchObject({ platform: 'cloudflare', lastRead: true });
    expect(resources.find((r) => r.resource === 'faithnet-home')).toMatchObject({ platform: 'vercel', lastRead: false });
    const one = await tool(env, 'infra_config', { owner: 'estate:faithnet' });
    expect((one.owners as unknown[]).length).toBe(1);
  });
  it('a kind-filtered read never hands back another kind — the cost rows that ride along must not reach an infra caller', async () => {
    // The store's "latest of every (kind,id) rides along" query ignored the kind filter, so a kind=infra read also
    // returned the newest cost rows. A CostSampleV1 has `day`/`asOf` and no `at`, so the first infra caller to touch
    // one threw "Cannot read properties of undefined (reading 'startsWith')" and failed the whole cost pass. The
    // store answers one kind, and the caller filters again, so neither alone can resurrect the bug.
    const mixed = [toRow(infra()), toRow(cost())];
    const onlyInfra = mixed.filter((r) => r.kind === 'infra');
    expect(onlyInfra).toHaveLength(1);
    expect((onlyInfra[0]!.payload as { at?: string }).at).toBeTypeOf('string');
    // every infra payload carries `at`; every cost payload does not — which is why the two must never be mixed
    expect((toRow(cost()).payload as { at?: string }).at).toBeUndefined();
    const out = await tool(envOf(mixed), 'infra_status');
    expect((out.resources as unknown[]).length).toBe(1); // the cost row is not reported as a resource
  });
  it('a write is split into batches a Durable Object accepts — by size and by count', () => {
    // One day of Vercel charges is ~2,000 rows / ~800 KiB once both bases are carried; as a single body the pass
    // answered 500. It had passed at 869 rows, so the ceiling is somewhere between and must not be guessed at.
    const many = Array.from({ length: 2016 }, (_, i) => toRow(cost({ day: '2026-10-09', resource: `p${i}`, sku: 's' })));
    const parts = batched(many);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.flat()).toHaveLength(many.length); // nothing dropped and nothing duplicated
    expect(parts.flat().map((r) => r.id)).toEqual(many.map((r) => r.id)); // order preserved
    for (const p of parts) { expect(p.length).toBeLessThanOrEqual(PUT_MAX_ROWS); expect(JSON.stringify(p).length).toBeLessThanOrEqual(PUT_MAX_BYTES); }
    expect(batched([])).toEqual([]);
    // a single row larger than the ceiling still goes, alone, rather than being silently dropped
    const huge = [{ big: 'x'.repeat(PUT_MAX_BYTES * 2) }];
    expect(batched(huge)).toHaveLength(1);
  });
  it('a billed and an effective reading of the same day are two rows, not one overwriting the other', async () => {
    // costId carries the basis: without it the second write supersedes the first (I1's restatement rule is
    // per basis) and a Pro team's real effective cost would erase its billed zero, or the reverse.
    const billed = cost({ day: '2026-10-09', resource: 'faithnet-home', sku: 'pro', basis: 'billed', amountMicroUsd: 0 });
    const effective = cost({ day: '2026-10-09', resource: 'faithnet-home', sku: 'pro', basis: 'effective', amountMicroUsd: 4_500_000 });
    expect(toRow(billed).id).not.toBe(toRow(effective).id);
    const out = await tool(envOf([toRow(billed), toRow(effective)]), 'infra_cost', { window: '7d' });
    const rows = out.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.basis).sort()).toEqual(['billed', 'effective']);
    expect(rows.find((r) => r.basis === 'effective')).toMatchObject({ microUsd: 4_500_000 });
    expect(String(out.note)).toContain('never summed without the label');
  });
  it('a resource the manifest lists under nobody is reported with a null owner, never dropped', async () => {
    const out = await tool(envOf([toRow(infra({ resource: 'uupg-org' }))]), 'infra_status');
    expect((out.resources as Array<Record<string, unknown>>)[0]).toMatchObject({ resource: 'uupg-org', owner: null });
  });
});
