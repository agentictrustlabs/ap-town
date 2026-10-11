/**
 * Spec 436 §5.5 T2, and spec 278 before it — GIVE EACH CONTEXT AGENT ITS OWN VAULT.
 *
 * A chartered agent has an identity, a name and a door, but no vault: nothing it is told is kept until its
 * per-agent KEK is provisioned and the agent has AUTHORIZED the vault server to wield it. Until then every
 * write is refused `vault_key_unauthorized`, which is the fail-closed answer and not a bug.
 *
 * The ceremony is the one the Home runs for a person (`activateVault` in onboarding.ts), run here for a
 * service agent and signed by its CUSTODIAN, whose ECDSA the agent's account accepts over ERC-1271:
 *   1. ask the server what it is and which KEK it would use for this owner;
 *   2. provision that KEK, proving control of the owner over a freshness-bound challenge;
 *   3. sign a VaultKeyAuthorization — one non-subdelegable VAULT_KEY_USE caveat — and post it.
 *
 *   npx tsx scripts/bind-context-agent-vaults.mts
 *
 * Idempotent: an agent already bound for `vault:*` is left alone.
 */
import { buildVaultKeyUseCaveat, hashDelegation, ROOT_AUTHORITY, type Delegation } from '@agenticprimitives/delegation';
import { parseAgentName } from '@agenticprimitives/agent-naming';
import { createPublicClient, http, keccak256, toBytes, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { readFileSync } from 'node:fs';
import { CONTRACTS as contracts } from '@agenticprimitives/contracts/deployments/faithchain';

const MCP = process.env.VAULT_URL ?? 'https://mcp.faithnet.io';
const PERSONA = process.env.CUSTODIAN_PERSONA ?? `${process.env.HOME}/skills/.personas/demo-admin.json`;
const envLines = readFileSync('.env.ops.local', 'utf8').split('\n');
const envOf = (k: string): string => (envLines.find((l) => l.startsWith(`${k}=`)) ?? '').slice(k.length + 1).replace(/^'|'$/g, '');
const j = async (r: Response): Promise<Record<string, unknown>> => { const t = await r.text(); try { return JSON.parse(t) as Record<string, unknown>; } catch { return { _raw: t.slice(0, 200) }; } };

const cfgRaw = readFileSync('apps/town-agent/wrangler.toml', 'utf8').split('\n').find((l) => l.startsWith('CONTEXT_AGENTS = '))?.slice(17).replace(/^"|"$/g, '').replace(/\\"/g, '"') ?? '{}';
const cfg = JSON.parse(cfgRaw) as { town?: string; estates?: Record<string, string> };
const names = [...(cfg.town ? [cfg.town] : []), ...Object.values(cfg.estates ?? {})];
if (!names.length) throw new Error('CONTEXT_AGENTS names no agent');

const pub = createPublicClient({ transport: http(`https://rpc.faithnet.io?k=${envOf('CHAIN_APP_TOKEN_CHARTER')}`) });
const custodian = privateKeyToAccount(JSON.parse(readFileSync(PERSONA, 'utf8')).eoaPrivateKey as Hex);
// EIP-191 over the digest — the rail a wallet signs on, and the one the agent's ERC-1271 accepts from a custodian.
const sign = (digest: Hex): Promise<Hex> => custodian.signMessage({ message: { raw: digest } });

async function saOf(name: string): Promise<Address> {
  const node = parseAgentName(name).node;
  const owner = (await pub.readContract({ address: contracts.agentNameRegistry as Address, abi: [{ type: 'function', name: 'owner', stateMutability: 'view', inputs: [{ name: 'n', type: 'bytes32' }], outputs: [{ type: 'address' }] }], functionName: 'owner', args: [node] })) as Address;
  if (owner === '0x0000000000000000000000000000000000000000') throw new Error(`${name} is owned by nobody — charter it first`);
  return owner.toLowerCase() as Address;
}

for (const name of names) {
  const sa = await saOf(name);
  const status = (await j(await fetch(`${MCP}/custody/vault-key/is-bound?owner=${sa}`))) as { bound?: boolean; allowedResources?: string[] };
  if (status.bound && status.allowedResources?.includes('vault:*')) { console.log(`  ${name} ${sa} — already bound`); continue; }

  const info = (await j(await fetch(`${MCP}/custody/vault-key/server-info?owner=${sa}`))) as { serverId?: string; serverKey?: string; kmsKeyRef?: string | null; defaultResources?: string[]; classificationCeiling?: string; ops?: ('read' | 'write')[] };
  if (!info.kmsKeyRef) { console.log(`  ${name} — the server offers no KEK for this owner`); continue; }

  const issuedAt = Math.floor(Date.now() / 1000);
  const challenge = keccak256(toBytes(['demo-mcp:vault-key-provision:v1', sa, String(issuedAt)].join('\n')));
  const prov = (await j(await fetch(`${MCP}/custody/vault-key/provision`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: sa, issuedAt, proof: await sign(challenge) }) }))) as { ok?: boolean; kmsKeyRef?: string; error_description?: string; detail?: string };
  if (!prov.ok || !prov.kmsKeyRef) { console.log(`  ${name} — provision refused: ${prov.error_description ?? prov.detail ?? JSON.stringify(prov).slice(0, 140)}`); continue; }

  const params = {
    vaultId: String(info.serverId ?? '').trim() || 'demo-mcp',
    kmsKeyRef: prov.kmsKeyRef,
    serverKey: (info.serverKey ?? '0x0000000000000000000000000000000000000001') as Address,
    allowedResources: info.defaultResources ?? ['person-pii', 'org-sensitive', 'profile', 'vault:*'],
    classificationCeiling: info.classificationCeiling ?? 'regulated.high',
    ops: info.ops ?? (['read', 'write'] as ('read' | 'write')[]),
  };
  const validUntil = Math.floor(Date.now() / 1000) + 90 * 86_400;
  let salt = 0n; for (const b of crypto.getRandomValues(new Uint8Array(16))) salt = (salt << 8n) | BigInt(b);
  const d: Delegation = {
    delegator: sa, delegate: params.serverKey, authority: ROOT_AUTHORITY, salt, signature: '0x',
    caveats: [buildVaultKeyUseCaveat({ vaultId: params.vaultId, kmsKeyRef: params.kmsKeyRef, resources: params.allowedResources, classificationCeiling: params.classificationCeiling, ops: params.ops, noSubdelegation: true })],
  };
  d.signature = await sign(hashDelegation(d, contracts.chainId, contracts.delegationManager as Address));
  const bind = (await j(await fetch(`${MCP}/custody/vault-key/bind`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ owner: sa, ...params, expiresAt: new Date(validUntil * 1000).toISOString(), authorization: { ...d, salt: d.salt.toString() } }) }))) as { ok?: boolean; reason?: string; error?: string };
  console.log(`  ${name} ${sa} — ${bind.ok ? 'VAULT ACTIVATED' : `bind refused: ${bind.reason ?? bind.error ?? JSON.stringify(bind).slice(0, 140)}`}`);
}
