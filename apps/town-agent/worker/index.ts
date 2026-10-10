// The town agent — "what does this town offer, and is it healthy?" (spec 429 §2.2, R2).
//
// An A2A 1.0 agent on the standard server (@agenticprimitives/a2a/standard). It is PUBLIC and READ-ONLY: it holds no
// key, admits no principal, creates no task, and answers every message with a message built from the town manifest
// (packages/town-model, generated from towns/<chain>/town.yaml) and live probes. It lists; it never grants (D2).
//
//   GET  /.well-known/agent-card.json      the card (A2A 1.0)
//   POST /a2a                              JSON-RPC: SendMessage — a data part {skill:'town.describe'} |
//                                          {skill:'town.service', id} | any text (matched against service ids)
//   GET  /api/town · /api/services · /api/services/:id · /api/estates · /api/find?q= · /api/health
//   GET  everything else                   the Town portal (the built app in ./dist)
import { createStandardA2aServer, type AgentCardV1, type MessageV1, type PartV1 } from '@agenticprimitives/a2a/standard';
import { TOWNS, type TownManifest } from '@ap-town/town-model';
import { describe, serviceViews, townSummary, type Probe, type ServiceView } from './signals';
import { samplePulse, readPulse, type PulseSampleV1, type PulseEnv } from './pulse';
import { recordDay, pulseRecordReadiness, contextAgents, type PulseRecordEnv } from './pulse-record';
import { PERF_WINDOWS, operatorAuthorized, readPerformance, type InfraRowV1, type PerfWindow } from './pulse-perf';
import { resolveAgentCard, createStandardA2aClient } from '@agenticprimitives/a2a/standard';
export { HeartbeatDO } from './pulse';

interface Env {
  TOWN: string;
  PUBLIC_ORIGIN: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** The town's registry and naming service, over service bindings — the portal's Find and Names areas. */
  REGISTRY?: { fetch(req: Request): Promise<Response> };
  NAMING?: { fetch(req: Request): Promise<Response> };
  /** Spec 434 §10 / 436 §5.3 — the Pulse: the two metered gateways over service bindings, the estates over their heartbeat tokens, the sample store. */
  CHAIN?: { fetch(req: Request): Promise<Response> };
  INFERENCE?: { fetch(req: Request): Promise<Response> };
  TOWN_OPS_TOKEN?: string;
  ESTATE_HEARTBEAT_TOKENS?: string;
  HEARTBEAT?: DurableObjectNamespace;
  /** Spec 436 §5.5 — the Town Ask: the context agents (by name) whose vaults keep the Pulse's record and whose doors answer. */
  CONTEXT_AGENTS?: string;
  CONTEXT_AGENT_ZONE?: string;
  CONTEXT_AGENT_CREDENTIALS?: string;
  TOWN_SIGNER_KEY?: string;
  VAULT_URL?: string;
  VAULT_AUDIENCE?: string;
  CHAIN_ID?: string;
  /**
   * Spec 437 §4 (the owner's rule, 2026-10-10: "the town app should not retrieve this data; the town or estate MCP
   * should"). The town's PRIVATE MCP — the only thing in the town that holds a platform read credential and the only
   * thing that talks to Cloudflare, Vercel, Azure or GraphDB. This Worker asks it over a service binding and holds
   * nothing. Unbound ⇒ the Infra and Performance tabs say the MCP is not bound, never zeros.
   */
  INFRA?: { fetch(req: Request): Promise<Response> };
}

/** The town MCP's stored infra + cost rows for a window. `[]` is "nothing collected yet", which the tab says. */
export async function infraRowsFrom(env: Env, fromMs: number): Promise<{ rows: InfraRowV1[]; unavailable: string | null }> {
  if (!env.INFRA) return { rows: [], unavailable: 'the town MCP is not bound on this deployment' };
  if (!env.TOWN_OPS_TOKEN) return { rows: [], unavailable: 'this deployment has no town ops token, so it cannot read the town MCP' };
  try {
    const r = await env.INFRA.fetch(new Request(`https://town-mcp/infra/read?from=${fromMs}`, { headers: { accept: 'application/json', authorization: `Bearer ${env.TOWN_OPS_TOKEN}` }, signal: AbortSignal.timeout(15_000) }));
    if (!r.ok) return { rows: [], unavailable: `the town MCP answered ${r.status}` };
    return { rows: (await r.json()) as InfraRowV1[], unavailable: null };
  } catch (e) { return { rows: [], unavailable: `the town MCP could not be asked: ${e instanceof Error ? e.message : String(e)}` }; }
}

/** What the town MCP says it is configured with — the agent's own account of its servers and its security (names only). */
export async function infraConfigFrom(env: Env, owner?: string): Promise<unknown> {
  if (!env.INFRA) return { ok: false, error: 'the town MCP is not bound on this deployment' };
  if (!env.TOWN_OPS_TOKEN) return { ok: false, error: 'this deployment has no town ops token' };
  try {
    const r = await env.INFRA.fetch(new Request(`https://town-mcp/infra/config${owner ? `?owner=${encodeURIComponent(owner)}` : ''}`, { headers: { accept: 'application/json', authorization: `Bearer ${env.TOWN_OPS_TOKEN}` }, signal: AbortSignal.timeout(15_000) }));
    return r.ok ? await r.json() : { ok: false, error: `the town MCP answered ${r.status}` };
  } catch (e) { return { ok: false, error: `the town MCP could not be asked: ${e instanceof Error ? e.message : String(e)}` }; }
}

const VERSION = '0.1.0';

export function townOf(env: Env): TownManifest {
  const t = TOWNS[env.TOWN];
  if (!t) throw new Error(`TOWN "${env.TOWN}" is not a town this build knows (${Object.keys(TOWNS).join(', ')})`);
  return t;
}

export function cardFor(town: TownManifest, origin: string): AgentCardV1 {
  return {
    name: `${town.town} town`,
    description: `The ${town.town} town's own agent: which estates live on chain ${town.chain.id}, which services they share, and whether each is up. It lists; it never grants — whether you may use a service is your own delegation's question.`,
    version: VERSION,
    supportedInterfaces: [{ url: `${origin}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    provider: { organization: `The ${town.town} town`, url: origin },
    documentationUrl: `${origin}/`,
    skills: [
      { id: 'town.describe', name: 'Describe the town', description: 'The chain, the estates and every listed service, each with its signals: listed · healthy · compatible.', tags: ['town', 'directory', 'health'], examples: ['what is in this town?', 'which services are up?'] },
      { id: 'town.service', name: 'One service', description: 'One listed service by id — what it is, who deploys it, where it lives, and its signals.', tags: ['town', 'service', 'health'], examples: ['registry', 'skills', 'kms'] },
    ],
  };
}

const fetchProbe: Probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual', headers: { 'user-agent': 'ap-town-agent' } });
    return { status: r.status };
  } catch (e) { return { error: (e as Error).name }; }
};

/** What a message asks for. A data part naming a skill wins; otherwise text is matched against service ids. */
export function intentOf(message: MessageV1, town: TownManifest): { skill: 'town.describe' } | { skill: 'town.service'; id: string } | { skill: 'unknown-service'; id: string } {
  for (const p of message.parts) {
    const d = p.data as { skill?: unknown; id?: unknown } | undefined;
    if (d && d.skill === 'town.service' && typeof d.id === 'string') {
      return town.services.some((s) => s.id === d.id) ? { skill: 'town.service', id: d.id } : { skill: 'unknown-service', id: d.id };
    }
    if (d && d.skill === 'town.describe') return { skill: 'town.describe' };
  }
  const text = message.parts.map((p) => p.text ?? '').join(' ').toLowerCase();
  const hit = town.services.find((s) => new RegExp(`\\b${s.id.replace(/-/g, '[- ]')}\\b`).test(text));
  return hit ? { skill: 'town.service', id: hit.id } : { skill: 'town.describe' };
}

function reply(parts: PartV1[]): PartV1[] { return parts; }

export async function answer(town: TownManifest, message: MessageV1, probe: Probe, selfHost: string | null): Promise<PartV1[]> {
  const intent = intentOf(message, town);
  if (intent.skill === 'unknown-service') {
    return reply([{ text: `"${intent.id}" is not a service listed in the ${town.town} town. Listed: ${town.services.map((s) => s.id).join(', ')}.` }]);
  }
  const views = await serviceViews(town, probe, selfHost);
  if (intent.skill === 'town.service') {
    const v = views.find((x) => x.id === intent.id) as ServiceView;
    return reply([
      { text: `${v.id} (${v.kind}) — ${v.description} Deployed from ${v.repo}${v.hosts.length ? ` at ${v.hosts.join(', ')}` : ''}. Healthy: ${v.signals.healthy}${v.signals.healthDetail ? ` (${v.signals.healthDetail})` : ''}. ${v.authorized}` },
      { data: { service: v }, mediaType: 'application/json' },
    ]);
  }
  return reply([
    { text: describe(town, views) },
    { data: { ...townSummary(town), services: views }, mediaType: 'application/json' },
  ]);
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', ...extra } });

/** Ask a bound town service for JSON; `null` when it is not bound or does not answer (said so, never guessed). */
async function ask<T>(svc: { fetch(req: Request): Promise<Response> } | undefined, url: string, init?: RequestInit): Promise<T | null> {
  if (!svc) return null;
  try { const r = await svc.fetch(new Request(url, { ...init, headers: { accept: 'application/json', ...(init?.headers ?? {}) } })); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}

/** The operator's "collect now": forwarded to the town MCP, which does the collecting. This Worker reaches no provider. */
async function runPassVia(env: Env, which: string, authorization: string | null): Promise<Response> {
  if (!operatorAuthorized(env.TOWN_OPS_TOKEN, authorization)) return json({ ok: false, error: 'a pass is run with the town ops token' }, 401);
  if (!env.INFRA) return json({ ok: false, error: 'the town MCP is not bound on this deployment' }, 503);
  try {
    const r = await env.INFRA.fetch(new Request('https://town-mcp/infra/pass', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.TOWN_OPS_TOKEN}` }, body: JSON.stringify({ which }), signal: AbortSignal.timeout(110_000) }));
    return json(await r.json().catch(() => ({ ok: false, error: `the town MCP answered ${r.status}` })), r.ok ? 200 : 502);
  } catch (e) { return json({ ok: false, error: `the town MCP could not be asked: ${e instanceof Error ? e.message : String(e)}` }, 502); }
}

async function api(path: string, url: URL, env: Env, town: TownManifest, selfHost: string, origin: string, authorization: string | null = null, method = 'GET'): Promise<Response> {
  if (path === '/pulse/pass') return method === 'POST' ? runPassVia(env, url.searchParams.get('which') ?? 'status', authorization) : json({ error: 'POST, with the town ops token' }, 405);
  if (path === '/health') return json({ ok: true, service: 'town-agent', town: town.town, pulseRecord: pulseRecordReadiness(env as PulseRecordEnv), contextAgents: contextAgents(env as PulseRecordEnv), townMcp: env.INFRA ? 'bound' : 'not bound on this deployment' });
  if (path === '/estates') return json(townSummary(town).estates);
  // WHAT THIS AGENT IS CONFIGURED WITH (the owner's rule, 2026-10-10): which servers the town — or one estate,
  // service or application — declares, and which read credentials the town MCP holds, BY NAME. Never a value: the
  // credentials live only in the MCP, and this Worker could not print one if it tried.
  if (path === '/config') return json(await infraConfigFrom(env, url.searchParams.get('owner') ?? undefined), 200, { 'cache-control': 'public, max-age=60' });
  if (path === '/town') {
    const [services, names] = await Promise.all([serviceViews(town, fetchProbe, selfHost), ask<unknown>(env.NAMING, 'https://naming/api/town')]);
    return json({ ...townSummary(town), services, names, card: `${origin}/.well-known/agent-card.json` }, 200, { 'cache-control': 'public, max-age=30' });
  }
  if (path === '/services') return json(await serviceViews(town, fetchProbe, selfHost));
  const m = path.match(/^\/services\/([a-z0-9-]+)$/);
  if (m) {
    const v = (await serviceViews(town, fetchProbe, selfHost)).find((x) => x.id === m[1]);
    return v ? json(v) : json({ error: `no service "${m[1]}" in the ${town.town} town` }, 404);
  }
  // The registry, as the portal's Find area (the discovery explorer, folded in — spec 429 §7.3). Every answer is the
  // registry's own; the portal adds nothing to it. A listing is a fact, not a permission.
  if (path === '/find') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const type = (url.searchParams.get('type') ?? '').trim();
    const registered = url.searchParams.get('registered') === '1';
    if (!q && !type && !registered) return json({ error: 'say what you are looking for' }, 400);
    const mandates: Record<string, unknown> = { requireRegistered: registered };
    if (type) { if (['person', 'org', 'service'].includes(type)) mandates.requireKind = type; else mandates.requireAgentType = type; }
    const r = await ask<Record<string, unknown>>(env.REGISTRY, 'https://registry/discover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(q ? { intent: { need: q } } : {}), mandates }) });
    return r ? json({ query: q, type, registered, ...r }) : json({ error: 'the registry could not be asked just now' }, 502);
  }
  if (path === '/facets') {
    const r = await ask<unknown>(env.REGISTRY, 'https://registry/facets');
    return r ? json(r, 200, { 'cache-control': 'public, max-age=120' }) : json({ error: 'the registry could not be asked just now' }, 502);
  }
  const ag = path.match(/^\/agent\/(0x[0-9a-fA-F]{40}|[a-z0-9.@-]+)$/);
  if (ag) {
    const key = ag[1]!;
    const [agent, offerings] = await Promise.all([
      ask<Record<string, unknown>>(env.REGISTRY, `https://registry/agent?key=${encodeURIComponent(key)}`),
      ask<Record<string, unknown>>(env.REGISTRY, `https://registry/offerings?key=${encodeURIComponent(key)}`),
    ]);
    if (!agent) return json({ error: 'the registry could not be asked just now' }, 502);
    return json({ key, agent, offerings });
  }
  // The Pulse (spec 434 §10 / 436 §5.3): the latest sample per source and the series for a window, from the store the
  // cron fills. Public: everything here is aggregate — probes, gateway rollups, estate counts — never a person's record.
  if (path === '/pulse') {
    if (!env.HEARTBEAT) return json({ error: 'no sample store is bound on this deployment' }, 503);
    const window = (PERF_WINDOWS as string[]).includes(url.searchParams.get('window') ?? '') ? (url.searchParams.get('window') as PerfWindow) : '24h';
    const nowMs = Date.now();
    const from = nowMs - (window === '90d' ? 90 : window === '30d' ? 30 : window === '7d' ? 7 : 1) * 86_400_000;
    const r = await env.HEARTBEAT.get(env.HEARTBEAT.idFromName(town.town)).fetch(`https://pulse/read?from=${from}`);
    const samples = (await r.json()) as PulseSampleV1[];
    // Spec 437 / 434 §10: infra STATUS and the provenance block are public; cost amounts and infra metrics are the operator's
    // (the one town ops token, `authorization: Bearer …`) — withheld, said so (`detail: false`), never zeroed.
    const detail = operatorAuthorized(env.TOWN_OPS_TOKEN, authorization);
    const infra = await infraRowsFrom(env, from);
    const performance = readPerformance(town, samples, infra.rows, { window, nowMs, detail });
    return json({ ...readPulse(town, samples, window === '90d' ? '30d' : window), performance: { ...performance, ...(infra.unavailable ? { unavailable: infra.unavailable } : {}) } }, 200, detail ? { 'cache-control': 'private, no-store' } : { 'cache-control': 'public, max-age=60' });
  }
  // THE TOWN ASK (spec 436 §5.5 T4): a question goes to the context agent's A2A door as a stranger; the portal relays
  // the answer and names who said it. No key, no session, no rewrite here. Until the agent is chartered: said so.
  if (path === '/ask') {
    const q = (url.searchParams.get('q') ?? '').trim();
    const scope = url.searchParams.get('scope') === 'estate' ? 'estate' : 'town';
    if (!q) return json({ ok: false, error: 'say what you want to know' }, 400);
    const cfg = contextAgents(env as PulseRecordEnv);
    const estateId = url.searchParams.get('estate') ?? town.estates[0]?.id ?? '';
    const name = scope === 'town' ? cfg.town : cfg.estates[estateId];
    if (!name) return json({ ok: false, error: 'not_configured', detail: `the ${scope} context agent is not chartered yet (spec 436 §5.5 T1: ${scope === 'town' ? 'faith-town.workspace' : `${estateId}'s estate agent`} under demo-admin) — the Pulse's tabs show the live numbers meanwhile` }, 503);
    const zone = env.CONTEXT_AGENT_ZONE ?? town.estates[0]?.agentZone ?? '';
    const host = `${name.split('.')[0]}-${name.split('.')[1]}.${zone}`;
    try {
      const resolved = await resolveAgentCard(`https://${host}/.well-known/agent-card.json`, fetch);
      const client = createStandardA2aClient({ endpoint: resolved.endpoint, fetch });
      const a = await client.ask(q, { timeoutMs: 45_000 });
      const data = (a.task?.artifacts ?? []).flatMap((x: { parts?: Array<{ data?: unknown }> }) => x.parts ?? []).map((p) => p.data).find((d) => d && typeof d === 'object') as { cited?: Array<{ key: string; day?: string }>; runRef?: string } | undefined;
      return json({ ok: true, answer: a.text || '(no words)', agent: name, ...(data?.cited ? { cited: data.cited } : {}), ...(data?.runRef ? { runRef: data.runRef } : {}) });
    } catch (e) { return json({ ok: false, error: 'unreachable', detail: `${name} at ${host} did not answer: ${e instanceof Error ? e.message : String(e)}` }, 502); }
  }
  return json({ error: 'not found' }, 404);
}

/** The sampler: every five minutes (wrangler `[triggers]`), one pass over every source into the store. */
export async function takeSample(env: Env, town: TownManifest): Promise<number> {
  if (!env.HEARTBEAT) return 0;
  const samples = await samplePulse(town, env as PulseEnv, fetchProbe, fetch, new URL(env.PUBLIC_ORIGIN).host);
  const store = env.HEARTBEAT.get(env.HEARTBEAT.idFromName(town.town));
  await store.fetch('https://pulse/put', { method: 'POST', body: JSON.stringify(samples) });
  // Once an hour (the first pass of the hour) the day's rollup goes to the context agents' vaults — the record (436 §5.5 T2).
  if (new Date().getUTCMinutes() < 5 && pulseRecordReadiness(env as PulseRecordEnv).ready) {
    const day = new Date().toISOString().slice(0, 10);
    const all = (await (await store.fetch(`https://pulse/read?from=${Date.parse(day)}`)).json()) as PulseSampleV1[];
    const landed = await recordDay(env as PulseRecordEnv, all, day, fetch, town, (await infraRowsFrom(env, Date.parse(day))).rows);
    for (const l of landed) if (!l.ok) console.warn(`[pulse-record] ${l.agent} ${l.recordType}: ${l.error}`);
  }
  return samples.length;
}


export default {
  // The portal's own clock samples what it can read without a credential: the service probes, the two gateways'
  // rollups, each estate's heartbeat. Infrastructure, cost and performance are the town MCP's three cadences on its
  // own Worker — this one holds no provider credential and reaches no provider (spec 437 §4).
  async scheduled(_ev: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(takeSample(env, townOf(env)));
  },
  async fetch(req: Request, env: Env): Promise<Response> {
    const town = townOf(env);
    const origin = env.PUBLIC_ORIGIN.replace(/\/$/, '');
    const url = new URL(req.url);
    const selfHost = new URL(origin).host;
    const card = cardFor(town, origin);

    if (req.method === 'GET' && (url.pathname === '/.well-known/agent-card.json' || url.pathname === '/.well-known/agent.json')) {
      return json(card, 200, { 'cache-control': 'public, max-age=300', etag: `"${town.town}-${VERSION}"` });
    }
    if (url.pathname.startsWith('/api/')) {
      // Read-only, with one exception: an operator may tell the town MCP to collect now (`POST /api/pulse/pass`).
      // The MCP does the collecting; this Worker holds no provider credential and reaches no provider.
      const path = url.pathname.slice(4).replace(/\/+$/, '') || '/';
      if (req.method !== 'GET' && !(req.method === 'POST' && path === '/pulse/pass')) return json({ error: 'read only' }, 405);
      return api(path, url, env, town, selfHost, origin, req.headers.get('authorization'), req.method);
    }
    if (url.pathname === '/a2a') {
      const server = createStandardA2aServer({
        card,
        // No task is ever created — every message is answered with a message — so no task is anybody's to see.
        canSeeTask: () => false,
        executor: { async execute(ctx) { await ctx.reply(await answer(town, ctx.message, fetchProbe, selfHost)); } },
      });
      return server.handle(req);
    }
    return env.ASSETS.fetch(req);
  },
};
