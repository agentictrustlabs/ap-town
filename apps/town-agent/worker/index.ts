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

interface Env {
  TOWN: string;
  PUBLIC_ORIGIN: string;
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** The town's registry and naming service, over service bindings — the portal's Find and Names areas. */
  REGISTRY?: { fetch(req: Request): Promise<Response> };
  NAMING?: { fetch(req: Request): Promise<Response> };
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

async function api(path: string, url: URL, env: Env, town: TownManifest, selfHost: string, origin: string): Promise<Response> {
  if (path === '/health') return json({ ok: true, service: 'town-agent', town: town.town });
  if (path === '/estates') return json(townSummary(town).estates);
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
  if (path === '/find') {
    // The registry's search, as the portal's Find area. A listing is a fact, not a permission.
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q) return json({ error: 'say what you are looking for' }, 400);
    const r = await ask<{ results?: unknown[] }>(env.REGISTRY, 'https://registry/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: { text: q }, limit: 24 }) });
    return r ? json({ query: q, results: r.results ?? [] }) : json({ error: 'the registry could not be asked just now' }, 502);
  }
  return json({ error: 'not found' }, 404);
}

export default {
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
      if (req.method !== 'GET') return json({ error: 'read only' }, 405);
      return api(url.pathname.slice(4).replace(/\/+$/, '') || '/', url, env, town, selfHost, origin);
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
