// Spec 413 W2 — the shelf projector reads as a stranger, verifies before it projects, and withdraws on any doubt that
// is a real answer (not public, re-saved since release, unsigned) — but never on a failure to look.
import { describe, it, expect } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { verifyMessage, type Hex } from 'viem';
import { canonicalDigest } from '@agenticprimitives/content-storage';
import { projectShelfEntry, workIri, type ShelfDeps, type ShelfFile } from '../src/shelf.js';

const owner = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const ORIGIN = 'https://carol.faithnet.ai';
const LANE = `${ORIGIN}/a2a`;
const TEXT = '# On grief\n\nGrief is love persevering.\n\n' + 'A long meditation. '.repeat(40);

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}
/** Home's `mintRelease` for a page, written out independently of the projector (which goes through content-storage). */
function homeReleaseId(name: string, kind: string, commitment: string, version: string, who: string): Hex {
  const canonicalId = canonicalDigest({ page: name, kind });
  const bundleRoot = canonicalDigest({ root: commitment });
  const risk = { riskTier: 'low', requestedCapabilities: ['read'] };
  return canonicalDigest({ canonicalId, version, bundleRoot, owner: who, publisher: who, lockDigest: canonicalDigest([]), risk });
}

async function releasedFile(opts: { text?: string; commitmentOf?: string; signed?: boolean } = {}): Promise<ShelfFile> {
  const commitment = await sha256Hex(opts.commitmentOf ?? opts.text ?? TEXT);
  const releaseId = homeReleaseId('on-grief.md', 'md', commitment, '1.0.0', owner.address);
  const signature = opts.signed === false ? undefined : await owner.signMessage({ message: { raw: releaseId } });
  return { id: 'art-1', name: 'on-grief.md', kind: 'md', commitment, release: { releaseId, version: '1.0.0', signed: opts.signed !== false, ...(signature ? { signature } : {}), owner: owner.address, publishedAt: new Date().toISOString() } };
}

function harness(opts: { file?: ShelfFile | null; text?: string; laneDown?: boolean; endpoint?: string | null; records?: { cardUri: string | null; a2aEndpoint: string | null } | null; card?: unknown; prev?: string[] }) {
  const log = { upserted: [] as string[], deleted: [] as string[], updates: [] as string[], remembered: new Map<string, string[]>() };
  const text = opts.text ?? TEXT;
  const deps: ShelfDeps = {
    chainId: 34348,
    laneRecordsOf: async () => (opts.records !== undefined ? opts.records : { cardUri: null, a2aEndpoint: opts.endpoint === undefined ? LANE : opts.endpoint }),
    fetchPublic: async (url, init) => {
      if (url.endsWith('/.well-known/agent-card.json')) return opts.card === undefined ? new Response('no', { status: 404 }) : Response.json(opts.card);
      if (opts.laneDown) return new Response('down', { status: 502 });
      const data = JSON.parse(String(init?.body)).params.message.parts[0].data as { offset?: number };
      if (!opts.file) return Response.json({ result: { parts: [{ data: { read: false, refused: 'not on the shelf' } }] } });
      const off = data.offset ?? 0;
      const page = text.slice(off, off + 300);
      return Response.json({ result: { parts: [{ data: { read: true, file: opts.file, text: page, chars: text.length, truncated: off + page.length < text.length } }] } });
    },
    client: { readContract: async () => false, verifyMessage: (a: Parameters<typeof verifyMessage>[0]) => verifyMessage(a) } as never,
    contracts: null,
    ai: { run: async (_m, inputs) => ({ data: (inputs.text as string[]).map(() => [0.1, 0.2]) }) },
    vectors: { upsert: async (v) => { log.upserted.push(...v.map((x) => x.id)); }, deleteByIds: async (ids) => { log.deleted.push(...ids); } },
    sparqlUpdate: async (u) => { log.updates.push(u); },
    previousIds: async () => opts.prev ?? [],
    rememberIds: async (k, ids) => { log.remembered.set(k, ids); },
  };
  return { deps, log };
}
const hint = { owner: owner.address, entryId: 'art-1' };

describe('projectShelfEntry', () => {
  it('projects a public, released, signed work — read whole across pages — into the graph and the index', async () => {
    const { deps, log } = harness({ file: await releasedFile() });
    const r = await projectShelfEntry(deps, hint);
    expect(r.status).toBe('projected');
    expect(log.upserted.length).toBeGreaterThan(0);
    expect(log.updates[0]).toContain(workIri(34348, owner.address, 'art-1'));
    expect(log.updates[0]).toContain('PublishedWork');
    expect(log.remembered.get(`shelf:${owner.address.toLowerCase()}:art-1`)).toEqual(log.upserted);
  });

  it('WITHDRAWS a document re-saved since its release (the release no longer reproduces)', async () => {
    const edited = TEXT + '\nAn afterthought.';
    const stale = await releasedFile({ commitmentOf: TEXT });
    const file = { ...stale, commitment: await sha256Hex(edited) }; // the served commitment is the NEW text's
    const { deps, log } = harness({ file, text: edited, prev: ['old1'] });
    const r = await projectShelfEntry(deps, hint);
    expect(r).toMatchObject({ status: 'withdrawn' });
    expect((r as { reason: string }).reason).toMatch(/changed since its latest release/);
    expect(log.deleted).toEqual(['old1']);
  });

  it('WITHDRAWS a public page that was never signed, and one no longer on the shelf', async () => {
    const unsigned = harness({ file: await releasedFile({ signed: false }) });
    expect(await projectShelfEntry(unsigned.deps, hint)).toMatchObject({ status: 'withdrawn' });
    const gone = harness({ file: null, prev: ['a', 'b'] });
    const r = await projectShelfEntry(gone.deps, hint);
    expect(r).toMatchObject({ status: 'withdrawn', removed: 2 });
    expect(gone.log.updates[0]).toMatch(/^DELETE WHERE/);
  });

  it('refuses a signature by anyone but the owner', async () => {
    const file = await releasedFile();
    const other = privateKeyToAccount('0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba');
    file.release!.signature = await other.signMessage({ message: { raw: file.release!.releaseId as Hex } });
    const { deps } = harness({ file });
    expect(await projectShelfEntry(deps, hint)).toMatchObject({ status: 'withdrawn' });
  });

  it('a failure to LOOK is not a withdrawal: an unreachable lane, a non-https or absent endpoint on chain — nothing deleted', async () => {
    for (const opts of [{ laneDown: true }, { records: null }, { endpoint: null }, { records: { cardUri: `${ORIGIN}/.well-known/agent-card.json`, a2aEndpoint: LANE } }]) {
      const { deps, log } = harness({ file: await releasedFile(), prev: ['keep'], ...opts });
      expect(await projectShelfEntry(deps, hint)).toMatchObject({ status: 'skipped' });
      expect(log.deleted).toEqual([]);
      expect(log.updates).toEqual([]);
    }
  });
});

describe('where the lane is — by the record the chain holds', () => {
  it('a published cardUri wins: the lane is the interface the card names, even on another host', async () => {
    const EDGE_LANE = 'https://edge.faithnet.io/api/a2a/carol.me';
    const seen: string[] = [];
    const { deps } = harness({ file: await releasedFile(), records: { cardUri: `${ORIGIN}/.well-known/agent-card.json`, a2aEndpoint: 'https://carol.faithnet.ai/api/a2a' }, card: { supportedInterfaces: [{ url: EDGE_LANE, protocolBinding: 'JSONRPC' }] } });
    const inner = deps.fetchPublic;
    deps.fetchPublic = (url, init) => { seen.push(url); return inner(url, init); };
    expect(await projectShelfEntry(deps, hint)).toMatchObject({ status: 'projected' });
    expect(seen.filter((u) => !u.endsWith('agent-card.json')).every((u) => u === EDGE_LANE)).toBe(true);
  });
  it('an unreadable card is "could not look" — never a quiet switch to the a2aEndpoint', async () => {
    const seen: string[] = [];
    const { deps } = harness({ file: await releasedFile(), records: { cardUri: `${ORIGIN}/.well-known/agent-card.json`, a2aEndpoint: LANE } });
    const inner = deps.fetchPublic;
    deps.fetchPublic = (url, init) => { seen.push(url); return inner(url, init); };
    expect(await projectShelfEntry(deps, hint)).toMatchObject({ status: 'skipped' });
    expect(seen).not.toContain(LANE);
  });
});

import { laneBindingFor } from '../src/worker.js';
describe('laneBindingFor', () => {
  const EDGE = { fetch: async () => new Response('edge') };
  const A2A = { fetch: async () => new Response('a2a') };
  const env = { LANE_ROUTES: 'edge.faithnet.io=LANE_FAITHNET_1,*.faithnet.ai=LANE_FAITHNET_2', LANE_FAITHNET_1: EDGE, LANE_FAITHNET_2: A2A };
  it('routes each estate host to its binding and leaves external hosts to the network', () => {
    expect(laneBindingFor(env, 'edge.faithnet.io')).toBe(EDGE);
    expect(laneBindingFor(env, 'carol.faithnet.ai')).toBe(A2A);
    expect(laneBindingFor(env, 'faithnet.ai.evil.example')).toBeNull();
    expect(laneBindingFor(env, 'example.org')).toBeNull();
  });
  it('a route to an unbound binding is an error, not a silent network fetch', () => {
    expect(() => laneBindingFor({ LANE_ROUTES: 'edge.faithnet.io=EDGE' }, 'edge.faithnet.io')).toThrow(/not bound/);
  });
});
