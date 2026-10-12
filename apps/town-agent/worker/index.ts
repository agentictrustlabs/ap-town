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
import { TOWNS, allMcpServers, attributeEndpoint, estateMcpServers, estateOf, estateRoster, placeAgent, placeAgents, sourceUrlOf, type AgentRosterRow, type InfraSampleV1, type TownManifest } from '@ap-town/town-model';
import { agentCardHost, contextAgentViews, describe, serviceViews, townSummary, type Probe, type ServiceView } from './signals';
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
/** The capability a context agent offers a stranger (spec 436 §5.5 T3) — the runtime's public lane allows it by this id. */
const PULSE_PUBLIC_ASK = 'pulse.public.ask';

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

/** Knock on every declared MCP door, in parallel and ONCE each. `up: null` where no probe is declared, which
 *  is a DIFFERENT answer from down: a binding-only server has no door to knock on and is not therefore broken.
 *  Shared by the census and the estate page so the same server never reads "answers" on one and "not probed"
 *  on the other — two pages disagreeing about a door is worse than neither saying anything. */
async function probeMcp<T extends { probe?: string }>(servers: T[], probe: Probe): Promise<Array<T & { up: boolean | null; status?: number }>> {
  return Promise.all(servers.map(async (m) => {
    if (!m.probe) return { ...m, up: null };
    const r = await probe(m.probe);
    const status = 'status' in r ? r.status : 0;
    return { ...m, up: status >= 200 && status < 400, status };
  }));
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
      // Spec 435 §7. Both read the SAME things the portal's pages read, so an agent and a reader are never told
      // different things about one estate. `town.standing` is deliberately absent: it would report a
      // `TownStanding` attestation, and none exists yet (435 W1) — a skill that can only answer "none" is worse
      // than no skill, because a caller cannot tell it apart from a town where nobody has standing.
      { id: 'town.estate', name: 'One estate', description: 'One estate of this town by id — where it lives, the name roots it may give and the gate that authorizes them, whose keys hold it, the MCP servers it declares, and which agents answer at its hosts. Membership is INFERRED from each agent\'s own on-chain endpoint and every row says so; no attestation of membership exists yet. Args: a data part { "skill": "town.estate", "id": "<estate id>" }, or name the estate in the text.', tags: ['town', 'estate', 'directory'], examples: ['tell me about the faithnet estate', 'which agents are in imbnet?'] },
      { id: 'town.mcp', name: 'The MCP servers', description: 'Which MCP servers this town runs, which each estate runs, and which agents serve a door of their own. The first two are DECLARED in the town manifest; the third is read from the chain. What an agent has ATTACHED is absent by construction: those are records in its owner\'s vault under her own grant. No tool lists — those belong to each server\'s own signed manifest. An endpoint says where a server listens, never that you may use it.', tags: ['town', 'mcp', 'directory'], examples: ['which mcp servers are here?', 'what mcp does faithnet run?'] },
    ],
  };
}

const fetchProbe: Probe = async (url) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: 'manual', headers: { 'user-agent': 'ap-town-agent' } });
    return { status: r.status };
  } catch (e) { return { error: (e as Error).name }; }
};

export type TownIntent =
  | { skill: 'town.describe' }
  | { skill: 'town.service'; id: string }
  | { skill: 'unknown-service'; id: string }
  | { skill: 'town.estate'; id: string }
  | { skill: 'unknown-estate'; id: string }
  | { skill: 'town.mcp'; estate?: string };

/**
 * WHAT A MESSAGE ASKS FOR. A data part naming a skill wins; otherwise the text is matched, in an order the
 * collisions decide:
 *
 *   1. A SERVICE ID, first and unchanged. Two of this town's services are themselves named `…-mcp`, so
 *      "is discovery-mcp up" has to reach the service answer rather than the census; matching the specific
 *      id before the generic word is what keeps that true.
 *   2. The word MCP, which no estate id contains. An estate named alongside it scopes the census to that
 *      estate rather than changing the question.
 *   3. An ESTATE ID on its own.
 *
 * It is a MATCHER, not an understanding — the same deliberate ceiling `pulse.public.ask` keeps. A wrong
 * match answers a question nobody asked and says which one it answered; a model would compose a confident
 * sentence out of the same uncertainty.
 */
export function intentOf(message: MessageV1, town: TownManifest): TownIntent {
  for (const p of message.parts) {
    const d = p.data as { skill?: unknown; id?: unknown } | undefined;
    if (d && d.skill === 'town.service' && typeof d.id === 'string') {
      return town.services.some((s) => s.id === d.id) ? { skill: 'town.service', id: d.id } : { skill: 'unknown-service', id: d.id };
    }
    if (d && d.skill === 'town.estate' && typeof d.id === 'string') {
      return town.estates.some((e) => e.id === d.id) ? { skill: 'town.estate', id: d.id } : { skill: 'unknown-estate', id: d.id };
    }
    if (d && d.skill === 'town.mcp') return { skill: 'town.mcp', ...(typeof d.id === 'string' && town.estates.some((e) => e.id === d.id) ? { estate: d.id } : {}) };
    if (d && d.skill === 'town.describe') return { skill: 'town.describe' };
  }
  const text = message.parts.map((p) => p.text ?? '').join(' ').toLowerCase();
  const hit = town.services.find((s) => new RegExp(`\\b${s.id.replace(/-/g, '[- ]')}\\b`).test(text));
  if (hit) return { skill: 'town.service', id: hit.id };
  const estate = town.estates.find((e) => new RegExp(`\\b${e.id.replace(/-/g, '[- ]')}\\b`).test(text));
  if (/\bmcps?\b|\bmcp servers?\b/.test(text)) return { skill: 'town.mcp', ...(estate ? { estate: estate.id } : {}) };
  if (estate) return { skill: 'town.estate', id: estate.id };
  return { skill: 'town.describe' };
}

function reply(parts: PartV1[]): PartV1[] { return parts; }

/** The roster, or `null` when the registry could not be asked. A PORT: the A2A answer and the portal's routes
 *  read the same rows, and neither invents an empty town out of an unreachable registry. */
export type RosterRead = () => Promise<{ rows: AgentRosterRow[]; truncated: boolean } | null>;

/** ONE ESTATE, BUILT ONCE (spec 435 §4). `/api/estate/:id` and the `town.estate` skill both compose from this,
 *  so a reader and an agent are never told different things about one estate. */
export async function estateView(town: TownManifest, estateId: string, probe: Probe, roster: RosterRead | undefined) {
  const estate = estateOf(town, estateId);
  if (!estate) return null;
  const read = roster ? await roster() : null;
  return {
    estate,
    mcpServers: await probeMcp(estateMcpServers(town, estate.id), probe),
    // UNREACHABLE AND EMPTY ARE DIFFERENT ANSWERS. An estate rendered with no agents because a service
    // binding was down is the most convincing lie either door could tell. `read` and `truncated` ride along
    // so "none were placed" is always said with the denominator it was placed out of.
    agents: read
      ? { ...estateRoster(read.rows, town, estate.id), read: read.rows.length, truncated: read.truncated }
      : { unavailable: 'the registry could not be asked just now, so this estate\u2019s agents are unknown rather than none' },
  };
}

/** THE MCP CENSUS, BUILT ONCE (spec 435 §5) — shared by `/api/mcp` and the `town.mcp` skill for the same reason. */
export async function mcpCensusView(town: TownManifest, probe: Probe, roster: RosterRead | undefined, estateId?: string) {
  const read = roster ? await roster() : null;
  const declared = estateId ? estateMcpServers(town, estateId) : allMcpServers(town);
  return {
    town: town.town,
    ...(estateId ? { estate: estateId } : {}),
    servers: await probeMcp(declared, probe),
    // An agent's own door is on the CHAIN, not in the manifest. Scoped to one estate when one was named,
    // using the same placement the estate page uses — and an unplaced agent is never silently assigned.
    agentDoors: read
      ? {
          rows: placeAgents(read.rows.filter((r) => !!r.mcpEndpoint), town).filter((a) => !estateId || a.estate === estateId),
          read: read.rows.length,
          truncated: read.truncated,
        }
      : { unavailable: 'the registry could not be asked just now, so which agents serve a door of their own is unknown rather than none' },
  };
}

/** The `town.estate` sentence. Counts and names; nothing from any vault, and the inference said as one. */
function estateWords(v: NonNullable<Awaited<ReturnType<typeof estateView>>>): string {
  const e = v.estate;
  const lines = [
    `The ${e.id} estate: its Home at ${e.home}, its gate at ${e.edge}, its agents reached at ${e.a2a}${e.agentZone ? ` under the zone ${e.agentZone}` : ' (it serves no agent zone of its own)'}. Deployed from ${e.repo}${e.estateName ? `; its own name on this chain is ${e.estateName}` : ''}.`,
    `It may name under ${e.nameRoots.map((r) => `.${r}`).join(' ')}${e.namingGate ? `, authorized by the gate ${e.namingGate} — recover the signer from one of its registrations and it is that address` : ', and it has no naming gate of its own'}.`,
    e.kms?.tenant ? `Its keys live in the ${e.kms.tenant} tenant${e.kms.backend ? ` (${e.kms.backend})` : ''}; a key is a delegate, never an identity.` : 'It declares no key-custody tenant of its own.',
    v.mcpServers.length
      ? `It declares ${v.mcpServers.length} MCP server(s): ${v.mcpServers.map((m) => `${m.id} (${m.exposure})`).join(', ')}.`
      : 'It declares no MCP server.',
  ];
  if ('unavailable' in v.agents) lines.push(`Which agents are in it could not be read: ${v.agents.unavailable}`);
  else if (v.agents.agents.length === 0) lines.push(`No agent was placed in it: none of the ${v.agents.read} row(s) read from the registry carries an endpoint this estate recognises. That is a statement about endpoints, not about the estate.`);
  else lines.push(
    `${v.agents.agents.length} agent(s) answer at its hosts: ${v.agents.byKind.person} person, ${v.agents.byKind.org} organization, ${v.agents.byKind.service} service, ${v.agents.byKind.undeclared} with no declared type; ${v.agents.withMcp} serve an MCP door of their own. Every one of those placements is INFERRED from the agent's own on-chain endpoint and carries which rule placed it — no attestation of membership exists yet, and an inference does not become one by being reported.`,
  );
  lines.push('None of this says what anybody may do here. That is the estate\u2019s own Home to answer.');
  return lines.join('\n');
}

/** The `town.mcp` sentence. What is here, what is deliberately not, and that an endpoint is not an invitation. */
function mcpWords(v: Awaited<ReturnType<typeof mcpCensusView>>): string {
  const byScale = (sc: 'town' | 'estate') => v.servers.filter((m) => m.scale === sc);
  const lines = [
    v.estate
      ? `The ${v.estate} estate declares ${v.servers.length} MCP server(s).`
      : `The ${v.town} town: ${byScale('town').length} MCP server(s) of its own and ${byScale('estate').length} declared by its estates.`,
    ...v.servers.map((m) => `- ${m.id}${m.estate ? ` (${m.estate})` : ''}: ${m.exposure}${m.url ? ` at ${m.url}` : ', no door — only a Worker bound to it can reach it'}${m.up === null ? '' : m.up ? ' [answers]' : ' [did not answer]'} — ${m.description}`),
  ];
  if ('unavailable' in v.agentDoors) lines.push(`Which agents serve a door of their own could not be read: ${v.agentDoors.unavailable}`);
  else lines.push(
    v.agentDoors.rows.length
      ? `${v.agentDoors.rows.length} agent(s) publish an MCP endpoint of their own, read from the chain: ${v.agentDoors.rows.map((a) => `${a.name ?? a.smartAgent} at ${a.mcpEndpoint}`).join('; ')}.`
      : `No agent here publishes an MCP endpoint of its own (${v.agentDoors.read} read). An agent can serve tools without publishing a door, so this is a count of published doors and not of servers.`,
  );
  lines.push(
    'What an agent has ATTACHED is not here and cannot be: those are records in its owner\u2019s vault under her own grant, which this town cannot read and will not guess.',
    'No tool lists: what a server offers is its own signed manifest\u2019s answer, read from the registry rather than from a file somebody edited.',
    'An endpoint is where a server listens. It is never a statement that you may use it — every call is decided inside, against the chain.',
  );
  return lines.join('\n');
}

/**
 * WHICH OF THE TOWN'S TWO AGENTS ANSWERS A QUESTION TYPED INTO THE PORTAL.
 *
 * The portal has one Ask box and two agents behind it, and they know different things:
 *
 *   the CONTEXT AGENT knows how things have been GOING — the daily pulse rollups written into its vault.
 *   the TOWN AGENT    knows the town's SHAPE — what the manifest declares and what the chain shows.
 *
 * This decides which, BEFORE either is asked, from the question itself. It is a router and not a fallback
 * (ADR-0013): nothing here asks one agent, sees an empty answer, and tries the other. The answer names who
 * answered either way, so a reader is never guessing which of the two they are reading.
 *
 * THE CLAIM IS DELIBERATELY NARROW, because the failure mode is stealing a question the context agent would
 * have answered better. Two rules:
 *
 *   · `mcp` claims outright. No pulse record carries a single fact about an MCP server, so a question using
 *     the word cannot be the context agent's under any reading.
 *   · An estate NAME alone does not claim. "how is faithnet doing this week" is a pulse question and the
 *     estate names appear in both agents' worlds; it claims only when the question also asks about the
 *     estate's shape — who is in it, what it may name, who holds its keys, where it lives.
 *
 * Everything else goes to the context agent exactly as before. `null` means "not mine".
 */
const ESTATE_SHAPE = /\bagents?\b|\bwho(?:'s| is)? in\b|\bmembers?\b|\bname roots?\b|\bnaming gate\b|\bnames? (?:it|they) (?:may|can)\b|\bcustod(?:y|ian)\b|\bkeys?\b|\bwhere (?:is|does)\b|\bhome\b|\bedge\b|\bendpoints?\b|\brepositor(?:y|ies)\b|\bwhat does it run\b/i;

export function claimedByTown(text: string, town: TownManifest): TownIntent | null {
  const t = text.toLowerCase();
  const estate = town.estates.find((e) => new RegExp(`\\b${e.id.replace(/-/g, '[- ]')}\\b`).test(t));
  if (/\bmcps?\b|\bmcp servers?\b/.test(t)) return { skill: 'town.mcp', ...(estate ? { estate: estate.id } : {}) };
  if (estate && ESTATE_SHAPE.test(t)) return { skill: 'town.estate', id: estate.id };
  return null;
}

export async function answer(town: TownManifest, message: MessageV1, probe: Probe, selfHost: string | null, deps: { roster?: RosterRead } = {}): Promise<PartV1[]> {
  const intent = intentOf(message, town);
  if (intent.skill === 'unknown-service') {
    return reply([{ text: `"${intent.id}" is not a service listed in the ${town.town} town. Listed: ${town.services.map((s) => s.id).join(', ')}.` }]);
  }
  if (intent.skill === 'unknown-estate') {
    return reply([{ text: `"${intent.id}" is not an estate of the ${town.town} town. Its estates: ${town.estates.map((e) => e.id).join(', ')}.` }]);
  }
  if (intent.skill === 'town.estate') {
    const v = await estateView(town, intent.id, probe, deps.roster);
    if (!v) return reply([{ text: `"${intent.id}" is not an estate of the ${town.town} town.` }]);
    return reply([{ text: estateWords(v) }, { data: v, mediaType: 'application/json' }]);
  }
  if (intent.skill === 'town.mcp') {
    const v = await mcpCensusView(town, probe, deps.roster, intent.estate);
    return reply([{ text: mcpWords(v) }, { data: v, mediaType: 'application/json' }]);
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

/** THE ONE ROSTER READ both doors use. `null` when the registry is unbound or does not answer — which every
 *  caller turns into "unknown", never into "none" (the registry holding nothing and the registry being
 *  unreachable are opposite facts that look identical on a page). */
function rosterOf(env: Env): RosterRead {
  return async () => {
    const r = await ask<{ ok?: boolean; rows?: AgentRosterRow[]; truncated?: boolean }>(env.REGISTRY, 'https://registry/roster?limit=500');
    return r?.ok && Array.isArray(r.rows) ? { rows: r.rows, truncated: !!r.truncated } : null;
  };
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

/** Exported for its tests: the API's routes are where "could not ask" must not render as "none", and that is
 *  only checkable by calling them with a registry that refuses. */
export async function api(path: string, url: URL, env: Env, town: TownManifest, selfHost: string, origin: string, authorization: string | null = null, method = 'GET', probe: Probe = fetchProbe): Promise<Response> {
  if (path === '/pulse/pass') return method === 'POST' ? runPassVia(env, url.searchParams.get('which') ?? 'status', authorization) : json({ error: 'POST, with the town ops token' }, 405);
  // RECORD THE DAY NOW (spec 436 §5.5 T2). The sampler does this once an hour; an operator may ask for it, which
  // is how the wires get proven the moment they are minted rather than at the top of the next hour. It writes
  // the same record the cron would, into the context agents' own vaults, as those agents.
  if (path === '/pulse/record') {
    if (method !== 'POST') return json({ error: 'POST, with the town ops token' }, 405);
    if (!operatorAuthorized(env.TOWN_OPS_TOKEN, authorization)) return json({ ok: false, error: 'the town ops token is required' }, 401);
    const ready = pulseRecordReadiness(env as PulseRecordEnv);
    if (!ready.ready) return json({ ok: false, error: 'not_ready', detail: ready.reason }, 503);
    if (!env.HEARTBEAT) return json({ ok: false, error: 'no sample store is bound on this deployment' }, 503);
    const day = url.searchParams.get('day') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ ok: false, error: 'day must be YYYY-MM-DD' }, 400);
    const store = env.HEARTBEAT.get(env.HEARTBEAT.idFromName(town.town));
    const all = (await (await store.fetch(`https://pulse/read?from=${Date.parse(day)}`)).json()) as PulseSampleV1[];
    const landed = await recordDay(env as PulseRecordEnv, all, day, fetch, town, (await infraRowsFrom(env, Date.parse(day))).rows);
    await store.fetch('https://pulse/record-outcome', { method: 'POST', body: JSON.stringify({ at: new Date().toISOString(), day, landed }) }).catch(() => undefined);
    return json({ ok: landed.every((l) => l.ok), day, samples: all.length, landed });
  }
  if (path === '/health') {
    // Readiness is whether the WIRES are in place; `lastRecord` is whether the write actually landed. Two
    // different questions, and only the second one explains an Ask that says it has no record.
    const store = env.HEARTBEAT?.get(env.HEARTBEAT.idFromName(town.town));
    const lastRecord = store ? await (await store.fetch('https://pulse/record-outcome')).json().catch(() => null) : null;
    return json({ ok: true, service: 'town-agent', town: town.town, pulseRecord: pulseRecordReadiness(env as PulseRecordEnv), lastRecord, contextAgents: contextAgents(env as PulseRecordEnv), townMcp: env.INFRA ? 'bound' : 'not bound on this deployment' });
  }
  if (path === '/estates') return json(townSummary(town).estates);
  // ── ONE ESTATE, ON ITS OWN PAGE (spec 435 §4) ──────────────────────────────────────────────────────────
  // Everything an estate declares in the manifest, its MCP servers, and the agents this town can PLACE in it
  // from their own on-chain endpoints. The placement is an inference and says so on every row; nothing here
  // reads a vault, and the estate's own Home remains the only thing that knows who may do what there.
  const est = path.match(/^\/estate\/([a-z0-9-]+)$/);
  if (est) {
    // The SAME builder the `town.estate` A2A skill composes from, so a reader and an agent are never told
    // different things about one estate. The page adds only what is the portal's: who answers for it, and the chain.
    const v = await estateView(town, est[1]!, probe, rosterOf(env));
    if (!v) return json({ error: `no estate "${est[1]}" in the ${town.town} town` }, 404);
    return json({
      ...v,
      agent: contextAgentViews(town, contextAgents(env as PulseRecordEnv), env.CONTEXT_AGENT_ZONE).estates[v.estate.id] ?? null,
      chain: town.chain, town: town.town,
    }, 200, { 'cache-control': 'public, max-age=60' });
  }
  // ── WHAT SERVES THIS ENDPOINT (spec 437 I4, asked the other way round) ────────────────────────────────
  // A reader on an agent's page holds a URL the chain gave them and wants to know what is behind it: which
  // Worker, from which repository, and how it is doing. The attribution is the manifest's (declared, never
  // derived from the hostname); the reading is the town MCP's, which is the only thing holding a platform
  // credential. Status is public and metrics are the operator's, exactly as on the Pulse — withheld with the
  // reason, never zeroed, because a zero looks like a measurement and gets believed.
  if (path === '/endpoint') {
    const target = (url.searchParams.get('url') ?? '').trim();
    if (!target) return json({ error: 'say which endpoint' }, 400);
    const attribution = attributeEndpoint(town, target);
    const source = sourceUrlOf(attribution);
    const detail = operatorAuthorized(env.TOWN_OPS_TOKEN, authorization);
    // No Worker named ⇒ nothing to read, and that is the answer rather than an empty reading.
    if (!attribution.worker && !attribution.vercelProject) {
      return json({ attribution, source, reading: null, detail }, 200, { 'cache-control': 'public, max-age=300' });
    }
    const from = Date.now() - 24 * 3600_000;
    const infra = await infraRowsFrom(env, from);
    const resource = attribution.worker ?? attribution.vercelProject!;
    const samples = infra.rows
      .filter((r) => r.kind === 'infra')
      .map((r) => r.payload as InfraSampleV1)
      .filter((p) => p.resource === resource);
    const latest = samples.length ? samples.reduce((a, b) => (Date.parse(b.at) > Date.parse(a.at) ? b : a)) : null;
    return json({
      attribution, source, detail,
      reading: latest
        ? {
            resource, platform: latest.platform, account: latest.account, kind: latest.kind,
            status: latest.status, asOf: latest.asOf, lagClass: latest.lagClass, ok: latest.ok,
            ...(latest.error ? { error: latest.error } : {}),
            // SPEC 437: status is public, the numbers are the operator's. `null` with a reason, never zeros.
            metrics: detail ? latest.metrics : null,
            ...(detail ? { series: samples.slice(-96).map((p) => ({ at: p.at, metrics: p.metrics })) } : {}),
            ...(detail ? {} : { withheld: 'the readings are the operator\u2019s; status, lag and what runs here are public' }),
          }
        : null,
      ...(infra.unavailable ? { unavailable: infra.unavailable } : latest ? {} : { unavailable: `the town MCP holds no reading for ${resource} in the last day` }),
    }, 200, detail ? { 'cache-control': 'private, no-store' } : { 'cache-control': 'public, max-age=60' });
  }
  // ── THE MCP CENSUS AT THE SCALES A MANIFEST AND A CHAIN CAN ANSWER (spec 435 §5) ───────────────────────
  // Town-shared and per-estate servers come from the manifest, which DECLARES them. The agents' own doors come
  // from the chain (`atl:mcpEndpoint`). What an agent has ATTACHED is absent on purpose: those are spec-404
  // records in its owner's vault under her grant, and the town cannot see them and will not guess.
  if (path === '/mcp') {
    const estate = url.searchParams.get('estate');
    return json(await mcpCensusView(town, probe, rosterOf(env), estate && town.estates.some((e) => e.id === estate) ? estate : undefined), 200, { 'cache-control': 'public, max-age=60' });
  }
  // WHAT THIS AGENT IS CONFIGURED WITH (the owner's rule, 2026-10-10): which servers the town — or one estate,
  // service or application — declares, and which read credentials the town MCP holds, BY NAME. Never a value: the
  // credentials live only in the MCP, and this Worker could not print one if it tried.
  if (path === '/config') return json(await infraConfigFrom(env, url.searchParams.get('owner') ?? undefined), 200, { 'cache-control': 'public, max-age=60' });
  if (path === '/town') {
    const [services, names] = await Promise.all([serviceViews(town, fetchProbe, selfHost), ask<unknown>(env.NAMING, 'https://naming/api/town')]);
    // WHO ANSWERS FOR EACH CONTEXT (spec 436 §5.5): the town's agent and each estate's, by name and by card.
    // The portal shows the door it would send a question to, which is the only honest way to show the Ask.
    const agents = contextAgentViews(town, contextAgents(env as PulseRecordEnv), env.CONTEXT_AGENT_ZONE);
    return json({ ...townSummary(town), services, names, agents, card: `${origin}/.well-known/agent-card.json` }, 200, { 'cache-control': 'public, max-age=30' });
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
    // WHICH ESTATE THIS AGENT IS PLACED IN (spec 435 §4) — computed from its own on-chain endpoint against the
    // hosts this town declares, the same rule the estate page uses. An INFERENCE, carrying which rule placed
    // it, and it is on the agent's page because "whose estate is this?" is a public-graph question a reader
    // arrives with and the chain's relationship edges do not answer.
    const triples = ((agent as { triples?: Array<{ p: string; o: string }> }).triples ?? []);
    const a2a = triples.find((t) => /[#/]a2aEndpoint$/.test(t.p))?.o;
    const mcp = triples.find((t) => /[#/]mcpEndpoint$/.test(t.p))?.o;
    const sa = triples.find((t) => /[#/]smartAgent$/.test(t.p))?.o ?? '';
    const placement = placeAgent({ name: key, smartAgent: sa, ...(a2a ? { a2aEndpoint: a2a } : {}), ...(mcp ? { mcpEndpoint: mcp } : {}) }, town);
    return json({ key, agent, offerings, placement: { estate: placement.estate, how: placement.how } });
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
    // THE TOWN AGENT ANSWERS ITS OWN QUESTIONS (spec 435 §7). Decided here, before either agent is asked, and
    // the reply names who answered — see `claimedByTown` for why the claim is as narrow as it is.
    const mine = claimedByTown(q, town);
    if (mine && (mine.skill === 'town.mcp' || mine.skill === 'town.estate')) {
      const v = mine.skill === 'town.mcp'
        ? await mcpCensusView(town, fetchProbe, rosterOf(env), mine.estate)
        : await estateView(town, mine.id, fetchProbe, rosterOf(env));
      if (v) {
        const words = mine.skill === 'town.mcp' ? mcpWords(v as Awaited<ReturnType<typeof mcpCensusView>>) : estateWords(v as NonNullable<Awaited<ReturnType<typeof estateView>>>);
        return json({ ok: true, answer: words, agent: `${town.town} town agent`, skill: mine.skill, read: 'the town manifest and the public registry' }, 200, { 'cache-control': 'public, max-age=30' });
      }
    }
    const cfg = contextAgents(env as PulseRecordEnv);
    const estateId = url.searchParams.get('estate') ?? town.estates[0]?.id ?? '';
    const name = scope === 'town' ? cfg.town : cfg.estates[estateId];
    if (!name) return json({ ok: false, error: 'not_configured', detail: `the ${scope} context agent is not chartered yet (spec 436 §5.5 T1: ${scope === 'town' ? 'faith-town.workspace' : `${estateId}'s estate agent`} under demo-admin) — the Pulse's tabs show the live numbers meanwhile` }, 503);
    const zone = env.CONTEXT_AGENT_ZONE ?? town.estates[0]?.agentZone ?? '';
    // The same derivation the portal shows beside the agent's name (`agentCardHost`), so the door named on the
    // page is the door the question actually goes to.
    const host = agentCardHost(name, zone);
    if (!host) return json({ ok: false, error: 'not_configured', detail: `no agent zone is configured for the ${scope} context, so ${name}'s card host cannot be derived` }, 503);
    try {
      const resolved = await resolveAgentCard(`https://${host}/.well-known/agent-card.json`, fetch);
      const client = createStandardA2aClient({ endpoint: resolved.endpoint, fetch });
      // THE QUESTION GOES AS A STRANGER (spec 436 §5.5 T4). A stranger's message is admitted only on the public
      // lane, which takes a NAMED capability — so the question travels as words AND as the one capability it is
      // asking for. The portal holds no key and signs nothing; naming a capability is not holding authority, and
      // an agent that does not offer this one simply refuses.
      const sent = await client.sendMessage([{ text: q }, { data: { skill: PULSE_PUBLIC_ASK, question: q } }]);
      // THE PUBLIC LANE ANSWERS WITH A MESSAGE AND NO TASK, and a message arrives as the JSON-RPC result ITSELF
      // rather than under `message` — a reply with `parts` IS the reply. Reading only `sent.message` found
      // nothing and reported a real answer as "answered without words".
      const asMessage = sent as unknown as { parts?: unknown[] };
      const direct = Array.isArray(asMessage.parts) ? asMessage.parts : sent.message?.parts;
      const task = direct ? null : sent.task ? await client.awaitTask(sent.task.id, { timeoutMs: 45_000 }) : null;
      const parts = direct ?? ((task?.artifacts ?? []) as Array<{ parts?: unknown[] }>).flatMap((x) => x.parts ?? []);
      const textOf = (ps: unknown[]): string => ps.map((x) => (x as { text?: string }).text ?? '').filter(Boolean).join(' ').trim();
      const data = parts.map((x) => (x as { data?: unknown }).data).find((d) => d && typeof d === 'object') as { answer?: string; cited?: Array<{ key: string; day?: string }>; read?: boolean; window?: unknown; runRef?: string } | undefined;
      const words = data?.answer || textOf(parts);
      // AN ANSWER THAT CITES NOTHING IS NOT AN ANSWER (436 §5.5): the agent answers from records it keeps, so a
      // reply with no record behind it is relayed as the refusal it is, never dressed up as a finding.
      if (!words) return json({ ok: false, error: 'no_answer', detail: `${name} answered without words.` }, 502);
      return json({ ok: true, answer: words, agent: name, ...(data?.cited ? { cited: data.cited } : {}), ...(data?.window ? { window: data.window } : {}), ...(data?.read === false ? { read: false } : {}), ...(data?.runRef ? { runRef: data.runRef } : {}) });
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // The agent is chartered and its door answers, but a stranger's plain question is not yet something it
      // admits: the public lane takes a NAMED public skill, and the town skill plus the records behind it are
      // spec 436 §5.5 T2/T3. Say that, rather than repeat "not chartered" at a name that now resolves on chain.
      if (/admits only an authenticated principal/i.test(why))
        return json({ ok: false, error: 'not_public_yet', detail: `${name} is chartered and its door answers, but it does not yet take a stranger's question — its public town skill and the records behind it are still to come (spec 436 §5.5 T2/T3). The Pulse's tabs show the live numbers meanwhile.` }, 503);
      return json({ ok: false, error: 'unreachable', detail: `${name} at ${host} did not answer: ${why}` }, 502);
    }
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
    // KEPT, NOT ONLY LOGGED. A write that the vault refuses is the one thing that makes the Ask answer "I
    // have no record", and until this was stored the only way to see it was the ops token and a log tail.
    await store.fetch('https://pulse/record-outcome', { method: 'POST', body: JSON.stringify({ at: new Date().toISOString(), day, landed }) }).catch(() => undefined);
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
      // Read-only, with two exceptions, both the operator's: tell the town MCP to collect now
      // (`POST /api/pulse/pass`), and write the day's record into the context agents' vaults
      // (`POST /api/pulse/record`). The MCP does the collecting; this Worker reaches no provider.
      const path = url.pathname.slice(4).replace(/\/+$/, '') || '/';
      if (req.method !== 'GET' && !(req.method === 'POST' && (path === '/pulse/pass' || path === '/pulse/record'))) return json({ error: 'read only' }, 405);
      return api(path, url, env, town, selfHost, origin, req.headers.get('authorization'), req.method);
    }
    if (url.pathname === '/a2a') {
      const server = createStandardA2aServer({
        card,
        // No task is ever created — every message is answered with a message — so no task is anybody's to see.
        canSeeTask: () => false,
        // The roster is handed in, so `town.estate` and `town.mcp` read the registry the portal's own pages read.
        // Still public and still read-only: the roster is the chain's public rows, and nothing here holds a key.
        executor: { async execute(ctx) { await ctx.reply(await answer(town, ctx.message, fetchProbe, selfHost, { roster: rosterOf(env) })); } },
      });
      return server.handle(req);
    }
    return env.ASSETS.fetch(req);
  },
};
