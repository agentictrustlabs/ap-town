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
import { TOWNS, attributeResource, type CostSampleV1, type InfraSampleV1, type ResourceOwnershipV1, type TownManifest } from '@ap-town/town-model';
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
export interface StoredRow { kind: 'infra' | 'cost'; id: string; at: string; ok: boolean; payload: InfraSampleV1 | CostSampleV1; error?: string }
export const toRow = (x: InfraSampleV1 | CostSampleV1): StoredRow =>
  x.type === 'ap.infra-sample.v1'
    ? { kind: 'infra', id: infraId(x), at: x.at, ok: x.ok, payload: x, ...(x.error ? { error: x.error } : {}) }
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
  const rows = [...pass.samples, ...pass.costs].map(toRow);
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

/** The stored rows for a window, newest-last; the latest of every (kind, id) rides along so a quiet source still shows its last word. */
async function readRows(env: Env, q: { from: number; to?: number; kind?: string }): Promise<StoredRow[]> {
  if (!env.INFRA) return [];
  const u = new URL('https://infra/read');
  u.searchParams.set('from', String(q.from));
  if (q.to !== undefined) u.searchParams.set('to', String(q.to));
  if (q.kind) u.searchParams.set('kind', q.kind);
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
  return c.json(await readRows(c.env, { from, ...(to !== undefined ? { to } : {}), ...(kind ? { kind } : {}) }));
});

app.post('/infra/pass', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { which?: string };
  const which = body.which === 'hourly' || body.which === 'cost' ? body.which : 'status';
  const pass = await runPass(c.env, which);
  return c.json({ ok: true, which, samples: pass.samples.length, costs: pass.costs.length, unreadable: pass.unreadable });
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
    // The last reading per resource, so "declared but never read" is visible as itself.
    const rows = await readRows(env, { from: Date.now() - 2 * 86_400_000, kind: 'infra' });
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
      owners: owners.map((x) => { const rs = resourcesOf(x.o); return { owner: `${x.kind}:${x.id}`, resources: rs, declared: rs.length, readable: rs.filter((r) => r.lastRead).length }; }),
      ...(want ? {} : { unattributedNote: 'a platform resource this manifest lists under nobody shows in the Pulse\'s Unattributed bucket; it is shown, never hidden' }),
    };
  }
  if (name === 'infra_status' || name === 'infra_metrics') {
    const rows = await readRows(env, { from: Date.now() - 2 * 86_400_000, kind: 'infra' });
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
    const rows = await readRows(env, { from: Date.now() - windowMs(args.window), kind: 'cost' });
    const latest = new Map<string, CostSampleV1>();
    for (const r of rows) { const cur = latest.get(r.id); const c = r.payload as CostSampleV1; if (!cur || cur.asOf <= c.asOf) latest.set(r.id, c); }
    const groups = new Map<string, { owner: string | null; platform: string; basis: string; microUsd: number; days: Set<string>; complete: boolean; asOf: string }>();
    for (const c of latest.values()) {
      const o = c.resource === '*' ? null : attributeResource(town, c.platform, c.resource);
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

/** The store. A serving plane (spec 437 I1): 30 days of infra, 400 of cost, pruned by alarm. Wiping it loses trend lines, never a record. */
export class InfraDO {
  private readonly sql: SqlStorage;
  constructor(private readonly state: DurableObjectState) {
    this.sql = state.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS rows (kind TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL, ok INTEGER NOT NULL, day TEXT, json TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS rows_at ON rows(at); CREATE INDEX IF NOT EXISTS rows_kind_id_at ON rows(kind, id, at);`);
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'POST' && url.pathname === '/put') {
      const rows = (await req.json()) as StoredRow[];
      for (const r of rows) this.sql.exec('INSERT INTO rows (kind, id, at, ok, day, json) VALUES (?, ?, ?, ?, ?, ?)', r.kind, r.id, Date.parse(r.at), r.ok ? 1 : 0, r.kind === 'cost' ? String((r.payload as CostSampleV1).day ?? '') : null, JSON.stringify(r));
      if ((await this.state.storage.getAlarm()) === null) await this.state.storage.setAlarm(Date.now() + 3_600_000);
      return Response.json({ ok: true, stored: rows.length });
    }
    if (url.pathname === '/read') {
      const from = Number(url.searchParams.get('from') ?? Date.now() - 86_400_000);
      const to = Number(url.searchParams.get('to') ?? Number.MAX_SAFE_INTEGER);
      const kind = url.searchParams.get('kind');
      const rows = kind
        ? this.sql.exec<{ json: string }>('SELECT json FROM rows WHERE kind = ? AND at >= ? AND at <= ? ORDER BY at', kind, from, to).toArray()
        : this.sql.exec<{ json: string }>('SELECT json FROM rows WHERE at >= ? AND at <= ? ORDER BY at', from, to).toArray();
      // The latest of every (kind, id) rides along even when older than the window, so a quiet source still shows its
      // last word — but it must honour the SAME kind filter as the window query. It did not, so a `kind=infra` read
      // also handed back the latest cost rows; a cost payload has no `at`, and the first caller to touch one threw
      // `Cannot read properties of undefined (reading 'startsWith')` and failed the whole cost pass (2026-10-11).
      // Latent until an account had both an infra and a cost row for the same platform.
      const latest = kind
        ? this.sql.exec<{ json: string }>('SELECT json FROM rows r WHERE kind = ? AND at = (SELECT MAX(at) FROM rows WHERE kind = r.kind AND id = r.id)', kind).toArray()
        : this.sql.exec<{ json: string }>('SELECT json FROM rows r WHERE at = (SELECT MAX(at) FROM rows WHERE kind = r.kind AND id = r.id)').toArray();
      const seen = new Set<string>();
      const all = [...rows, ...latest].map((r) => JSON.parse(r.json) as StoredRow).filter((r) => { const k = `${r.kind}|${r.id}|${r.at}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return Response.json(all);
    }
    return Response.json({ error: 'not found' }, { status: 404 });
  }
  async alarm(): Promise<void> {
    this.sql.exec("DELETE FROM rows WHERE kind != 'cost' AND at < ?", Date.now() - RETENTION_MS);
    this.sql.exec("DELETE FROM rows WHERE kind = 'cost' AND at < ?", Date.now() - COST_RETENTION_MS);
    await this.state.storage.setAlarm(Date.now() + 3_600_000);
  }
}
