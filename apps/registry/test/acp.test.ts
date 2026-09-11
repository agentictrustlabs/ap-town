import { describe, it, expect } from 'vitest';
import { acpAgentFor, acpRegistry } from '../src/acp.js';

const row = { name: 'alice.me', smartAgent: '0x' + 'a'.repeat(40), displayName: 'Alice', description: 'Helps', capabilityIds: ['adv:estate-planning'], agentType: 'person', tld: 'me', a2aEndpoint: 'https://alice.faithnet.io', examples: ['plan my estate', 'draft a will'] };

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
