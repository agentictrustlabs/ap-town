/**
 * Spec 387 §3 — THE GATEWAY'S SESSION WIRES: gateway.svc → the key only the gateway Worker holds, pinned to
 * `harness.ask` and nothing else, pinned to ONE RECEIVING AGENT, timestamp-bounded, signed by the agent's custodian
 * (alice, who chartered it) through the Home. Revocable on chain by her at any moment; rotation = a new wire, never
 * a config edit.
 *
 * ONE WIRE PER TARGET (Ring 0 spec 445 / RUN-9, 2026-11-10). A receiving host refuses a session wire whose
 * allowedTargets caveat does not name ITS OWN agent, and refuses a wire with no such caveat. The wire this script
 * minted before named no target and is refused everywhere once a receiver is on the new a2a. So: run it once per
 * agent the gateway calls. A wire stolen from the Worker then works at one agent, and revoking one leaves the rest.
 *
 *   npx tsx scripts/mint-gateway-wire.mts --target 0x<receiving agent's Smart Agent address> [--days 365]
 *     (reads demo/gateway.faithnet.json + apps/discovery-connector/.env.gateway.local)
 *
 * The target is the agent's canonical address as the registry names it (`ap:canonicalAgentId` — the `anchor` in the
 * gateway's handle), never a hostname. Writes GATEWAY_AGENT and, for this target, GATEWAY_SESSION_WIRE_<40 hex>
 * (base64url JSON) and GATEWAY_WIRE_REF_<40 hex> into apps/discovery-connector/.env.gateway.local; each
 * GATEWAY_SESSION_WIRE_<40 hex> is then a Worker secret of the same name. The retired, untargeted
 * GATEWAY_SESSION_WIRE / GATEWAY_WIRE_REF lines are left in the file untouched: revoke that wire on chain
 * (its ref is GATEWAY_WIRE_REF) and delete the secret once every target has its own.
 */
import { buildCaveat, encodeAllowedMethodsTerms, encodeAllowedTargetsTerms, encodeTimestampTerms, hashDelegation, ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import { checkSessionWireShape, delegationToWire, skillSelector } from '@agenticprimitives/a2a';
import { STANDARD_SURFACE_SKILL } from '@agenticprimitives/a2a/standard';
import { toHex, type Address, type Hex } from 'viem';
import { readFileSync, writeFileSync } from 'node:fs';

const HOME = 'https://www.faithnet.me';
const CHAIN = 34348;
// faithchain (Ring 0 deployments-faithchain.json) — the gateway agent's chain.
const DM = '0x3BBeCcC7a52E1CE04a3BF7E7404D3BCBF566C490' as Address;
const TIMESTAMP = '0x5A11D8ff4E5Ef341c66C98dFD2441b5858d8e293' as Address;
const ALLOWED_METHODS = '0x2d1C7730D29Ba8aEE1D02f59eF0BBE88b439560e' as Address;
const ALLOWED_TARGETS = '0x8421F81d4F5f7f64F2e518d8b2a12ef4C1d11088' as Address;
const ENV = 'apps/discovery-connector/.env.gateway.local';
const arg = (k: string): string | undefined => { const i = process.argv.indexOf(`--${k}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const TARGET = (arg('target') ?? '').toLowerCase() as Address;
const DAYS = Number(arg('days') ?? 365);
if (!/^0x[0-9a-f]{40}$/.test(TARGET) || !Number.isFinite(DAYS) || DAYS <= 0) {
  console.error('usage: mint-gateway-wire.mts --target 0x<receiving agent> [--days 365]\n  one wire per receiving agent: a session wire names the host it is presented at (Ring 0 spec 445 / RUN-9)');
  process.exit(2);
}
const j = async (r: Response) => { const t = await r.text(); try { return JSON.parse(t); } catch { return { _raw: t.slice(0, 250) }; } };
const note = JSON.parse(readFileSync('demo/gateway.faithnet.json', 'utf8')) as { service: { name: string; sa: Address } };
const env = Object.fromEntries(readFileSync(ENV, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const key = (env.GATEWAY_EOA ?? '').toLowerCase() as Address;
if (!/^0x[0-9a-f]{40}$/.test(key)) throw new Error('GATEWAY_EOA missing in .env.gateway.local');
const SVC = note.service.sa.toLowerCase() as Address;
if (TARGET === SVC) throw new Error('--target is the gateway agent itself; name the agent the gateway CALLS');

const alice = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: 'alice', client_id: 'demo-web' }) }));
const sign = async (digest: Hex): Promise<Hex> => { const b = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${alice.homeSession}` }, body: JSON.stringify({ digest }) })); if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 160)}`); return b.signature as Hex; };

const validUntil = Math.floor(Date.now() / 1000) + DAYS * 86_400;
const salt = BigInt(toHex(crypto.getRandomValues(new Uint8Array(16))));
const d: Delegation = {
  delegator: SVC, delegate: key, authority: ROOT_AUTHORITY, salt, signature: '0x',
  caveats: [
    buildCaveat(TIMESTAMP, encodeTimestampTerms(0, validUntil)),
    // THE TARGET: the one receiving agent this wire is a credential at. Its gate reads this caveat on every request.
    buildCaveat(ALLOWED_TARGETS, encodeAllowedTargetsTerms([TARGET])),
    // ONE skill: asking. Never the any-skill sentinel.
    buildCaveat(ALLOWED_METHODS, encodeAllowedMethodsTerms([skillSelector(STANDARD_SURFACE_SKILL)])),
  ],
};
const ref = hashDelegation(d, CHAIN, DM);
d.signature = await sign(ref);
const wire = delegationToWire(d);
// The same shape check the receiving agent's gate runs on every request — refused here, before anything is written.
const refused = checkSessionWireShape(wire, { timestamp: TIMESTAMP, allowedMethods: ALLOWED_METHODS, allowedTargets: ALLOWED_TARGETS }, Math.floor(Date.now() / 1000), { target: TARGET, skill: STANDARD_SURFACE_SKILL });
if (refused) { console.error(`the wire's shape is refused: ${refused} — nothing written`); process.exit(1); }
const b64 = Buffer.from(JSON.stringify(wire)).toString('base64url');
const suffix = TARGET.slice(2);
const WIRE_VAR = `GATEWAY_SESSION_WIRE_${suffix}`; const REF_VAR = `GATEWAY_WIRE_REF_${suffix}`;
const lines = readFileSync(ENV, 'utf8').split('\n').filter((l) => l && !l.startsWith('GATEWAY_AGENT=') && !l.startsWith(`${WIRE_VAR}=`) && !l.startsWith(`${REF_VAR}=`));
writeFileSync(ENV, [...lines, `GATEWAY_AGENT=${SVC}`, `${WIRE_VAR}=${b64}`, `${REF_VAR}=${ref}`].join('\n') + '\n');
console.log(`✓ session wire ${ref}\n  ${note.service.name} ${SVC} → ${key}, pinned to "${STANDARD_SURFACE_SKILL}" at ${TARGET} only, ${DAYS} days — written to ${ENV} as ${WIRE_VAR}\n  next: put ${WIRE_VAR} on the Worker as a secret of that name (each env that runs the gateway)`);
