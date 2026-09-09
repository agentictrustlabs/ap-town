import { describe, it, expect } from 'vitest';
import app from '../src/index.js';
import { planFindServices } from '../src/plan.js';
import { shapeService } from '../src/catalog.js';

const LIGONIER = {
  identifier: 'urn:air:ligonier-svc.faithnet.io:agent:ligonier', displayName: 'Ligonier Ministries', type: 'application/a2a-agent-card+json',
  url: 'https://ligonier-svc.faithnet.io/.well-known/agent-card.json', description: 'Reformed teaching, study plans on justification',
  capabilities: ['gc:CFnDiscipleshipCurricula'], tags: ['service', 'justification'],
  trustManifest: { identity: 'https://ligonier-svc.faithnet.io', identityType: 'https-fqdn', attestations: [{ type: 'ap-registry-receipt', uri: 'https://discovery-a2a.faithnet.io/receipts/1' }] },
  'ap:canonicalAgentId': '0x' + 'a'.repeat(40), 'ap:agentType': 'service', 'ap:registryStatus': 'active', 'ap:siteUrl': 'https://www.ligonier.org', score: 0.42, source: 'https://discovery-a2a.faithnet.io/search',
};
const seen: Array<{ url: string; body: unknown }> = [];
const registry = (results: unknown[], status = 200) => ({
  DISCOVERY: { fetch: async (url: string, init?: RequestInit) => { seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null }); return new Response(status === 200 ? JSON.stringify({ results }) : JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'graph down' } }), { status, headers: { 'content-type': 'application/json' } }); } },
  REGISTRY_ORIGIN: 'https://discovery-a2a.faithnet.io',
});
const rpc = async (env: unknown, body: unknown) => app.fetch(new Request('https://connector.test/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), env as never);

describe('spec 386 — the discovery connector', () => {
  it('the §0 request compiles to ONE exact ARD search body — deterministic, no model', () => {
    const p = planFindServices({ topic: 'justification', capability: 'gc:CFnDiscipleshipCurricula', language: 'en', limit: 5 });
    expect(p.body).toEqual({ query: { text: 'justification', filter: { capabilities: ['gc:CFnDiscipleshipCurricula'], 'ap:language': ['en'] } }, pageSize: 5, federation: 'none' });
    expect(p.topic).toMatchObject({ known: true, shared: 'gc:TopicJustification', publisherTerms: { ligonier: 'lig:justification' } });
    expect(planFindServices({ topic: 'sanctification' }).topic).toMatchObject({ known: false });
    expect(planFindServices({ capability: 'study plans' }).body.query.filter).toEqual({ capabilities: ['gc:CFnDiscipleshipCurricula'] });
    expect(planFindServices({ language: 'English!' }).refused).toMatch(/BCP-47/);
    expect(planFindServices({}).refused).toMatch(/topic, a capability/);
  });

  it('MCP handshake: initialize, initialized (202), ping, tools/list with read-only annotations, GET refused', async () => {
    const env = registry([]);
    const init = await (await rpc(env, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'claude', version: '1' } } })).json() as { result: { protocolVersion: string; serverInfo: { name: string }; instructions: string } };
    expect(init.result.protocolVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(init.result.serverInfo.name).toBe('Global.Church Discovery');
    expect(init.result.instructions).toMatch(/authorizes nothing/);
    expect((await rpc(env, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect(((await (await rpc(env, { jsonrpc: '2.0', id: 2, method: 'ping' })).json()) as { result: unknown }).result).toEqual({});
    const list = (await (await rpc(env, { jsonrpc: '2.0', id: 3, method: 'tools/list' })).json()) as { result: { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> } };
    expect(list.result.tools.map((t) => t.name)).toEqual(['find_services', 'get_service', 'list_topics']);
    expect(list.result.tools.every((t) => t.annotations.readOnlyHint === true)).toBe(true);
    expect((await app.fetch(new Request('https://connector.test/mcp'), env as never)).status).toBe(405);
  });

  it('find_services: the registry is asked with the exact body and the answer is shaped — website surfaced, relevance labelled, the note fixed', async () => {
    seen.length = 0;
    const env = registry([LIGONIER]);
    const r = (await (await rpc(env, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'find_services', arguments: { topic: 'justification', capability: 'gc:CFnDiscipleshipCurricula', language: 'en', limit: 5 } } })).json()) as { result: { structuredContent: { services: Array<Record<string, unknown>>; topicResolution: { explanation: string }; note: string; explanation: string } } };
    expect(seen[0]).toEqual({ url: 'https://discovery-a2a.faithnet.io/search', body: { query: { text: 'justification', filter: { capabilities: ['gc:CFnDiscipleshipCurricula'], 'ap:language': ['en'] } }, pageSize: 5, federation: 'none' } });
    const s = r.result.structuredContent;
    expect(s.services).toHaveLength(1);
    expect(s.services[0]).toMatchObject({ name: 'Ligonier Ministries', website: 'https://www.ligonier.org', card: LIGONIER.url, capabilities: ['gc:CFnDiscipleshipCurricula'], relevance: 0.42, registryStatus: 'active' });
    expect((s.services[0]!.verification as { attestations: unknown[] }).attestations).toHaveLength(1);
    expect(s.topicResolution.explanation).toBe('“justification” → gc:TopicJustification ← skos:exactMatch ← lig:justification (ligonier)');
    expect(s.note).toMatch(/authorizes nothing/);
    expect(JSON.stringify(s)).not.toMatch(/trustScore|confidence|recommended/i);
  });

  it('an unknown topic is searched as the word and the explanation says so; an empty result is honest', async () => {
    seen.length = 0;
    const r = (await (await rpc(registry([]), { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'find_services', arguments: { topic: 'sanctification' } } })).json()) as { result: { structuredContent: { services: unknown[]; topicResolution: { known: boolean }; explanation: string } } };
    expect((seen[0]!.body as { query: { text: string } }).query.text).toBe('sanctification');
    expect(r.result.structuredContent.topicResolution.known).toBe(false);
    expect(r.result.structuredContent.services).toEqual([]);
    expect(r.result.structuredContent.explanation).toMatch(/not a topic this connector maps/);
    expect(r.result.structuredContent.explanation).toMatch(/nothing registered matched/);
  });

  it('a language filter that matches nothing says so and shows the matches that assert no language, labelled', async () => {
    seen.length = 0;
    let n = 0;
    const env = { REGISTRY_ORIGIN: 'https://discovery-a2a.faithnet.io', DISCOVERY: { fetch: async (url: string, init?: RequestInit) => { const body = JSON.parse(String(init?.body)); seen.push({ url, body }); n++; const withLang = !!body.query?.filter?.['ap:language']; return new Response(JSON.stringify({ results: withLang ? [] : [LIGONIER] }), { headers: { 'content-type': 'application/json' } }); } } };
    const r = (await (await rpc(env, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'find_services', arguments: { topic: 'justification', capability: 'study plans', language: 'en' } } })).json()) as { result: { structuredContent: { services: Array<{ name: string; languageAsserted?: boolean }>; explanation: string } } };
    expect(n).toBe(2);
    expect((seen[1]!.body as { query: { filter?: Record<string, unknown> } }).query.filter).toEqual({ capabilities: ['gc:CFnDiscipleshipCurricula'] });
    expect(r.result.structuredContent.services).toEqual([expect.objectContaining({ name: 'Ligonier Ministries', languageAsserted: false })]);
    expect(r.result.structuredContent.explanation).toMatch(/no registered service asserts the language “en”/);
  });

  it('a registry 502 is a tool error in the registry’s words — never a fallback', async () => {
    const r = (await (await rpc(registry([], 502), { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'find_services', arguments: { topic: 'justification' } } })).json()) as { result: { isError?: boolean; structuredContent: { error: string } } };
    expect(r.result.isError).toBe(true);
    expect(r.result.structuredContent.error).toMatch(/answered 502: graph down/);
  });

  it('list_topics cites the IRIs; shapeService keeps the entry verbatim beside the shaped fields', async () => {
    const r = (await (await rpc(registry([]), { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_topics', arguments: {} } })).json()) as { result: { structuredContent: { topics: Array<{ topic: string; shared: string }> } } };
    expect(r.result.structuredContent.topics).toEqual([expect.objectContaining({ topic: 'justification', shared: 'gc:TopicJustification' })]);
    expect(shapeService(LIGONIER).entry).toBe(LIGONIER);
  });
});
