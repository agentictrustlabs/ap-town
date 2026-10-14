// RELEASE THE TOWN AGENT'S CARD — sign it, and have the agent itself say the key is its (spec 347 §4.2).
//
// WHY A SIGNATURE ALONE IS NOT ENOUGH, which is the whole reason this script exists rather than a one-liner in the
// Worker. A JWS proves that whoever holds a key signed these bytes. It does not say the key has anything to do with
// the agent, so a signed card with a self-published key answers "did someone sign this?" and not "is this the card
// its agent published?" — the question our own reading of the NANDA index says 27 of 29 entries cannot answer. The
// answer is three artifacts, and all three are published:
//
//   1. the CARD, with an ES256 JWS over its RFC 8785 canonical bytes (`kid` = RFC 7638 thumbprint);
//   2. the KEY, as a public JWK set, so a stranger has the material to check (1);
//   3. the BINDING — `SmartAgentCardBindingV1`, an EIP-712 statement signed by the AGENT and validated through
//      ERC-1271, naming this card's two digests AND this key's thumbprint. That is the artifact that makes the key
//      the agent's, and without it the other two are a stranger signing their own homework.
//
// A verifier that knows nothing about us stops after (1) and (2) and still gets a valid A2A card. One that knows AP
// continues: thumbprint authorized by the SA → binding valid on chain → this is that agent's card.
//
// THE PRIVATE KEY NEVER REACHES THE WORKER. The Worker serves a released bundle and signs nothing; the key lives in
// `.secrets/` with the operator. A released card is immutable bytes, so signing at request time would also mean
// re-signing whatever the manifest happened to say that minute, which is the opposite of a release.
//
//   RPC_URL=… npx tsx apps/town-agent/scripts/release-card.mts [--town faithchain] [--origin https://town.faithnet.io]
//     [--agent 0x… --by demo-admin --home https://www.faithnet.me] [--days 365] [--new-key] [--dry-run]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import {
  canonicalCardBytes, cardContentDigest, signedCardContentDigest, generateA2ACardSigningKey, importVerificationKey,
  jwkThumbprint, signA2ACard, verifyA2ACardSignatures, smartAgentCardBindingDigest, verifySmartAgentCardBinding,
  type SmartAgentCardBindingV1,
} from '@agenticprimitives/agent-profile/a2a';
import { createPublicClient, http, type Address, type Hex } from 'viem';
import { cardFor, townOf } from '../worker/index.js';

const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const townId = arg('town') ?? 'faithchain';
const origin = (arg('origin') ?? 'https://town.faithnet.io').replace(/\/$/, '');
const agent = (arg('agent') ?? '0xabAbAD83E69B4cFbf1B90C1c70561D6D770bEef4').toLowerCase() as Address;
const by = arg('by') ?? 'demo-admin';
const home = (arg('home') ?? 'https://www.faithnet.me').replace(/\/$/, '');
const days = Number(arg('days') ?? 365);
const chainId = Number(process.env.CHAIN_ID ?? 34348);
const dry = process.argv.includes('--dry-run');
const newKey = process.argv.includes('--new-key');
const RPC = process.env.RPC_URL ?? process.env.FEDERATION_RPC_URL;
if (!RPC) { console.error('RPC_URL is required — the binding is verified on chain before it is written'); process.exit(2); }

const KEY_FILE = `${process.env.AP_TOWN_SECRETS ?? '../../.secrets'}/town-card-signing-key.local.json`;
const OUT = `released/${townId}-card.json`;
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 200) }; } };

// ── 1. the card, exactly as the Worker builds it ──────────────────────────────────────────────────────
const town = townOf({ TOWN: townId } as never);
const card = cardFor(town, origin);
const unsignedDigest = cardContentDigest(card);
console.log(`${townId}: ${card.name} · ${card.skills?.length ?? 0} skill(s) · unsigned digest ${unsignedDigest}`);

// ── 2. the signing key — stable across releases unless --new-key, so the thumbprint a reader learned stays true ──
mkdirSync(KEY_FILE.replace(/\/[^/]+$/, ''), { recursive: true });
let keyDoc: { privateJwk: JsonWebKey; publicJwk: JsonWebKey; kid: string; alg: 'ES256'; createdAt: string };
if (!newKey && existsSync(KEY_FILE)) {
  keyDoc = JSON.parse(readFileSync(KEY_FILE, 'utf8'));
  console.log(`  key: reused, kid ${keyDoc.kid} (created ${keyDoc.createdAt})`);
} else {
  const pair = await generateA2ACardSigningKey('ES256');
  const privateJwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  keyDoc = { privateJwk, publicJwk: pair.publicJwk, kid: pair.kid, alg: 'ES256', createdAt: new Date().toISOString() };
  if (!dry) { writeFileSync(KEY_FILE, `${JSON.stringify(keyDoc, null, 2)}\n`, { mode: 0o600 }); }
  console.log(`  key: NEW, kid ${keyDoc.kid} — a new thumbprint means a new binding; the old one stops matching`);
}
if (keyDoc.kid !== (await jwkThumbprint(keyDoc.publicJwk))) { console.error('  the stored kid is not the thumbprint of the stored public key — refusing to sign'); process.exit(1); }
const privateKey = await crypto.subtle.importKey('jwk', keyDoc.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

// ── 3. sign, and verify the signature before anything else is built on it ──────────────────────────────
const signed = await signA2ACard(card, { privateKey, kid: keyDoc.kid, alg: 'ES256' });
const verifyKey = await importVerificationKey(keyDoc.publicJwk, 'ES256');
const check = await verifyA2ACardSignatures(signed.card, { keys: () => verifyKey });
if (!check.ok) { console.error(`  the signature this script just made does not verify: ${JSON.stringify(check.results ?? check)}`); process.exit(1); }
const signedDigest = signedCardContentDigest(signed.card);
console.log(`  signed: ${signed.card.signatures.length} signature(s), verified · signed digest ${signedDigest}`);

// ── 4. the binding the AGENT signs — the artifact that makes the key its own ───────────────────────────
const now = Math.floor(Date.now() / 1000);
const releaseId = `rel-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`;
const binding: SmartAgentCardBindingV1 = {
  canonicalAgentId: `eip155:${chainId}:${agent}`,
  cardResourceId: `${townId}.town.card`,
  cardReleaseId: releaseId,
  cardUri: `${origin}/.well-known/agent-card.json`,
  unsignedCardDigest: unsignedDigest,
  signedCardDigest: signedDigest,
  signerKeyThumbprint: keyDoc.kid,
  validFrom: now,
  validUntil: now + days * 86_400,
};
const digest = smartAgentCardBindingDigest(binding, chainId, agent);
console.log(`  binding: ${releaseId}, EIP-712 digest ${digest}`);
if (dry) { console.log('  would sign the binding and write the release'); process.exit(0); }

const si = await j(await fetch(`${home}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: by, client_id: 'demo-jp' }) }));
const token = String(si.homeSession ?? '');
if (!token) { console.error(`  no session for ${by} at ${home}`); process.exit(1); }
const sg = await j(await fetch(`${home}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ digest }) }));
const signature = sg.signature as Hex | undefined;
if (!signature) { console.error(`  persona-sign refused: ${JSON.stringify(sg).slice(0, 200)}`); process.exit(1); }

// ── 5. the agent's own account is the oracle: if it does not accept the signature, nothing is written ──
const pub = createPublicClient({ transport: http(RPC) });
const ERC1271 = [{ type: 'function', name: 'isValidSignature', stateMutability: 'view', inputs: [{ name: 'h', type: 'bytes32' }, { name: 's', type: 'bytes' }], outputs: [{ type: 'bytes4' }] }] as const;
const verified = await verifySmartAgentCardBinding(
  { binding, chainId, verifyingContract: agent, signature },
  // The port is `erc1271Verifier.verifyHash` — passing a differently-named function made the call THROW, which the
  // verifier reports as `signature_invalid`, indistinguishable from a bad signature. Worth the comment.
  { erc1271Verifier: { verifyHash: async ({ address, hash, signature: sig }) => (await pub.readContract({ address, abi: ERC1271, functionName: 'isValidSignature', args: [hash as Hex, sig as Hex] })) === '0x1626ba7e' } },
);
if (!verified.ok) { console.error(`  the agent's account does not accept this binding: ${verified.reason ?? JSON.stringify(verified)} — nothing written`); process.exit(1); }
console.log(`  binding verified on chain through ERC-1271 by ${agent}`);

// ── 6. the release bundle the Worker serves verbatim ──────────────────────────────────────────────────
const bundle = {
  type: 'ap.town-card-release.v1',
  town: townId,
  origin,
  releaseId,
  releasedAt: new Date().toISOString(),
  card: signed.card,
  jwks: { keys: [{ ...keyDoc.publicJwk, kid: keyDoc.kid, alg: 'ES256', use: 'sig' }] },
  smartAgentBinding: { binding, chainId, verifyingContract: agent, signature },
  /** What a reader can check, and in which order. Published so the document explains its own verification. */
  verify: [
    'Fetch the card. Strip `signatures`. Canonicalize with RFC 8785 and sha256 it: that is `unsignedCardDigest`.',
    'Fetch /.well-known/jwks.json. The key whose RFC 7638 thumbprint equals the JWS `kid` verifies the detached payload.',
    'Fetch /.well-known/agent-card-binding.json. It names both digests and that same thumbprint.',
    `Verify the binding's EIP-712 digest against ${agent} with ERC-1271 on chain ${chainId}. Only then is this that agent's card.`,
    'None of it is authority. A card is evidence of what an agent says it does, never permission to make it do anything.',
  ],
};
mkdirSync('released', { recursive: true });
writeFileSync(OUT, `${JSON.stringify(bundle, null, 2)}\n`);
console.log(`  wrote ${OUT} — deploy the Worker to serve it`);
