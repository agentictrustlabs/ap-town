// GATE — this really is the card its agent published, checked the way a stranger would check it.
//
// Four claims, each a separate failure, because a reader who conflates them has trusted a party nobody vouched for:
//   1. the served card carries a JWS and its canonical bytes verify under the key the `kid` names;
//   2. the key is PUBLISHED, so the reader has material to check (1) with rather than a thumbprint;
//   3. the binding names BOTH of this card's digests and that same thumbprint;
//   4. the binding's EIP-712 digest is accepted on chain by the agent's own account through ERC-1271 — which is the
//      only step that makes any of it the AGENT's card rather than somebody's signed JSON.
//
// And three refusals, because a gate that cannot fail has proved nothing: a tampered card, a foreign key, and a
// binding read against the wrong agent must all be rejected.
//
//   RPC_URL=… npx tsx scripts/gate-card-signature.mts [--origin https://town.faithnet.io]
import {
  cardContentDigest, signedCardContentDigest, importVerificationKey, jwkThumbprint, verifyA2ACardSignatures,
  decodeProtectedHeader, verifySmartAgentCardBinding, generateA2ACardSigningKey,
} from '@agenticprimitives/agent-profile/a2a';
import { createPublicClient, http, type Address, type Hex } from 'viem';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const origin = (arg('origin') ?? 'https://town.faithnet.io').replace(/\/$/, '');
const RPC = process.env.RPC_URL ?? process.env.FEDERATION_RPC_URL;
if (!RPC) { console.error('RPC_URL is required — claim 4 is an on-chain read'); process.exit(2); }
const ERC1271 = [{ type: 'function', name: 'isValidSignature', stateMutability: 'view', inputs: [{ name: 'h', type: 'bytes32' }, { name: 's', type: 'bytes' }], outputs: [{ type: 'bytes4' }] }] as const;
const pub = createPublicClient({ transport: http(RPC) });
const erc1271Verifier = {
  verifyHash: async ({ address, hash, signature }: { address: Address; hash: Hex; signature: Hex }) =>
    (await pub.readContract({ address, abi: ERC1271, functionName: 'isValidSignature', args: [hash, signature] })) === '0x1626ba7e',
};
const checks: string[] = []; const fails: string[] = [];
const ok = (s: string) => { checks.push(s); console.log(`  ok   ${s}`); };
const bad = (s: string) => { fails.push(s); console.error(`  FAIL ${s}`); };

const getJson = async (p: string) => {
  const r = await fetch(`${origin}${p}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${p} answered ${r.status}`);
  return r.json() as Promise<Record<string, unknown>>;
};

const card = await getJson('/.well-known/agent-card.json');
const jwks = await getJson('/.well-known/jwks.json') as { keys?: JsonWebKey[] };
const bound = await getJson('/.well-known/agent-card-binding.json') as { binding: Record<string, string>; chainId: number; verifyingContract: string; signature: string };

// ── 1 + 2. the signature, under the published key ─────────────────────────────────────────────────────
const sigs = (card.signatures ?? []) as Array<{ protected: string; signature: string }>;
if (!sigs.length) bad('the served card carries no signature'); else ok(`the served card carries ${sigs.length} signature(s)`);
const kid = sigs.length ? decodeProtectedHeader(sigs[0]!).kid : undefined;
const jwk = (jwks.keys ?? []).find((k) => (k as { kid?: string }).kid === kid);
if (!jwk) bad(`the published key set has no key for kid ${kid ?? '(none)'} — a thumbprint is not a key`);
else {
  ok(`the key set publishes the key the kid names (${kid})`);
  if ((await jwkThumbprint(jwk)) !== kid) bad('the published key is not the one its own kid claims');
  else ok('the published key hashes to its kid (RFC 7638) — nothing was swapped');
  const key = await importVerificationKey(jwk, 'ES256');
  const v = await verifyA2ACardSignatures(card as never, { keys: () => key });
  if (!v.ok) bad(`the signature does not verify over the served bytes: ${JSON.stringify(v).slice(0, 160)}`);
  else ok('the signature verifies over the card\'s own RFC 8785 canonical bytes');
  // REFUSAL: change one character and the same key must reject it.
  const tampered = { ...card, description: `${String(card.description)} ` };
  const t = await verifyA2ACardSignatures(tampered as never, { keys: () => key });
  if (t.ok) bad('a tampered card still verified — the signature is not over the content'); else ok('a tampered card is refused');
  // REFUSAL: a different key must not verify this card. A REAL second key, generated here — a malformed one makes
  // the import throw, and a refusal that was skipped because the setup failed is not a refusal.
  const foreign = await generateA2ACardSigningKey('ES256');
  const o = await verifyA2ACardSignatures(card as never, { keys: () => foreign.publicKey });
  if (o.ok) bad('a foreign key verified this card'); else ok('a foreign, well-formed key is refused');
}

// ── 3. the binding covers THESE bytes and THAT key ────────────────────────────────────────────────────
const unsigned = cardContentDigest(card as never);
const signedDigest = signedCardContentDigest(card as never);
if (bound.binding.unsignedCardDigest !== unsigned) bad(`the binding's unsignedCardDigest is not this card's (${bound.binding.unsignedCardDigest} vs ${unsigned})`);
else ok('the binding names this card\'s unsigned digest');
if (bound.binding.signedCardDigest !== signedDigest) bad(`the binding's signedCardDigest is not this card's (${bound.binding.signedCardDigest} vs ${signedDigest})`);
else ok('the binding names this card\'s signed digest — the served signature is the released one');
if (bound.binding.signerKeyThumbprint !== kid) bad(`the binding authorizes ${bound.binding.signerKeyThumbprint}, not the key that signed (${kid})`);
else ok('the binding authorizes the key that signed');

// ── 4. the agent's own account is the oracle ──────────────────────────────────────────────────────────
const agent = bound.verifyingContract.toLowerCase() as Address;
const v = await verifySmartAgentCardBinding({ binding: bound.binding as never, chainId: bound.chainId, verifyingContract: agent, signature: bound.signature as Hex }, { erc1271Verifier });
if (!v.ok) bad(`the agent's account does not accept the binding: ${v.reason}`);
else ok(`the agent's own account accepts the binding (${agent}, ERC-1271, chain ${bound.chainId})`);
// REFUSAL, and it has to reach the CHAIN to mean anything. Pointing the same binding at another agent is refused
// by a shape check (`agent_mismatch`) before any read happens, which proves the verifier's bookkeeping and not the
// chain's judgement. So the twin also rewrites `canonicalAgentId` to that other agent: now the shape agrees, the
// digest is recomputed for the new domain, and the only thing left to refuse is the signature itself.
const wrong = '0xb0d11ce19b756a682e78b4904cd8d832303b3d11' as Address; // alice — a real, deployed SA that did not sign this
const shapeOnly = await verifySmartAgentCardBinding({ binding: bound.binding as never, chainId: bound.chainId, verifyingContract: wrong, signature: bound.signature as Hex }, { erc1271Verifier });
if (shapeOnly.ok) bad('another agent\'s account accepted this binding'); else ok(`a binding pointed at another agent is refused before any read (${shapeOnly.reason})`);
const restated = { ...bound.binding, canonicalAgentId: `eip155:${bound.chainId}:${wrong}` };
const w = await verifySmartAgentCardBinding({ binding: restated as never, chainId: bound.chainId, verifyingContract: wrong, signature: bound.signature as Hex }, { erc1271Verifier });
if (w.ok) bad('another agent\'s account accepted a restated binding — the signature is not bound to the agent');
else if (w.reason !== 'signature_invalid') bad(`the restated binding was refused as ${w.reason}, so the chain was still not consulted`);
else ok('restated for another agent so the shape agrees, the CHAIN refuses the signature (signature_invalid)');

console.log('');
if (fails.length) { console.error(`CARD SIGNATURE GATE RED · ${fails.length} of ${checks.length + fails.length} checks failed`); process.exit(1); }
console.log(`CARD SIGNATURE GATE GREEN · ${checks.length} checks incl. 4 refusals — this is the card ${agent} published`);
