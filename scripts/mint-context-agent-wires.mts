/**
 * Spec 436 §5.5 T2 — THE CONTEXT AGENTS' VAULT WIRES.
 *
 * The town agent writes each day's pulse rollup into the context agents' own vaults, AS those agents. It holds
 * no custody of them, so each write rides a two-part wire the agent's custodian signed:
 *
 *   grant — delegator = the context agent, delegate = the town's signer key, scoped by a VAULT_RECORD_SCOPE
 *           caveat to `vault:pulse.day:*` for write and read, and to nothing else. Not the agent's vault; one
 *           record family of it.
 *   leaf  — the session delegation that binds the same key, timestamp-bounded.
 *
 * Both are signed through the Home by the custodian of the agents (`demo-admin`, who chartered them in T1) —
 * this script holds no custody key of its own and signs nothing itself. The town's signer key is generated here
 * and written to `.env.ops.local`; it is a DELEGATE, never an identity, and revoking either wire on chain stops
 * it instantly without touching any config.
 *
 *   npx tsx scripts/mint-context-agent-wires.mts [days=365]
 *
 * Idempotent in the only sense that matters: re-running mints FRESH wires and replaces the old ones in
 * `.env.ops.local`. The superseded wires stay valid until they expire or are revoked — rotation is a new wire.
 */
import { buildCaveat, buildSessionAudienceCaveat, buildVaultRecordScopeCaveat, encodeTimestampTerms, encodeValueTerms, hashDelegation, ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import { parseAgentName } from '@agenticprimitives/agent-naming';
import { createPublicClient, http, toHex, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { readFileSync, writeFileSync } from 'node:fs';
import { CONTRACTS as contracts } from '@agenticprimitives/contracts/deployments/faithchain';

const HOME = process.env.HOME_ORIGIN ?? 'https://www.faithnet.me';
const CUSTODIAN = process.env.CUSTODIAN_HANDLE ?? 'demo-admin';
const ENV = '.env.ops.local';
const SERVER = process.env.VAULT_SERVER_ID ?? 'demo-mcp';
const DAYS = Number(process.argv[2] ?? 365);
/** The one record family the town writes (spec 436 §5.5 T2); `pulse.day:` is `apinf:TownPulse` in Ring 0. */
const RESOURCES = ['vault:pulse.day:*'];

const j = async (r: Response): Promise<Record<string, unknown>> => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 220) }; } };
const envLines = readFileSync(ENV, 'utf8').split('\n');
const envOf = (k: string): string => (envLines.find((l) => l.startsWith(`${k}=`)) ?? '').slice(k.length + 1).replace(/^'|'$/g, '');

const agentsRaw = process.env.CONTEXT_AGENTS ?? readFileSync('apps/town-agent/wrangler.toml', 'utf8').split('\n').find((l) => l.startsWith('CONTEXT_AGENTS = '))?.slice(17).replace(/^"|"$/g, '').replace(/\\"/g, '"') ?? '';
const cfg = JSON.parse(agentsRaw || '{}') as { town?: string; estates?: Record<string, string> };
const names = [...(cfg.town ? [cfg.town] : []), ...Object.values(cfg.estates ?? {})];
if (!names.length) throw new Error('CONTEXT_AGENTS names no agent — charter them first (T1)');

const token = envOf('CHAIN_APP_TOKEN_CHARTER');
if (!token) throw new Error(`${ENV} has no CHAIN_APP_TOKEN_CHARTER — the chain gateway needs an app token`);
const pub = createPublicClient({ transport: http(`https://rpc.faithnet.io?k=${token}`) });

/**
 * The SA a typed name points at, read from the chain — never from a note on disk — and only when forward and
 * reverse AGREE: the name's owner must name the name back as its primary. A one-way read would let a name whose
 * owner has moved on hand this script the wrong agent to grant over.
 */
const REGISTRY_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'primaryName', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'bytes32' }] },
] as const;
async function saOf(name: string): Promise<Address> {
  const node = parseAgentName(name).node;
  const owner = (await pub.readContract({ address: contracts.agentNameRegistry as Address, abi: REGISTRY_ABI, functionName: 'owner', args: [node] }).catch(() => null)) as Address | null;
  if (!owner || owner === '0x0000000000000000000000000000000000000000') throw new Error(`${name} is owned by nobody on chain — charter it first (T1)`);
  const back = (await pub.readContract({ address: contracts.agentNameRegistry as Address, abi: REGISTRY_ABI, functionName: 'primaryName', args: [owner] })) as Hex;
  if (back.toLowerCase() !== node.toLowerCase()) throw new Error(`${name} does not round-trip: its owner ${owner} names ${back} as its primary`);
  return owner.toLowerCase() as Address;
}

const me = await j(await fetch(`${HOME}/connect/demo-signin`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: CUSTODIAN, client_id: 'demo-web' }) }));
if (!me.homeSession) throw new Error(`demo-signin ${CUSTODIAN}: ${JSON.stringify(me).slice(0, 180)}`);
const sign = async (digest: Hex): Promise<Hex> => {
  const b = await j(await fetch(`${HOME}/connect/persona-sign`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${me.homeSession as string}` }, body: JSON.stringify({ digest }) }));
  if (!b.signature) throw new Error(`persona-sign: ${JSON.stringify(b).slice(0, 180)}`);
  return b.signature as Hex;
};

// The town's signer key: kept if one is already set, so a re-mint does not strand the deployed Worker.
const signerKey = (envOf('TOWN_SIGNER_KEY') || generatePrivateKey()) as Hex;
const signer = privateKeyToAccount(signerKey);
const validUntil = Math.floor(Date.now() / 1000) + DAYS * 86_400;
const saltOf = (): bigint => { let s = 0n; for (const b of crypto.getRandomValues(new Uint8Array(16))) s = (s << 8n) | BigInt(b); return s; };
const wire = (d: Delegation) => ({ ...d, salt: d.salt.toString() });

const creds: Record<string, { grant: unknown; leaf: unknown }> = {};
for (const name of names) {
  const sa = await saOf(name);
  const mk = async (caveats: Delegation['caveats']): Promise<Delegation> => {
    const d: Delegation = { delegator: sa, delegate: signer.address.toLowerCase() as Address, authority: ROOT_AUTHORITY, salt: saltOf(), signature: '0x', caveats };
    d.signature = await sign(hashDelegation(d, contracts.chainId, contracts.delegationManager as Address));
    return d;
  };
  // The grant carries the authority and NARROWS it to one record family; the leaf only binds the key.
  const grant = await mk([
    buildVaultRecordScopeCaveat([{ server: SERVER, resources: RESOURCES, ops: ['write', 'read'] }]),
    buildCaveat(contracts.timestampEnforcer as Address, encodeTimestampTerms(0, validUntil)),
    buildCaveat(contracts.valueEnforcer as Address, encodeValueTerms(0n)),
  ]);
  // THE LEAF NAMES ITS AUDIENCE (spec 408 §2.1): the delegates this session key may present the agent's
  // delegations to. A leaf that names nobody is refused outright — "session-delegation names no audience" —
  // and no knob re-admits the old shape. Here that audience is exactly the grant's delegate: this key, and
  // nothing else, may be presented with this grant.
  const leaf = await mk([
    buildCaveat(contracts.timestampEnforcer as Address, encodeTimestampTerms(0, validUntil)),
    buildSessionAudienceCaveat([signer.address.toLowerCase() as Address]),
  ]);
  creds[name] = { grant: wire(grant), leaf: wire(leaf) };
  console.log(`  ${name} ${sa} → ${signer.address}  scope ${RESOURCES.join(' ')} write,read · ${DAYS} days`);
}

// A Cloudflare secret is capped at 5.1 kB and two wire pairs run to 5.4, so the JSON is split into parts the
// Worker re-joins in order. Chunked by BYTES, not by agent, so a third agent needs no new name.
const json = JSON.stringify(creds);
const PART = 4800;
const parts: string[] = [];
for (let i = 0; i < json.length; i += PART) parts.push(json.slice(i, i + PART));
if (parts.length > 4) throw new Error(`${parts.length} parts needed but the Worker reads 4 — raise CONTEXT_AGENT_CREDENTIALS_<n> in pulse-record.ts`);
const keep = envLines.filter((l) => l && !l.startsWith('TOWN_SIGNER_KEY=') && !/^CONTEXT_AGENT_CREDENTIALS(_\d)?=/.test(l));
writeFileSync(ENV, [...keep, `TOWN_SIGNER_KEY=${signerKey}`, ...parts.map((p, i) => `CONTEXT_AGENT_CREDENTIALS${i ? `_${i + 1}` : ''}='${p}'`)].join('\n') + '\n', { mode: 0o600 });
console.log(`  credentials: ${json.length} bytes in ${parts.length} part(s)`);
console.log(`\n✓ ${names.length} wire pair(s) written to ${ENV} (0600). Run scripts/set-pulse-secrets.sh to put them on the town agent.`);
