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

interface AgentResult { agent: string; name: string | null; smartAgent: string; facets: string[]; shaclConforms: boolean }

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

const mcpUrl = (env: Env) => (env.MCP_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const mcpGet = async (env: Env, path: string) => {
  const res = env.MCP ? await env.MCP.fetch(`https://mcp${path}`) : await fetch(`${mcpUrl(env)}${path}`);
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

/** Rank a candidate → an ontology-typed apdisc:MatchCandidate with a TrustDetermination (confidence +
 *  cited evidence) and an EvidencePath. v1 weighting is lexical + facet-richness + SHACL; the intent/
 *  mandate inputs are the seam where skill/geo/trust expansion + mandate constraints grow. */
function matchCandidate(a: AgentResult, q: string) {
  const cites: string[] = [];
  let conf = 0;
  const ql = q.trim().toLowerCase();
  if (ql && a.name?.toLowerCase().includes(ql)) { conf += 0.5; cites.push(`name matches “${q}”`); }
  else if (!ql) conf += 0.1;
  conf += Math.min(a.facets.length, 5) * 0.08;
  if (a.facets.length) cites.push(`${a.facets.length} on-chain facet(s): ${a.facets.join(', ')}`);
  if (a.shaclConforms) { conf += 0.1; cites.push('SHACL-conformant (cbox shapes)'); }
  const confidence = Math.round(Math.min(conf, 1) * 100) / 100;
  return {
    '@type': `${APDISC}MatchCandidate`,
    [`${APDISC}candidateAgent`]: { '@type': `${AP}Agent`, [`${AP}smartAgent`]: a.smartAgent, name: a.name, facets: a.facets },
    [`${APDISC}hasTrustDetermination`]: {
      '@type': `${APDISC}TrustDetermination`,
      [`${APDISC}confidence`]: confidence,
      [`${APDISC}citesEvidence`]: cites,
      note: 'over PUBLIC evidence — informs ranking, not authority to act',
    },
    [`${APDISC}hasEvidencePath`]: {
      '@type': `${APDISC}EvidencePath`,
      'sh:conforms': a.shaclConforms,
      citedFacets: a.facets,
      agentNode: a.agent,
    },
    [`${APDISC}matchScore`]: confidence,
    // flattened convenience fields (UI):
    name: a.name, smartAgent: a.smartAgent, facets: a.facets, shaclConforms: a.shaclConforms,
    score: confidence, why: cites,
  };
}

// The discover skill (A2A-style invocation over JSON; browser/clients POST here).
app.post('/discover', async (c) => {
  const { query = '', intent, mandates, limit = 25 } = (await c.req.json().catch(() => ({}))) as {
    query?: string; intent?: string; mandates?: unknown; limit?: number;
  };
  const q = (query || intent || '').toString();
  const mcp = await mcpGet(c.env, `/search?q=${encodeURIComponent(q)}&limit=${limit}`).catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return c.json({ ok: false, error: mcp?.error ?? 'discovery MCP unavailable' }, 502);
  const ranked = (mcp.results as AgentResult[])
    .map((a) => matchCandidate(a, q))
    .sort((x, y) => (y.score as number) - (x.score as number));
  return c.json({
    ok: true,
    '@context': { apdisc: APDISC, ap: AP, sh: 'http://www.w3.org/ns/shacl#' },
    '@type': `${APDISC}CandidateQuery`,
    query: q,
    intent: intent ?? null,
    mandates: mandates ?? null,
    note: intent || mandates ? 'intent/mandate accepted; weighted matching evolving' : undefined,
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

app.get('/', (c) => c.json({ service: 'demo-discovery-a2a', card: '/.well-known/agent-card.json', discover: 'POST /discover {query,intent?,mandates?}', agent: 'GET /agent?key=' }));

export default app;
