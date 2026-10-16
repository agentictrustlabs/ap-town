import { describe, expect, it } from 'vitest';
import { namehash } from '@agenticprimitives/agent-naming';
import { TOWNS } from '@ap-town/town-model';
import { displayOf, identityOf, labelRefusal, nameView, nameViewLocal, namesLike, namesLikeLocal, searchView, searchViewLocal, type Ctx } from '../worker/views';
import type { Peer } from '../worker/peers';
import type { Chain } from '../worker/chain';

const ZERO = '0x0000000000000000000000000000000000000000';
const AGENT = '0x1dba4a27c53d7babda99513080223fb3bfc4bad1';
const SUB_ME = '0x7fd5e2a3a49c321a4ced39be403ecde2fc1cb823';

/** A chain with two roots (`me`, open; `org`, open) and one name, `nathan.me`, pointing at AGENT. `extraNames` adds names
 *  under `.me` pointing at the given agent (a LOCAL table's own claims); `peers`/`root` place the chain in the federation. */
function fakeCtx(opts: { extraNames?: Record<string, string>; peers?: Peer[]; root?: Peer | null; town?: keyof typeof TOWNS } = {}): Ctx {
  const roots: Record<string, string> = { [namehash('me')]: 'me', [namehash('org')]: 'org' };
  const nathan = namehash('nathan.me');
  const extra = Object.fromEntries(Object.entries(opts.extraNames ?? {}).map(([n, a]) => [namehash(n), { label: n.split('.')[0]!, agent: a }]));
  const reg = async (fn: string, args: readonly unknown[] = []): Promise<unknown> => {
    const n = args[0] as string;
    switch (fn) {
      case 'getRoots': return Object.keys(roots);
      case 'label': return roots[n] ?? (n === nathan ? 'nathan' : extra[n]?.label ?? '');
      case 'childCount': return roots[n] === 'me' ? 1n : 0n;
      case 'childLabelhashes': return [];
      case 'subregistry': return roots[n] ? SUB_ME : ZERO;
      case 'recordExists': return !!roots[n] || n === nathan || !!extra[n];
      case 'owner': return extra[n]?.agent ?? (n === nathan ? AGENT : ZERO);
      case 'isExpired': return false;
      case 'resolver': return ZERO;
      case 'expiry': case 'registeredAt': return 0n;
      case 'rootByLabel': return namehash(n);
      default: throw new Error(`unexpected registry read ${fn}`);
    }
  };
  const ur = async (fn: string, args: readonly unknown[] = []): Promise<unknown> => {
    if (fn === 'resolveName') return extra[args[0] as string]?.agent ?? (args[0] === nathan ? AGENT : ZERO);
    if (fn === 'reverseResolveString') return '';
    throw new Error(`unexpected resolver read ${fn}`);
  };
  // A registered name's page also reads its records, the agent's declared type and its profile; the fake has none of each.
  const naming = { getRecords: async () => ({}), readDerivedType: async () => ({ agentType: 'person', serviceRole: null, agentKind: null, agentSubtype: null }) };
  const chain = { client: { getBlockNumber: async () => 7n }, reg, ur, sub: async () => '0x', naming, profile: async () => '', subregistries: { me: SUB_ME }, open: new Set([SUB_ME]), priced: {}, pricedSet: new Set(), coin: null, feeTreasury: null } as unknown as Chain;
  return { town: TOWNS[opts.town ?? 'faithchain']!, chain, listed: async () => null, peers: opts.peers ?? [], root: opts.root ?? null };
}

/** A peer whose read API is served by `ctx` — the other town, in-process. Records the paths it was asked. */
function peerOf(town: string, chainId: number, ctx: Ctx, asked: string[] = []): Peer {
  return {
    town, chainId, host: `names.${town}.test`, manifest: TOWNS[town === 'hopenet' ? 'hopenet' : 'faithchain']!,
    async get<T>(path: string) {
      asked.push(path);
      const u = new URL(`https://x/api${path}`);
      const local = u.searchParams.get('local') === '1';
      const q = u.searchParams.get('q') ?? '';
      if (u.pathname.startsWith('/api/name/')) return { ok: true as const, data: (await (local ? nameViewLocal : nameView)(ctx, decodeURIComponent(u.pathname.slice('/api/name/'.length)))) as T };
      if (u.pathname === '/api/search') return { ok: true as const, data: (await (local ? searchViewLocal : searchView)(ctx, q)) as T };
      if (u.pathname === '/api/names-like') return { ok: true as const, data: (await (local ? namesLikeLocal : namesLike)(ctx, q, u.searchParams.get('tld'))) as T };
      return { ok: false as const, error: `no route ${path}` };
    },
  };
}

describe('words and forms', () => {
  it('shows a scoped on-chain name in its display form', () => {
    expect(displayOf('vault.svc.richcanvas.org')).toBe('vault.svc@richcanvas.org');
    expect(displayOf('nathan.me')).toBe('nathan.me');
  });
  it('refuses a label with the rule it breaks', () => {
    expect(labelRefusal('ab')?.rule).toBe('label_too_short');
    expect(labelRefusal('Bob')?.rule).toBe('charset');
    expect(labelRefusal('-bob')?.rule).toBe('charset');
    expect(labelRefusal('www')?.rule).toBe('reserved_label');
    expect(labelRefusal('nathan')).toBeNull();
  });
});

describe('search — one box, and it says what the text is', () => {
  it('an address, a name, a root, and an agent host in an estate zone', async () => {
    const ctx = fakeCtx();
    expect(await searchView(ctx, AGENT.toUpperCase().replace('0X', '0x'))).toMatchObject({ kind: 'address' });
    expect(await searchView(ctx, 'Nathan.me')).toMatchObject({ kind: 'name', name: 'nathan.me' });
    expect(await searchView(ctx, 'me')).toMatchObject({ kind: 'root', tld: 'me' });
    expect(await searchView(ctx, 'https://missio-nexus-org.faithnet.ai/api/a2a')).toMatchObject({ kind: 'name', name: 'missio-nexus.org' });
    expect(await searchView(ctx, 'vault.svc@richcanvas.org')).toMatchObject({ kind: 'name', name: 'vault.svc@richcanvas.org' });
  });
  it('a bare label is answered across every root, registered or free', async () => {
    const v = await searchView(fakeCtx(), 'nathan');
    expect(v.kind).toBe('label');
    if (v.kind !== 'label') return;
    expect(v.rows.map((r) => [r.name, r.status])).toEqual([['nathan.me', 'registered'], ['nathan.org', 'available']]);
    expect(v.rows[1]!.by).toMatch(/organization’s agent could claim it, from its Home/);
  });
  it('says why a string is not a name', async () => {
    const ctx = fakeCtx();
    expect(await searchView(ctx, 'foo.xyz')).toMatchObject({ kind: 'invalid', rule: 'unknown_tld' });
    expect(await searchView(ctx, 'ab')).toMatchObject({ kind: 'invalid', rule: 'label_too_short' });
    expect(await searchView(ctx, '0x1234')).toMatchObject({ kind: 'invalid', rule: 'address' });
    expect(await searchView(ctx, '')).toMatchObject({ kind: 'invalid', rule: 'empty' });
  });
});

describe('a name that is not registered', () => {
  it('a free name says who could claim it, and never offers the visitor a claim', async () => {
    const v = await nameView(fakeCtx(), 'zzz-free.org');
    expect(v.status).toBe('available');
    expect(v.availability?.by).toBe('an organization’s agent');
    expect(v.availability?.rule).toMatch(/only while the agent’s own type record says so/);
    expect(v.can).toEqual([]);
  });
  it('a root is not a name; a name under a root this town lacks is not claimable', async () => {
    const ctx = fakeCtx();
    expect(await nameView(ctx, 'me')).toMatchObject({ status: 'invalid', form: 'root', tld: 'me' });
    expect(await nameView(ctx, 'acme.team')).toMatchObject({ status: 'not-claimable' });
  });
  it('an invalid name carries the rule in words', async () => {
    const v = await nameView(fakeCtx(), 'a.me');
    expect(v.status).toBe('invalid');
    expect(v.invalid?.detail).toMatch(/three characters/);
  });
});

describe('who a name is a name of (spec 440 §C3) — the root chain\'s address is never promoted to canonical', () => {
  const agent = '0x013fb41c28fe7919f9abfa03884110ef629006e5' as const;
  const home = 'eip155:34349:0x3f96a0b26c59260b4fe74b40726b000b12ef33d3';
  it('with a declared home on another chain, this chain\'s account is a satellite and the canonical id is the home', () => {
    const id = identityOf({ chainId: 34348, agent, name: 'maya-fernandes.me', declaredEstate: null, records: { nativeId: home, accounts: [`eip155:34348:${agent}`, home], a2aEndpoint: 'https://maya-fernandes.impact-agent.ai/api/a2a' } });
    expect(id.canonical).toBe(home);
    expect(id.canonicalTown).toBe('hopenet');
    expect(id.here).toMatchObject({ account: `eip155:34348:${agent}`, role: 'satellite', here: true, town: 'faithchain' });
    expect(id.accounts.map((a) => [a.chainId, a.role])).toEqual([[34348, 'satellite'], [34349, 'home']]);
    expect(id.estate).toMatchObject({ id: 'impact-agent', town: 'hopenet', how: 'placed' });
  });
  it('with no declared home, nothing is canonical and the page says so', () => {
    const id = identityOf({ chainId: 34348, agent, name: 'x.me', declaredEstate: null, records: {} });
    expect(id.canonical).toBeNull();
    expect(id.here?.role).toBe('undeclared');
    expect(id.accounts).toHaveLength(1);
    expect(id.estate).toBeNull();
  });
  it('a declared estate wins over placement', () => {
    const id = identityOf({ chainId: 34348, agent, name: 'x.me', declaredEstate: { name: 'faithnet.estate', id: 'faithnet', home: 'https://www.faithnet.me', agent: null }, records: { a2aEndpoint: 'https://x.impact-agent.ai/api/a2a' } });
    expect(id.estate).toMatchObject({ id: 'faithnet', how: 'declared', town: 'faithchain' });
  });
});


describe('one namespace, one root (spec 440 §C) — a local table never answers as a root', () => {
  const RICH = '0x5bbdaceda00248ebeecb412d6ff04cdd5dbdb957';
  /** The root (faithchain: nathan.me) and a rooted town (hopenet: its table holds rich-impact.me and a copy of nathan.me). */
  function federation() {
    const askedRoot: string[] = []; const askedHope: string[] = [];
    const rootCtx = fakeCtx({ town: 'faithchain' });
    // hopenet's table: rich-impact.me (claimed only there) and a copy of nathan.me pointing at a different account.
    const hopeCtx = fakeCtx({ town: 'hopenet', extraNames: { 'rich-impact.me': RICH, 'nathan.me': RICH } });
    const rootPeer = peerOf('faithchain', 34348, rootCtx, askedRoot);
    const hopePeer = peerOf('hopenet', 34349, hopeCtx, askedHope);
    rootCtx.peers = [hopePeer];
    hopeCtx.peers = [rootPeer]; hopeCtx.root = rootPeer;
    return { rootCtx, hopeCtx, askedRoot, askedHope };
  }

  it('a rooted town says a root name is registered even when its own table has no entry — and stamps both chains', async () => {
    const { hopeCtx } = federation();
    const v = await nameView(hopeCtx, 'alice.me');
    expect(v.status).toBe('available'); // free on the root, which is the only place it could be held
    expect(v.town).toBe('hopenet'); expect(v.chainId).toBe(34349);
    expect(v.rootedAt).toMatchObject({ town: 'faithchain', chainId: 34348 });
    expect(v.availability?.by).toMatch(/a Home on the faithchain town/);
    expect(v.local).toMatchObject({ exists: false, agent: null });
  });

  it('a rooted town shows the root’s record and its own copy beside it, never two names', async () => {
    const { hopeCtx } = federation();
    const v = await nameView(hopeCtx, 'nathan.me');
    expect(v.status).toBe('registered');
    expect(v.agent).toBe(AGENT); // the root's
    expect(v.local).toMatchObject({ exists: true, agent: RICH });
    expect(v.banners[0]).toMatchObject({ tone: 'warn', title: 'This chain’s table points elsewhere' });
  });

  it('a name claimed only in a rooted town’s table is free on the root, and both towns say where it went', async () => {
    const { rootCtx, hopeCtx, askedHope } = federation();
    const onRoot = await nameView(rootCtx, 'rich-impact.me');
    expect(onRoot.status).toBe('available');
    expect(onRoot.claimedElsewhere).toEqual([{ town: 'hopenet', chainId: 34349, agent: RICH, owner: RICH }]);
    expect(onRoot.banners[0]?.title).toMatch(/Claimed on hopenet, not on the root/);
    // The root asked the table alone — no loop back to itself.
    expect(askedHope.every((p) => p.includes('local=1'))).toBe(true);
    const onHope = await nameView(hopeCtx, 'rich-impact.me');
    expect(onHope.status).toBe('available');
    expect(onHope.local).toMatchObject({ exists: true, agent: RICH });
    expect(onHope.banners[0]?.title).toBe('Claimed only on this chain');
  });

  it('the root’s label search marks a row held in another table; a registered row is left alone', async () => {
    const { rootCtx } = federation();
    const v = await searchView(rootCtx, 'rich-impact');
    if (v.kind !== 'label') throw new Error(v.kind);
    expect(v.rows.find((r) => r.name === 'rich-impact.me')?.claimedElsewhere).toMatchObject({ town: 'hopenet', agent: RICH });
    expect(v.rows.find((r) => r.name === 'rich-impact.org')?.claimedElsewhere).toBeUndefined();
    const n = await searchView(rootCtx, 'nathan');
    if (n.kind !== 'label') throw new Error(n.kind);
    expect(n.rows.find((r) => r.name === 'nathan.me')).toMatchObject({ status: 'registered' });
    expect(n.rows.find((r) => r.name === 'nathan.me')?.claimedElsewhere).toBeUndefined();
  });

  it('a peer that cannot be asked is null, never "nowhere"', async () => {
    const rootCtx = fakeCtx({ town: 'faithchain' });
    rootCtx.peers = [{ town: 'hopenet', chainId: 34349, host: 'x', manifest: TOWNS.hopenet!, get: async () => ({ ok: false, error: 'down' }) }];
    const v = await nameView(rootCtx, 'rich-impact.me');
    expect(v.status).toBe('available');
    expect(v.claimedElsewhere).toBeNull();
    expect(v.banners.some((b) => /could not be asked/.test(b.title))).toBe(true);
  });

  it('a rooted town whose root cannot be asked refuses rather than answering from its table', async () => {
    const hopeCtx = fakeCtx({ town: 'hopenet', extraNames: { 'rich-impact.me': RICH } });
    hopeCtx.root = { town: 'faithchain', chainId: 34348, host: 'x', manifest: TOWNS.faithchain!, get: async () => ({ ok: false, error: 'down' }) };
    hopeCtx.peers = [hopeCtx.root];
    await expect(nameView(hopeCtx, 'rich-impact.me')).rejects.toThrow(/rooted at faithchain/);
  });
});
