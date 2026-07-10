// demo-discovery-mcp — discovery MCP server (mirrors demo-bible-mcp from verifiable-content-demo). Tools
// read the discovery knowledge base (GraphDB @ agentkg.io, populated by agent-indexer from agent-naming +
// on-chain facets). Exposed two ways: a REST seam the A2A agent calls (GET /search, /agent — like bible's
// mcpGet/mcpPost) AND an MCP JSON-RPC endpoint (POST /mcp) for real MCP clients. Holds GraphDB creds
// server-side; the browser never sees them. Chain: browser → demo-discovery-a2a → demo-discovery-mcp → GraphDB.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { searchAgents, getAgent, getOfferings, listNames, describeTerm, listShapes, checkCustody, runKbQuery, type Env } from './graphdb.js';

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

// ── REST tool seam (what the A2A agent calls) ──
app.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = Number(c.req.query('limit') ?? 25);
  try { return c.json({ ok: true, query: q, results: await searchAgents(c.env, q, limit) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Every named agent, most-recently-registered first (apnam:registeredAt off AgentNameRegistry storage).
app.get('/names', async (c) => {
  const limit = Number(c.req.query('limit') ?? 100);
  try { return c.json({ ok: true, names: await listNames(c.env, limit) }); }
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
app.get('/offerings', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  try { return c.json({ ok: true, key, offerings: await getOfferings(c.env, key) }); }
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
    description: 'Search the discovery knowledge graph for agents by free text (name / profile). Returns each agent with its on-chain facet coverage + SHACL conformance.',
    inputSchema: { type: 'object', properties: { q: { type: 'string', description: 'free-text query' }, limit: { type: 'number' } } },
  },
  {
    name: 'list_names',
    description: 'List every named agent in the discovery knowledge graph, most-recently-registered first. Each: name, smartAgent, registeredAt/expiresAt (unix seconds, from on-chain AgentNameRegistry storage), agent kind, displayName.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number', description: 'max results (default 100, cap 500)' } } },
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
          ? { ok: true, results: await searchAgents(c.env, String(args.q ?? ''), Number(args.limit ?? 25)) }
          : name === 'list_names'
            ? { ok: true, names: await listNames(c.env, Number(args.limit ?? 100)) }
          : name === 'get_agent'
            ? (await getAgent(c.env, String(args.key ?? ''))) ?? { ok: false, error: 'not found' }
          : name === 'get_offerings'
            ? { ok: true, offerings: await getOfferings(c.env, String(args.key ?? '')) }
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

app.get('/', (c) => c.json({ service: 'demo-discovery-mcp', tools: TOOLS.map((t) => t.name), rest: ['/search?q=', '/names?limit=', '/agent?key=', '/offerings?key=', 'POST /custody {subjectAgents,credential}'], mcp: 'POST /mcp' }));

export default app;
