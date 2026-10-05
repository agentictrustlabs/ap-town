// The town agent — "what does this town offer, and is it healthy?" (spec 429 §2.2, R2).
//
// An A2A 1.0 agent on the standard server (@agenticprimitives/a2a/standard). It is PUBLIC and READ-ONLY: it holds no
// key, admits no principal, creates no task, and answers every message with a message built from the town manifest
// (packages/town-model, generated from towns/<chain>/town.yaml) and live probes. It lists; it never grants (D2).
//
//   GET  /.well-known/agent-card.json      the card (A2A 1.0)
//   POST /                                 JSON-RPC: SendMessage — a data part {skill:'town.describe'} |
//                                          {skill:'town.service', id} | any text (matched against service ids)
//   GET  /town · /services · /services/:id · /estates · /health      the same answers as JSON
import { createStandardA2aServer, type AgentCardV1, type MessageV1, type PartV1 } from '@agenticprimitives/a2a/standard';
import { TOWNS, type TownManifest } from '@ap-town/town-model';
import { describe, serviceViews, townSummary, type Probe, type ServiceView } from './signals';

interface Env { TOWN: string; PUBLIC_ORIGIN: string }

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
    supportedInterfaces: [{ url: `${origin}/`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }],
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    provider: { organization: `The ${town.town} town`, url: origin },
    documentationUrl: 'https://github.com/agentictrustlabs/ap-town',
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
    if (req.method === 'GET') {
      if (url.pathname === '/health') return json({ ok: true, service: 'town-agent', town: town.town });
      if (url.pathname === '/estates') return json(townSummary(town).estates);
      if (url.pathname === '/town' || url.pathname === '/') return json({ ...townSummary(town), services: await serviceViews(town, fetchProbe, selfHost), card: `${origin}/.well-known/agent-card.json` });
      if (url.pathname === '/services') return json(await serviceViews(town, fetchProbe, selfHost));
      const m = url.pathname.match(/^\/services\/([a-z0-9-]+)$/);
      if (m) {
        const v = (await serviceViews(town, fetchProbe, selfHost)).find((x) => x.id === m[1]);
        return v ? json(v) : json({ error: `no service "${m[1]}" in the ${town.town} town` }, 404);
      }
      return json({ error: 'not found' }, 404);
    }

    const server = createStandardA2aServer({
      card,
      // No task is ever created — every message is answered with a message — so no task is anybody's to see.
      canSeeTask: () => false,
      executor: {
        async execute(ctx) { await ctx.reply(await answer(town, ctx.message, fetchProbe, selfHost)); },
      },
    });
    return server.handle(req);
  },
};
