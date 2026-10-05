/**
 * Spec 387 §3 — THE GATEWAY'S SESSION WIRE: gateway.svc → the key only the gateway Worker holds, pinned to
 * `harness.ask` and nothing else, timestamp-bounded, signed by the agent's custodian (alice, who chartered it)
 * through the Home. Revocable on chain by her at any moment; rotation = a new wire, never a config edit.
 *
 *   npx tsx scripts/mint-gateway-wire.mts [days=365]     (reads demo/gateway.faithnet.json + .env.gateway.local)
 *
 * Writes GATEWAY_AGENT and GATEWAY_SESSION_WIRE (base64url JSON) into apps/discovery-connector/.env.gateway.local.
 */
import { hashDelegation, type Delegation } from '@agenticprimitives/delegation';
import { skillSelector } from '@agenticprimitives/a2a';
import { STANDARD_SURFACE_SKILL } from '@agenticprimitives/a2a/standard';
import { encodeAbiParameters, toHex, type Address, type Hex } from 'viem';
import { readFileSync, writeFileSync } from 'node:fs';

const HOME = 'https://www.faithnet.me';
const CHAIN = 34348;
const DM = '0x710cb1bF08C234Df397e0910331e0A29710EF4F7' as Address;
const TIMESTAMP = '0x73A7B878168b7DE48677617179A8bE894f0Dfe96' as Address;
const ALLOWED_METHODS = '0xdBb2E47793393C499efB0f3fcbf6Ca8669791a41' as Address;
const ENV = 'apps/discovery-connector/.env.gateway.local';
const DAYS = Number(process.argv[2] ?? 365);
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 250) }; } };
const note = JSON.parse(readFileSync('demo/gateway.faithnet.json', 'utf8')) as { service: { name: string; sa: Address } };
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const key = (env.GATEWAY_EOA ?? '').toLowerCase() as Address;
if (!/^0x[0-9a-f]{40}$/.test(key)) throw new Error('GATEWAY_EOA missing in .env.gateway.local');
const SVC = note.service.sa.toLowerCase() as Address;

const alice = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'alice', client_id: 'demo-web' }) }));
const sign = async (digest: Hex): Promise<Hex> => { const b = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.homeSession}` }, body: JSON.stringify({ digest }) })); if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 160)}`); return b.signature; };

const validUntil = Math.floor(Date.now() / 1000) + DAYS * 86_400;
const salt = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
const d: Delegation = {
  delegator: SVC, delegate: key, authority: `0x${'0'.repeat(64)}` as Hex,
  caveats: [
    { enforcer: TIMESTAMP, terms: encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [0n, BigInt(validUntil)]), args: '0x' },
    { enforcer: ALLOWED_METHODS, terms: encodeAbiParameters([{ type: 'bytes4[]' }], [[skillSelector(STANDARD_SURFACE_SKILL)]]), args: '0x' },
  ],
  salt, signature: '0x',
};
const ref = hashDelegation(d, CHAIN, DM);
d.signature = await sign(ref);
const wire = { ...d, salt: salt.toString() };
const b64 = Buffer.from(JSON.stringify(wire)).toString('base64url');
const lines = readFileSync(ENV, 'utf8').split('\n').filter((l) => l && !l.startsWith('GATEWAY_AGENT=') && !l.startsWith('GATEWAY_SESSION_WIRE=') && !l.startsWith('GATEWAY_WIRE_REF='));
writeFileSync(ENV, [...lines, `GATEWAY_AGENT=${SVC}`, `GATEWAY_SESSION_WIRE=${b64}`, `GATEWAY_WIRE_REF=${ref}`].join('\n') + '\n');
console.log(`✓ session wire ${ref}\n  ${note.service.name} ${SVC} → ${key}, pinned to "${STANDARD_SURFACE_SKILL}", ${DAYS} days — written to ${ENV}`);
