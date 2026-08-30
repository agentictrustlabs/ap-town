import { describe, it, expect } from 'vitest';
import { ardEntryForAgent, ardRegistryEntry, ardManifest, planArdSearch, ardSearchResponse, ardExploreResponse, parseAgentsFilter, ardAgentsResponse, ARD_A2A_CARD_TYPE, ARD_URN_PATTERN, encodePageToken } from '../src/ard.js';
import { acpAgentFor, acpRegistry } from '../src/acp.js';

const row = { name: 'alice.me', smartAgent: '0x' + 'a'.repeat(40), displayName: 'Alice', description: 'Helps', capabilityIds: ['adv:estate-planning'], agentType: 'person', tld: 'me', a2aEndpoint: 'https://alice.faithnet.io', examples: ['plan my estate', 'draft a will'] };

describe('ARD entries (spec 347 §8.5)', () => {
  it('projects an agent with an A2A host into a conformant entry; identity aligns with the URN publisher', () => {
    const r = ardEntryForAgent(row, { receiptUriFor: () => 'https://discovery.example/receipts/1' });
    expect(r.entry).toBeTruthy();
    const e = r.entry!;
    expect(e.identifier).toBe('urn:air:alice.faithnet.io:agent:alice');
    expect(ARD_URN_PATTERN.test(e.identifier)).toBe(true);
    expect(e.type).toBe(ARD_A2A_CARD_TYPE);
    expect(e.url).toBe('https://alice.faithnet.io/.well-known/agent-card.json');
    expect(e.trustManifest?.identity).toBe('https://alice.faithnet.io');
    expect(e.trustManifest?.attestations?.[0]).toEqual({ type: 'ap-registry-receipt', uri: 'https://discovery.example/receipts/1' });
    expect(e.representativeQueries).toEqual(['plan my estate', 'draft a will']);
    expect(e.capabilities).toEqual(['adv:estate-planning']);
    expect(e['ap:canonicalAgentId']).toBe(row.smartAgent);
    expect(JSON.stringify(e)).not.toMatch(/mcp/i);
  });
  it('an agent without an A2A host is an honest miss, never a fabricated url', () => {
    expect(ardEntryForAgent({ ...row, a2aEndpoint: null })).toEqual({ entry: null, reason: 'no-a2a-host' });
    expect(ardEntryForAgent({ ...row, a2aEndpoint: 'http://localhost:8787' })).toEqual({ entry: null, reason: 'bad-host' });
  });
  it('the manifest carries the ARD base context plus our namespaced extension', () => {
    const m = ardManifest([ardRegistryEntry('https://discovery-a2a.faithnet.io', { name: 'discovery.registry', displayName: 'Discovery', description: 'd' })]);
    expect(m['@context']).toEqual(['https://agenticresourcediscovery.org/context/v1', expect.objectContaining({ ap: expect.any(String) })]);
    expect(m.entries[0]!.type).toBe('application/ai-registry+json');
    expect(m.entries[0]!.identifier).toBe('urn:air:discovery-a2a.faithnet.io:registry:discovery.registry');
  });
});

describe('ARD search', () => {
  it('maps text → need, capabilities → hard mandate, tags → derived type; score is fit only', () => {
    const plan = planArdSearch({ query: { text: 'estate planning', filter: { capabilities: ['adv:estate-planning'], tags: ['person'] } }, pageSize: 5 });
    expect('code' in plan).toBe(false);
    if ('code' in plan) return;
    expect(plan.need).toBe('estate planning');
    expect(plan.mandates).toEqual({ requireCapabilityId: 'adv:estate-planning', requireAgentType: 'person' });
    const res = ardSearchResponse([{ ...row, fitScore: 0.42, trustScore: 0.99, why: ['registry'] }], plan, { source: 'https://d.example/' });
    expect(res.results[0]!.score).toBe(42);
    expect(res.results[0]!['ap:trustEvidence']).toMatchObject({ confidence: 0.99 });
  });
  it('rejects what it cannot honour instead of guessing', () => {
    expect(planArdSearch({ pageSize: 0 })).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(planArdSearch({ query: { filter: { capabilities: ['a', 'b'] } } })).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(planArdSearch({ query: { filter: { 'okf:taxonomy': ['x'] } } })).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(planArdSearch({ pageToken: 'nope' })).toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
  it('a type filter this registry cannot serve yields an empty page, not an error; pagination tokens round-trip', () => {
    const plan = planArdSearch({ query: { filter: { type: ['application/mcp-server-card+json'] } } });
    if ('code' in plan) throw new Error('unexpected');
    expect(plan.typeServable).toBe(false);
    const p2 = planArdSearch({ pageSize: 1, pageToken: encodePageToken(1) });
    if ('code' in p2) throw new Error('unexpected');
    const res = ardSearchResponse([{ ...row, fitScore: 1 }, { ...row, name: 'bob.me', fitScore: 0.5 }, { ...row, name: 'cy.me', fitScore: 0.1 }], p2, { source: 's' });
    expect(res.results.map((r) => r.identifier)).toEqual(['urn:air:alice.faithnet.io:agent:bob']);
    expect(res.pageToken).toBeDefined();
  });
  it('explore + list', () => {
    const ex = ardExploreResponse({ resultType: { facets: [{ field: 'ap:agentType', limit: 1 }, { field: 'type' }] } }, { agentTypes: [{ value: 'org', count: 3 }, { value: 'person', count: 5 }], total: 8 });
    expect(ex).toMatchObject({ resultType: 'facets', facets: { 'ap:agentType': { buckets: [{ value: 'person', count: 5 }], otherCount: 3 }, type: { buckets: [{ value: ARD_A2A_CARD_TYPE, count: 8 }] } } });
    expect(ardExploreResponse({ resultType: { facets: [{ field: 'publisher' }] } }, {})).toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(parseAgentsFilter('type = "application/a2a-agent-card+json" AND tags:"person"')).toEqual({ type: ARD_A2A_CARD_TYPE, tag: 'person' });
    expect(parseAgentsFilter('name = x')).toMatchObject({ code: 'INVALID_ARGUMENT' });
    const list = ardAgentsResponse([row, { ...row, name: 'org1.org', agentType: 'org' }], { tag: 'org' });
    if ('code' in list) throw new Error('unexpected');
    expect(list.agents.map((a) => a.identifier)).toEqual(['urn:air:alice.faithnet.io:agent:org1']);
  });
});

describe('ACP registry projection', () => {
  const dist = { acp: true, version: '1.2.3', npx: { package: '@x/agent@1.2.3', args: ['--acp'] } };
  it('lists only agents that declare an ACP distribution, with the schema-exact shape and nothing extra', () => {
    const { registry, skipped } = acpRegistry([
      { ...row, distribution: dist },
      { ...row, name: 'bob.me', distribution: { acp: true, version: '1.0.0' } },
      { ...row, name: 'cy.me', distribution: { npx: { package: 'p' }, version: '1.0.0' } },
      { ...row, name: 'dee.me' },
    ]);
    expect(registry).toEqual({ version: '1.0.0', agents: [{ id: 'alice', name: 'Alice', version: '1.2.3', description: 'Helps', distribution: { npx: { package: '@x/agent@1.2.3', args: ['--acp'] } } }] });
    expect(skipped).toEqual({ 'no-method': 1, 'not-acp': 1, 'no-distribution': 1 });
    expect(Object.keys(registry.agents[0]!)).not.toContain('smartAgent');
  });
  it('id must match ^[a-z][a-z0-9-]*$', () => {
    expect(acpAgentFor({ ...row, name: '9lives.me', distribution: dist })).toEqual({ agent: null, reason: 'bad-id' });
  });
});
