import { describe, it, expect } from 'vitest';
import { dayRollup, pulseRecordReadiness, agentRecordReadiness, contextAgents } from '../worker/pulse-record';
import { namesSampleOf, type PulseSampleV1 } from '../worker/pulse';

describe('the Pulse record (spec 436 §5.5)', () => {
  it('rolls a day up: services up/samples, the latest chain and inference summaries, each estate heartbeat — counts only', () => {
    const s: PulseSampleV1[] = [
      { kind: 'service', id: 'naming', at: '2026-10-10T01:00:00Z', ok: true, payload: {} }, { kind: 'service', id: 'naming', at: '2026-10-10T02:00:00Z', ok: false, payload: {} },
      { kind: 'chain', id: 'chain-gateway', at: '2026-10-10T02:00:00Z', ok: true, payload: { totals: { requests: 9 } } },
      { kind: 'estate', id: 'faithnet', at: '2026-10-10T02:00:00Z', ok: true, payload: { agents: { person: 1 } } },
      { kind: 'service', id: 'naming', at: '2026-10-11T00:00:00Z', ok: true, payload: {} },
    ];
    const r = dayRollup(s, '2026-10-10');
    expect(r).toMatchObject({ type: 'ap.town-pulse.v1', day: '2026-10-10', samples: 4, services: { naming: { samples: 2, up: 1 } }, chain: { totals: { requests: 9 } }, inference: null, estates: { faithnet: { agents: { person: 1 } } } });
  });
  it('keeps the town of names in counts per root — the last good sample of the day, no name and no owner', () => {
    const s: PulseSampleV1[] = [
      { kind: 'names', id: 'naming', at: '2026-10-10T01:00:00Z', ok: true, payload: namesSampleOf({ chainId: 34348, block: 1, roots: [{ tld: 'me', kind: 'person', names: 'a person', count: 85 }] }) },
      { kind: 'names', id: 'naming', at: '2026-10-10T02:00:00Z', ok: true, payload: namesSampleOf({ chainId: 34348, block: 9, roots: [{ tld: 'me', kind: 'person', names: 'a person', count: 86, sample: [{ name: 'alice.me', owner: '0xabc' }] }, { tld: 'org', kind: 'org', names: 'an organization', count: 69 }] }) },
      { kind: 'names', id: 'naming', at: '2026-10-10T03:00:00Z', ok: false, payload: null, error: 'answered 502' },
    ];
    const r = dayRollup(s, '2026-10-10') as { names: { total: number; block: number; roots: Array<Record<string, unknown>> } };
    expect(r.names).toEqual({ chainId: 34348, block: 9, total: 155, roots: [{ tld: 'me', kind: 'person', names: 'a person', count: 86 }, { tld: 'org', kind: 'org', names: 'an organization', count: 69 }] });
    // The owner of a name is never carried: the sample is a count per root and nothing else.
    expect(JSON.stringify(r.names)).not.toContain('0xabc');
  });
  it('is ready per agent: one estate with no wires does not stop the town\'s own record', () => {
    const wire = (delegate: string) => ({ delegator: '0x' + '1'.repeat(40), delegate, authority: '0x00', caveats: [], salt: '1', signature: '0xsig' });
    const env = {
      VAULT_URL: 'https://v', TOWN_SIGNER_KEY: '0x' + '1'.repeat(64),
      CONTEXT_AGENTS: '{"town":"faith-town.workspace","estates":{"faithnet":"faith-estate.workspace","imbnet":"imb-estate.workspace"}}',
      CONTEXT_AGENT_CREDENTIALS: JSON.stringify({
        'faith-town.workspace': { grant: wire('0x' + '2'.repeat(40)), leaf: wire('0x' + '2'.repeat(40)) },
        'faith-estate.workspace': { grant: wire('0x' + '3'.repeat(40)), leaf: wire('0x' + '3'.repeat(40)) },
      }),
    };
    expect(pulseRecordReadiness(env)).toMatchObject({ ready: true, agents: ['faith-town.workspace', 'faith-estate.workspace'], notReady: [{ agent: 'imb-estate.workspace', reason: expect.stringContaining('no vault credentials') }] });
    expect(agentRecordReadiness(env, 'faith-town.workspace')).toEqual({ ready: true });
    expect(agentRecordReadiness(env, 'imb-estate.workspace')).toMatchObject({ ready: false, reason: expect.stringContaining('imb-estate.workspace') });
    expect(agentRecordReadiness(env, 'someone.else')).toMatchObject({ ready: false, reason: expect.stringContaining('not a context agent') });
  });
  it('readiness names what is missing, in order: vault, key, agents, credentials', () => {
    expect(pulseRecordReadiness({})).toMatchObject({ ready: false, reason: 'VAULT_URL unset' });
    expect(pulseRecordReadiness({ VAULT_URL: 'https://v', TOWN_SIGNER_KEY: '0x' + '1'.repeat(64) })).toMatchObject({ ready: false });
    expect(pulseRecordReadiness({ VAULT_URL: 'https://v', TOWN_SIGNER_KEY: '0x' + '1'.repeat(64), CONTEXT_AGENTS: '{"town":"faith-town.workspace","estates":{}}' })).toMatchObject({ ready: false, reason: expect.stringContaining('faith-town.workspace') });
    expect(contextAgents({ CONTEXT_AGENTS: 'nope' })).toEqual({ estates: {} });
  });
});
