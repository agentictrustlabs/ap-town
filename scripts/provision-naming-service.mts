/**
 * SPEC 431 — the town's naming service, provisioned the estate's way: a demo PERSON who custodies it (the town clerk),
 * the naming SERVICE AGENT (the governor of every priced subregistry), and its TREASURY (where every fee goes).
 *
 *   RPC_URL=<gateway url with a write-capable token> pnpm provision:naming
 *
 * Idempotent. Every run:
 *   1. loads (or makes) the clerk's custodian key from `.townclerk-key.local.json` — gitignored, 0600, never printed;
 *   2. derives the three Smart Agents from that key with labelled salts and deploys whichever is missing (the chain
 *      charges no gas, so the key needs no balance);
 *   3. claims the names — `townclerk.me` (a person), `naming.svc` (a service), `naming.treasury` (a treasury) — as
 *      each agent, through the Home's relayer (gasless user operations), signed by the clerk's key;
 *   4. writes `operations/naming-service.faithchain.json` (addresses only) and prints the persona entry for the
 *      Home's roster (`demo/personas.json` + the DEMO_PERSONA_KEYS secret), where the key DOES belong.
 *
 * No deployer key, no faucet: the clerk is a demo person like Nathan or the Poker Site, and everything the naming
 * service does from here on is a ceremony under the clerk's custody.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createPublicClient, encodeFunctionData, http, keccak256, toBytes, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { AgentAccountClient, buildExecuteBatchCallData, type ContractCall } from '@agenticprimitives/agent-account';
import { buildDeclareAgentTypeCalls, buildTypedClaimCalls, namehash, agentNameUniversalResolverAbi, agentProfileResolverTypeAbi } from '@agenticprimitives/agent-naming';
import { getDeployments } from '@agenticprimitives/contracts/deployments';

const HOME = process.env.HOME_URL ?? 'https://www.faithnet.me';
const RPC = process.env.RPC_URL ?? '';
if (!RPC) throw new Error('RPC_URL (a chain-gateway URL with a write-capable token) is required');
const CHAIN_ID = 34348;
const KEY_FILE = '.townclerk-key.local.json';
const OUT = 'operations/naming-service.faithchain.json';
const d = getDeployments('faithchain') as unknown as Record<string, Address> & { permissionlessSubregistries: Record<string, Address> };

// 1. The clerk's key.
let key: Hex;
if (existsSync(KEY_FILE)) key = (JSON.parse(readFileSync(KEY_FILE, 'utf8')) as { privateKey: Hex }).privateKey;
else { key = generatePrivateKey(); writeFileSync(KEY_FILE, JSON.stringify({ privateKey: key, note: 'the town clerk — custodian of the naming service and its treasury (spec 431). Never commit.' }, null, 2), { mode: 0o600 }); }
const clerk = privateKeyToAccount(key);
console.log(`clerk custodian ${clerk.address}`);

const pc = createPublicClient({ transport: http(RPC) });
const accounts = new AgentAccountClient({ rpcUrl: RPC, chainId: CHAIN_ID, entryPoint: d.entryPoint, factory: d.agentAccountFactory });
const salt = (label: string): bigint => BigInt(keccak256(toBytes(label)));
const spec = (label: string) => ({ mode: 0, custodians: [clerk.address] as const, salt: salt(label) });

// 2. The three agents.
const AGENTS = [
  { id: 'person', label: 'town.clerk.person.v1', name: 'townclerk.me', type: 'person' as const, displayName: 'Tamsin Clerk — the town clerk', description: 'Custodian of the town’s naming service and its treasury (spec 431).' },
  { id: 'service', label: 'town.naming.service.v1', name: 'naming.svc', type: 'service' as const, displayName: 'Naming service', description: 'The town’s naming service agent: governor of every priced subregistry and of the roots. It lists; it never grants.' },
  { id: 'treasury', label: 'town.naming.treasury.v1', name: 'naming.treasury', type: 'treasury' as const, displayName: 'Naming treasury', description: 'Where every naming fee goes (spec 431 §4).' },
];
const out: Record<string, { address: Address; name: string }> = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')) as { agents?: typeof out }).agents ?? {} : {};
for (const a of AGENTS) {
  const addr = await accounts.getAddressForAgentAccount(spec(a.label));
  const code = await pc.getCode({ address: addr });
  if (!code || code === '0x') { console.log(`deploying ${a.id} agent ${addr} …`); await accounts.createAgentAccountFromAccount(spec(a.label), clerk); }
  else console.log(`${a.id} agent ${addr} already deployed`);
  out[a.id] = { address: addr, name: a.name };
}

// 3. The names, as each agent, through the Home's relayer.
const csrfRes = await fetch(`${HOME}/a2a/auth/csrf`, { headers: { origin: HOME } });
const csrf = (await csrfRes.json()) as { token?: string };
const H = { 'content-type': 'application/json', origin: HOME, cookie: (csrfRes.headers.get('set-cookie') ?? '').split(';')[0] ?? '', 'x-csrf-token': csrf.token ?? '' };
const post = async (path: string, body: unknown): Promise<Record<string, unknown>> => (await fetch(`${HOME}/a2a${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
async function execute(sender: Address, calls: ContractCall[]): Promise<Hex> {
  const callData = buildExecuteBatchCallData(calls);
  for (let i = 0; i < 6; i++) {
    const b = await post('/account/build-call-userop', { sender, callData });
    if (!b.ok) throw new Error(`build-call-userop: ${JSON.stringify(b).slice(0, 240)}`);
    const signature = await clerk.signMessage({ message: { raw: b.userOpHash as Hex } });
    const s = await post('/account/submit-call-userop', { userOp: { ...(b.userOp as object), signature } });
    if (s.ok) return s.transactionHash as Hex;
    if (/AA25|nonce/i.test(JSON.stringify(s))) { await new Promise((r) => setTimeout(r, 3000)); continue; }
    throw new Error(`submit-call-userop: ${JSON.stringify(s).slice(0, 240)}`);
  }
  throw new Error('submit-call-userop: gave up on the nonce');
}
for (const a of AGENTS) {
  const addr = out[a.id]!.address;
  const current = (await pc.readContract({ address: d.agentNameUniversalResolver, abi: agentNameUniversalResolverAbi, functionName: 'reverseResolveString', args: [addr] })) as string;
  if (current === a.name) { console.log(`${a.id}: presents ${a.name}`); continue; }
  const registered = (await pc.readContract({ address: d.agentProfileResolver, abi: agentProfileResolverTypeAbi, functionName: 'isRegistered', args: [addr] })) as boolean;
  const declare = buildDeclareAgentTypeCalls({ profileResolver: d.agentProfileResolver, agent: addr, agentType: a.type, registered, displayName: a.displayName });
  const claim = buildTypedClaimCalls({ name: a.name, owner: addr, registry: d.agentNameRegistry, resolver: d.agentNameResolver, subregistries: d.permissionlessSubregistries, agentType: a.type, records: { displayName: a.displayName, description: a.description } });
  console.log(`${a.id}: claiming ${a.name} …`);
  const tx = await execute(addr, [...declare, claim.claim, claim.primaryName, ...claim.records]);
  console.log(`${a.id}: ${a.name} ← ${addr} (${tx})`);
}

// 4. Record (addresses only) and print the roster entry.
mkdirSync('operations', { recursive: true });
writeFileSync(OUT, JSON.stringify({ chainId: CHAIN_ID, clerkCustodian: clerk.address, agents: out, provisionedAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`wrote ${OUT}`);
console.log('\nHome roster entry (demo/personas.json → DEMO_PERSONA_KEYS), the key from the key file:');
console.log(JSON.stringify({ townclerk: { name: 'Tamsin Clerk — the town clerk', sa: out.person!.address, blurb: 'Custodian of the town’s naming service and its treasury.', custodies: [{ sa: out.service!.address, name: 'Naming service', kind: 'service' }, { sa: out.treasury!.address, name: 'Naming treasury', kind: 'treasury' }], eoaPrivateKey: '<from .townclerk-key.local.json>' } }, null, 2));
