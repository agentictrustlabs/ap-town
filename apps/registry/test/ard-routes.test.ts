import { describe, it, expect, afterEach, vi } from 'vitest';
import app from '../src/index.js';

const SA = '0x' + 'b'.repeat(40);
const rows = [
  { agent: 'urn:a', name: 'alice.me', smartAgent: SA, facets: ['naming', 'profile'], shaclConforms: true, displayName: 'Alice', description: 'Estate planning help', capabilityIds: ['adv:estate-planning'], agentType: 'person', tld: 'me', a2aEndpoint: 'https://alice.faithnet.io', distribution: { acp: true, version: '1.0.0', npx: { package: '@alice/agent@1.0.0' } } },
  { agent: 'urn:b', name: 'bob.org', smartAgent: '0x' + 'c'.repeat(40), facets: ['naming'], shaclConforms: true, displayName: 'Bob Org', agentType: 'org', tld: 'org', a2aEndpoint: null },
];
const facets = { ok: true, agentTypes: [{ value: 'person', count: 1 }, { value: 'org', count: 1 }], total: 2 };

const env = { MCP_URL: 'http://mcp.test', A2A_PUBLIC_ORIGIN: 'https://discovery-a2a.example' } as unknown as Parameters<typeof app.fetch>[1];
const call = (path: string, init: RequestInit = {}) => app.fetch(new Request(`https://discovery-a2a.example${path}`, init), env);

describe('ARD + ACP routes on the discovery registry', () => {
  afterEach(() => vi.unstubAllGlobals());
  const stubMcp = () => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/facets')) return new Response(JSON.stringify(facets), { headers: { 'content-type': 'application/json' } });
    if (u.includes('/search')) return new Response(JSON.stringify({ ok: true, results: rows }), { headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: 404 });
  }));

  it('serves /.well-known/ard.json with the registry entry first and one entry per agent with an A2A host', async () => {
    stubMcp();
    const r = await call('/.well-known/ard.json');
    expect(r.status).toBe(200);
    const m = await r.json() as { entries: Array<{ identifier: string; type: string }> };
    expect(m.entries[0]).toMatchObject({ identifier: 'urn:air:discovery-a2a.example:registry:discovery.registry', type: 'application/ai-registry+json' });
    expect(m.entries.map((e) => e.identifier)).toEqual(['urn:air:discovery-a2a.example:registry:discovery.registry', 'urn:air:alice.faithnet.io:agent:alice']);
  });

  it('POST /search returns ARD results whose score is relevance only', async () => {
    stubMcp();
    const r = await call('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: { text: 'estate planning' }, pageSize: 5 }) });
    expect(r.status).toBe(200);
    const j = await r.json() as { results: Array<{ identifier: string; score: number; source: string; 'ap:trustEvidence': unknown }> };
    expect(j.results).toHaveLength(1);
    expect(j.results[0]).toMatchObject({ identifier: 'urn:air:alice.faithnet.io:agent:alice', source: 'https://discovery-a2a.example/search' });
    expect(j.results[0]!.score).toBeGreaterThanOrEqual(0);
    expect(j.results[0]!['ap:trustEvidence']).toBeTruthy();
    const bad = await call('/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageSize: 500 }) });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: { code: 'INVALID_ARGUMENT' } });
  });

  it('POST /explore, GET /agents, and the ACP registry file', async () => {
    stubMcp();
    const ex = await (await call('/explore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ resultType: { facets: [{ field: 'ap:agentType' }] } }) })).json() as { facets: Record<string, { buckets: unknown[] }> };
    expect(ex.facets['ap:agentType']!.buckets).toHaveLength(2);
    const list = await (await call('/agents?filter=' + encodeURIComponent('tags:"person"'))).json() as { items: Array<{ identifier: string }> };
    expect(list.items.map((a) => a.identifier)).toEqual(['urn:air:alice.faithnet.io:agent:alice']);
    const acp = await call('/registry/v1/latest/registry.json');
    expect(acp.status).toBe(200);
    expect(await acp.json()).toEqual({ version: '1.0.0', agents: [{ id: 'alice', name: 'Alice', version: '1.0.0', description: 'Estate planning help', distribution: { npx: { package: '@alice/agent@1.0.0' } } }] });
    expect(JSON.parse(acp.headers.get('x-ap-skipped')!)).toEqual({ 'no-distribution': 1 });
  });
});
