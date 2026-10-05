import { describe, expect, it } from 'vitest';
import { namehash } from '@agenticprimitives/agent-naming';
import { TOWNS } from '@ap-town/town-model';
import { displayOf, labelRefusal, nameView, searchView, type Ctx } from '../worker/views';
import type { Chain } from '../worker/chain';

const ZERO = '0x0000000000000000000000000000000000000000';
const AGENT = '0x1dba4a27c53d7babda99513080223fb3bfc4bad1';
const SUB_ME = '0x7fd5e2a3a49c321a4ced39be403ecde2fc1cb823';

/** A chain with two roots (`me`, open; `org`, open) and one name, `nathan.me`, pointing at AGENT. */
function fakeCtx(): Ctx {
  const roots: Record<string, string> = { [namehash('me')]: 'me', [namehash('org')]: 'org' };
  const nathan = namehash('nathan.me');
  const reg = async (fn: string, args: readonly unknown[] = []): Promise<unknown> => {
    const n = args[0] as string;
    switch (fn) {
      case 'getRoots': return Object.keys(roots);
      case 'label': return roots[n] ?? (n === nathan ? 'nathan' : '');
      case 'childCount': return roots[n] === 'me' ? 1n : 0n;
      case 'subregistry': return roots[n] ? SUB_ME : ZERO;
      case 'recordExists': return !!roots[n] || n === nathan;
      case 'owner': return n === nathan ? AGENT : ZERO;
      case 'isExpired': return false;
      case 'resolver': return ZERO;
      case 'expiry': case 'registeredAt': return 0n;
      case 'rootByLabel': return namehash(n);
      default: throw new Error(`unexpected registry read ${fn}`);
    }
  };
  const ur = async (fn: string, args: readonly unknown[] = []): Promise<unknown> => {
    if (fn === 'resolveName') return args[0] === nathan ? AGENT : ZERO;
    if (fn === 'reverseResolveString') return '';
    throw new Error(`unexpected resolver read ${fn}`);
  };
  const chain = { client: { getBlockNumber: async () => 7n }, reg, ur, sub: async () => '0x', subregistries: { me: SUB_ME }, open: new Set([SUB_ME]) } as unknown as Chain;
  return { town: TOWNS.faithchain!, chain, listed: async () => null };
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
