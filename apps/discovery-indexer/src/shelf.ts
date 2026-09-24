// THE SHELF PROJECTOR — spec 413 W2, under the ADR-0040 amendment of 2026-09-24.
//
// A Library document its owner made PUBLIC (spec 412) and RELEASED with her signature is already world-readable and
// self-authenticating. This projects it into the public tier: one `apcnt:PublishedWork` node in the `urn:ap:shelf` graph
// (so `kb.question` can count and list works) and its passages in the vector index (so `kb.retrieve` can find them).
//
// THE INDEXER READS IT THE WAY A STRANGER WOULD, and trusts nothing it was told:
//   • where to read comes from the CHAIN (her name's `cardUri`, else its `a2aEndpoint` — the spec 286 rule), never from
//     the hint that named the document;
//   • the document comes over the ANONYMOUS lane (`library.public.read`) — if the lane will not serve it, it is not public;
//   • (b) the latest release must REPRODUCE from the served content core (`content-storage.computeReleaseId`) and its
//     signature must verify against the owner Smart Agent — ERC-1271, or a DEL-001 session leaf live at `publishedAt`,
//     unrevoked, valid at the universal validator;
//   • (c) sha256 of the served text must equal the served commitment the release id was recomputed over.
// Anything short of all of that WITHDRAWS what an earlier projection wrote — "no longer public", "re-saved since its
// release" and "the signature no longer verifies" all mean the same thing here: not a published work today.
//
// A hint is only a hint: `{owner, entryId}` — two public identifiers, no content. Losing one costs freshness; forging one
// costs a read of the owner's own public lane, which answers exactly what it answers anyone.
import type { Address, Hex, PublicClient } from 'viem';
import { parseSessionWrappedSignature, verifySessionLeafSignatureAt } from '@agenticprimitives/a2a';
import { hashDelegation } from '@agenticprimitives/delegation';
import { canonicalDigest, computeLockDigest, computeReleaseId } from '@agenticprimitives/content-storage';
import { PUBLISHED_WORK_TERMS as W, SHELF_GRAPH } from '@agenticprimitives/ontology';
import { writePassages, type VectorWriter, type WorkersAi } from './vectors.js';

export interface ShelfHint { owner: string; entryId: string }

export interface ShelfFile {
  id: string; name: string; kind: string; path?: string; contentType?: string | null; text?: boolean; isFolder?: boolean;
  commitment?: string | null;
  release?: { releaseId: string; version: string; signed: boolean; signature?: string; owner: string; publishedAt: string; bundleRoot?: string; canonicalId?: string } | null;
}

/** What the projector needs, all injected: the chain, the lane transport, the stores. */
export interface ShelfDeps {
  chainId: number;
  /** The owner's on-chain reach records (`cardUri`, `a2aEndpoint`), or null when unnamed. Throws when the chain cannot be read. */
  laneRecordsOf: (owner: Address) => Promise<{ cardUri: string | null; a2aEndpoint: string | null } | null>;
  /** Fetch a public URL — a service binding to the estate's agent Worker in production (CF-1042: a Worker cannot fetch a
   *  same-account hostname), the global fetch from the Node CLI. */
  fetchPublic: (url: string, init?: RequestInit) => Promise<Response>;
  client: Pick<PublicClient, 'readContract' | 'verifyMessage'>;
  contracts: { delegationManager: Address; universalSignatureValidator: Address; timestampEnforcer: Address } | null;
  ai: WorkersAi;
  vectors: VectorWriter;
  /** Run a SPARQL 1.1 update against the A-box store. */
  sparqlUpdate: (update: string) => Promise<void>;
  /** The ids a previous projection wrote for this document (derived state, the indexer's own KV). */
  previousIds: (key: string) => Promise<string[]>;
  rememberIds: (key: string, ids: string[]) => Promise<void>;
  now?: () => Date;
}

export type ShelfOutcome =
  | { status: 'projected'; owner: string; entryId: string; releaseId: string; passages: number }
  | { status: 'withdrawn'; owner: string; entryId: string; reason: string; removed: number }
  | { status: 'skipped'; owner: string; entryId: string; reason: string };

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const ENTRY_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** What is projected as passages: prose a reader would quote. A JSON-LD manifest, a folder, a bundle, an image or a PDF is
 *  not (spec 413 §5) — the manifest's facts belong in the graph as facts, not in the index as text. */
const PAGE_KINDS = new Set(['md', 'skill']);
const LANE_PAGE_MAX = 40;
const USV_ABI = [{ type: 'function', name: 'isValidSig', stateMutability: 'view', inputs: [{ name: 'signer', type: 'address' }, { name: 'hash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }], outputs: [{ type: 'bool' }] }] as const;
const IS_REVOKED_ABI = [{ type: 'function', name: 'isRevoked', stateMutability: 'view', inputs: [{ name: 'delegationHash', type: 'bytes32' }], outputs: [{ type: 'bool' }] }] as const;

export function isShelfHint(v: unknown): v is ShelfHint {
  const h = v as ShelfHint;
  return !!h && typeof h === 'object' && typeof h.owner === 'string' && ADDRESS_RE.test(h.owner) && typeof h.entryId === 'string' && ENTRY_RE.test(h.entryId);
}

export const workIri = (chainId: number, owner: string, entryId: string): string => `urn:ap:work:${chainId}:${owner.toLowerCase()}:${entryId}`;
const lit = (s: string): string => JSON.stringify(s);

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `0x${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * WHERE THE OWNER'S PUBLIC LANE IS — decided by WHICH RECORD THE CHAIN HOLDS, never by trying one and then another:
 *   `cardUri` published   → the JSON-RPC interface named by the card AT THAT URI (the owner's own record points at the card;
 *                           the card may name an interface on another host — the estate's edge — and that is the card's
 *                           to say, as in the spec 286 crawl). A card that cannot be fetched is "could not look".
 *   only `a2aEndpoint`    → that endpoint IS the interface (on faithnet: `https://edge.faithnet.io/api/a2a/<name>`).
 *   neither               → nowhere to look.
 * Precedence, not a fallback (ADR-0013): with a `cardUri`, a failed card read never becomes a read of `a2aEndpoint`.
 */
async function laneOf(deps: ShelfDeps, records: { cardUri: string | null; a2aEndpoint: string | null }): Promise<{ endpoint: string } | { skipped: string }> {
  if (records.cardUri) {
    const res = await deps.fetchPublic(records.cardUri, { headers: { accept: 'application/json' } }).catch(() => null);
    if (!res?.ok) return { skipped: `the owner's card (${records.cardUri}) could not be read` };
    const card = (await res.json().catch(() => null)) as { supportedInterfaces?: Array<{ url?: string; protocolBinding?: string }>; url?: string } | null;
    const url = card?.supportedInterfaces?.find((i) => i.protocolBinding === 'JSONRPC')?.url ?? card?.url ?? null;
    if (!url || !/^https:\/\//.test(url)) return { skipped: 'the owner\'s card names no https JSON-RPC interface' };
    return { endpoint: url };
  }
  if (records.a2aEndpoint) return { endpoint: records.a2aEndpoint.replace(/\/$/, '') };
  return { skipped: 'the owner publishes neither a cardUri nor an a2aEndpoint on chain' };
}

async function lane(deps: ShelfDeps, endpoint: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const res = await deps.fetchPublic(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'a2a-version': '1.0' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [{ data }] } } }),
  }).catch(() => null);
  if (!res?.ok) return null;
  const out = (await res.json().catch(() => null)) as { result?: { parts?: Array<{ data?: Record<string, unknown> }> } } | null;
  return out?.result?.parts?.find((p) => p.data && typeof p.data === 'object')?.data ?? null;
}

/** The whole public text, read page by page (`offset`) so a long work's commitment can be checked. `null` when the lane
 *  will not serve it (not public, not a page, gone) — `unreachable` when the lane itself could not be asked. */
async function readWhole(deps: ShelfDeps, endpoint: string, entryId: string): Promise<{ file: ShelfFile; text: string } | null | 'unreachable'> {
  let text = '';
  let file: ShelfFile | null = null;
  for (let page = 0; page < LANE_PAGE_MAX; page++) {
    const r = await lane(deps, endpoint, { skill: 'library.public.read', id: entryId, ...(text.length ? { offset: text.length } : {}) });
    if (!r) return 'unreachable';
    if (r.read !== true || typeof r.text !== 'string') return null;
    file ??= r.file as ShelfFile;
    // A page is appended only if it is a continuation: a lane that ignores `offset` returns the head again, and
    // concatenating it would hash a text nobody wrote — so the commitment check below fails closed on it.
    text += r.text;
    const chars = typeof r.chars === 'number' ? r.chars : text.length;
    if (r.truncated !== true || text.length >= chars || !r.text) break;
  }
  return file ? { file, text } : null;
}

/** (b) + (c): the release reproduces from the served content, the text is the committed text, and the owner signed. */
export async function verifyRelease(deps: Pick<ShelfDeps, 'client' | 'contracts' | 'chainId'>, owner: Address, file: ShelfFile, text: string): Promise<string | null> {
  const rel = file.release;
  if (!rel) return 'never released — public but not published';
  if (!rel.signed || !rel.signature) return 'the release carries no owner signature';
  if (rel.owner.toLowerCase() !== owner.toLowerCase()) return 'the release names another owner';
  if (!file.commitment) return 'the served document carries no commitment';
  if ((await sha256Hex(text)) !== file.commitment.toLowerCase()) return 'the served text does not match its commitment (read incomplete or altered)';
  // Home's page release (library.ts `mintRelease`), recomputed through content-storage — never a local copy of the rule.
  const releaseId = computeReleaseId({
    canonicalId: canonicalDigest(file.kind === 'skill' ? { skill: file.name } : { page: file.name, kind: file.kind }),
    version: rel.version,
    bundleRoot: canonicalDigest({ root: file.commitment }),
    owner: rel.owner as Address, publisher: rel.owner as Address,
    dependencyLock: { dependencies: [], lockDigest: computeLockDigest([]) },
    risk: { riskTier: 'low', requestedCapabilities: ['read'] },
    issuedAt: '', status: 'active' as never, releaseId: '0x' as Hex,
  });
  if (releaseId.toLowerCase() !== rel.releaseId.toLowerCase()) return 'the document changed since its latest release (the release does not reproduce from the served content)';
  const at = Date.parse(rel.publishedAt);
  if (parseSessionWrappedSignature(rel.signature)) {
    if (!deps.contracts) return 'the release is signed under a session leaf and this indexer names no delegation contracts to verify it';
    const c = deps.contracts;
    const failed = await verifySessionLeafSignatureAt({
      signer: owner, digest: rel.releaseId as Hex, signature: rel.signature, timestampEnforcer: c.timestampEnforcer, at: Number.isFinite(at) ? at : 0,
      isRevoked: async (d) => (await deps.client.readContract({ address: c.delegationManager, abi: IS_REVOKED_ABI, functionName: 'isRevoked', args: [hashDelegation(d, deps.chainId, c.delegationManager)] })) === true,
      verifyDelegationSig: async (d) => (await deps.client.readContract({ address: c.universalSignatureValidator, abi: USV_ABI, functionName: 'isValidSig', args: [d.delegator, hashDelegation(d, deps.chainId, c.delegationManager), d.signature] })) === true,
    });
    return failed;
  }
  const ok = await deps.client.verifyMessage({ address: owner, message: { raw: rel.releaseId as Hex }, signature: rel.signature as Hex }).catch(() => false);
  return ok ? null : 'the owner Smart Agent does not accept the release signature (ERC-1271)';
}

async function withdraw(deps: ShelfDeps, hint: ShelfHint, reason: string): Promise<ShelfOutcome> {
  const key = `shelf:${hint.owner.toLowerCase()}:${hint.entryId}`;
  const prev = await deps.previousIds(key);
  if (prev.length) await deps.vectors.deleteByIds(prev);
  await deps.sparqlUpdate(`DELETE WHERE { GRAPH <${SHELF_GRAPH}> { <${workIri(deps.chainId, hint.owner, hint.entryId)}> ?p ?o } }`);
  await deps.rememberIds(key, []);
  return { status: 'withdrawn', owner: hint.owner, entryId: hint.entryId, reason, removed: prev.length };
}

/** Observe one document and make the public tier agree with what its owner serves and signed, right now. */
export async function projectShelfEntry(deps: ShelfDeps, hint: ShelfHint): Promise<ShelfOutcome> {
  const owner = hint.owner as Address;
  const records = await deps.laneRecordsOf(owner);
  // No place to look is not evidence the work was withdrawn — we simply cannot look. Leave the tier as it is.
  if (!records) return { status: 'skipped', owner: hint.owner, entryId: hint.entryId, reason: 'the owner has no name on chain' };
  const where = await laneOf(deps, records);
  if ('skipped' in where) return { status: 'skipped', owner: hint.owner, entryId: hint.entryId, reason: where.skipped };
  const endpoint = where.endpoint;
  const read = await readWhole(deps, endpoint, hint.entryId);
  // CRAWL FAILURE ≠ WITHDRAWN (ADR-0013, the offerings rule): an unreachable lane leaves what is indexed in place.
  if (read === 'unreachable') return { status: 'skipped', owner: hint.owner, entryId: hint.entryId, reason: 'the owner\'s public lane could not be reached' };
  if (!read) return withdraw(deps, hint, 'not on the owner\'s public shelf');
  if (read.file.isFolder || !PAGE_KINDS.has(read.file.kind)) return withdraw(deps, hint, `a ${read.file.isFolder ? 'folder' : read.file.kind} is not projected as a passage`);
  const failed = await verifyRelease(deps, owner, read.file, read.text);
  if (failed) return withdraw(deps, hint, failed);

  const rel = read.file.release!;
  const observedAt = (deps.now?.() ?? new Date()).toISOString();
  const key = `shelf:${owner.toLowerCase()}:${hint.entryId}`;
  const ids = await writePassages(deps.ai, deps.vectors, {
    kind: 'shelf', subject: owner, title: read.file.name, text: read.text, sourceUrl: endpoint, entryId: hint.entryId,
    releaseId: rel.releaseId, commitment: read.file.commitment!, observedAt,
  });
  const stale = (await deps.previousIds(key)).filter((id) => !ids.includes(id));
  if (stale.length) await deps.vectors.deleteByIds(stale);
  const work = workIri(deps.chainId, owner, hint.entryId);
  await deps.sparqlUpdate([
    `DELETE WHERE { GRAPH <${SHELF_GRAPH}> { <${work}> ?p ?o } }`,
    `INSERT DATA { GRAPH <${SHELF_GRAPH}> {\n<${work}> a <${W.PublishedWork}> ;\n  <${W.publisher}> ${lit(owner.toLowerCase())} ;\n  <${W.title}> ${lit(read.file.name)} ;\n  <${W.releaseId}> ${lit(rel.releaseId)} ;\n  <${W.contentCommitment}> ${lit(read.file.commitment!)} ;\n  <${W.sourceEndpoint}> ${lit(endpoint)} ;\n  <${W.observedAt}> ${lit(observedAt)}${ids.map((id) => ` ;\n  <${W.vectorId}> ${lit(id)}`).join('')} .\n} }`,
  ].join(';\n'));
  await deps.rememberIds(key, ids);
  return { status: 'projected', owner: hint.owner, entryId: hint.entryId, releaseId: rel.releaseId, passages: ids.length };
}

