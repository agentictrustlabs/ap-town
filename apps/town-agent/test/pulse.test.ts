import { describe, it, expect } from 'vitest';
import { readPulse, samplePulse, type PulseSampleV1 } from '../worker/pulse';
import type { TownManifest } from '@ap-town/town-model';

const town = { town: 'faithchain', status: 'live', chain: { id: 1, generation: '1', rpc: 'https://rpc' }, estates: [{ id: 'faithnet', repo: 'r', home: 'https://home', edge: 'https://edge', a2a: 'https://a2a.example', agentZone: 'x', nameRoots: [], lanes: {} }], services: [{ id: 'naming', kind: 'commons', repo: 'ap-town', hosts: ['names.x'], probe: 'https://names.x/health', description: 'd' }, { id: 'kms', kind: 'commons', repo: 'x', hosts: [], description: 'd' }] } as unknown as TownManifest;
const NOW = Date.parse('2026-10-10T12:00:00Z');
const at = (minsAgo: number) => new Date(NOW - minsAgo * 60_000).toISOString();
const hb = (minsAgo: number, completed: number) => ({ type: 'ap.estate-heartbeat.v1', estate: 'faithnet', at: at(minsAgo), window: '24h', generation: '1', versions: {}, agents: { person: 3, org: 1, service: 2 }, homesActive24h: 2, runs: { started: completed + 1, completed, parked: 1, failed: 0, canceled: 0 }, parkedForSignature: 1, modelCalls: 5, tokensIn: 100, tokensOut: 20, inferenceMicroUsd: null, vaultCalls: 9, doRequests: 40, askLatencyP95Ms: 800 });

describe('readPulse', () => {
  it('buckets samples into a series, keeps the latest per source, and marks a stale estate', () => {
    const samples: PulseSampleV1[] = [
      { kind: 'service', id: 'naming', at: at(40), ok: true, payload: { status: 200, up: true, ms: 50 } },
      { kind: 'service', id: 'naming', at: at(20), ok: false, payload: { status: 500, up: false, ms: 50 } },
      { kind: 'estate', id: 'faithnet', at: at(40), ok: true, payload: hb(40, 10) },
      { kind: 'estate', id: 'faithnet', at: at(20), ok: true, payload: hb(20, 12) },
      { kind: 'chain', id: 'chain-gateway', at: at(5), ok: true, payload: { totals: { requests: 7, denied: { rateLimited: 1 }, upstreamErrors: 0 }, latency: { upstreamP95Ms: 120 } } },
      { kind: 'inference', id: 'inference', at: at(5), ok: false, payload: null, error: 'not bound on this deployment' },
    ];
    const p = readPulse(town, samples, '24h', NOW);
    expect(p.services.naming?.series.map((x) => x.up)).toEqual([true, false]);
    expect(p.services.kms?.series).toEqual([]);
    expect(p.estates.faithnet?.stale).toBe(true);
    expect(p.estates.faithnet?.series.map((x) => x.runsCompleted)).toEqual([10, 12]);
    expect(p.chain.series[0]).toMatchObject({ requests: 7, denied: 1, p95Ms: 120 });
    expect(p.inference.latest?.error).toBe('not bound on this deployment');
    expect(p.sampledAt).toBe(at(5));
    const fresh = readPulse(town, [{ kind: 'estate', id: 'faithnet', at: at(2), ok: true, payload: hb(2, 1) }], '24h', NOW);
    expect(fresh.estates.faithnet?.stale).toBe(false);
  });
  it('samplePulse probes every service with a probe and says why a source could not be read', async () => {
    const out = await samplePulse(town, { TOWN_OPS_TOKEN: 't' }, async () => ({ status: 200 }), (async () => new Response('nope', { status: 401 })) as unknown as typeof fetch);
    expect(out.find((s) => s.kind === 'service' && s.id === 'naming')?.ok).toBe(true);
    expect(out.find((s) => s.kind === 'service' && s.id === 'kms')).toBeUndefined();
    expect(out.find((s) => s.kind === 'chain')?.error).toBe('not bound on this deployment');
    expect(out.find((s) => s.kind === 'estate')?.error).toBe('no heartbeat token for this estate');
    const withToken = await samplePulse(town, { ESTATE_HEARTBEAT_TOKENS: '{"faithnet":"tok"}' }, async () => ({ status: 200 }), (async () => Response.json(hb(0, 3))) as unknown as typeof fetch);
    expect(withToken.find((s) => s.kind === 'estate')?.ok).toBe(true);
  });
});
