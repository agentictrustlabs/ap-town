import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allMcpServers, crawlRoots, estateMcpServers, EXPOSURE_WORDS, laneBindings, laneRoutesVar, parseTown, townMcpServers, validateTown, AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL } from '../src/index';

const faithchain = readFileSync(new URL('../../../towns/faithchain/town.yaml', import.meta.url), 'utf8');

const base = () => ({
  town: 't', status: 'live', chain: { id: 1, generation: '1', rpc: 'https://rpc.example', deployment: 'example' },
  estates: [{ id: 'a', repo: 'r', home: 'https://h.example', edge: 'https://e.example', a2a: 'https://x.example', nameRoots: ['me'] }],
  services: [] as unknown[],
});

describe('town manifest', () => {
  it('the faithchain manifest is valid', () => {
    const { town, errors } = parseTown(faithchain);
    expect(errors).toEqual([]);
    expect(town?.chain.id).toBe(34348);
  });

  it('refuses a service host claimed twice and a lane claimed by two estates', () => {
    const t = base();
    t.estates.push({ ...t.estates[0]!, id: 'b' });
    (t.estates[0] as any).lanes = { 'edge.example': 'w1' };
    (t.estates[1] as any).lanes = { 'edge.example': 'w2' };
    t.services = [
      { id: 's1', kind: 'commons', repo: 'x/y', hosts: ['a.example'], description: 'one' },
      { id: 's2', kind: 'commons', repo: 'x/y', hosts: ['a.example'], description: 'two' },
    ];
    const { town, errors } = validateTown(t);
    expect(town).toBeNull();
    expect(errors.some((e) => e.includes('already served by s1'))).toBe(true);
    expect(errors.some((e) => e.includes('already a lane of a'))).toBe(true);
  });

  it('a service ap-town deploys must name its app; a referenced one must not', () => {
    const t = base();
    t.services = [
      { id: 'mine', kind: 'commons', repo: 'ap-town', hosts: [], description: 'd' },
      { id: 'theirs', kind: 'application', repo: 'o/r', app: 'apps/x', hosts: [], description: 'd' },
    ];
    const { errors } = validateTown(t);
    expect(errors).toContain('services[0] (mine).app: a service ap-town deploys names its app directory');
    expect(errors).toContain('services[1] (theirs).app: only services ap-town deploys have an app here');
  });

  it('refuses an unknown kind and an estate the town does not have', () => {
    const t = base();
    t.services = [{ id: 's', kind: 'authority', repo: 'o/r', hosts: [], estates: ['zzz'], description: 'd' }];
    const { errors } = validateTown(t);
    expect(errors.some((e) => e.includes('.kind:'))).toBe(true);
    expect(errors.some((e) => e.includes('"zzz" is not an estate'))).toBe(true);
  });
});

describe('generators', () => {
  it('crawl roots are the union over estates, first-seen order', () => {
    const t = base() as any;
    t.estates.push({ ...t.estates[0], id: 'b', nameRoots: ['org', 'me'] });
    expect(crawlRoots(t)).toEqual(['me', 'org']);
  });

  it('lane bindings are per estate, one binding per Worker', () => {
    const { town } = parseTown(faithchain);
    expect(laneBindings(town!)).toEqual([
      { binding: 'LANE_FAITHNET_1', service: 'demo-edge-faithnet', pattern: 'edge.faithnet.io', estate: 'faithnet' },
      { binding: 'LANE_FAITHNET_1', service: 'demo-edge-faithnet', pattern: 'demo-edge-faithnet.richardpedersen3.workers.dev', estate: 'faithnet' },
      { binding: 'LANE_FAITHNET_2', service: 'demo-a2a-faithnet', pattern: '*.faithnet.ai', estate: 'faithnet' },
      // A SECOND ESTATE gets its own binding, numbered within ITS estate: a lane is per estate, so imbnet's
      // first is _1 beside faithnet's _1 and the two never collide.
      { binding: 'LANE_IMBNET_1', service: 'imb-edge', pattern: 'imb-edge.richardpedersen3.workers.dev', estate: 'imbnet' },
      // The RUNTIME is a lane too, because imbnet has no zone: the town pulls its heartbeat from that host,
      // and a same-account Worker cannot fetch a workers.dev one.
      { binding: 'LANE_IMBNET_2', service: 'imb-runtime', pattern: 'imb-runtime.richardpedersen3.workers.dev', estate: 'imbnet' },
    ]);
    expect(laneRoutesVar(town!)).toBe('edge.faithnet.io=LANE_FAITHNET_1,demo-edge-faithnet.richardpedersen3.workers.dev=LANE_FAITHNET_1,*.faithnet.ai=LANE_FAITHNET_2,imb-edge.richardpedersen3.workers.dev=LANE_IMBNET_1,imb-runtime.richardpedersen3.workers.dev=LANE_IMBNET_2');
  });

  it('authorization is never a town signal', () => {
    expect(AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL).toMatch(/does not grant/);
  });
});

describe('the MCP census — declared, never inferred (spec 435 §5)', () => {
  it('reads the town’s servers off the services that declare one, not off Worker names', () => {
    const { town } = parseTown(faithchain);
    const rows = townMcpServers(town!);
    expect(rows.map((r) => r.id).sort()).toEqual(['discovery-connector', 'discovery-mcp', 'skills', 'town-mcp']);
    // `demo-discovery-indexer-faithnet` is not here, and neither is any other Worker whose name ends in -mcp
    // without a declaration. The census is what the manifest asserts.
    expect(rows.every((r) => r.scale === 'town')).toBe(true);
    expect(rows.find((r) => r.id === 'discovery-connector')?.exposure).toBe('open');
    expect(rows.find((r) => r.id === 'town-mcp')?.exposure).toBe('binding');
  });

  it('gives a binding-only server no url, and an open one the host it is served on', () => {
    const { town } = parseTown(faithchain);
    const rows = townMcpServers(town!);
    expect(rows.find((r) => r.id === 'town-mcp')?.url).toBeUndefined();
    expect(rows.find((r) => r.id === 'discovery-connector')?.url).toBe('https://discovery-connector.faithnet.io');
  });

  it('reads each estate’s own servers, tagged with the estate', () => {
    const { town } = parseTown(faithchain);
    for (const id of ['faithnet', 'imbnet']) {
      const rows = estateMcpServers(town!, id);
      expect(rows.map((r) => r.id)).toEqual(['vault', 'home']);
      expect(rows.every((r) => r.scale === 'estate' && r.estate === id)).toBe(true);
      expect(rows.every((r) => !!r.url && !!r.description)).toBe(true);
    }
    expect(estateMcpServers(town!, 'nowhere')).toEqual([]);
  });

  it('every declared server is in the whole-town census exactly once', () => {
    const { town } = parseTown(faithchain);
    const all = allMcpServers(town!);
    const keys = all.map((r) => `${r.scale}:${r.estate ?? ''}:${r.id}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(all.length).toBe(townMcpServers(town!).length + town!.estates.reduce((n, e) => n + (e.mcpServers?.length ?? 0), 0));
  });

  it('refuses a binding-only server that also says where its door is', () => {
    const t = base();
    (t.estates[0] as any).mcpServers = [{ id: 'v', description: 'd', exposure: 'binding', url: 'https://v.example' }];
    const { errors } = validateTown(t);
    expect(errors.join(' ')).toMatch(/binding-only server has no door/);
  });

  it('refuses a server with a door that does not say where, and an unknown exposure', () => {
    const t = base();
    (t.estates[0] as any).mcpServers = [
      { id: 'v', description: 'd', exposure: 'authenticated' },
      { id: 'w', description: 'd', exposure: 'sometimes', url: 'https://w.example' },
    ];
    const { errors } = validateTown(t);
    expect(errors.join(' ')).toMatch(/says where it is/);
    expect(errors.join(' ')).toMatch(/exposure: one of/);
  });

  it('refuses a nameless or wordless server, and a duplicate id in one estate', () => {
    const t = base();
    (t.estates[0] as any).mcpServers = [
      { id: 'v', exposure: 'binding' },
      { id: 'v', description: 'd', exposure: 'binding' },
      { description: 'd', exposure: 'binding' },
    ];
    const { errors } = validateTown(t);
    expect(errors.join(' ')).toMatch(/description: required/);
    expect(errors.join(' ')).toMatch(/duplicate MCP server id/);
    expect(errors.join(' ')).toMatch(/id: a lower-case id/);
  });

  it('every exposure has words a reader can act on, and none of them is a permission', () => {
    for (const [k, v] of Object.entries(EXPOSURE_WORDS)) {
      expect(v.length).toBeGreaterThan(10);
      expect(v, `${k} reads as a permission`).not.toMatch(/\b(allowed|authori[sz]ed|may use|permitted|trusted)\b/i);
    }
  });
});
