// demo-discovery-a2a — the discovery agent surface (mirrors demo-bible-a2a). Advertises a
// `discover-agents` skill and orchestrates the discovery MCP over the knowledge base: query → MCP
// search_agents → rank → best agents (+ evidence). Browser → A2A → MCP → GraphDB.
//
// v1 ranking is lexical + facet-richness; this is the seam where INTENT + MANDATE matching grows — the
// agent will parse a stated intent/mandate, expand it (skills/geo/trust), query the graph, and return the
// best agents with an explainable evidence path. It evolves into a full-featured discovery app.

import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  MCP_URL?: string;
  AGENT_NAME?: string;
  A2A_PUBLIC_ORIGIN?: string;
  // Service binding to demo-discovery-mcp (production; Workers can't fetch each other by public URL).
  MCP?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
}

interface AgentResult {
  agent: string; name: string | null; smartAgent: string; facets: string[]; shaclConforms: boolean;
  registryStatus?: string | null; displayName?: string | null; description?: string | null;
}

// spec 281 — structured intent (soft rank) + mandates (hard filters).
interface Intent { need?: string; skills?: string[]; geo?: string }
interface Mandates { requireRegistered?: boolean; requireShaclConforms?: boolean; requireKind?: string; requireSkill?: string; geo?: string }

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

const mcpUrl = (env: Env) => (env.MCP_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const mcpGet = async (env: Env, path: string) => {
  const res = env.MCP ? await env.MCP.fetch(`https://mcp${path}`) : await fetch(`${mcpUrl(env)}${path}`);
  return res.json() as Promise<any>;
};
const mcpPost = async (env: Env, path: string, body: unknown) => {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = env.MCP ? await env.MCP.fetch(`https://mcp${path}`, init) : await fetch(`${mcpUrl(env)}${path}`, init);
  return res.json() as Promise<any>;
};

app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-a2a' }));

app.get('/.well-known/agent-card.json', (c) => {
  const origin = (c.env.A2A_PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, '');
  return c.json({
    protocolVersion: '1.0',
    name: 'Discovery Agent',
    description: 'Finds the best Smart Agents for a stated need. Queries the AP discovery knowledge graph (agent-naming + on-chain facets) through the discovery MCP, ranks by relevance + verifiable trust, and returns candidates with an evidence path. Evolves into intent + mandate driven matching.',
    provider: { organization: 'Agentic Primitives — Discovery', url: origin },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'discover-agents',
        name: 'Discover agents',
        description: 'Given a query (and, increasingly, an intent + mandate), return the best matching agents from the knowledge graph with relevance + trust evidence.',
        tags: ['discovery', 'registry', 'intent-matching', 'knowledge-graph'],
        examples: ['scripture provider', 'org agents in .impact', 'lbsb'],
      },
    ],
  });
});

// Agentic-trust ontology IRIs (apdisc: discovery vocabulary). Results are typed as the ontology's own
// MatchCandidate / TrustDetermination / EvidencePath so the agent's output IS the ontology in motion.
const APDISC = 'https://agenticprimitives.dev/ns/discovery#';
const AP = 'https://agenticprimitives.dev/ns/core#';

// spec 281 — filter → score → surface (ported from smart-agent 001, adapted to rank AGENTS).
const W_FIT = 0.6;   // intent fit (soft)        — smart-agent's proximity weight
const W_TRUST = 0.4; // public trust signals     — smart-agent's outcome weight
const isRegistered = (a: AgentResult) => a.registryStatus === 'active' || a.facets.includes('registry');

/** Hard MANDATE filter: returns the list of satisfied mandate keys, or null if ANY required mandate fails
 *  (→ candidate dropped). Derived purely from public facets (ADR-0040). */
function mandatePass(a: AgentResult, m: Mandates | undefined): string[] | null {
  const satisfied: string[] = [];
  if (!m) return satisfied;
  if (m.requireRegistered) { if (!isRegistered(a)) return null; satisfied.push('registered'); }
  if (m.requireShaclConforms) { if (!a.shaclConforms) return null; satisfied.push('shaclConforms'); }
  if (m.requireSkill) { const hit = (a.description ?? '').toLowerCase().includes(m.requireSkill.toLowerCase()) || (a.displayName ?? '').toLowerCase().includes(m.requireSkill.toLowerCase()); if (!hit) return null; satisfied.push(`skill:${m.requireSkill}`); }
  if (m.geo) { if (!(a.description ?? '').toLowerCase().includes(m.geo.toLowerCase())) return null; satisfied.push(`geo:${m.geo}`); }
  if (m.requireKind) { satisfied.push(`kind:${m.requireKind}`); } // best-effort (agentKind facet projection pending) — recorded, not yet hard-enforced
  return satisfied;
}

/** Soft INTENT fit (0..1): lexical relevance of the need against name + profile text + skills. */
function fitScore(a: AgentResult, intent: Intent, cites: string[]): number {
  const need = (intent.need ?? '').trim().toLowerCase();
  const hay = [a.name, a.displayName, a.description].filter(Boolean).join(' ').toLowerCase();
  let s = 0;
  if (!need) { s = 0.15; }
  else {
    if (a.name?.toLowerCase().includes(need)) { s += 0.6; cites.push(`name matches “${intent.need}”`); }
    if (a.displayName?.toLowerCase().includes(need) || a.description?.toLowerCase().includes(need)) { s += 0.4; cites.push('profile text matches the need'); }
    const toks = need.split(/\s+/).filter((t) => t.length > 2);
    const tokHits = toks.filter((t) => hay.includes(t)).length;
    if (toks.length) { s += 0.4 * (tokHits / toks.length); if (tokHits) cites.push(`${tokHits}/${toks.length} need term(s) matched`); }
  }
  for (const sk of intent.skills ?? []) { if (hay.includes(sk.toLowerCase())) { s += 0.2; cites.push(`skill “${sk}” present`); } }
  return Math.min(s, 1);
}

/** Absolute public-trust signal (0..1) — registry-active + SHACL + facet richness (attestation/relationship
 *  edges count once projected). Requester-relative proximity + outcome history are deferred (spec 281). */
function trustScore(a: AgentResult, cites: string[]): number {
  let s = 0;
  if (isRegistered(a)) { s += 0.5; cites.push('active registry entry'); }
  if (a.shaclConforms) { s += 0.2; cites.push('SHACL-conformant (cbox shapes)'); }
  s += Math.min(a.facets.length, 5) * 0.06;
  if (a.facets.length) cites.push(`${a.facets.length} on-chain facet(s): ${a.facets.join(', ')}`);
  return Math.min(s, 1);
}

/** Score + surface one mandate-passing candidate as an ontology-typed apdisc:MatchCandidate. */
function matchCandidate(a: AgentResult, intent: Intent, satisfiedMandates: string[]) {
  const cites: string[] = [];
  const fit = fitScore(a, intent, cites);
  const trust = trustScore(a, cites);
  const score = Math.round(Math.min(W_FIT * fit + W_TRUST * trust, 1) * 100) / 100;
  return {
    '@type': `${APDISC}MatchCandidate`,
    [`${APDISC}candidateAgent`]: { '@type': `${AP}Agent`, [`${AP}smartAgent`]: a.smartAgent, name: a.name, facets: a.facets },
    [`${APDISC}hasTrustDetermination`]: {
      '@type': `${APDISC}TrustDetermination`,
      [`${APDISC}confidence`]: score,
      [`${APDISC}citesEvidence`]: cites,
      note: 'over PUBLIC evidence — informs ranking, not authority to act',
    },
    [`${APDISC}hasEvidencePath`]: {
      '@type': `${APDISC}EvidencePath`,
      'sh:conforms': a.shaclConforms,
      citedFacets: a.facets,
      agentNode: a.agent,
      basis: { fitScore: Math.round(fit * 100) / 100, trustScore: Math.round(trust * 100) / 100, weights: { fit: W_FIT, trust: W_TRUST } },
    },
    [`${APDISC}matchScore`]: score,
    [`${APDISC}matchScoreBasis`]: Math.round(score * 10000), // smart-agent SHACL-precision convention (0..10000)
    satisfiedMandates,
    // flattened convenience fields (UI):
    name: a.name, smartAgent: a.smartAgent, facets: a.facets, shaclConforms: a.shaclConforms,
    registered: isRegistered(a), score, why: cites,
  };
}

// The discover skill (A2A-style; browser/clients POST here). Filter → score → surface (spec 281):
//   mandates = HARD filters (drop failures) · intent = SOFT rank (0.6·fit + 0.4·trust) · evidence path out.
// `intent` may be a structured object {need,skills?,geo?} OR a bare string (legacy = the need); a bare
// {query} still works (free-text), so existing callers (the Registry tab's loadRegistry) are unaffected.
app.post('/discover', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    query?: string; intent?: Intent | string; mandates?: Mandates; limit?: number;
  };
  const intent: Intent = typeof body.intent === 'string' ? { need: body.intent } : (body.intent ?? {});
  const mandates = body.mandates;
  const limit = body.limit ?? 25;
  // Text seed for the MCP search: explicit query, else the intent need (empty = the full candidate set).
  const q = (body.query || intent.need || '').toString();

  const mcp = await mcpGet(c.env, `/search?q=${encodeURIComponent(q)}&limit=${limit}`).catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return c.json({ ok: false, error: mcp?.error ?? 'discovery MCP unavailable' }, 502);

  const candidates = mcp.results as AgentResult[];
  let dropped = 0;
  const ranked = candidates
    .map((a) => { const sat = mandatePass(a, mandates); if (sat === null) { dropped++; return null; } return matchCandidate(a, intent, sat); })
    .filter((x): x is ReturnType<typeof matchCandidate> => x !== null)
    .sort((x, y) => (y.score as number) - (x.score as number));

  return c.json({
    ok: true,
    '@context': { apdisc: APDISC, ap: AP, sh: 'http://www.w3.org/ns/shacl#' },
    '@type': `${APDISC}CandidateQuery`,
    query: q,
    intent,
    mandates: mandates ?? null,
    matched: ranked.length,
    droppedByMandates: dropped,
    source: 'discovery-mcp → GraphDB (agentic-trust ontology: T-box + C-box SHACL + A-box)',
    results: ranked,
  });
});

// Agent detail — the full A-box node for one agent (every on-chain facet), via the MCP get_agent tool.
// Browser → A2A → MCP → GraphDB, same as discovery.
app.get('/agent', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  const r = await mcpGet(c.env, `/agent?key=${encodeURIComponent(key)}`).catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

// Custody check (ADR-0040) — which candidate agents does the viewer's credential custody? Proxies the MCP
// check_custody tool (exact-match over opaque, on-chain-reproducible membership tokens). Browser → A2A →
// MCP → GraphDB. The credential is the viewer's own on-chain identifier (EOA / passkey digest); nothing is
// stored, and the answer reveals nothing the chain doesn't.
app.post('/custody', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { subjectAgents?: unknown; credential?: unknown };
  const r = await mcpPost(c.env, '/custody', { subjectAgents: body.subjectAgents, credential: body.credential }).catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

app.get('/', (c) => c.json({ service: 'demo-discovery-a2a', card: '/.well-known/agent-card.json', discover: 'POST /discover {query?, intent?:{need,skills?,geo?}, mandates?:{requireRegistered?,requireShaclConforms?,requireKind?,requireSkill?,geo?}}', agent: 'GET /agent?key=', custody: 'POST /custody {subjectAgents,credential}' }));

export default app;
