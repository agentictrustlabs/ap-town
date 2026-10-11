import { describe, it, expect } from 'vitest';
import type { TownManifest } from '@ap-town/town-model';
import { collectCloudflareHourly, deriveCloudflareCost, HOURLY_DATASETS } from '../src/infra/cloudflare';
import { collectVercelCharges, collectVercelDeployments, parseFocus, projectOf } from '../src/infra/vercel';
import { collectAzureCost, collectAzureHealth, collectAzureVmMetrics } from '../src/infra/azure';
import { collectGraphdbHealth, collectGraphdbRepositories, parsePrometheus } from '../src/infra/graphdb';
import { collectCostPass, collectHourlyPass, collectStatusPass, PRICING } from '../src/infra/passes';
import { attributeResource, declaredResources } from '@ap-town/town-model';

const AT = '2026-10-10T12:03:00.000Z';
type Route = (url: string, init?: RequestInit) => Response | Promise<Response>;
const fetchOf = (route: Route): typeof fetch => (async (input: RequestInfo | URL, init?: RequestInit) => route(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url, init)) as typeof fetch;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const town = {
  town: 'faithchain', status: 'live', chain: { id: 34348, generation: '1', rpc: 'https://rpc' },
  accounts: { cloudflare: [{ id: 'acctA', label: 'town' }, { id: 'acctB', label: 'richcanvas' }], vercel: { teamId: 'team_1' }, azure: { subscriptionId: 'sub1', resourceGroups: ['rg-faithnet'] }, graphdb: { url: 'https://graphdb.example' } },
  estates: [{ id: 'faithnet', repo: 'r', home: 'h', edge: 'e', a2a: 'a', agentZone: 'z', nameRoots: [], lanes: {}, workers: ['demo-a2a-faithnet'], vercelProjects: ['faithnet-home'] }],
  services: [{ id: 'town-agent', kind: 'commons', repo: 'ap-town', worker: 'faithchain-town-agent', hosts: [], description: 'd' }, { id: 'rpc', kind: 'commons', repo: 'ap-town', hosts: [], description: 'd', azureResources: ['/subscriptions/sub1/resourceGroups/rg-faithnet/providers/Microsoft.Compute/virtualMachines/besu-1'] }],
} as unknown as TownManifest;

describe('cloudflare collector (spec 437 §4)', () => {
  const accounts = [{ id: 'acctA', label: 'town', token: 't' }];
  it('reads one dataset per request so one drifting dataset is unreadable ALONE; the rest read (I3)', async () => {
    const f = fetchOf(async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { query: string };
      if (q.query.includes('queueMessageOperationsAdaptiveGroups')) return json({ errors: [{ message: 'Cannot query field "billableOperations"' }] });
      if (q.query.includes('workersInvocationsAdaptive')) return json({ data: { viewer: { accounts: [{ rows: [{ dimensions: { scriptName: 'demo-a2a-faithnet' }, sum: { requests: 1000, errors: 10, subrequests: 3000 }, quantiles: { cpuTimeP50: 2500, cpuTimeP99: 40000, wallTimeP50: 90000, wallTimeP99: 900000 } }, { dimensions: { scriptName: 'flaky' }, sum: { requests: 100, errors: 20, subrequests: 0 }, quantiles: {} }] }] } } });
      if (q.query.includes('kvOperationsAdaptiveGroups')) return json({ data: { viewer: { accounts: [{ rows: [{ dimensions: { namespaceId: 'ns1', actionType: 'read' }, sum: { requests: 50 } }, { dimensions: { namespaceId: 'ns1', actionType: 'write' }, sum: { requests: 5 } }] }] } } });
      return json({ data: { viewer: { accounts: [{ rows: [] }] } } });
    });
    const out = await collectCloudflareHourly(accounts, { from: '2026-10-10T11:00:00.000Z', to: '2026-10-10T12:00:00.000Z' }, f, AT);
    const w = out.find((s) => s.resource === 'demo-a2a-faithnet')!;
    expect(w).toMatchObject({ platform: 'cloudflare', account: 'acctA', kind: 'worker', lagClass: 'hourly', status: 'up', ok: true, asOf: '2026-10-10T12:00:00.000Z' });
    expect(w.metrics).toMatchObject({ requests: 1000, errors: 10, cpuP50Ms: 2.5, cpuP99Ms: 40, wallP99Ms: 900 });
    expect(out.find((s) => s.resource === 'flaky')!.status).toBe('degraded');
    expect(out.find((s) => s.kind === 'kv')!.metrics).toEqual({ reads: 50, writes: 5 });
    const q = out.find((s) => s.kind === 'queue')!;
    expect(q.ok).toBe(false); expect(q.error).toContain('billableOperations'); expect(q.metrics).toEqual({});
    expect(out.filter((s) => s.ok).length).toBeGreaterThan(0);
  });
  it('an account whose token is refused is unreadable for every dataset, never zeros', async () => {
    const out = await collectCloudflareHourly(accounts, { from: 'a', to: 'b' }, fetchOf(() => new Response('{"success":false,"errors":[{"message":"Authentication error"}]}', { status: 401 })), AT);
    expect(out).toHaveLength(HOURLY_DATASETS.length);
    expect(out.every((s) => !s.ok && s.error?.includes('401'))).toBe(true);
  });
  it('derives a day of cost from the meters × the published table, shares the prorated allowance, and marks a partial day partial', () => {
    const hour = (h: number, requests: number) => ({ type: 'ap.infra-sample.v1' as const, platform: 'cloudflare' as const, account: 'acctA', resource: 'w1', kind: 'worker' as const, at: `2026-10-09T${String(h).padStart(2, '0')}:05:00.000Z`, asOf: `2026-10-09T${String(h + 1).padStart(2, '0')}:00:00.000Z`, lagClass: 'hourly' as const, status: 'up' as const, metrics: { requests, errors: 0, cpuP50Ms: 1 }, ok: true });
    const full = Array.from({ length: 24 }, (_, h) => hour(h, 1_000_000));
    const costs = deriveCloudflareCost('acctA', '2026-10-09', full, PRICING, AT);
    const req = costs.find((c) => c.sku === 'workers.requests')!;
    // 24M requests − 10M/30 included ≈ 23.67M × 0.3 µ$ ≈ 7.1 $
    expect(req).toMatchObject({ basis: 'derived', complete: true, ok: true, resource: 'w1', day: '2026-10-09' });
    expect(req.amountMicroUsd).toBe(Math.round((24_000_000 - 10_000_000 / 30) * 0.3));
    const partial = deriveCloudflareCost('acctA', '2026-10-09', [...full.slice(0, 20), { ...hour(21, 0), ok: false, error: 'workers: answered 500', metrics: {} }], PRICING, AT);
    expect(partial.every((c) => !c.complete)).toBe(true);
    expect(partial.find((c) => !c.ok)!.error).toContain('answered 500');
    expect(deriveCloudflareCost('acctA', '2026-10-08', [], PRICING, AT)[0]).toMatchObject({ ok: false, complete: false, error: 'no samples for this day' });
  });
});

describe('vercel collector', () => {
  const cfg = { token: 't', teamId: 'team_1' };
  it('the production deployment per project: state → status, age from ready; a missing project is its own failure', async () => {
    const f = fetchOf((u) => (u.includes('projectId=faithnet-home') ? json({ deployments: [{ uid: 'd1', readyState: 'READY', createdAt: Date.parse(AT) - 600_000, ready: Date.parse(AT) - 540_000 }] }) : u.includes('projectId=broken') ? json({ deployments: [{ uid: 'd2', readyState: 'ERROR', createdAt: 1 }] }) : json({ error: { message: 'not found' } }, 404)));
    const out = await collectVercelDeployments(cfg, ['faithnet-home', 'broken', 'ghost'], f, AT);
    expect(out[0]).toMatchObject({ platform: 'vercel', resource: 'faithnet-home', kind: 'deployment', lagClass: 'live', status: 'up', ok: true, metrics: { ready: 1, deployAgeMs: 540_000, buildMs: 60_000 } });
    expect(out[1]!.status).toBe('down');
    expect(out[2]).toMatchObject({ ok: false, status: 'unknown' }); expect(out[2]!.error).toContain('404');
  });
  it('charges: FOCUS JSONL grouped by day × project × sku, billed; a bad line marks the read incomplete', async () => {
    const lines = [{ ChargePeriodStart: '2026-10-08T00:00:00Z', BilledCost: 1.25, BillingCurrency: 'USD', ServiceName: 'Fast Data Transfer', SkuId: 'fdt', ResourceName: 'faithnet-home' }, { ChargePeriodStart: '2026-10-08T00:00:00Z', BilledCost: '0.75', BillingCurrency: 'USD', ServiceName: 'Fast Data Transfer', SkuId: 'fdt', ResourceName: 'faithnet-home' }, { ChargePeriodStart: '2026-10-09T00:00:00Z', BilledCost: 20, BillingCurrency: 'USD', ServiceName: 'Pro plan', SkuId: 'pro' }].map((x) => JSON.stringify(x)).join('\n');
    const out = await collectVercelCharges(cfg, '2026-10-03', '2026-10-09', fetchOf(() => new Response(lines, { status: 200 })), AT);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ platform: 'vercel', day: '2026-10-08', resource: 'faithnet-home', sku: 'fdt', amountMicroUsd: 2_000_000, basis: 'billed', complete: true, ok: true });
    expect(out[1]).toMatchObject({ day: '2026-10-09', resource: 'Pro plan', amountMicroUsd: 20_000_000 });
    const bad = await collectVercelCharges(cfg, 'a', 'b', fetchOf(() => new Response(`${lines}\nnot json`, { status: 200 })), AT);
    expect(bad.every((c) => !c.complete && c.error?.includes('unreadable line'))).toBe(true);
    expect(parseFocus('[{"BilledCost":1}]').rows).toHaveLength(1);
    const refused = await collectVercelCharges(cfg, 'a', 'b', fetchOf(() => new Response('forbidden', { status: 403 })), AT);
    expect(refused[0]).toMatchObject({ ok: false, complete: false, resource: '*' }); expect(refused[0]!.error).toContain('403');
  });
  it('charges: a project is read from Vercel\'s capitalised ProjectName tag, not FOCUS\'s empty ResourceName', () => {
    // The live stream leaves ResourceName empty on all 7,875 rows and puts the project in Tags.ProjectName.
    // Reading the lower-case `project` key sent every row to Unattributed while the owner sat right there.
    expect(projectOf({ Tags: { ProjectId: 'prj_1', ProjectName: 'faithnet-home' }, ServiceName: 'Fluid Provisioned Memory' })).toBe('faithnet-home');
    expect(projectOf({ Tags: { project: 'legacy-lowercase' }, ServiceName: 'x' })).toBe('legacy-lowercase');
    // a seat or a plan carries no project and is team-level on purpose, not a failure to attribute
    expect(projectOf({ Tags: {}, ServiceName: 'Additional Team Seats' })).toBe('Additional Team Seats');
    expect(projectOf({})).toBe('unattributed');
  });
  it('charges: a plan whose usage is inside its allowance reads billed 0 beside a real effective — both bases are kept, labelled, and never summed', async () => {
    // The shape the live faithnet team returns (2026-10-10): BilledCost 0 on every row, EffectiveCost carrying it.
    const lines = [
      { ChargePeriodStart: '2026-10-08T07:00:00Z', BilledCost: 0, EffectiveCost: 0.32, BillingCurrency: 'USD', ServiceName: 'Speed Insights Plus', SkuId: 'si' },
      { ChargePeriodStart: '2026-10-08T07:00:00Z', BilledCost: 0, EffectiveCost: 1.5, BillingCurrency: 'USD', ServiceName: 'Build CPU Minutes', SkuId: 'bcm', ResourceName: 'faithnet-home' },
    ].map((x) => JSON.stringify(x)).join('\n');
    const out = await collectVercelCharges(cfg, '2026-10-03', '2026-10-09', fetchOf(() => new Response(lines, { status: 200 })), AT);
    expect(out.every((c) => c.basis === 'effective')).toBe(true); // the all-zero billed basis is dropped, not shown as $0.00
    expect(out.map((c) => c.amountMicroUsd).sort((a, b) => a - b)).toEqual([320_000, 1_500_000]);
    // when BOTH bases carry a figure, each is its own row and neither absorbs the other
    const both = await collectVercelCharges(cfg, 'a', 'b', fetchOf(() => new Response(JSON.stringify({ ChargePeriodStart: '2026-10-08T07:00:00Z', BilledCost: 2, EffectiveCost: 5, BillingCurrency: 'USD', ServiceName: 'Pro', SkuId: 'pro' }), { status: 200 })), AT);
    expect(both).toHaveLength(2);
    expect(both.find((c) => c.basis === 'billed')!.amountMicroUsd).toBe(2_000_000);
    expect(both.find((c) => c.basis === 'effective')!.amountMicroUsd).toBe(5_000_000);
    // a team that genuinely spent nothing keeps both zeroes rather than vanishing
    const free = await collectVercelCharges(cfg, 'a', 'b', fetchOf(() => new Response(JSON.stringify({ ChargePeriodStart: '2026-10-08T07:00:00Z', BilledCost: 0, EffectiveCost: 0, BillingCurrency: 'USD', ServiceName: 'Pro', SkuId: 'pro' }), { status: 200 })), AT);
    expect(free.map((c) => c.basis).sort()).toEqual(['billed', 'effective']);
  });
});

describe('azure collector', () => {
  const cfg = { subscriptionId: 'sub1' }; const vm = '/subscriptions/sub1/resourceGroups/rg-faithnet/providers/Microsoft.Compute/virtualMachines/besu-1';
  it('resource health → status; VM metrics take the last point per metric', async () => {
    const health = await collectAzureHealth(cfg, 'tok', [vm, '/x/providers/Microsoft.Network/publicIPAddresses/ip1'], fetchOf((u) => (u.includes('besu-1') ? json({ properties: { availabilityState: 'Available', reportedTime: '2026-10-10T12:00:00Z' } }) : json({ error: 'nope' }, 500))), AT);
    expect(health[0]).toMatchObject({ platform: 'azure', account: 'sub1', resource: 'besu-1', kind: 'vm', status: 'up', lagClass: 'live', asOf: '2026-10-10T12:00:00Z' });
    expect(health[1]).toMatchObject({ ok: false, resource: 'ip1', kind: 'node', status: 'unknown' });
    const m = await collectAzureVmMetrics(cfg, 'tok', vm, { from: 'a', to: 'b' }, fetchOf(() => json({ value: [{ name: { value: 'Percentage CPU' }, timeseries: [{ data: [{ timeStamp: 't1', average: 10, maximum: 30 }, { timeStamp: 't2', average: 12.5, maximum: 44 }] }] }, { name: { value: 'Available Memory Bytes' }, timeseries: [{ data: [{ timeStamp: 't2', average: 8e9 }] }] }, { name: { value: 'Network In Total' }, timeseries: [{ data: [{ timeStamp: 't2', total: 123 }] }] }] })), AT);
    expect(m).toMatchObject({ kind: 'vm', lagClass: 'hourly', status: 'up', asOf: 't2', metrics: { cpuPercent: 12.5, cpuMaxPercent: 44, memoryAvailableBytes: 8e9, networkInBytes: 123 } });
  });
  it('cost: daily rows by resource group, billed; a 429 backs off once on retry-after, a second refusal is a failed, incomplete row', async () => {
    let calls = 0; const waits: number[] = [];
    const answer = json({ properties: { columns: [{ name: 'Cost' }, { name: 'UsageDate' }, { name: 'ResourceGroupName' }, { name: 'Currency' }], rows: [[4.2, 20261008, 'rg-faithnet', 'USD'], [0.3, 20261009, 'rg-faithnet', 'USD']] } });
    const out = await collectAzureCost(cfg, 'tok', { from: '2026-10-03', to: '2026-10-09' }, fetchOf(() => (++calls === 1 ? new Response('busy', { status: 429, headers: { 'x-ms-ratelimit-microsoft.consumption-retry-after': '7' } }) : answer)), AT, async (ms) => { waits.push(ms); });
    expect(waits).toEqual([7000]);
    expect(out).toEqual([expect.objectContaining({ platform: 'azure', day: '2026-10-08', resource: 'rg-faithnet', amountMicroUsd: 4_200_000, basis: 'billed', complete: true, ok: true }), expect.objectContaining({ day: '2026-10-09', amountMicroUsd: 300_000 })]);
    const still = await collectAzureCost(cfg, 'tok', { from: 'a', to: '2026-10-09' }, fetchOf(() => new Response('busy', { status: 429 })), AT, async () => {});
    expect(still[0]).toMatchObject({ ok: false, complete: false, resource: '*', day: '2026-10-09' }); expect(still[0]!.error).toContain('429');
  });
});

describe('graphdb collector — the monitor answers PROMETHEUS TEXT, not JSON (checked live 2026-10-10)', () => {
  const cfg = { url: 'https://graphdb.example/', authorization: 'Basic abc' };
  const PROM = `# HELP graphdb_heap_max_mem Maximum available memory for the GraphDB instance.\n# TYPE graphdb_heap_max_mem gauge\ngraphdb_heap_max_mem 2147483648\ngraphdb_heap_used_mem 1607532304\ngraphdb_nonheap_used_mem 269770752\ngraphdb_threads_count 48\ngraphdb_cpu_load 7.063103192279138\ngraphdb_open_file_descriptors 756\ngraphdb_max_file_descriptors 524288\ngraphdb_data_dir_used 24210915328\ngraphdb_labelled{repo="x"} 5\n`;
  it('parses the gauges, carries the credential, and names them as the Pulse names them', async () => {
    expect(parsePrometheus(PROM)).toMatchObject({ graphdb_heap_max_mem: 2_147_483_648, graphdb_cpu_load: 7.063103192279138, graphdb_threads_count: 48 });
    expect(parsePrometheus(PROM).graphdb_labelled).toBe(5); // a labelled series still parses; GraphDB emits none today
    const h = await collectGraphdbHealth(cfg, fetchOf((u, init) => {
      const hs = new Headers(init?.headers);
      expect(hs.get('authorization')).toBe('Basic abc');
      // The live monitor refuses to negotiate: anything but */* answers 500 (checked 2026-10-10).
      expect(hs.get('accept')).toBe('*/*');
      return u.endsWith('/rest/monitor/infrastructure') ? new Response(PROM, { status: 200, headers: { 'content-type': 'text/plain' } }) : json({}, 404);
    }), AT);
    expect(h).toMatchObject({ platform: 'graphdb', account: 'https://graphdb.example/', kind: 'node', status: 'up', lagClass: 'live' });
    expect(h.metrics).toMatchObject({ heapUsedBytes: 1_607_532_304, heapMaxBytes: 2_147_483_648, threadCount: 48, cpuLoad: 7.063103192279138, openFileDescriptors: 756, dataDirUsedBytes: 24_210_915_328 });
    expect(h.metrics.heapCommittedBytes).toBeNull();
  });
  it('degraded when the heap or the file descriptors are over 90% of their limit', async () => {
    const strained = await collectGraphdbHealth(cfg, fetchOf(() => new Response('graphdb_heap_used_mem 1950000000\ngraphdb_heap_max_mem 2147483648\n', { status: 200 })), AT);
    expect(strained.status).toBe('degraded');
    const fds = await collectGraphdbHealth(cfg, fetchOf(() => new Response('graphdb_open_file_descriptors 500000\ngraphdb_max_file_descriptors 524288\n', { status: 200 })), AT);
    expect(fds.status).toBe('degraded');
  });
  it('a JSON answer (or anything this parser does not recognise) is UNREADABLE, never a healthy node', async () => {
    const asJson = await collectGraphdbHealth(cfg, fetchOf(() => json({ heapMemoryUsage: { used: 1, max: 2 } })), AT);
    expect(asJson).toMatchObject({ ok: false, status: 'unknown' });
    expect(asJson.error).toContain('this parser recognises');
    const down = await collectGraphdbHealth(cfg, fetchOf(() => { throw new Error('connect ECONNREFUSED'); }), AT);
    expect(down).toMatchObject({ ok: false, status: 'unknown', error: 'connect ECONNREFUSED' });
  });
  it('repository statement counts, with a per-repository failure of its own', async () => {
    const repos = await collectGraphdbRepositories(cfg, fetchOf((u) => (u.endsWith('/rest/repositories') ? json([{ id: 'agentkg' }, { id: 'broken' }]) : u.includes('/agentkg/size') ? json({ inferred: 245_664, total: 1_087_027, explicit: 841_363 }) : json({}, 500))), AT);
    expect(repos[0]).toMatchObject({ kind: 'repository', resource: 'agentkg', ok: true, metrics: { statementsTotal: 1_087_027, statementsExplicit: 841_363, statementsInferred: 245_664 } });
    expect(repos[1]).toMatchObject({ resource: 'broken', ok: false });
    expect(await collectGraphdbRepositories(cfg, fetchOf(() => json({ not: 'a list' })), AT)).toEqual([expect.objectContaining({ ok: false, error: 'repositories: not a list' })]);
  });
});

describe('the passes and the attribution (I4, I7)', () => {
  it('declared resources come from the manifest; attribution is declared or null', () => {
    expect(declaredResources(town)).toEqual({ vercelProjects: ['faithnet-home'], azureResources: ['/subscriptions/sub1/resourceGroups/rg-faithnet/providers/Microsoft.Compute/virtualMachines/besu-1'], workers: ['demo-a2a-faithnet', 'faithchain-town-agent'], pagesProjects: [] });
    expect(attributeResource(town, 'cloudflare', 'demo-a2a-faithnet')).toEqual({ kind: 'estate', id: 'faithnet' });
    expect(attributeResource(town, 'cloudflare', 'faithchain-town-agent')).toEqual({ kind: 'service', id: 'town-agent' });
    expect(attributeResource(town, 'cloudflare', 'pokernight-api')).toBeNull();
    expect(attributeResource(town, 'vercel', 'faithnet-home')).toEqual({ kind: 'estate', id: 'faithnet' });
    expect(attributeResource(town, 'azure', 'besu-1')).toEqual({ kind: 'service', id: 'rpc' });
    expect(attributeResource(town, 'graphdb', 'graphdb')).toEqual({ kind: 'town', id: 'faithchain' });
  });
  it('an unconfigured source is NOT CONFIGURED — a failed sample per declared account, named in unreadable — never a zero', async () => {
    const status = await collectStatusPass(town, {}, fetchOf(() => json({}, 500)), Date.parse(AT));
    expect(status.unreadable).toEqual(['vercel: VERCEL_TOKEN unset', 'azure: AZURE_* unset']);
    expect(status.samples.filter((s) => s.platform === 'vercel')).toEqual([expect.objectContaining({ resource: 'faithnet-home', ok: false, status: 'unknown', error: 'not configured: VERCEL_TOKEN unset' })]);
    expect(status.samples.find((s) => s.platform === 'graphdb')).toMatchObject({ ok: false });
    const hourly = await collectHourlyPass(town, { CLOUDFLARE_ACCOUNTS: JSON.stringify([{ id: 'acctA', label: 'town', token: 't' }]) }, fetchOf(() => json({ data: { viewer: { accounts: [{ rows: [] }] } } })), Date.parse(AT));
    expect(hourly.unreadable).toContain('cloudflare richcanvas: no token in CLOUDFLARE_ACCOUNTS');
    expect(hourly.samples.find((s) => s.account === 'acctB')).toMatchObject({ ok: false, error: 'not configured: no token for this account' });
    const cost = await collectCostPass(town, {}, fetchOf(() => json({}, 500)), Date.parse(AT));
    expect(cost.costs.every((c) => !c.ok && !c.complete && c.amountMicroUsd === 0)).toBe(true);
    expect(cost.unreadable).toEqual(['vercel: VERCEL_TOKEN unset', 'azure: AZURE_* unset', 'cloudflare: CLOUDFLARE_ACCOUNTS unset']);
  });
  it('the cost pass stamps storage on the day it describes and derives yesterday from the prior hourly samples', async () => {
    const env = { CLOUDFLARE_ACCOUNTS: JSON.stringify([{ id: 'acctA', label: 'town', token: 't' }, { id: 'acctB', label: 'rc', token: 't2' }]) };
    const f = fetchOf((u, init) => { const q = JSON.parse(String(init?.body)) as { query: string }; return q.query.includes('d1StorageAdaptiveGroups') ? json({ data: { viewer: { accounts: [{ rows: [{ dimensions: { databaseId: 'db1' }, max: { databaseSizeBytes: 3e10 } }] }] } } }) : json({ data: { viewer: { accounts: [{ rows: [] }] } } }); });
    const prior = Array.from({ length: 24 }, (_, h) => ({ type: 'ap.infra-sample.v1' as const, platform: 'cloudflare' as const, account: 'acctA', resource: 'w1', kind: 'd1' as const, at: `2026-10-09T${String(h).padStart(2, '0')}:05:00.000Z`, asOf: `2026-10-09T${String(h + 1).padStart(2, '0')}:00:00.000Z`, lagClass: 'hourly' as const, status: 'up' as const, metrics: { rowsRead: 1e9, rowsWritten: 1e6 }, ok: true }));
    const out = await collectCostPass(town, env, f, Date.parse(AT), prior);
    expect(out.samples.find((s) => s.resource === 'db1')).toMatchObject({ at: '2026-10-09T23:59:59.000Z', metrics: { storageBytes: 3e10 } });
    const a = out.costs.filter((c) => c.account === 'acctA');
    expect(a.find((c) => c.sku === 'd1.rowsWritten')).toMatchObject({ day: '2026-10-09', resource: 'w1', basis: 'derived', complete: true });
    // 30 GB for one day of a 30-day month = 1 GB-month; 5 GB-month/30 included → (1 − 0.1667) × 0.75 $
    expect(a.find((c) => c.sku === 'd1.storageGbMonth')!.amountMicroUsd).toBe(Math.round((1 - 5 / 30) * 750_000));
    expect(out.costs.filter((c) => c.account === 'acctB').every((c) => c.ok === false || c.complete === false)).toBe(true);
  });
});
