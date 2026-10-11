// THE LEDGER — spec 434 §7: receipts are vault records of inference.svc, written through the estate vault's public
// native door AS THE SERVICE ITSELF (the scripture Worker's shape, spec 433 W2): the GRANT (inference.svc → the vault's
// interactions service, scoped to `vault:inference.receipt:*` …, write), the LEAF (inference.svc → this Worker's signing
// key, DEL-001), a TOKEN minted per write and a per-call invocation proof, both signed by the Worker's own delegate key
// (`INFERENCE_SIGNER_KEY`, a secret; a delegate under a wire the custodian minted — compromise reaches a delegate, never
// the identity). No prompt text ever reaches here (G7). When the credentials are not provisioned the ledger says so on
// `/healthz` and receipts still land in the meter's 30-day table — a cache, said as such, never the record.
import { mintDelegationToken, buildInvocationProof, type Delegation } from '@agenticprimitives/delegation';
import type { InferenceReceiptV1, ReceiptLedgerPort } from '@agenticprimitives/model-gateway';
import { hashMessage, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

export interface VaultLedgerEnv {
  VAULT_URL?: string;
  VAULT_AUDIENCE?: string;
  VAULT_GRANT?: string;
  VAULT_SESSION_LEAF?: string;
  INFERENCE_SIGNER_KEY?: string;
  INFERENCE_AGENT_NAME?: string;
  CHAIN_ID?: string;
}

interface WireDoc { delegator: string; delegate: string; authority: string; caveats: Array<{ enforcer: string; terms: string; args?: string }>; salt: string; signature: string }
const isWireDoc = (x: unknown): x is WireDoc => { const w = x as Partial<WireDoc> | null; return !!w && typeof w === 'object' && /^0x[0-9a-fA-F]{40}$/.test(String(w.delegator)) && /^0x[0-9a-fA-F]{40}$/.test(String(w.delegate)) && Array.isArray(w.caveats) && typeof w.signature === 'string'; };
const toDelegation = (w: WireDoc): Delegation => ({ delegator: w.delegator as Address, delegate: w.delegate as Address, authority: w.authority as Hex, caveats: w.caveats.map((c) => ({ enforcer: c.enforcer as Address, terms: c.terms as Hex, args: (c.args ?? '0x') as Hex })), salt: BigInt(w.salt), signature: w.signature as Hex });
const parseWire = (raw: string | undefined, what: string): WireDoc | { error: string } => {
  if (!raw?.trim()) return { error: `${what} is not provisioned` };
  try { const j = JSON.parse(raw) as unknown; return isWireDoc(j) ? j : { error: `${what} is not a delegation wire` }; } catch { return { error: `${what} is not JSON` }; }
};

export type LedgerReadiness = { ready: true; agent: Address; delegate: Address; vault: string } | { ready: false; reason: string };
export function vaultLedgerReadiness(env: VaultLedgerEnv): LedgerReadiness {
  if (!env.VAULT_URL) return { ready: false, reason: 'VAULT_URL unset' };
  const grant = parseWire(env.VAULT_GRANT, 'VAULT_GRANT'); if ('error' in grant) return { ready: false, reason: grant.error };
  const leaf = parseWire(env.VAULT_SESSION_LEAF, 'VAULT_SESSION_LEAF'); if ('error' in leaf) return { ready: false, reason: leaf.error };
  if (grant.delegator.toLowerCase() !== leaf.delegator.toLowerCase()) return { ready: false, reason: 'the grant and the leaf name different agents' };
  if (!env.INFERENCE_SIGNER_KEY || !/^0x[0-9a-fA-F]{64}$/.test(env.INFERENCE_SIGNER_KEY)) return { ready: false, reason: 'INFERENCE_SIGNER_KEY unset' };
  const signer = privateKeyToAccount(env.INFERENCE_SIGNER_KEY as Hex);
  if (signer.address.toLowerCase() !== leaf.delegate.toLowerCase()) return { ready: false, reason: `the signer key is ${signer.address}, the leaf names ${leaf.delegate}` };
  return { ready: true, agent: grant.delegator.toLowerCase() as Address, delegate: leaf.delegate.toLowerCase() as Address, vault: env.VAULT_URL.replace(/\/$/, '') };
}

/** The receipt ledger over the vault's native door; `undefined` when not provisioned (the caller says so, never silently). */
export function vaultReceiptLedger(env: VaultLedgerEnv, fetchImpl: typeof fetch = fetch, log?: (line: string) => void): ReceiptLedgerPort | undefined {
  const ready = vaultLedgerReadiness(env);
  if (!ready.ready) return undefined;
  const grant = toDelegation(parseWire(env.VAULT_GRANT, 'grant') as WireDoc);
  const leaf = toDelegation(parseWire(env.VAULT_SESSION_LEAF, 'leaf') as WireDoc);
  const audience = env.VAULT_AUDIENCE ?? 'urn:mcp:server:person';
  const chainId = Number(env.CHAIN_ID ?? '0');
  const signer = privateKeyToAccount(env.INFERENCE_SIGNER_KEY as Hex);
  const signDigest = async (d: Hex): Promise<Hex> => signer.sign({ hash: d });
  return {
    async write(receipt: InferenceReceiptV1) {
      const { token } = await mintDelegationToken(
        { iss: env.INFERENCE_AGENT_NAME ?? 'inference.svc', aud: audience, sub: ready.agent, delegation: grant, sessionKeyAddress: ready.delegate, sessionDelegation: leaf, usageLimit: 1, ttlSeconds: 300 } as never,
        async (message: string) => signDigest(hashMessage(message)),
      );
      const now = Date.now();
      const toolArgs = { recordType: `inference.receipt:${receipt.id}`, data: receipt };
      // THE PROOF IS SIGNED OVER WHAT THE SERVER RECOMPUTES. `withDelegation` strips `token`,
    // `quorumProof` and `invocationProof` from the handler's input and hashes THE REST — and this door
    // hands it `{ token, invocationProof, args }`, so the rest is `{ args }`, never the args alone.
    // Signing `toolArgs` gave `arguments_mismatch`, surfaced only as a flat 401 `invalid_invocation_proof`.
    const invocationProof = await buildInvocationProof({ chainId, audience, principal: ready.agent, sessionKey: ready.delegate, operation: 'set_vault_record', args: { args: toolArgs }, rawDelegationToken: token, requestId: crypto.randomUUID(), issuedAt: now, expiresAt: now + 30_000, sign: signDigest } as never);
      const res = await fetchImpl(`${ready.vault}/mcp/native`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ token, invocationProof, tool: 'set_vault_record', args: toolArgs }) });
      const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; detail?: string };
      if (!(res.ok && out.ok)) log?.(`[ledger] vault refused inference.receipt:${receipt.id}: ${out.error ?? out.code ?? res.status}${out.detail ? ` (${out.detail})` : ''}`);
    },
  };
}
