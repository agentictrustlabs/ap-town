import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { allMcpServers, attributeEndpoint, crawlRoots, estateMcpServers, EXPOSURE_WORDS, laneBindings, laneRoutesVar, parseTown, sourceUrlOf, townMcpServers, validateTown, AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL } from '../src/index';

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
      //
      // imbnet GOT ITS OWN ZONES on 2026-10-13 (`impact-agent.io` + `impact-agent.ai`), so it now carries the
      // same shape faithnet does — the edge host, the `*.<agentZone>` card wildcard — and the workers.dev
      // hosts stay beside them while they still serve. Note what this proves: ONE binding per Worker, several
      // patterns onto it. imbnet's `*.impact-agent.ai` and `a2a.impact-agent.io` both reach `imb-runtime` on
      // LANE_IMBNET_2, which is the invariant this test is named for.
      { binding: 'LANE_IMBNET_1', service: 'imb-edge', pattern: 'edge.impact-agent.io', estate: 'imbnet' },
      { binding: 'LANE_IMBNET_2', service: 'imb-runtime', pattern: '*.impact-agent.ai', estate: 'imbnet' },
      { binding: 'LANE_IMBNET_2', service: 'imb-runtime', pattern: 'a2a.impact-agent.io', estate: 'imbnet' },
      { binding: 'LANE_IMBNET_1', service: 'imb-edge', pattern: 'imb-edge.richardpedersen3.workers.dev', estate: 'imbnet' },
      // The RUNTIME is a lane on the old host too: the town pulls this estate's heartbeat from it, and a
      // same-account Worker cannot fetch a workers.dev one.
      { binding: 'LANE_IMBNET_2', service: 'imb-runtime', pattern: 'imb-runtime.richardpedersen3.workers.dev', estate: 'imbnet' },
    ]);
    expect(laneRoutesVar(town!)).toBe('edge.faithnet.io=LANE_FAITHNET_1,demo-edge-faithnet.richardpedersen3.workers.dev=LANE_FAITHNET_1,*.faithnet.ai=LANE_FAITHNET_2,edge.impact-agent.io=LANE_IMBNET_1,*.impact-agent.ai=LANE_IMBNET_2,a2a.impact-agent.io=LANE_IMBNET_2,imb-edge.richardpedersen3.workers.dev=LANE_IMBNET_1,imb-runtime.richardpedersen3.workers.dev=LANE_IMBNET_2');
  });

  it('authorization is never a town signal', () => {
    expect(AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL).toMatch(/does not grant/);
  });
});

describe('the MCP census — declared, never inferred (spec 435 §5)', () => {
  it('reads the town’s servers off the services that declare one, not off Worker names', () => {
    const { town } = parseTown(faithchain);
    const rows = townMcpServers(town!);
    // `people-groups` joined the census when the manifest declared the Worker behind people-groups.svc's
    // own `atl:mcpEndpoint` (2026-10-12) — a declared server, which is the only way into this list.
    expect(rows.map((r) => r.id).sort()).toEqual(['discovery-connector', 'discovery-mcp', 'people-groups', 'skills', 'town-mcp']);
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

describe('what serves this endpoint — declared, never derived from the hostname', () => {
  const t = () => parseTown(faithchain).town!;

  it('attributes an agent’s A2A door to the Worker its estate’s lane names', () => {
    // The case the hostname cannot answer: `alice.faithnet.ai` names no Worker, and the only thing that knows
    // what runs behind it is the estate's `*.faithnet.ai` lane.
    const a = attributeEndpoint(t(), 'https://alice.faithnet.ai/api/a2a');
    expect(a.how).toBe('estate-zone');
    expect(a.estate).toBe('faithnet');
    expect(a.worker).toBe('demo-a2a-faithnet');
    expect(a.repo).toBe('agentictrustlabs/ap-home');
    expect(a.note).toMatch(/every agent under faithnet\.ai answers at the demo-a2a-faithnet Worker/);
  });

  it('attributes a declared MCP server’s url to that server and its estate', () => {
    const a = attributeEndpoint(t(), 'https://mcp.faithnet.io');
    expect(a).toMatchObject({ how: 'mcp-server', mcpServerId: 'vault', estate: 'faithnet', worker: 'demo-mcp-faithnet' });
  });

  it('attributes a listed service’s host to that service, with its app directory', () => {
    const a = attributeEndpoint(t(), 'https://discovery-connector.faithnet.io/mcp');
    expect(a).toMatchObject({ how: 'service-host', serviceId: 'discovery-connector', worker: 'demo-discovery-connector-faithnet', repo: 'ap-town', app: 'apps/discovery-connector' });
    expect(sourceUrlOf(a)).toBe('https://github.com/agentictrustlabs/ap-town/tree/HEAD/apps/discovery-connector');
  });

  it('attributes an estate’s own doors, and its Home to its Vercel project', () => {
    expect(attributeEndpoint(t(), 'https://imb-runtime.richardpedersen3.workers.dev')).toMatchObject({ how: 'estate-lane', estate: 'imbnet', worker: 'imb-runtime' });
    expect(attributeEndpoint(t(), 'https://www.faithnet.me')).toMatchObject({ how: 'estate-door', estate: 'faithnet', vercelProject: 'faithnet-home' });
  });

  it('says UNATTRIBUTED for a host the manifest never declared — it does not split the name on a dot', () => {
    // The temptation this refuses: `demo-gc-pg-staging.r-pedersen.workers.dev` looks exactly like a Worker
    // name. A convention that is right four times in six is two falsehoods.
    //
    // The example used to be `demo-gc-pg.…` itself, until the manifest DECLARED that host (people-groups-mcp,
    // 2026-10-12) and this test started passing for the wrong reason — a declared host attributes because it
    // was declared, which is the opposite of what is being tested here. Its staging twin is undeclared and
    // identically shaped, so the test asks the question it means to ask.
    const a = attributeEndpoint(t(), 'https://demo-gc-pg-staging.r-pedersen.workers.dev/mcp');
    expect(a.how).toBe('unattributed');
    expect(a.worker).toBeUndefined();
    expect(a.note).toMatch(/does not guess/);
  });

  it('an unreadable URL is unattributed and says so, rather than throwing', () => {
    expect(attributeEndpoint(t(), 'not a url')).toMatchObject({ how: 'unattributed', host: '' });
  });

  it('a repository with no app directory links the repository itself', () => {
    const a = attributeEndpoint(t(), 'https://skills.faithnet.io');
    expect(a.repo).toBe('agentictrustlabs/skills');
    expect(sourceUrlOf(a)).toBe('https://github.com/agentictrustlabs/skills');
    expect(sourceUrlOf({ ...a, repo: undefined } as typeof a)).toBeNull();
  });
});
