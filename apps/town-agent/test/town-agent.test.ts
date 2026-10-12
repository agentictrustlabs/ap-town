import { describe as d, expect, it } from 'vitest';
import { TOWNS } from '@ap-town/town-model';
import { answer, api, cardFor, intentOf } from '../worker/index';
import type { MessageV1 } from '@agenticprimitives/a2a/standard';

const town = TOWNS.faithchain!;
const msg = (parts: MessageV1['parts']): MessageV1 => ({ messageId: 'm', role: 'ROLE_USER', parts });
const up = async () => ({ status: 200 });

d('town agent', () => {
  it('the card is A2A 1.0 with a JSONRPC interface and two skills', () => {
    const c = cardFor(town, 'https://town.example');
    expect(c.supportedInterfaces[0]).toEqual({ url: 'https://town.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(c.skills.map((s) => s.id)).toEqual(['town.describe', 'town.service']);
  });

  it('reads intent from a data part, then from text, else describes the town', () => {
    expect(intentOf(msg([{ data: { skill: 'town.service', id: 'skills' } }]), town)).toEqual({ skill: 'town.service', id: 'skills' });
    expect(intentOf(msg([{ data: { skill: 'town.service', id: 'nope' } }]), town)).toEqual({ skill: 'unknown-service', id: 'nope' });
    expect(intentOf(msg([{ text: 'is the chain gateway up?' }]), town)).toEqual({ skill: 'town.service', id: 'chain-gateway' });
    expect(intentOf(msg([{ text: 'what is here?' }]), town)).toEqual({ skill: 'town.describe' });
  });

  it('every service view carries the three signals and says listing is not permission', async () => {
    const parts = await answer(town, msg([{ text: 'what is here?' }]), up, null);
    const data = parts[1]!.data as { services: Array<{ signals: Record<string, unknown>; authorized: string }> };
    expect(data.services.length).toBe(town.services.length);
    for (const s of data.services) {
      expect(Object.keys(s.signals).filter((k) => !k.endsWith('Detail')).sort()).toEqual(['compatible', 'healthy', 'listed']);
      expect(s.authorized).toMatch(/does not grant/);
      expect(s.signals).not.toHaveProperty('authorized');
    }
  });

  it('a probe failure is "down" with its reason; a service without a probe is "unobserved"', async () => {
    const parts = await answer(town, msg([{ text: 'x' }]), async () => ({ error: 'TimeoutError' }), null);
    const services = (parts[1]!.data as { services: Array<{ id: string; signals: { healthy: string; healthDetail?: string } }> }).services;
    expect(services.find((s) => s.id === 'registry')!.signals).toMatchObject({ healthy: 'down', healthDetail: 'TimeoutError' });
    expect(services.find((s) => s.id === 'discovery-mcp')!.signals.healthy).toBe('unobserved');
  });
});

// ── THE ESTATE PAGE AND THE MCP CENSUS (spec 435 §4, §5) ──────────────────────────────────────────────────
// Both routes are read by pages that would look correct while saying the wrong thing, so what is tested here
// is the distinction they exist to keep: a registry that cannot be asked must not render as an empty town.
const envWith = (registry: { fetch(req: Request): Promise<Response> } | undefined) =>
  ({ TOWN: 'faithchain', PUBLIC_ORIGIN: 'https://town.example', ASSETS: { fetch: async () => new Response('') }, ...(registry ? { REGISTRY: registry } : {}) }) as unknown as Parameters<typeof api>[2];

const rosterOf = (rows: unknown[]) => ({
  async fetch(req: Request) {
    if (new URL(req.url).pathname === '/roster') return new Response(JSON.stringify({ ok: true, returned: rows.length, truncated: false, rows }), { headers: { 'content-type': 'application/json' } });
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  },
});
const refusing = { async fetch() { return new Response('nope', { status: 502 }); } };

// The probe is INJECTED. A unit test that reaches the live hosts tests the internet, and a red run would then
// mean "a door was down", which is not what any assertion here is about.
const call = async (path: string, registry?: { fetch(req: Request): Promise<Response> }) => {
  const url = new URL(`https://town.example/api${path}`);
  const res = await api(path, url, envWith(registry), town, 'town.example', 'https://town.example', null, 'GET', up);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

d('the estate page', () => {
  it('an estate the town does not know is a 404, not an empty estate', async () => {
    const r = await call('/estate/nowhere', rosterOf([]));
    expect(r.status).toBe(404);
    expect(String(r.body.error)).toMatch(/no estate "nowhere"/);
  });

  it('places agents by their own endpoints and says how each was placed', async () => {
    const r = await call('/estate/faithnet', rosterOf([
      { name: 'alice.me', smartAgent: '0xa1', kind: 'PersonAgent', a2aEndpoint: 'https://alice.faithnet.ai/api/a2a' },
      { name: 'x.svc', smartAgent: '0xb2', kind: 'ServiceAgent', a2aEndpoint: 'https://a2a.faithnet.io', mcpEndpoint: 'https://x.example/mcp' },
      { name: 'far.me', smartAgent: '0xc3', kind: 'PersonAgent', a2aEndpoint: 'https://imb-runtime.richardpedersen3.workers.dev' },
      { name: 'none.me', smartAgent: '0xd4', kind: 'PersonAgent' },
    ]));
    const agents = r.body.agents as { agents: Array<{ name: string; how: string }>; byKind: Record<string, number>; withMcp: number };
    expect(agents.agents.map((a) => [a.name, a.how])).toEqual([['alice.me', 'agent-zone'], ['x.svc', 'estate-a2a']]);
    expect(agents.byKind).toEqual({ person: 1, org: 0, service: 1, undeclared: 0 });
    expect(agents.withMcp).toBe(1);
  });

  it('an unreachable registry is said, and is NOT an estate with no agents', async () => {
    const r = await call('/estate/faithnet', refusing);
    expect(r.status).toBe(200);
    expect(r.body.agents).toHaveProperty('unavailable');
    expect(String((r.body.agents as { unavailable: string }).unavailable)).toMatch(/unknown rather than none/);
    // The estate's own declared facts still render: they come from the manifest, not from the registry.
    expect((r.body.mcpServers as unknown[]).length).toBe(2);
  });

  it('carries the estate’s MCP servers and its own declared facts', async () => {
    const r = await call('/estate/imbnet', rosterOf([]));
    const e = r.body.estate as { id: string; estateName: string; namingGate: string; agentZone?: string };
    expect(e.id).toBe('imbnet');
    expect(e.estateName).toBe('imbnet.estate');
    expect(e.agentZone).toBeUndefined();
    expect((r.body.mcpServers as Array<{ id: string; estate: string }>).map((m) => m.id)).toEqual(['vault', 'home']);
  });
});

d('the MCP census', () => {
  it('lists the town’s and every estate’s, and probes only where a probe is declared', async () => {
    const r = await call('/mcp', rosterOf([]));
    const servers = r.body.servers as Array<{ id: string; scale: string; estate?: string; up: boolean | null; probe?: string }>;
    expect(servers.filter((m) => m.scale === 'town').map((m) => m.id).sort()).toEqual(['discovery-connector', 'discovery-mcp', 'skills', 'town-mcp']);
    expect(servers.filter((m) => m.estate === 'faithnet').map((m) => m.id)).toEqual(['vault', 'home']);
    // A binding-only server has no door to knock on: `null`, never false, which would read as down.
    expect(servers.find((m) => m.id === 'town-mcp')!.up).toBeNull();
    for (const m of servers) if (!m.probe) expect(m.up).toBeNull();
    // And where a probe IS declared, the injected probe's answer is reported rather than invented.
    expect(servers.find((m) => m.id === 'discovery-connector')!.up).toBe(true);
  });

  it('lists only the agents whose own records name a door', async () => {
    const r = await call('/mcp', rosterOf([
      { name: 'a.svc', smartAgent: '0x1', mcpEndpoint: 'https://a.example/mcp', a2aEndpoint: 'https://a.faithnet.ai' },
      { name: 'b.me', smartAgent: '0x2', a2aEndpoint: 'https://b.faithnet.ai' },
    ]));
    const doors = r.body.agentDoors as { rows: Array<{ name: string; estate: string | null }>; read: number };
    expect(doors.rows.map((x) => x.name)).toEqual(['a.svc']);
    expect(doors.rows[0]!.estate).toBe('faithnet');
    expect(doors.read).toBe(2);
  });

  it('an unreachable registry leaves the agents unknown while the manifest half still answers', async () => {
    const r = await call('/mcp', refusing);
    expect(r.body.agentDoors).toHaveProperty('unavailable');
    expect((r.body.servers as unknown[]).length).toBeGreaterThan(0);
  });
});
