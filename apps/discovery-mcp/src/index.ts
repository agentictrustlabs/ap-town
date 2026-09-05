// demo-discovery-mcp — discovery MCP server (mirrors demo-bible-mcp from verifiable-content-demo). Tools
// read the discovery knowledge base (GraphDB @ agentkg.io, populated by agent-indexer from agent-naming +
// on-chain facets). Exposed two ways: a REST seam the A2A agent calls (GET /search, /agent — like bible's
// mcpGet/mcpPost) AND an MCP JSON-RPC endpoint (POST /mcp) for real MCP clients. Holds GraphDB creds
// server-side; the browser never sees them. Chain: browser → demo-discovery-a2a → demo-discovery-mcp → GraphDB.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { kbSchema } from './kb-schema.js';
import { searchAgents, searchAgentsPage, lookupAgents, getAgent, getOfferings, getTrustFabric, listNames, listAgentsByContext, describeTerm, listShapes, checkCustody, runKbQuery, runKbConstruct, getFacets, SEARCH_MAX_LIMIT, type Env } from './graphdb.js';

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-mcp', kb: c.env.GRAPHDB_QUERY_URL }));

// Read-only SPARQL passthrough for the admin KB browser (T-box / C-box / A-box navigation). The KB is
// world-readable (ADR-0040); update verbs are rejected + SELECTs capped in runKbQuery. CORS is open (above).
app.post('/kb/query', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  if (!body.query) return c.json({ ok: false, error: 'query required' }, 400);
  try { return c.json({ ok: true, ...(await runKbQuery(c.env, body.query)) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 400); }
});

// THE GROUNDING CORPUS — spec 357 W2. What this store actually contains: the classes and properties that
// HAVE DATA, with the T-box's own labels and comments, plus worked question→query examples.
//
// Read-only and public, like everything else here: it describes a world-readable graph (ADR-0040). Custody
// vocabulary is excluded — see `kb-schema.ts`. `?fresh=1` skips the isolate cache.
app.get('/kb/schema', async (c) => {
  try { return c.json({ ok: true, ...(await kbSchema(c.env, { fresh: c.req.query('fresh') === '1' })) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// THE ANSWER PATH — spec 357 §3. CONSTRUCT in, JSON-LD out, the query returned with it.
//
// Separate from `/kb/query` on purpose rather than by sniffing the form: this surface answers with the
// DOMAIN (entities, typed, with properties from the ontology) and the browser surface answers with a
// table. Two shapes, two routes, neither pretending to be the other. Still a read of world-readable data
// (ADR-0040) — a query here decides what is shown, never what may be seen.
app.post('/kb/construct', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { query?: string };
  if (!body.query) return c.json({ ok: false, error: 'query required' }, 400);
  try { return c.json({ ok: true, ...(await runKbConstruct(c.env, body.query)) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 400); }
});

// ── REST tool seam (what the A2A agent calls) ──
// `/search` is DISCOVERY over an unknown field. It is paged, and the page now REPORTS itself: `truncated`
// says more agents matched than were returned, and `maxLimit` states the ceiling. Previously the ceiling
// was a silent 200 — `limit=500` and `limit=1000` both returned 200 rows with nothing saying so, so a
// caller enriching a fixed candidate set from one bulk read silently dropped every agent outside the
// window and could not tell "not in the window" from "no facets published". For that use case, use
// `/lookup`, which is exact.
app.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = Number(c.req.query('limit') ?? 25);
  try {
    const page = await searchAgentsPage(c.env, q, limit);
    return c.json({ ok: true, query: q, maxLimit: SEARCH_MAX_LIMIT, ...page });
  } catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// EXACT bounded read of a known candidate set — the ENRICHMENT path. The caller passes the Smart Agents it
// already holds; the filter runs server-side, so the answer is complete by construction and its cost scales
// with the candidate count rather than with the size of the knowledge base. Never truncated: a missing SA
// means "not in the KB", and a transport failure is a non-200, so a caller can always tell the two apart.
// POST (not GET) because a roster of SAs overflows a query string.
app.post('/lookup', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agents?: unknown };
  const agents = Array.isArray(body.agents) ? body.agents.filter((x): x is string => typeof x === 'string') : [];
  if (!agents.length) return c.json({ ok: false, error: 'agents[] required' }, 400);
  try {
    const results = await lookupAgents(c.env, agents);
    return c.json({ ok: true, requested: agents.length, returned: results.length, truncated: false, results });
  } catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Every named agent, most-recently-registered first (apnam:registeredAt off AgentNameRegistry storage).
app.get('/names', async (c) => {
  const limit = Number(c.req.query('limit') ?? 100);
  try { return c.json({ ok: true, names: await listNames(c.env, limit) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Public app-specific discovery, e.g. /agents?appContext=uupg&orgRole=alliance.
app.get('/agents', async (c) => {
  const appContext = c.req.query('appContext') ?? '';
  const orgRole = c.req.query('orgRole') ?? '';
  const limit = Number(c.req.query('limit') ?? 100);
  if (!appContext) return c.json({ ok: false, error: 'appContext required' }, 400);
  try { return c.json({ ok: true, agents: await listAgentsByContext(c.env, appContext, orgRole, limit) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

app.get('/agent', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  try { const a = await getAgent(c.env, key); return a ? c.json({ ok: true, ...a }) : c.json({ ok: false, error: 'not found' }, 404); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Offerings (spec 286): the crawled per-skill Offerings an agent advertises (from its public A2A card,
// host-asserted + provenance). The full per-skill set the matcher ranks over, queryable offline.
// Facets for the discovery filters (spec 346 §8.5): distinct declared agent types / root kinds / capability ids /
// suffixes with agent counts — grouped aggregates, flat cost. Public, on-chain-derived facts only (ADR-0040).
app.get('/facets', async (c) => {
  try { return c.json({ ok: true, ...(await getFacets(c.env)) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

app.get('/offerings', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  try { return c.json({ ok: true, key, offerings: await getOfferings(c.env, key) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// G1 — the trust fabric of one agent: its AgentRelationship edges and its AttestationRegistry rows. Both
// were projected into a shape the SPARQL store silently dropped, so this data did not exist in the graph
// until the projector/store fix; every query below returned zero rows for every agent on the substrate.
app.get('/trust', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  try { return c.json({ ok: true, key, ...(await getTrustFabric(c.env, key)) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Custody check (ADR-0040): which of subjectAgents[] does the viewer's credential (EOA / passkey digest)
// custody? Exact-match over the opaque membership graph — yes/no per agent, no enumeration. credential is
// the on-chain identifier the viewer presents for THEMSELVES; we never store the request.
app.post('/custody', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { subjectAgents?: unknown; credential?: unknown };
  const sas = Array.isArray(body.subjectAgents) ? body.subjectAgents.filter((x): x is string => typeof x === 'string') : [];
  const credential = typeof body.credential === 'string' ? body.credential : '';
  if (!credential || !sas.length) return c.json({ ok: false, error: 'subjectAgents[] and credential required' }, 400);
  try { return c.json({ ok: true, results: await checkCustody(c.env, sas, credential) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Ontology-aware: the KB carries the agentic-trust ontology (T-box + C-box SHACL), so the MCP can define
// its own vocabulary from the graph.
app.get('/ontology/term', async (c) => {
  const term = c.req.query('term') ?? '';
  if (!term) return c.json({ ok: false, error: 'term (IRI or local name) required' }, 400);
  try { const t = await describeTerm(c.env, term); return t ? c.json({ ok: true, ...t }) : c.json({ ok: false, error: 'term not found' }, 404); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});
app.get('/ontology/shapes', async (c) => {
  try { return c.json({ ok: true, shapes: await listShapes(c.env) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// ── MCP JSON-RPC (streamable HTTP) ──
const TOOLS = [
  {
    name: 'search_agents',
    description: 'Search the discovery knowledge graph for agents by free text (name / profile / skills / focus areas). Returns each agent with its structured discovery facets (languages, regions, focusAreas), its trust fabric counts (active relationship edges, valid attestations), on-chain facet coverage and SHACL conformance. PAGED: the response carries `truncated` and `maxLimit` — if you already know which agents you want, call lookup_agents instead, which is exact and never truncated.',
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'free-text query' }, limit: { type: 'number' } } },
  },
  {
    name: 'list_names',
    description: 'List every named agent in the discovery knowledge graph, most-recently-registered first. Each: name, smartAgent, registeredAt/expiresAt, agent kind, displayName, and public discovery metadata.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'max results (default 100, cap 500)' } } },
  },
  {
    name: 'list_agents_by_context',
    description: 'List public named agents by appContext and optional orgRole, e.g. UUPG alliances or organizations.',
    inputSchema: { type: 'object', properties: { appContext: { type: 'string' }, orgRole: { type: 'string' }, limit: { type: 'number' } }, required: ['appContext'] },
  },
  {
    name: 'get_agent',
    description: 'Get the full A-box node (all on-chain facets) for one agent by name (e.g. "lbsb.impact") or Smart Agent address (0x…).',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'get_offerings',
    description: 'Get the crawled per-skill Offerings (spec 286) one agent advertises — from its public A2A card, host-asserted with provenance (source endpoint / observedAt / card digest). Each offering: skillId, effect, exposure, family, status, required capabilities. Use to rank which agent best services an intent/mandate. Key = name or 0x SA.',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'lookup_agents',
    description: 'EXACT bounded read of the discovery facets for a KNOWN set of Smart Agent addresses. Use this — not search_agents — whenever you already hold the candidate list (routing, consult seating, roster enrichment): it filters server-side by your SA list, is never truncated, and does not scale with the size of the knowledge base. An agent missing from the result is genuinely absent from the KB.',
    inputSchema: { type: 'object', properties: { agents: { type: 'array', items: { type: 'string' }, description: '0x Smart Agent addresses' } }, required: ['agents'] },
  },
  {
    name: 'get_trust_fabric',
    description: "Get one agent's PUBLIC trust fabric from the knowledge graph: its bilateral AgentRelationship edges (type, counterparty, direction, lifecycle status) and its EAS-aligned attestations (uid, credentialType, issuer, validity). This is who vouches for, governs, partners with or operates on behalf of whom — the evidence behind a trust score, distinct from the agent's own self-asserted profile. Key = name or 0x SA.",
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'describe_term',
    description: 'Define an agentic-trust ontology term FROM THE KNOWLEDGE GRAPH (loaded T-box/C-box): label, comment, type, domain, range. Accepts an IRI or local name (e.g. "TrustDetermination", "RegistryEntry").',
    inputSchema: { type: 'object', properties: { term: { type: 'string' } }, required: ['term'] },
  },
  {
    name: 'list_shapes',
    description: 'List the SHACL NodeShapes (C-box) the A-box is validated against.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'check_custody',
    description: 'Privacy-preserving custody check (ADR-0040): which of the given Smart Agents does a credential (EOA address or passkey credentialIdDigest) custody? Exact-match over opaque, on-chain-reproducible membership tokens — yes/no per agent, never an enumeration of who controls whom.',
    inputSchema: { type: 'object', properties: { subjectAgents: { type: 'array', items: { type: 'string' } }, credential: { type: 'string' } }, required: ['subjectAgents', 'credential'] },
  },
];

app.post('/mcp', async (c) => {
  const req = (await c.req.json().catch(() => ({}))) as { id?: unknown; method?: string; params?: any };
  const reply = (result: unknown) => c.json({ jsonrpc: '2.0', id: req.id ?? null, result });
  const fail = (code: number, message: string) => c.json({ jsonrpc: '2.0', id: req.id ?? null, error: { code, message } });
  try {
    switch (req.method) {
      case 'initialize':
        return reply({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'demo-discovery-mcp', version: '0.0.1' } });
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const { name, arguments: args = {} } = req.params ?? {};
        const out = name === 'search_agents'
          ? { ok: true, maxLimit: SEARCH_MAX_LIMIT, ...(await searchAgentsPage(c.env, String(args.q ?? ''), Number(args.limit ?? 25))) }
          : name === 'list_names'
            ? { ok: true, names: await listNames(c.env, Number(args.limit ?? 100)) }
          : name === 'list_agents_by_context'
            ? { ok: true, agents: await listAgentsByContext(c.env, String(args.appContext ?? ''), String(args.orgRole ?? ''), Number(args.limit ?? 100)) }
          : name === 'get_agent'
            ? (await getAgent(c.env, String(args.key ?? ''))) ?? { ok: false, error: 'not found' }
          : name === 'get_offerings'
            ? { ok: true, offerings: await getOfferings(c.env, String(args.key ?? '')) }
          : name === 'lookup_agents'
            ? { ok: true, results: await lookupAgents(c.env, Array.isArray(args.agents) ? args.agents.map(String) : []) }
          : name === 'get_trust_fabric'
            ? { ok: true, ...(await getTrustFabric(c.env, String(args.key ?? ''))) }
          : name === 'describe_term'
            ? (await describeTerm(c.env, String(args.term ?? ''))) ?? { ok: false, error: 'term not found' }
          : name === 'list_shapes'
            ? { ok: true, shapes: await listShapes(c.env) }
          : name === 'check_custody'
            ? { ok: true, results: await checkCustody(c.env, Array.isArray(args.subjectAgents) ? args.subjectAgents.map(String) : [], String(args.credential ?? '')) }
            : null;
        if (out === null) return fail(-32601, `unknown tool: ${name}`);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out) }] });
      }
      default:
        return fail(-32601, `method not found: ${req.method}`);
    }
  } catch (e) {
    return fail(-32603, String((e as Error).message));
  }
});

app.get('/', (c) => c.json({ service: 'demo-discovery-mcp', tools: TOOLS.map((t) => t.name), rest: ['/search?q=', '/names?limit=', '/agents?appContext=&orgRole=', '/agent?key=', '/offerings?key=', '/trust?key=', 'POST /lookup {agents:[0x…]}', 'POST /custody {subjectAgents,credential}'], mcp: 'POST /mcp' }));

export default app;
