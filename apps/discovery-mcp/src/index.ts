// demo-discovery-mcp — discovery MCP server (mirrors demo-bible-mcp from verifiable-content-demo). Tools
// read the discovery knowledge base (GraphDB @ agentkg.io, populated by agent-indexer from agent-naming +
// on-chain facets). Exposed two ways: a REST seam the A2A agent calls (GET /search, /agent — like bible's
// mcpGet/mcpPost) AND an MCP JSON-RPC endpoint (POST /mcp) for real MCP clients. Holds GraphDB creds
// server-side; the browser never sees them. Chain: browser → demo-discovery-a2a → demo-discovery-mcp → GraphDB.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { searchAgents, getAgent, describeTerm, listShapes, type Env } from './graphdb.js';

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-mcp', kb: c.env.GRAPHDB_QUERY_URL }));

// ── REST tool seam (what the A2A agent calls) ──
app.get('/search', async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = Number(c.req.query('limit') ?? 25);
  try { return c.json({ ok: true, query: q, results: await searchAgents(c.env, q, limit) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

app.get('/agent', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  try { const a = await getAgent(c.env, key); return a ? c.json({ ok: true, ...a }) : c.json({ ok: false, error: 'not found' }, 404); }
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
    name: 'get_agent',
    description: 'Get the full A-box node (all on-chain facets) for one agent by name (e.g. "lbsb.impact") or Smart Agent address (0x…).',
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
          : name === 'get_agent'
            ? (await getAgent(c.env, String(args.key ?? ''))) ?? { ok: false, error: 'not found' }
          : name === 'describe_term'
            ? (await describeTerm(c.env, String(args.term ?? ''))) ?? { ok: false, error: 'term not found' }
          : name === 'list_shapes'
            ? { ok: true, shapes: await listShapes(c.env) }
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

app.get('/', (c) => c.json({ service: 'demo-discovery-mcp', tools: TOOLS.map((t) => t.name), rest: ['/search?q=', '/agent?key='], mcp: 'POST /mcp' }));

export default app;
