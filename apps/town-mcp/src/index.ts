// THE TOWN'S PRIVATE MCP — spec 437 §4 (amended 2026-10-10 on the owner's rule: "the town app should not retrieve this
// data; the town or estate MCP should"). ADR-0057: MCP is a PRIVATE capability interface behind an admitted runtime,
// absent from every Agent Card.
//
// This Worker is the only thing in the town that holds a platform read credential, and the only thing that talks to
// Cloudflare, Vercel, Azure or GraphDB. It collects on its own three cadences (I1), keeps the samples in its own
// `InfraDO` (a serving plane: wiping it loses trend lines, never a record), and answers two ways —
//
//   the REST seam the town agent calls over a service binding:
//     GET  /health                        which sources are configured, by NAME (never a value)
//     GET  /infra/read?from=&to=&kind=    the stored samples (infra · cost)
//     GET  /infra/view?window=            the infra + cost view, already attributed
//     POST /infra/pass {which}            run one pass now (status · hourly · cost) — a READ of the providers
//
//   and `POST /mcp` (JSON-RPC 2.0) for a real MCP client — the Town Ask's harness calls these as tools:
//     infra_sources · infra_status · infra_metrics · infra_cost
//
// It has no route and no custom domain. Every answer is aggregate infrastructure fact: no person, no vault, no key.
// It READS; nothing here acts (I8).
import { Hono } from 'hono';
import { TOWNS, attributeCost, attributeResource, dropSupersededCostRows, type CostMonthV1, type CostSampleV1, type InfraSampleV1, type ResourceOwnershipV1, type TownManifest } from '@ap-town/town-model';
import { collectCostPass, collectHourlyPass, collectStatusPass, type InfraEnv, type InfraPass } from './infra/passes';

export interface Env extends InfraEnv {
  TOWN: string;
  TOWN_OPS_TOKEN?: string;
  INFRA?: DurableObjectNamespace;
}

/** Spec 437 I1 — the three cadences. The town agent's own 5-minute sampler is a different clock on a different Worker. */
export const CRON_STATUS = '*/5 * * * *';
export const CRON_HOURLY = '7 * * * *';
export const CRON_COST = '30 6 * * *';
export const RETENTION_MS = 30 * 86_400_000;
export const COST_RETENTION_MS = 400 * 86_400_000;

export const townOf = (env: Env): TownManifest => {
  const t = TOWNS[env.TOWN];
  if (!t) throw new Error(`TOWN "${env.TOWN}" is not a town this build knows (${Object.keys(TOWNS).join(', ')})`);
  return t;
};

/** Which sources this deployment can read, by NAME. A credential's presence is a fact; its value never leaves. */
export function infraSources(env: InfraEnv): { configured: string[]; unconfigured: string[] } {
  const az = !!(env.AZURE_TENANT_ID && env.AZURE_CLIENT_ID && env.AZURE_CLIENT_SECRET && env.AZURE_SUBSCRIPTION_ID);
  const rows: Array<[string, boolean]> = [['cloudflare', !!env.CLOUDFLARE_ACCOUNTS], ['vercel', !!env.VERCEL_TOKEN], ['azure', az], ['graphdb', !!env.GRAPHDB_MONITOR_TOKEN]];
  return { configured: rows.filter(([, ok]) => ok).map(([n]) => n), unconfigured: rows.filter(([, ok]) => !ok).map(([n]) => n) };
}

export const infraId = (s: InfraSampleV1): string => `${s.platform}|${s.account}|${s.kind}|${s.resource}`;
/**
 * The identity of a cost reading. `basis` is PART of it: a later read of the same day supersedes the earlier
 * one (I1), but only within its own basis — a provider can report a billed and an effective figure for the same
 * day × resource × sku, and without the basis here the second would silently overwrite the first and one of the
 * two would vanish from the store.
 */
export const costId = (c: CostSampleV1): string => `${c.platform}|${c.account}|${c.day}|${c.resource}|${c.sku ?? ''}|${c.basis}`;
/** What the store keeps: one row per sample, filed by kind and (for cost) by the day it describes. */
/** A whole month as the provider billed it (spec 437 I1): one row per (platform, account, month, basis), and a
 *  later read of the same month supersedes the earlier — billed figures restate for months, not only for days. */
export const costMonthId = (c: CostMonthV1): string => `${c.platform}|${c.account}|${c.month}|${c.basis}`;
export interface StoredRow { kind: 'infra' | 'cost' | 'cost-month'; id: string; at: string; ok: boolean; payload: InfraSampleV1 | CostSampleV1 | CostMonthV1; error?: string }
export const toRow = (x: InfraSampleV1 | CostSampleV1 | CostMonthV1): StoredRow =>
  x.type === 'ap.infra-sample.v1'
    ? { kind: 'infra', id: infraId(x), at: x.at, ok: x.ok, payload: x, ...(x.error ? { error: x.error } : {}) }
    : x.type === 'ap.cost-month.v1'
      ? { kind: 'cost-month', id: costMonthId(x), at: x.asOf, ok: x.ok, payload: x, ...(x.error ? { error: x.error } : {}) }
      : { kind: 'cost', id: costId(x), at: x.asOf, ok: x.ok, payload: x, ...(x.error ? { error: x.error } : {}) };

/** The one token the town's own services answer to, compared in constant time. Unset ⇒ the door is closed, and says so. */
export function authorized(env: Env, authorization: string | null): { ok: true } | { ok: false; status: 401 | 503; error: string } {
  if (!env.TOWN_OPS_TOKEN) return { ok: false, status: 503, error: 'this deployment has no TOWN_OPS_TOKEN, so it answers nobody' };
  const given = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (given.length !== env.TOWN_OPS_TOKEN.length) return { ok: false, status: 401, error: 'the town MCP is read with the town ops token' };
  let diff = 0; for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ env.TOWN_OPS_TOKEN.charCodeAt(i);
  return diff === 0 ? { ok: true } : { ok: false, status: 401, error: 'the town MCP is read with the town ops token' };
}

/** One pass, stored. Returns what it took and the sources it could not read — never a zero for a source that failed (I3). */
export async function runPass(env: Env, which: 'status' | 'hourly' | 'cost', nowMs = Date.now(), fetchImpl: typeof fetch = fetch): Promise<InfraPass> {
  const town = townOf(env);
  const store = env.INFRA?.get(env.INFRA.idFromName(town.town));
  let pass: InfraPass;
  if (which === 'status') pass = await collectStatusPass(town, env, fetchImpl, nowMs);
  else if (which === 'hourly') pass = await collectHourlyPass(town, env, fetchImpl, nowMs);
  else {
    // Yesterday's Cloudflare hourly rows are the meters the derived cost is computed from.
    const dayStart = Math.floor(nowMs / 86_400_000) * 86_400_000 - 86_400_000;
    const prior = store
      ? ((await (await store.fetch(`https://infra/read?kind=infra&from=${dayStart}&to=${dayStart + 86_400_000 - 1}`)).json()) as StoredRow[])
          .filter((r) => r.kind === 'infra') // belt and braces: the store is asked for infra, and only infra is read
          .map((r) => r.payload as InfraSampleV1)
          .filter((s) => s.platform === 'cloudflare')
      : [];
    pass = await collectCostPass(town, env, fetchImpl, nowMs, prior);
  }
  // A failed month is not a restatement of billed figures (I3). Storing an `ok:false` placeholder for the
  // running month under the same id superseded the last good sample, and the Cost table then said "unreadable".
  const rows = [...pass.samples, ...pass.costs, ...(pass.months ?? []).filter((m) => m.ok)].map(toRow);
  if (store) for (const batch of batched(rows)) await store.fetch('https://infra/put', { method: 'POST', body: JSON.stringify(batch) });
  for (const u of pass.unreadable) console.warn(`[town-mcp:${which}] ${u}`);
  return pass;
}

/**
 * Split a write into requests a Durable Object will actually accept. A day of Vercel charges is ~2,000 rows and
 * ~800 KiB once both cost bases are carried, and sending that as ONE body made the pass answer 500 (2026-10-11;
 * it had passed at 869 rows, so the ceiling sits between). Chunked by serialised size AND by count, so a town
 * with more projects or a provider with a fatter row does not rediscover the same wall.
 */
export const PUT_MAX_BYTES = 96 * 1024;
export const PUT_MAX_ROWS = 200;
export function batched<T>(rows: readonly T[], maxBytes = PUT_MAX_BYTES, maxRows = PUT_MAX_ROWS): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 2; // the enclosing []
  for (const r of rows) {
    const size = JSON.stringify(r).length + 1;
    if (cur.length && (cur.length >= maxRows || bytes + size > maxBytes)) { out.push(cur); cur = []; bytes = 2; }
    cur.push(r); bytes += size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** What a read may ask of the store beyond the window: `step` — one infra sample per cadence per `step` ms, the
 *  resolution the asker draws at; `rollup: 'sku'` — cost rows summed over the SKU, one per day × resource × basis. */
export interface ReadOpts { step?: number; rollup?: 'sku' }
/** The stored rows for a window, newest-last; the latest of every (kind, id, cadence) rides along so a quiet source still shows its last word. */
async function readRows(env: Env, q: { from: number; to?: number; kind?: string } & ReadOpts): Promise<StoredRow[]> {
  if (!env.INFRA) return [];
  const u = new URL('https://infra/read');
  u.searchParams.set('from', String(q.from));
  if (q.to !== undefined) u.searchParams.set('to', String(q.to));
  if (q.kind) u.searchParams.set('kind', q.kind);
  if (q.step) u.searchParams.set('step', String(q.step));
  if (q.rollup) u.searchParams.set('rollup', q.rollup);
  const r = await env.INFRA.get(env.INFRA.idFromName(townOf(env).town)).fetch(u.toString());
  const rows = (await r.json()) as StoredRow[];
  // Asked for one kind, read only that kind. The store's own filter once leaked cost rows into an infra read
  // (the "latest rides along" query ignored it), and an infra caller reading a cost payload crashes on the `at`
  // a cost sample does not have. Checked here too, so one filter failing cannot reach a tool.
  return q.kind ? rows.filter((x) => x.kind === q.kind) : rows;
}

const app = new Hono<{ Bindings: Env }>();

// Public-ish only in the sense that the binding is the only way in: this says which sources are configured, by name.
app.get('/health', (c) => c.json({ ok: true, service: 'town-mcp', town: c.env.TOWN, sources: infraSources(c.env), crons: [CRON_STATUS, CRON_HOURLY, CRON_COST], store: !!c.env.INFRA }));

app.use('/infra/*', async (c, next) => {
  const a = authorized(c.env, c.req.header('authorization') ?? null);
  if (!a.ok) return c.json({ ok: false, error: a.error }, a.status);
  await next();
});

app.get('/infra/config', async (c) => c.json({ ok: true, ...(await callTool(c.env, 'infra_config', { ...(c.req.query('owner') ? { owner: c.req.query('owner') } : {}) }) as Record<string, unknown>) }));

app.get('/infra/read', async (c) => {
  const from = Number(c.req.query('from') ?? Date.now() - 86_400_000);
  const to = c.req.query('to') ? Number(c.req.query('to')) : undefined;
  const kind = c.req.query('kind');
  const step = Number(c.req.query('step') ?? 0);
  const rollup = c.req.query('rollup') === 'sku' ? ('sku' as const) : undefined;
  return c.json(await readRows(c.env, { from, ...(to !== undefined ? { to } : {}), ...(kind ? { kind } : {}), ...(step > 0 ? { step } : {}), ...(rollup ? { rollup } : {}) }));
});

/** The store's own account of itself: rows, bytes and span per kind. Reads nothing from a provider. */
app.get('/infra/store', async (c) => c.json(await storeStats(c.env)));

/** Prune now — what the hourly alarm does: retention, and the restatements a later read superseded (I1). */
app.post('/infra/prune', async (c) => {
  if (!c.env.INFRA) return c.json({ ok: false, error: 'no store is bound on this deployment' }, 503);
  const r = await c.env.INFRA.get(c.env.INFRA.idFromName(townOf(c.env).town)).fetch('https://infra/prune', { method: 'POST' });
  return c.json(await r.json(), r.status as 200);
});

export async function storeStats(env: Env): Promise<unknown> {
  if (!env.INFRA) return { ok: false, error: 'no store is bound on this deployment' };
  const r = await env.INFRA.get(env.INFRA.idFromName(townOf(env).town)).fetch('https://infra/stats');
  return r.json();
}

app.post('/infra/pass', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { which?: string };
  const which = body.which === 'hourly' || body.which === 'cost' ? body.which : 'status';
  const pass = await runPass(c.env, which);
  return c.json({ ok: true, which, samples: pass.samples.length, costs: pass.costs.length, months: pass.months?.length ?? 0, unreadable: pass.unreadable });
});

// ── The MCP door (JSON-RPC 2.0) — the Town Ask's harness calls these as tools ───────────────────────────────────────
export const TOOLS = [
  { name: 'infra_sources', description: 'Which infrastructure sources this town can read, by name, and which are not configured. Never a credential.', inputSchema: { type: 'object', properties: {} } },
  { name: 'infra_status', description: "Every declared platform resource's current status (up · degraded · down · unknown) with the moment the source says it is current to and how stale that can be. A source that could not be read is unreadable with its reason, never zeros.", inputSchema: { type: 'object', properties: { platform: { type: 'string', description: 'Only this platform: cloudflare · vercel · azure · graphdb · chain-node.' } } } },
  { name: 'infra_metrics', description: "The last reading per resource: requests, errors, CPU and wall time for Workers; rows and query time for D1; storage; VM CPU and memory; GraphDB heap and statements. Aggregate infrastructure facts, never a person's record.", inputSchema: { type: 'object', properties: { platform: { type: 'string' }, owner: { type: 'string', description: 'Only resources this estate or service owns, as town.yaml declares it.' } } } },
  { name: 'infra_config', description: "What infrastructure this town or one of its estates, services or applications is CONFIGURED with: the accounts its resources live in (ids and labels, never a credential), the Workers · Pages projects · Vercel projects · Azure resources it declares, which read credentials this deployment holds BY NAME, and which declared resources have no reading yet. An agent's own account of its servers and its security configuration.", inputSchema: { type: 'object', properties: { owner: { type: 'string', description: "Whose configuration: 'town' for the whole town, or 'estate:<id>' / 'service:<id>' / an id on its own." } } } },
  { name: 'infra_cost', description: 'Cost per day per owner over a window, each row labelled with its basis — derived (a meter times a published price, our estimate), billed (what the provider invoiced) or effective (what the period consumed once committed and subscription spend is amortised) — with how current it is and whether the window is complete. The bases are never summed without the label: a provider whose usage sits inside a plan allowance reports billed 0 while effective carries the real figure.', inputSchema: { type: 'object', properties: { window: { type: 'string', description: '24h · 7d · 30d · 90d (default 7d).' }, owner: { type: 'string' } } } },
] as const;

function matchOwner(town: TownManifest, s: InfraSampleV1, owner?: string): boolean {
  if (!owner) return true;
  const o = attributeResource(town, s.platform, s.resource, s.kind);
  return !!o && (o.id === owner || `${o.kind}:${o.id}` === owner);
}

async function callTool(env: Env, name: string, args: Record<string, unknown>): Promise<unknown> {
  const town = townOf(env);
  const windowMs = (w: unknown): number => (w === '90d' ? 90 : w === '30d' ? 30 : w === '24h' ? 1 : 7) * 86_400_000;
  if (name === 'infra_sources') return { town: town.town, ...infraSources(env) };
  if (name === 'infra_config') {
    const want = typeof args.owner === 'string' && args.owner !== 'town' ? args.owner : null;
    const owners = [
      ...town.estates.map((e) => ({ kind: 'estate' as const, id: e.id, o: e as ResourceOwnershipV1 })),
      ...town.services.map((s) => ({ kind: (s.kind === 'application' ? 'application' : 'service') as 'service' | 'application', id: s.id, o: { ...(s as ResourceOwnershipV1), workers: [...(s.workers ?? []), ...(s.worker ? [s.worker] : [])] } })),
    ].filter((x) => !want || x.id === want || `${x.kind}:${x.id}` === want);
    // The last reading per resource, so "declared but never read" is visible as itself. One sample per cadence
    // over the two days is all this needs — the latest rides along regardless.
    const rows = await readRows(env, { from: Date.now() - 2 * 86_400_000, kind: 'infra', step: 2 * 86_400_000 });
    const read = new Set<string>();
    for (const r of rows) { const s = r.payload as InfraSampleV1; if (s.ok) read.add(`${s.platform}|${s.resource}`); }
    const resourcesOf = (o: ResourceOwnershipV1) => [
      ...(o.workers ?? []).map((r) => ({ platform: 'cloudflare', kind: 'worker', resource: r })),
      ...(o.pagesProjects ?? []).map((r) => ({ platform: 'cloudflare', kind: 'pages', resource: r })),
      ...(o.vercelProjects ?? []).map((r) => ({ platform: 'vercel', kind: 'deployment', resource: r })),
      ...(o.azureResources ?? []).map((r) => ({ platform: 'azure', kind: /virtualMachines/i.test(r) ? 'vm' : 'node', resource: r.split('/').pop() ?? r })),
    ].map((x) => ({ ...x, lastRead: read.has(`${x.platform}|${x.resource}`) }));
    const sources = infraSources(env);
    return {
      town: town.town,
      accounts: town.accounts ?? null,
      credentials: { configured: sources.configured, notConfigured: sources.unconfigured, note: 'names only — a credential value never leaves this Worker, and the town portal holds none of them' },
      // What the store holds, by kind: the agent's account of its own serving plane, so a read that grows past
      // what one answer can carry is visible here before it fails there.
      store: await storeStats(env),
      owners: owners.map((x) => { const rs = resourcesOf(x.o); return { owner: `${x.kind}:${x.id}`, resources: rs, declared: rs.length, readable: rs.filter((r) => r.lastRead).length }; }),
      ...(want ? {} : { unattributedNote: 'a platform resource this manifest lists under nobody shows in the Pulse\'s Unattributed bucket; it is shown, never hidden' }),
    };
  }
  if (name === 'infra_status' || name === 'infra_metrics') {
    const rows = await readRows(env, { from: Date.now() - 2 * 86_400_000, kind: 'infra', step: 2 * 86_400_000 });
    const latest = new Map<string, InfraSampleV1>();
    for (const r of rows) { const cur = latest.get(r.id); const s = r.payload as InfraSampleV1; if (!cur || cur.at <= s.at) latest.set(r.id, s); }
    const out = [...latest.values()]
      .filter((s) => (!args.platform || s.platform === args.platform) && matchOwner(town, s, args.owner as string | undefined))
      .map((s) => {
        const owner = attributeResource(town, s.platform, s.resource, s.kind);
        const base = { platform: s.platform, account: s.account, resource: s.resource, kind: s.kind, owner: owner ? `${owner.kind}:${owner.id}` : null, status: s.status, asOf: s.asOf, lag: s.lagClass, readable: s.ok, ...(s.error ? { error: s.error } : {}) };
        return name === 'infra_metrics' ? { ...base, metrics: s.metrics } : base;
      })
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.resource.localeCompare(b.resource));
    return { resources: out, unreadable: out.filter((r) => !r.readable).length, sources: infraSources(env) };
  }
  if (name === 'infra_cost') {
    // Grouped by owner and basis below, so the SKU is summed away at the store rather than carried here row by row.
    const rows = await readRows(env, { from: Date.now() - windowMs(args.window), kind: 'cost', rollup: 'sku' });
    const latest = new Map<string, CostSampleV1>();
    for (const r of rows) { const cur = latest.get(r.id); const c = r.payload as CostSampleV1; if (!cur || cur.asOf <= c.asOf) latest.set(r.id, c); }
    const groups = new Map<string, { owner: string | null; platform: string; basis: string; microUsd: number; days: Set<string>; complete: boolean; asOf: string }>();
    for (const c of dropSupersededCostRows([...latest.values()])) {
      const o = attributeCost(town, c);
      if (args.owner && !(o && (o.id === args.owner || `${o.kind}:${o.id}` === args.owner))) continue;
      const key = `${c.platform}|${o ? `${o.kind}:${o.id}` : 'unattributed'}|${c.basis}`;
      const g = groups.get(key) ?? { owner: o ? `${o.kind}:${o.id}` : null, platform: c.platform, basis: c.basis, microUsd: 0, days: new Set<string>(), complete: true, asOf: c.asOf };
      g.microUsd += c.ok ? c.amountMicroUsd : 0; g.days.add(c.day); g.complete = g.complete && c.complete && c.ok; g.asOf = g.asOf > c.asOf ? g.asOf : c.asOf;
      groups.set(key, g);
    }
    const out = [...groups.values()].map((g) => ({ ...g, days: g.days.size, usd: Number((g.microUsd / 1e6).toFixed(6)) })).sort((a, b) => b.microUsd - a.microUsd);
    return { window: args.window ?? '7d', rows: out, complete: out.every((r) => r.complete), note: 'derived = a meter times a published unit price, our estimate; billed = what the provider invoiced; effective = what the period consumed once committed and subscription spend is amortised. They are never summed without the label — billed 0 beside a non-zero effective means the usage sat inside a plan allowance, not that it was free.' };
  }
  throw new Error(`no such tool: ${name}`);
}

app.post('/mcp', async (c) => {
  const a = authorized(c.env, c.req.header('authorization') ?? null);
  if (!a.ok) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: a.error } }, a.status);
  const req = (await c.req.json().catch(() => ({}))) as { id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } };
  const id = req.id ?? null;
  try {
    if (req.method === 'initialize') return c.json({ jsonrpc: '2.0', id, result: { protocolVersion: '2026-07-28', capabilities: { tools: {} }, serverInfo: { name: 'town-mcp', version: '0.0.1' } } });
    if (req.method === 'tools/list') return c.json({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    if (req.method === 'tools/call') {
      const name = String(req.params?.name ?? '');
      const data = await callTool(c.env, name, req.params?.arguments ?? {});
      return c.json({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data } });
    }
    return c.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${req.method}` } }, 404);
  } catch (e) {
    return c.json({ jsonrpc: '2.0', id, error: { code: -32000, message: e instanceof Error ? e.message : String(e) } }, 500);
  }
});

app.all('*', (c) => c.json({ error: 'not found' }, 404));

export default {
  async scheduled(ev: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runPass(env, ev.cron === CRON_HOURLY ? 'hourly' : ev.cron === CRON_COST ? 'cost' : 'status'));
  },
  fetch: app.fetch,
};

/** A cost row summed over its SKUs — what `rollup=sku` hands back: the day × resource × basis a reader groups by anyway. */
export type CostRollupRow = { platform: string; account: string; day: string; resource: string; scope: string | null; basis: string; amountMicroUsd: number; at: number; ok: number; asOf: string; complete: number; error: string | null };
export function rollupRow(x: CostRollupRow): StoredRow {
  const payload: CostSampleV1 = {
    type: 'ap.cost-sample.v1', platform: x.platform as CostSampleV1['platform'], account: x.account, day: x.day, resource: x.resource,
    ...(x.scope ? { scope: x.scope } : {}), amountMicroUsd: Number(x.amountMicroUsd ?? 0), basis: x.basis as CostSampleV1['basis'],
    asOf: x.asOf, complete: !!x.complete, ok: !!x.ok, ...(x.error ? { error: x.error } : {}),
  };
  return { kind: 'cost', id: `${x.platform}|${x.account}|${x.day}|${x.resource}||${x.basis}`, at: new Date(x.at).toISOString(), ok: !!x.ok, payload, ...(x.error ? { error: x.error } : {}) };
}

/** The store's schema generation: `lag` column, the cadence index, the day index, and the superseded restatements pruned once. */
const SCHEMA = 2;
const dayOfMs = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The store. A serving plane (spec 437 I1): 30 days of infra, 400 of cost, pruned by alarm. Wiping it loses trend lines, never a record.
 *
 * A READ IS BOUNDED BY WHAT THE ASKER DRAWS, NOT BY WHAT THE STORE HOLDS. The 30-day Pulse read once handed back every
 * five-minute sample of the month and every restatement of every cost day — the daily pass restates seven days, so each
 * day's rows were in the store seven times over — as ONE JSON string, and the 30d and 90d windows answered
 * `RangeError: Invalid string length` from inside this class while 24h and 7d read fine (2026-10-28). Three rules now:
 *   · a cost or month row SUPERSEDES at write time — one row per id, as I1 says a later read does;
 *   · `step` hands back one sample per cadence per bucket, the resolution the Pulse draws at (96 buckets a window);
 *   · `rollup=sku` sums a cost day's SKUs into one row per resource × basis, which is the grain every reader groups to.
 * The latest sample per (id, cadence) rides along at any age, so a quiet source still shows its last word — per
 * CADENCE, because a VM read every five minutes and every hour is two tiles with two `asOf`s (I2).
 */
export class InfraDO {
  private readonly sql: SqlStorage;
  constructor(private readonly state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rows (kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, day TEXT, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rows_at ON rows(at); CREATE INDEX IF NOT EXISTS rows_kind_id_at ON rows(kind, id, at);`);
    state.blockConcurrencyWhile(() => this.migrate());
  }
  /** Once per schema generation, in chunks that each commit, so a store too big for one go still gets there. */
  private async migrate(): Promise<void> {
    if (((await this.state.storage.get<number>('schema')) ?? 1) >= SCHEMA) return;
    // The restatements first: they are most of the bulk, and every step after this is cheaper without them.
    this.pruneSuperseded();
    try { this.sql.exec('ALTER TABLE rows ADD COLUMN lag TEXT'); } catch { /* already there */ }
    for (;;) {
      const n = this.sql.exec("UPDATE rows SET lag = json_extract(json, '$.payload.lagClass') WHERE rowid IN (SELECT rowid FROM rows WHERE kind = 'infra' AND lag IS NULL LIMIT 20000)").rowsWritten;
      if (!n) break;
    }
    this.sql.exec('CREATE INDEX IF NOT EXISTS rows_kind_id_lag_at ON rows(kind, id, lag, at); CREATE INDEX IF NOT EXISTS rows_kind_day ON rows(kind, day)');
    await this.state.storage.put('schema', SCHEMA);
  }
  /** I1 — a later read of the same day or month supersedes the earlier: keep the newest row per (kind, id). */
  private pruneSuperseded(): number {
    return this.sql.exec("DELETE FROM rows WHERE kind IN ('cost', 'cost-month') AND at < (SELECT MAX(at) FROM rows r2 WHERE r2.kind = rows.kind AND r2.id = rows.id)").rowsWritten;
  }
  private prune(): { expired: number; superseded: number } {
    const a = this.sql.exec("DELETE FROM rows WHERE kind NOT IN ('cost', 'cost-month') AND at < ?", Date.now() - RETENTION_MS).rowsWritten;
    const b = this.sql.exec("DELETE FROM rows WHERE kind IN ('cost', 'cost-month') AND at < ?", Date.now() - COST_RETENTION_MS).rowsWritten;
    return { expired: a + b, superseded: this.pruneSuperseded() };
  }
  private stats(): unknown {
    const kinds = this.sql.exec<{ kind: string; n: number; ids: number; bytes: number; oldest: number; newest: number }>('SELECT kind, COUNT(*) AS n, COUNT(DISTINCT id) AS ids, SUM(LENGTH(json)) AS bytes, MIN(at) AS oldest, MAX(at) AS newest FROM rows GROUP BY kind').toArray();
    return { ok: true, schema: SCHEMA, databaseBytes: this.sql.databaseSize, kinds: kinds.map((k) => ({ ...k, oldest: new Date(k.oldest).toISOString(), newest: new Date(k.newest).toISOString() })) };
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/put') {
      const rows = (await req.json()) as StoredRow[];
      for (const r of rows) {
        // A cost or month row restates: the earlier read of the same id is superseded, not kept beside it (I1).
        if (r.kind !== 'infra') this.sql.exec('DELETE FROM rows WHERE kind = ? AND id = ?', r.kind, r.id);
        const lag = r.kind === 'infra' ? (r.payload as InfraSampleV1).lagClass ?? null : null;
        this.sql.exec('INSERT INTO rows (kind, id, at, ok, day, json, lag) VALUES (?, ?, ?, ?, ?, ?, ?)', r.kind, r.id, Date.parse(r.at), r.ok ? 1 : 0, r.kind === 'cost' ? String((r.payload as CostSampleV1).day ?? '') : null, JSON.stringify(r), lag);
      }
      if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + 3_600_000);
      return Response.json({ ok: true, stored: rows.length });
    }
    if (url.pathname === '/read') {
      const from = Number(url.searchParams.get('from') ?? Date.now() - 86_400_000);
      const to = Number(url.searchParams.get('to') ?? Number.MAX_SAFE_INTEGER);
      const kind = url.searchParams.get('kind');
      const step = Number(url.searchParams.get('step') ?? 0);
      const rollup = url.searchParams.get('rollup') === 'sku';
      const want = (k: string): boolean => !kind || kind === k;
      const out: StoredRow[] = [];
      const seen = new Set<string>();
      const take = (json: string): void => { if (!seen.has(json)) { seen.add(json); out.push(JSON.parse(json) as StoredRow); } };
      if (want('infra')) {
        // The window's samples — every one, or the last good one per cadence per `step` — then the last word per cadence at any age.
        // The bucket is INTEGER division: a bound JS number arrives as a REAL, and `at / ?` on a REAL is a float
        // unique to every row — the bench read came back the same 149 MB stepped as raw until the cast was there.
        // The join is on `=`, which the (kind, id, lag, at) index serves and `IS` does not (22 s against 0.3 s).
        const series = step > 0
          ? this.sql.exec<{ json: string }>("SELECT r.json FROM rows r JOIN (SELECT id, lag, MAX(at) AS at FROM rows WHERE kind = 'infra' AND at >= ? AND at <= ? AND ok = 1 GROUP BY id, lag, at / CAST(? AS INTEGER)) s ON r.kind = 'infra' AND r.id = s.id AND r.lag = s.lag AND r.at = s.at ORDER BY r.at", from, to, Math.round(step))
          : this.sql.exec<{ json: string }>("SELECT json FROM rows WHERE kind = 'infra' AND at >= ? AND at <= ? ORDER BY at", from, to);
        for (const r of series) take(r.json);
        for (const r of this.sql.exec<{ json: string }>("SELECT r.json FROM rows r JOIN (SELECT id, lag, MAX(at) AS at FROM rows WHERE kind = 'infra' GROUP BY id, lag) s ON r.kind = 'infra' AND r.id = s.id AND r.lag = s.lag AND r.at = s.at")) take(r.json);
      }
      if (want('cost')) {
        // Cost is filed by the DAY it describes, not the moment it was read: a window of days, the newest read of each.
        const dayFrom = dayOfMs(from); const dayTo = to >= Number.MAX_SAFE_INTEGER ? '9999-12-31' : dayOfMs(to);
        const latest = "(SELECT id, MAX(at) AS at FROM rows WHERE kind = 'cost' AND day >= ? AND day <= ? GROUP BY id) s ON r.kind = 'cost' AND r.id = s.id AND r.at = s.at";
        if (rollup) {
          const q = `SELECT json_extract(r.json, '$.payload.platform') AS platform, json_extract(r.json, '$.payload.account') AS account, r.day AS day, json_extract(r.json, '$.payload.resource') AS resource, json_extract(r.json, '$.payload.scope') AS scope, json_extract(r.json, '$.payload.basis') AS basis,
            SUM(CASE WHEN r.ok = 1 THEN json_extract(r.json, '$.payload.amountMicroUsd') ELSE 0 END) AS amountMicroUsd, MAX(r.at) AS at, MIN(r.ok) AS ok, MAX(json_extract(r.json, '$.payload.asOf')) AS asOf, MIN(json_extract(r.json, '$.payload.complete')) AS complete, MAX(json_extract(r.json, '$.payload.error')) AS error
            FROM rows r JOIN ${latest} GROUP BY platform, account, day, resource, scope, basis ORDER BY at`;
          for (const x of this.sql.exec<CostRollupRow>(q, dayFrom, dayTo)) out.push(rollupRow(x));
        } else {
          for (const r of this.sql.exec<{ json: string }>(`SELECT r.json FROM rows r JOIN ${latest} ORDER BY r.at`, dayFrom, dayTo)) take(r.json);
        }
      }
      if (want('cost-month')) {
        // Whole months at any age — a baseline is the point, and it is a handful of rows (one per month × basis after supersession).
        for (const r of this.sql.exec<{ json: string }>("SELECT r.json FROM rows r JOIN (SELECT id, MAX(at) AS at FROM rows WHERE kind = 'cost-month' GROUP BY id) s ON r.kind = 'cost-month' AND r.id = s.id AND r.at = s.at ORDER BY r.at")) take(r.json);
      }
      return Response.json(out);
    }
    if (url.pathname === '/stats') return Response.json(this.stats());
    if (req.method === 'POST' && url.pathname === '/prune') return Response.json({ ok: true, ...this.prune(), store: this.stats() });
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  async alarm(): Promise<void> {
    // A cost row is kept far longer than a sample, and a MONTH row is the history itself — purging it at the
    // sample retention would delete the baseline a month's figure is read against (`kind != 'cost'` did exactly
    // that to `cost-month` until it was named here). The restatements a later read superseded go too (I1).
    this.prune();
    await this.state.storage.setAlarm(Date.now() + 3_600_000);
  }
}
