import { describe, it, expect } from 'vitest';
import type { CostSampleV1, InfraSampleV1, TownManifest } from '@ap-town/town-model';
import { readPerformance, daysOf, operatorAuthorized, type InfraRowV1 } from '../worker/pulse-perf';

// The town MCP's stored rows (spec 437 §4): the portal reads these over its service binding and holds no credential.
const toInfraSample = (s: InfraSampleV1): InfraRowV1 => ({ kind: 'infra', id: `${s.platform}|${s.account}|${s.kind}|${s.resource}`, at: s.at, ok: s.ok, payload: s, ...(s.error ? { error: s.error } : {}) });
const toCostSample = (c: CostSampleV1): InfraRowV1 => ({ kind: 'cost', id: `${c.platform}|${c.account}|${c.day}|${c.resource}|${c.sku ?? ''}|${c.basis}`, at: c.asOf, ok: c.ok, payload: c, ...(c.error ? { error: c.error } : {}) });
import { dayRollup } from '../worker/pulse-record';
import type { PulseSampleV1 } from '../worker/pulse';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const town = {
  town: 'faithchain', status: 'live', chain: { id: 34348, generation: '1', rpc: 'https://rpc' },
  accounts: { cloudflare: [{ id: 'acctA', label: 'town' }], vercel: { teamId: 'team_1' } },
  estates: [{ id: 'faithnet', repo: 'r', home: 'h', edge: 'e', a2a: 'a', agentZone: 'z', nameRoots: [], lanes: {}, workers: ['demo-a2a-faithnet'], vercelProjects: ['faithnet-home'] }],
  services: [{ id: 'town-agent', kind: 'commons', repo: 'ap-town', worker: 'faithchain-town-agent', hosts: [], description: 'd' }],
} as unknown as TownManifest;
const infra = (p: Partial<InfraSampleV1>): InfraSampleV1 => ({ type: 'ap.infra-sample.v1', platform: 'cloudflare', account: 'acctA', resource: 'demo-a2a-faithnet', kind: 'worker', at: new Date(NOW - 60_000).toISOString(), asOf: new Date(NOW - 120_000).toISOString(), lagClass: 'hourly', status: 'up', metrics: { requests: 100, errors: 1 }, ok: true, ...p });
const cost = (p: Partial<CostSampleV1>): CostSampleV1 => ({ type: 'ap.cost-sample.v1', platform: 'vercel', account: 'team_1', day: '2026-10-09', resource: 'faithnet-home', sku: 'pro', amountMicroUsd: 1_000_000, basis: 'billed', asOf: new Date(NOW - 3_600_000).toISOString(), complete: true, ok: true, ...p });
const hb = (at: string, completed: number, inferenceMicroUsd: number | null = 500_000, performance?: unknown): PulseSampleV1 => ({ kind: 'estate', id: 'faithnet', at, ok: true, payload: { type: 'ap.estate-heartbeat.v1', estate: 'faithnet', at, window: '24h', generation: '1', versions: {}, agents: { person: 1, org: 1, service: 1 }, homesActive24h: 1, runs: { started: completed, completed, parked: 0, failed: 0, canceled: 0 }, parkedForSignature: 0, modelCalls: 1, tokensIn: 1, tokensOut: 1, inferenceMicroUsd, vaultCalls: 1, doRequests: 1, askLatencyP95Ms: 100, ...(performance ? { performance } : {}) } });

describe('readPerformance (spec 437 §5)', () => {
  it('the latest read of a cost day supersedes the earlier (I1); cost groups by platform × account × owner × basis; the public read withholds amounts and says so', () => {
    const rows: InfraRowV1[] = [
      { ...toCostSample(cost({ amountMicroUsd: 1_000_000 })), at: new Date(NOW - 7_200_000).toISOString() },
      { ...toCostSample(cost({ amountMicroUsd: 1_500_000, asOf: new Date(NOW - 3_600_000).toISOString() })), at: new Date(NOW - 3_600_000).toISOString() },
      toCostSample(cost({ day: '2026-10-08', amountMicroUsd: 200_000, complete: false, error: 'partial' })),
      toCostSample(cost({ platform: 'cloudflare', account: 'acctA', resource: 'pokernight-api', sku: 'workers.requests', basis: 'derived', amountMicroUsd: 50_000 })),
      toCostSample(cost({ day: '2026-07-01', amountMicroUsd: 99 })),
    ];
    const detail = readPerformance(town, [], rows, { window: '7d', nowMs: NOW, detail: true });
    const vercel = detail.cost.find((c) => c.platform === 'vercel')!;
    expect(vercel.owner).toEqual({ kind: 'estate', id: 'faithnet' });
    expect(vercel.days).toEqual([expect.objectContaining({ day: '2026-10-08', amountMicroUsd: 200_000, complete: false }), expect.objectContaining({ day: '2026-10-09', amountMicroUsd: 1_500_000, complete: true })]);
    expect(detail.cost.find((c) => c.platform === 'cloudflare')).toMatchObject({ owner: null, basis: 'derived' });
    expect(detail.complete).toBe(false);
    expect(detail.days).toHaveLength(7);
    const pub = readPerformance(town, [], rows, { window: '7d', nowMs: NOW, detail: false });
    expect(pub.cost).toEqual([]); expect(pub.detail).toBe(false);
  });
  it('infrastructure: latest per resource with owner; metrics only for the operator; the Unattributed bucket is shown either way; a failed source is named', () => {
    const rows: InfraRowV1[] = [
      toInfraSample(infra({})), toInfraSample(infra({ resource: 'faithchain-town-agent' })), toInfraSample(infra({ resource: 'pokernight-api' })),
      toInfraSample(infra({ platform: 'vercel', account: 'team_1', resource: 'faithnet-home', kind: 'deployment', lagClass: 'live', metrics: { deployAgeMs: 5 } })),
      toInfraSample(infra({ platform: 'graphdb', account: 'https://g', resource: 'graphdb', kind: 'node', ok: false, status: 'unknown', error: 'answered 503', metrics: {} })),
    ];
    const pub = readPerformance(town, [], rows, { window: '24h', nowMs: NOW, detail: false });
    expect(pub.infrastructure.find((r) => r.resource === 'demo-a2a-faithnet')).toMatchObject({ owner: { kind: 'estate', id: 'faithnet' }, latest: { status: 'up', metrics: {} }, series: [] });
    expect(pub.unattributed).toEqual([{ platform: 'cloudflare', account: 'acctA', resource: 'pokernight-api', kind: 'worker' }]);
    expect(pub.sources.find((s) => s.platform === 'graphdb')).toMatchObject({ ok: false, error: 'answered 503' });
    expect(pub.complete).toBe(false);
    const det = readPerformance(town, [], rows, { window: '24h', nowMs: NOW, detail: true });
    expect(det.infrastructure.find((r) => r.resource === 'demo-a2a-faithnet')!.latest!.metrics).toEqual({ requests: 100, errors: 1 });
    expect(det.infrastructure.find((r) => r.resource === 'demo-a2a-faithnet')!.series).toHaveLength(1);
  });

  // A resource read by TWO passes keeps a tile per cadence. Azure's VMs are the case: Resource Health every
  // five minutes, Monitor metrics hourly, one `infraId` between them. Keyed by id alone the newer status row
  // buried the metrics for good — three VMs reporting CPU while the Performance tab said "No VM readings
  // (Azure not configured or no VM listed)" (seen live 2026-10-13, the day Azure was first configured).
  it('a resource read at two cadences keeps both tiles, each with its own asOf and lag class', () => {
    const vm = { platform: 'azure' as const, account: 'sub1', resource: 'faithnet-vm', kind: 'vm' as const };
    const rows: InfraRowV1[] = [
      toInfraSample(infra({ ...vm, lagClass: 'hourly', at: new Date(NOW - 1_800_000).toISOString(), asOf: new Date(NOW - 1_800_000).toISOString(), status: 'up', metrics: { cpuPercent: 5.5, memoryAvailableBytes: 8e9 } })),
      toInfraSample(infra({ ...vm, lagClass: 'live', at: new Date(NOW - 60_000).toISOString(), asOf: new Date(NOW - 60_000).toISOString(), status: 'unknown', ok: false, error: 'Microsoft.ResourceHealth is not registered', metrics: {} })),
    ];
    const det = readPerformance(town, [], rows, { window: '24h', nowMs: NOW, detail: true });
    const mine = det.infrastructure.filter((r) => r.resource === 'faithnet-vm');
    expect(mine).toHaveLength(2);
    expect(mine.find((r) => r.latest!.lagClass === 'hourly')!.latest).toMatchObject({ status: 'up', ok: true, metrics: { cpuPercent: 5.5 } });
    expect(mine.find((r) => r.latest!.lagClass === 'live')!.latest).toMatchObject({ status: 'unknown', ok: false });
    // The SOURCE still reports its most recent word, which is the failure — a partial read stays partial (I3).
    expect(det.sources.find((s) => s.platform === 'azure')).toMatchObject({ ok: false });
    expect(det.complete).toBe(false);
  });
  it('cost per completed run = (inference receipts + the estate\'s attributed infra cost) ÷ completed runs, with both components and lag labels; the provenance block is the estate\'s own', () => {
    const perf = { type: 'ap.estate-performance.v1', window: '24h', runs: { total: 3, byOutcome: {} } };
    const samples: PulseSampleV1[] = [hb('2026-10-09T23:50:00Z', 100, 400_000), hb('2026-10-10T11:55:00Z', 50, 200_000, perf)];
    const rows: InfraRowV1[] = [
      toCostSample(cost({ day: '2026-10-09', amountMicroUsd: 3_000_000 })), toCostSample(cost({ day: '2026-10-10', amountMicroUsd: 1_500_000 })),
      toCostSample(cost({ platform: 'cloudflare', account: 'acctA', resource: 'demo-a2a-faithnet', sku: 'workers.requests', basis: 'derived', amountMicroUsd: 100_000 })),
      toCostSample(cost({ platform: 'cloudflare', account: 'acctA', resource: 'pokernight-api', sku: 'workers.requests', basis: 'derived', amountMicroUsd: 999_999_999 })),
    ];
    const r = readPerformance(town, samples, rows, { window: '24h', nowMs: NOW, detail: true });
    expect(r.provenance.faithnet).toEqual(perf);
    // 24h window = today only: one heartbeat (50 completed, 200k inference) + today's vercel 1.5M; yesterday's rows are outside the window.
    expect(r.costPerCompletedRun.faithnet).toMatchObject({ completedRuns: 50, inferenceMicroUsd: 200_000, infraMicroUsd: 1_500_000, infraBasis: 'billed', microUsd: Math.round(1_700_000 / 50), lag: ['5min', 'daily-restated'] });
    const week = readPerformance(town, samples, rows, { window: '7d', nowMs: NOW, detail: true });
    // ONE basis, named (I1): the two billed vercel days, NOT billed + the derived cloudflare estimate. Adding a
    // bill to an estimate produced a number that was neither, which is the whole point of carrying the label.
    expect(week.costPerCompletedRun.faithnet).toMatchObject({ completedRuns: 150, inferenceMicroUsd: 600_000, infraMicroUsd: 4_500_000, infraBasis: 'billed', complete: false });
    expect(week.costPerCompletedRun.faithnet!.lag).toEqual(['5min', 'daily-restated']);
    const pub = readPerformance(town, samples, rows, { window: '7d', nowMs: NOW, detail: false });
    expect(pub.costPerCompletedRun.faithnet).toMatchObject({ microUsd: null, infraMicroUsd: null, completedRuns: 150 });
    expect(pub.provenance.faithnet).toEqual(perf);
  });
  it('a source that has since been configured reads from its newest sample, not from the failure row that never gets overwritten', () => {
    // A source-level failure is one `resource: '*'` row; success writes per-resource rows and never replaces it.
    // Preferring any failure over any success left Cloudflare reading "not configured" while 67 readings landed.
    const old = { ...infra({ platform: 'cloudflare', account: 'acctA', resource: '*', ok: false, status: 'unknown' as const, error: 'not configured: CLOUDFLARE_ACCOUNTS unset', metrics: {} }), at: new Date(NOW - 7_200_000).toISOString(), asOf: new Date(NOW - 7_200_000).toISOString() };
    const fresh = { ...infra({ platform: 'cloudflare', account: 'acctA', resource: 'demo-a2a-faithnet' }), at: new Date(NOW - 60_000).toISOString(), asOf: new Date(NOW - 60_000).toISOString() };
    const rows: InfraRowV1[] = [{ kind: 'infra', id: 'cloudflare|acctA|*', at: old.at, ok: false, payload: old }, { kind: 'infra', id: 'cloudflare|acctA|demo-a2a-faithnet', at: fresh.at, ok: true, payload: fresh }];
    const src = readPerformance(town, [], rows, { window: '24h', nowMs: NOW, detail: true }).sources.find((x) => x.platform === 'cloudflare')!;
    expect(src).toMatchObject({ ok: true, error: null });
    // but a failure that IS the newest word still shows — an outage is never hidden by an older success
    const outage = { ...infra({ platform: 'cloudflare', account: 'acctA', resource: '*', ok: false, status: 'unknown' as const, error: 'authorization denied', metrics: {} }), at: new Date(NOW - 30_000).toISOString(), asOf: new Date(NOW - 30_000).toISOString() };
    const down = readPerformance(town, [], [...rows, { kind: 'infra', id: 'cloudflare|acctA|*', at: outage.at, ok: false, payload: outage }], { window: '24h', nowMs: NOW, detail: true }).sources.find((x) => x.platform === 'cloudflare')!;
    expect(down).toMatchObject({ ok: false, error: 'authorization denied' });
  });
  it('cost per run prefers a real effective over a billed zero, and says which basis it used', () => {
    // A Pro team whose usage sits inside its allowance: every billed row is 0, effective carries the money.
    const samples: PulseSampleV1[] = [hb('2026-10-10T11:55:00Z', 50, 200_000)];
    const inAllowance: InfraRowV1[] = [
      toCostSample(cost({ day: '2026-10-10', amountMicroUsd: 0, basis: 'billed' })),
      toCostSample(cost({ day: '2026-10-10', amountMicroUsd: 2_000_000, basis: 'effective' })),
    ];
    const r = readPerformance(town, samples, inAllowance, { window: '24h', nowMs: NOW, detail: true });
    expect(r.costPerCompletedRun.faithnet).toMatchObject({ infraBasis: 'effective', infraMicroUsd: 2_000_000, microUsd: Math.round(2_200_000 / 50) });
    // the two bases stay separate rows in the cost table — neither is folded into the other
    expect(r.cost.filter((c) => c.platform === 'vercel').map((c) => c.basis).sort()).toEqual(['billed', 'effective']);
    // and a provider that really did invoice money is preferred over the amortised figure
    const invoiced = readPerformance(town, samples, [...inAllowance, toCostSample(cost({ day: '2026-10-10', resource: 'faithnet-home', sku: 'x', amountMicroUsd: 900_000, basis: 'billed' }))], { window: '24h', nowMs: NOW, detail: true });
    expect(invoiced.costPerCompletedRun.faithnet).toMatchObject({ infraBasis: 'billed', infraMicroUsd: 900_000 });
    // no infrastructure cost at all is still null, never zero
    expect(readPerformance(town, samples, [], { window: '24h', nowMs: NOW, detail: true }).costPerCompletedRun.faithnet).toMatchObject({ infraMicroUsd: null, infraBasis: null });
  });
  it('the day rollup carries the day\'s infra status, cost and cost per run into the record when the town is given, and each estate\'s slice is its own', () => {
    const samples: PulseSampleV1[] = [hb('2026-10-10T11:55:00Z', 10, 100_000)];
    const rows: InfraRowV1[] = [toInfraSample(infra({})), toInfraSample(infra({ resource: 'pokernight-api' })), toCostSample(cost({ day: '2026-10-10', amountMicroUsd: 500_000 }))];
    const roll = dayRollup(samples, '2026-10-10', town, rows) as { pulse?: { infrastructure: unknown[]; cost: Array<{ days: unknown[] }>; costPerCompletedRun: Record<string, { microUsd: number }>; unattributed: unknown[] } };
    expect(roll.pulse?.infrastructure).toHaveLength(2);
    expect(roll.pulse?.cost[0]?.days).toHaveLength(1);
    expect(roll.pulse?.costPerCompletedRun.faithnet?.microUsd).toBe(60_000);
    expect(roll.pulse?.unattributed).toHaveLength(1);
    expect(dayRollup(samples, '2026-10-10')).not.toHaveProperty('pulse');
    // Without the MCP's rows the record still writes, with no infrastructure in it — never a zero dressed as a reading.
    expect((dayRollup(samples, '2026-10-10', town) as { pulse: { infrastructure: unknown[] } }).pulse.infrastructure).toEqual([]);
  });
  it('days of a window end today; the operator token is compared in constant time and an unset token admits nobody', () => {
    expect(daysOf('24h', NOW)).toEqual(['2026-10-10']);
    expect(daysOf('7d', NOW)[0]).toBe('2026-10-04');
    expect(operatorAuthorized('tok', 'Bearer tok')).toBe(true);
    expect(operatorAuthorized('tok', 'Bearer toX')).toBe(false);
    expect(operatorAuthorized(undefined, 'Bearer tok')).toBe(false);
  });
});
