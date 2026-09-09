// demo-discovery-connector — spec 386. A thin ARD client for external assistants, spoken as stateless
// Streamable HTTP MCP (`POST /mcp`). It reaches the discovery registry over a service binding and nothing
// else: never a ministry's A2A or MCP, never a page, never a payload of anyone's. Read-only, public,
// rate-limited at the edge. The registry finds and points; the client goes to the ministry directly.
import { Hono } from 'hono';
import { MethodRegistry, RpcError, RPC_ERROR, SUPPORTED_PROTOCOL_VERSIONS, buildServerDiscover, negotiateProtocolVersion, parseJsonRpc, parseRequestMeta } from '@agenticprimitives/mcp-protocol';
import { TOOLS, findServices, getService, listTopics } from './catalog.js';
import { RegistryError, type DiscoveryEnv } from './ard-client.js';
import { CONNECTOR } from './whitelabel.js';

export interface Env extends DiscoveryEnv { LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> } }

const app = new Hono<{ Bindings: Env }>();

const SERVER_INFO = { name: CONNECTOR.name, version: CONNECTOR.version };
const CAPABILITIES = { tools: { listChanged: false } };

/** The tool result envelope MCP clients read: text for the model, structured for the tool. */
function toolResult(value: Record<string, unknown>, isError = false): Record<string, unknown> {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}

function registryFor(env: Env): MethodRegistry {
  return new MethodRegistry({ onError: (info) => console.error('[discovery-connector]', info.method, info.error instanceof Error ? `${info.error.name}: ${info.error.message}` : String(info.error)) })
    .register('server/discover', () => buildServerDiscover({ serverInfo: SERVER_INFO, capabilities: CAPABILITIES }) as unknown as Record<string, unknown>)
    .register('tools/list', () => ({ tools: TOOLS }))
    .register('tools/call', async (params) => {
      const name = typeof params?.name === 'string' ? params.name : '';
      const args = ((params?.arguments ?? {}) as Record<string, unknown>);
      try {
        if (name === 'find_services') return toolResult((await findServices(env, args as never)) as unknown as Record<string, unknown>);
        if (name === 'get_service') return toolResult(await getService(env, String(args.key ?? '')));
        if (name === 'list_topics') return toolResult(listTopics() as unknown as Record<string, unknown>);
      } catch (e) {
        // ONE mechanism: the registry's refusal or outage is the answer, said as such — never a second store.
        if (e instanceof RegistryError) return toolResult({ error: e.message, registry: 'unavailable or refused', note: 'Nothing was guessed for; ask again later.' }, true);
        throw e;
      }
      throw new RpcError(RPC_ERROR.METHOD_NOT_FOUND, `unknown tool ${name}`);
    });
}

app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-connector', spec: 386, tools: TOOLS.map((t) => t.name) }));
app.get('/', (c) => c.json({ service: 'demo-discovery-connector', mcp: 'POST /mcp (Streamable HTTP, stateless)', tools: TOOLS.map((t) => t.name), doctrine: CONNECTOR.instructions }));
app.get('/mcp', (c) => c.json({ error: 'this server is stateless: POST JSON-RPC to /mcp; no SSE stream is offered' }, 405));

app.post('/mcp', async (c) => {
  const ip = c.req.header('cf-connecting-ip') ?? 'anon';
  if (c.env.LIMITER) {
    const r = await c.env.LIMITER.limit({ key: ip }).catch(() => ({ success: true }));
    if (!r.success) return c.json({ jsonrpc: '2.0', id: null, error: { code: RPC_ERROR.INTERNAL_ERROR, message: 'rate limited — try again in a minute' } }, 429);
  }
  const raw = await c.req.text();
  const parsed = parseJsonRpc(raw);
  if (!parsed.ok) return c.json(parsed.res as unknown as Record<string, unknown>);
  const req = parsed.req;
  const meta = parseRequestMeta(req.params?._meta as Record<string, unknown> | undefined, c.req.header('mcp-protocol-version'));
  // Claude.ai and its peers speak the dated protocol versions; an older client is answered with our newest and
  // may disconnect (MCP lifecycle), never refused for a date.
  const requested = typeof req.params?.protocolVersion === 'string' ? req.params.protocolVersion : meta.protocolVersion;
  const version = negotiateProtocolVersion(requested) ?? SUPPORTED_PROTOCOL_VERSIONS[0];
  const id = req.id ?? null;
  // Lifecycle, the client-compat trio: initialize / notifications/initialized / ping.
  if (req.method === 'initialize') return c.json({ jsonrpc: '2.0', id, result: { protocolVersion: version, capabilities: CAPABILITIES, serverInfo: SERVER_INFO, instructions: CONNECTOR.instructions } });
  if (req.method === 'notifications/initialized') return c.body(null, 202);
  if (req.method === 'ping') return c.json({ jsonrpc: '2.0', id, result: {} });
  const res = await registryFor(c.env).dispatch(req, { meta, protocolVersion: version, raw });
  return res === null ? c.body(null, 202) : c.json(res as unknown as Record<string, unknown>);
});

export default app;
