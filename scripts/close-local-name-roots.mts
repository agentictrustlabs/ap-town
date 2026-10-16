/**
 * ONE NAMESPACE, ONE ROOT (ap-federation spec 440 §C1, C6) — close a LOCAL TABLE's typed roots to claims.
 *
 * A chain whose names are rooted elsewhere (`town.yaml` `chain.namesRootedAt`) must not run a parallel `.me`: every
 * claim a Home makes there is a copy the root never sees, and until wave U3 carries it to the root, another agent can
 * take the same name on the root. hopechain's typed roots were deployed OPEN (a `PermissionlessSubregistry` each —
 * eleven `.me` copies by 2026-10-16). This sets each named root's subregistry to the zero address, after which only the
 * root's owner can register under it (`AgentNameRegistry.setSubregistry`, node-owner gated). Nothing already
 * registered is touched: existing entries stay as the copies they are, and the naming service shows them as such.
 *
 *   TOWN=hopenet RPC_URL=<gateway url with a write-capable token> ROOT_OWNER_KEY=0x… \
 *     pnpm tsx scripts/close-local-name-roots.mts --roots me,org,team,church,circle,household [--apply]
 *
 * Without `--apply` it reads and prints only. It refuses a town that is not rooted elsewhere, a root the signer does not
 * own, and a root that is already closed (said, not re-sent). The key is the ROOT OWNER's — on hopechain the deployer
 * (`deployments-hopechain.json#deployer`); it is read from the environment and never written anywhere.
 *
 * Which roots: the ones people and organizations claim (`me org team church circle household`). `.estate` and the
 * service roots (`svc treasury workspace registry`) are what the chain's bootstrap writes locally today (town.yaml) and
 * are left to the operator to name explicitly if they are to be closed too.
 */
import { createPublicClient, createWalletClient, http, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { agentNameRegistryAbi, namehash } from '@agenticprimitives/agent-naming';
import { getDeployments } from '@agenticprimitives/contracts/deployments';
import { TOWNS } from '../packages/town-model/src/towns.generated';

const ZERO: Address = '0x0000000000000000000000000000000000000000';
const arg = (name: string): string | null => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const apply = process.argv.includes('--apply');

const townId = process.env.TOWN ?? '';
const town = TOWNS[townId];
if (!town) throw new Error(`TOWN "${townId}" is not a town this build knows (${Object.keys(TOWNS).join(', ')})`);
if (!town.chain.namesRootedAt) throw new Error(`${townId} is a ROOT (no chain.namesRootedAt) — its roots are the namespace's and are not closed by this script`);
const rpc = process.env.RPC_URL ?? '';
if (!rpc) throw new Error('RPC_URL (a chain-gateway URL with a write-capable token) is required');
const roots = (arg('roots') ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
if (!roots.length) throw new Error('--roots me,org,… is required (named explicitly, never defaulted)');

const d = getDeployments(town.chain.deployment as Parameters<typeof getDeployments>[0]) as unknown as { agentNameRegistry: Address; deployer?: Address };
const chain = { id: town.chain.id, name: townId, nativeCurrency: { name: 'eth', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [rpc] } } } as const;
const pc = createPublicClient({ chain, transport: http(rpc) });

const key = (process.env.ROOT_OWNER_KEY ?? '') as Hex;
const signer = apply ? privateKeyToAccount(key) : null;
if (apply && !key) throw new Error('ROOT_OWNER_KEY is required with --apply');

console.log(`${townId} (eip155:${town.chain.id}) — names rooted at ${town.chain.namesRootedAt}; registry ${d.agentNameRegistry}${apply ? ` — APPLYING as ${signer!.address}` : ' — dry run'}`);
let toClose = 0;
for (const tld of roots) {
  const node = namehash(tld) as Hex;
  const [exists, owner, sub, count] = await Promise.all([
    pc.readContract({ address: d.agentNameRegistry, abi: agentNameRegistryAbi, functionName: 'recordExists', args: [node] }) as Promise<boolean>,
    pc.readContract({ address: d.agentNameRegistry, abi: agentNameRegistryAbi, functionName: 'owner', args: [node] }) as Promise<Address>,
    pc.readContract({ address: d.agentNameRegistry, abi: agentNameRegistryAbi, functionName: 'subregistry', args: [node] }) as Promise<Address>,
    pc.readContract({ address: d.agentNameRegistry, abi: agentNameRegistryAbi, functionName: 'childCount', args: [node] }) as Promise<bigint>,
  ]);
  if (!exists) { console.log(`  .${tld}: no such root on this chain — nothing to close`); continue; }
  if (sub === ZERO) { console.log(`  .${tld}: already closed (no subregistry); ${count} name(s) under it stay as they are`); continue; }
  const mine = !!signer && owner.toLowerCase() === signer.address.toLowerCase();
  console.log(`  .${tld}: OPEN via ${sub}; owner ${owner}${signer ? (mine ? ' (the signer)' : ' — NOT the signer, refused') : ''}; ${count} name(s) under it`);
  if (!apply) { toClose++; continue; }
  if (!mine) continue;
  const wc = createWalletClient({ account: signer!, chain, transport: http(rpc) });
  const tx = await wc.writeContract({ address: d.agentNameRegistry, abi: agentNameRegistryAbi, functionName: 'setSubregistry', args: [node, ZERO] });
  const rcpt = await pc.waitForTransactionReceipt({ hash: tx });
  console.log(`    closed — tx ${tx} (${rcpt.status})`);
  toClose++;
}
console.log(apply ? `done — ${toClose} root(s) closed` : `${toClose} root(s) would be closed; re-run with --apply and ROOT_OWNER_KEY to do it`);
