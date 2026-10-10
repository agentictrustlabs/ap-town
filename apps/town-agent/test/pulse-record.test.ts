import { describe, it, expect } from 'vitest';
import { dayRollup, pulseRecordReadiness, contextAgents } from '../worker/pulse-record';
import type { PulseSampleV1 } from '../worker/pulse';

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
  it('readiness names what is missing, in order: vault, key, agents, credentials', () => {
    expect(pulseRecordReadiness({})).toMatchObject({ ready: false, reason: 'VAULT_URL unset' });
    expect(pulseRecordReadiness({ VAULT_URL: 'https://v', TOWN_SIGNER_KEY: '0x' + '1'.repeat(64) })).toMatchObject({ ready: false });
    expect(pulseRecordReadiness({ VAULT_URL: 'https://v', TOWN_SIGNER_KEY: '0x' + '1'.repeat(64), CONTEXT_AGENTS: '{"town":"faith-town.workspace","estates":{}}' })).toMatchObject({ ready: false, reason: expect.stringContaining('faith-town.workspace') });
    expect(contextAgents({ CONTEXT_AGENTS: 'nope' })).toEqual({ estates: {} });
  });
});
