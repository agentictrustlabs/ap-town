import { describe as d, expect, it } from 'vitest';
import { TOWNS } from '@ap-town/town-model';
import { answer, api, cardFor, claimedByTown, intentOf, type RosterRead } from '../worker/index';
import type { MessageV1 } from '@agenticprimitives/a2a/standard';

const town = TOWNS.faithchain!;
const msg = (parts: MessageV1['parts']): MessageV1 => ({ messageId: 'm', role: 'ROLE_USER', parts });
const up = async () => ({ status: 200 });

d('town agent', () => {
  it('the card is A2A 1.0 with a JSONRPC interface and two skills', () => {
    const c = cardFor(town, 'https://town.example');
    expect(c.supportedInterfaces[0]).toEqual({ url: 'https://town.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
    expect(c.skills.map((s) => s.id)).toContain('town.describe');
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
// `api()` takes the path ALREADY stripped of its query, the way the fetch handler hands it over. Passing the
// whole thing matched no route and every assertion read `undefined`, which looks like a broken route.
const call = async (pathWithQuery: string, registry?: { fetch(req: Request): Promise<Response> }, authorization: string | null = null) => {
  const url = new URL(`https://town.example/api${pathWithQuery}`);
  const path = pathWithQuery.split('?')[0]!;
  const res = await api(path, url, envWith(registry), town, 'town.example', 'https://town.example', authorization, 'GET', up);
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
    // The estate page probes the same doors the census does. Two pages disagreeing about one door — "answers"
    // on /mcp and "not probed" here — is worse than neither saying anything, and that is what shipped first.
    expect((r.body.mcpServers as Array<{ up: boolean | null }>).map((m) => m.up)).toEqual([true, true]);
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

// ── THE TOWN AGENT'S OWN SKILLS (spec 435 §7) ─────────────────────────────────────────────────────────────
const ROWS = [
  { name: 'alice.me', smartAgent: '0xa1', kind: 'PersonAgent', a2aEndpoint: 'https://alice.faithnet.ai/api/a2a' },
  { name: 'pg.svc', smartAgent: '0xb2', kind: 'ServiceAgent', a2aEndpoint: 'https://a2a.faithnet.io', mcpEndpoint: 'https://pg.example/mcp' },
  { name: 'far.me', smartAgent: '0xc3', kind: 'PersonAgent', a2aEndpoint: 'https://imb-runtime.richardpedersen3.workers.dev' },
];
const withRoster: { roster: RosterRead } = { roster: async () => ({ rows: ROWS, truncated: false }) };
const dataMsg = (data: Record<string, unknown>) => msg([{ data }]);
const partsOf = async (m: Parameters<typeof answer>[1], deps: { roster: RosterRead } = withRoster) => answer(town, m, up, null, deps);
const textOf = (ps: Awaited<ReturnType<typeof answer>>) => String(ps[0]!.text ?? '');
const dataOf = (ps: Awaited<ReturnType<typeof answer>>) => ps[1]!.data as Record<string, unknown>;

d('the card advertises the two new skills and not a third it cannot keep', () => {
  it('lists town.estate and town.mcp, and NOT town.standing', () => {
    const ids = cardFor(town, 'https://town.example').skills.map((s) => s.id);
    expect(ids).toEqual(['town.describe', 'town.service', 'town.estate', 'town.mcp']);
    // `town.standing` would report an attestation that does not exist yet (435 W1). A skill that can only
    // answer "none" is worse than no skill: a caller cannot tell it from a town where nobody has standing.
    expect(ids).not.toContain('town.standing');
  });
});

d('intentOf — the collisions decide the order', () => {
  it('a service whose own id ends in -mcp still reaches the service answer', () => {
    expect(intentOf(msg([{ text: 'is discovery-mcp up?' }]), town)).toEqual({ skill: 'town.service', id: 'discovery-mcp' });
    expect(intentOf(msg([{ text: 'what about town-mcp' }]), town)).toEqual({ skill: 'town.service', id: 'town-mcp' });
  });
  it('the word mcp reaches the census, and an estate beside it scopes rather than changes the question', () => {
    expect(intentOf(msg([{ text: 'which mcp servers are here?' }]), town)).toEqual({ skill: 'town.mcp' });
    expect(intentOf(msg([{ text: 'what mcp does faithnet run?' }]), town)).toEqual({ skill: 'town.mcp', estate: 'faithnet' });
  });
  it('an estate id on its own reaches the estate answer', () => {
    expect(intentOf(msg([{ text: 'tell me about imbnet' }]), town)).toEqual({ skill: 'town.estate', id: 'imbnet' });
  });
  it('a data part wins, and names an estate this town does not have as unknown rather than guessing', () => {
    expect(intentOf(dataMsg({ skill: 'town.estate', id: 'imbnet' }), town)).toEqual({ skill: 'town.estate', id: 'imbnet' });
    expect(intentOf(dataMsg({ skill: 'town.estate', id: 'nowhere' }), town)).toEqual({ skill: 'unknown-estate', id: 'nowhere' });
    expect(intentOf(dataMsg({ skill: 'town.mcp', id: 'faithnet' }), town)).toEqual({ skill: 'town.mcp', estate: 'faithnet' });
  });
});

d('town.estate answers from the manifest and the chain, and never promotes an inference', () => {
  it('places agents by their endpoints and says the placement is inferred', async () => {
    const ps = await partsOf(dataMsg({ skill: 'town.estate', id: 'faithnet' }));
    const v = dataOf(ps) as { agents: { agents: Array<{ name: string; how: string }>; byKind: Record<string, number>; read: number } };
    expect(v.agents.agents.map((a) => a.name)).toEqual(['alice.me', 'pg.svc']);
    expect(v.agents.read).toBe(3);
    expect(textOf(ps)).toMatch(/INFERRED from the agent's own on-chain endpoint/);
    expect(textOf(ps)).not.toMatch(/attested|verified member/i);
  });

  it('says what the estate may name and who holds its keys, and that none of it is permission', async () => {
    const t = textOf(await partsOf(dataMsg({ skill: 'town.estate', id: 'faithnet' })));
    expect(t).toMatch(/\.me/);
    expect(t).toMatch(/authorized by the gate 0x/);
    expect(t).toMatch(/a key is a delegate, never an identity/);
    expect(t).toMatch(/None of this says what anybody may do here/);
  });

  it('an estate with no zone of its own says so rather than omitting it', async () => {
    expect(textOf(await partsOf(dataMsg({ skill: 'town.estate', id: 'imbnet' })))).toMatch(/serves no agent zone of its own/);
  });

  it('an unreachable registry leaves the agents unknown, never none', async () => {
    const ps = await partsOf(dataMsg({ skill: 'town.estate', id: 'faithnet' }), { roster: async () => null });
    expect(textOf(ps)).toMatch(/could not be read/);
    expect(textOf(ps)).not.toMatch(/No agent was placed/);
    expect(dataOf(ps).agents).toHaveProperty('unavailable');
  });

  it('refuses an estate this town does not have, and names the ones it does', async () => {
    expect(textOf(await partsOf(dataMsg({ skill: 'town.estate', id: 'nowhere' })))).toMatch(/not an estate of the .* town.*faithnet, imbnet/);
  });
});

d('town.mcp says what is here, what is deliberately not, and that a door is not an invitation', () => {
  it('lists the town’s and the estates’ declared servers with their exposure', async () => {
    const ps = await partsOf(dataMsg({ skill: 'town.mcp' }));
    const v = dataOf(ps) as { servers: Array<{ id: string; scale: string }> };
    expect(v.servers.filter((m) => m.scale === 'town').map((m) => m.id).sort()).toEqual(['discovery-connector', 'discovery-mcp', 'skills', 'town-mcp']);
    expect(v.servers.some((m) => m.scale === 'estate' && m.id === 'vault')).toBe(true);
    expect(textOf(ps)).toMatch(/no door — only a Worker bound to it can reach it/);
  });

  it('scopes to one estate when one was named', async () => {
    const v = dataOf(await partsOf(dataMsg({ skill: 'town.mcp', id: 'imbnet' }))) as { estate: string; servers: Array<{ id: string }>; agentDoors: { rows: unknown[] } };
    expect(v.estate).toBe('imbnet');
    expect(v.servers.map((m) => m.id)).toEqual(['vault', 'home']);
    expect(v.agentDoors.rows).toEqual([]);
  });

  it('names the agents whose own records carry a door, from the chain', async () => {
    const t = textOf(await partsOf(dataMsg({ skill: 'town.mcp' })));
    expect(t).toMatch(/pg\.svc at https:\/\/pg\.example\/mcp/);
  });

  it('states the two absences rather than leaving them to be read as none', async () => {
    const t = textOf(await partsOf(dataMsg({ skill: 'town.mcp' })));
    expect(t).toMatch(/ATTACHED is not here and cannot be/);
    expect(t).toMatch(/No tool lists/);
    expect(t).toMatch(/never a statement that you may use it/);
  });
});

d('the portal routes a question to whichever agent knows the answer', () => {
  it('claims every question that says mcp — no pulse record holds one such fact', () => {
    expect(claimedByTown('which mcp servers are here', town)).toEqual({ skill: 'town.mcp' });
    expect(claimedByTown('what MCP does faithnet run', town)).toEqual({ skill: 'town.mcp', estate: 'faithnet' });
  });

  it('DOES NOT claim a pulse question that happens to name an estate', () => {
    // The twin this router exists to get right: the estate names live in both agents' worlds, and these are
    // the context agent's questions. Claiming them would answer a shape question nobody asked.
    for (const q of ['how is faithnet doing this week', 'what did imbnet spend', 'is anything broken in faithnet', 'how many runs failed in faithnet']) {
      expect(claimedByTown(q, town), q).toBeNull();
    }
  });

  it('claims an estate question that asks about its shape', () => {
    for (const q of ['which agents are in faithnet', 'who is in imbnet', 'what name roots does faithnet have', 'who holds faithnet’s keys', 'where does imbnet live']) {
      expect(claimedByTown(q, town)?.skill, q).toBe('town.estate');
    }
  });

  it('claims nothing it was not asked', () => {
    for (const q of ['how is the town doing', 'how many people are named here', 'is the registry up']) {
      expect(claimedByTown(q, town), q).toBeNull();
    }
  });
});

d('what serves an endpoint (spec 437 I4)', () => {
  it('attributes an agent’s A2A door to its estate’s Worker, with the repository', async () => {
    const r = await call('/endpoint?url=https%3A%2F%2Falice.faithnet.ai%2Fapi%2Fa2a', rosterOf([]));
    const a = r.body.attribution as { how: string; worker: string; estate: string; repo: string };
    expect(a).toMatchObject({ how: 'estate-zone', worker: 'demo-a2a-faithnet', estate: 'faithnet', repo: 'agentictrustlabs/ap-home' });
    expect(r.body.source).toBe('https://github.com/agentictrustlabs/ap-home');
  });

  it('says UNATTRIBUTED, and reads nothing, for a host the manifest never declared', async () => {
    const r = await call('/endpoint?url=https%3A%2F%2Fdemo-gc-pg.r-pedersen.workers.dev%2Fmcp', rosterOf([]));
    expect((r.body.attribution as { how: string }).how).toBe('unattributed');
    expect(r.body.reading).toBeNull();
    expect(r.body.source).toBeNull();
  });

  it('withholds the numbers on a public read rather than zeroing them', async () => {
    // No ops token on this call, so `detail` is false. The shape must carry the refusal, never a 0.
    const r = await call('/endpoint?url=https%3A%2F%2Fmcp.faithnet.io', rosterOf([]));
    expect(r.body.detail).toBe(false);
    const reading = r.body.reading as { metrics: unknown } | null;
    if (reading) { expect(reading.metrics).toBeNull(); }
    // Either way the attribution — which is public — still answers.
    expect(r.body.attribution).toMatchObject({ how: 'mcp-server', mcpServerId: 'vault', worker: 'demo-mcp-faithnet' });
  });

  it('refuses an empty url rather than attributing nothing to nothing', async () => {
    expect((await call('/endpoint', rosterOf([]))).status).toBe(400);
  });

  it('a town service’s own host carries its app directory into the source link', async () => {
    const r = await call('/endpoint?url=https%3A%2F%2Fdiscovery-connector.faithnet.io', rosterOf([]));
    expect(r.body.source).toBe('https://github.com/agentictrustlabs/ap-town/tree/HEAD/apps/discovery-connector');
  });
});
