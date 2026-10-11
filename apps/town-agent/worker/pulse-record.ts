// THE PULSE'S RECORD — spec 436 §5.5. `HeartbeatDO` is the cache; the record is a day's rollup written into the TOWN
// CONTEXT AGENT's vault (`faith-town.workspace`, `pulse.day:<date>`) and each estate's slice into ITS context agent's,
// through the estate vault's native door AS THAT AGENT (the inference.svc shape: a scoped grant to the vault's
// interactions service + a DEL-001 leaf to this Worker's own signing key, a token per write, a per-call proof). Until
// the agents are chartered and the credentials provisioned (T1/T2) this module says so on `/api/health` and writes
// nothing — never a DO row dressed as a vault record.
import { mintDelegationToken, buildInvocationProof, type Delegation } from '@agenticprimitives/delegation';
import { hashMessage, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PulseSampleV1 } from './pulse';
import type { TownManifest } from '@ap-town/town-model';
import { readPerformance, type InfraRowV1 } from './pulse-perf';

export interface PulseRecordEnv {
  VAULT_URL?: string;
  VAULT_AUDIENCE?: string;
  /**
   * `{ "<agent-name>": { grant, leaf } }` — each context agent's vault wires. A Cloudflare secret is capped at
   * 5.1 kB and two wire pairs are 5.4 kB, so the JSON may be SPLIT across `CONTEXT_AGENT_CREDENTIALS` and
   * `…_2`, `…_3`, `…_4`, concatenated in that order before parsing. One agent still fits in the first alone.
   */
  CONTEXT_AGENT_CREDENTIALS?: string;
  CONTEXT_AGENT_CREDENTIALS_2?: string;
  CONTEXT_AGENT_CREDENTIALS_3?: string;
  CONTEXT_AGENT_CREDENTIALS_4?: string;
  /** This Worker's signing key (the leaf's delegate) — a delegate under wires the custodians minted; never an identity. */
  TOWN_SIGNER_KEY?: string;
  /** `{ "town": "faith-town.workspace", "estates": { "faithnet": "faith-estate.workspace" } }`. */
  CONTEXT_AGENTS?: string;
  CHAIN_ID?: string;
}

interface WireDoc { delegator: string; delegate: string; authority: string; caveats: Array<{ enforcer: string; terms: string; args?: string }>; salt: string; signature: string }
const isWireDoc = (x: unknown): x is WireDoc => { const w = x as Partial<WireDoc> | null; return !!w && typeof w === 'object' && /^0x[0-9a-fA-F]{40}$/.test(String(w.delegator)) && /^0x[0-9a-fA-F]{40}$/.test(String(w.delegate)) && Array.isArray(w.caveats) && typeof w.signature === 'string'; };
const toDelegation = (w: WireDoc): Delegation => ({ delegator: w.delegator as Address, delegate: w.delegate as Address, authority: w.authority as Hex, caveats: w.caveats.map((c) => ({ enforcer: c.enforcer as Address, terms: c.terms as Hex, args: (c.args ?? '0x') as Hex })), salt: BigInt(w.salt), signature: w.signature as Hex });

export interface ContextAgentsConfig { town?: string; estates: Record<string, string> }

/** The credentials JSON, re-joined from however many parts the 5.1 kB secret ceiling forced it into. */
export function contextAgentCredentialsRaw(env: PulseRecordEnv): string {
  return [env.CONTEXT_AGENT_CREDENTIALS, env.CONTEXT_AGENT_CREDENTIALS_2, env.CONTEXT_AGENT_CREDENTIALS_3, env.CONTEXT_AGENT_CREDENTIALS_4].filter((x): x is string => typeof x === 'string' && x.length > 0).join('');
}

export function contextAgents(env: PulseRecordEnv): ContextAgentsConfig {
  try { const j = JSON.parse(env.CONTEXT_AGENTS ?? '{}') as Partial<ContextAgentsConfig>; return { ...(j.town ? { town: j.town } : {}), estates: j.estates ?? {} }; } catch { return { estates: {} }; }
}

export type RecordReadiness = { ready: true; agents: string[] } | { ready: false; reason: string };
export function pulseRecordReadiness(env: PulseRecordEnv): RecordReadiness {
  if (!env.VAULT_URL) return { ready: false, reason: 'VAULT_URL unset' };
  if (!env.TOWN_SIGNER_KEY || !/^0x[0-9a-fA-F]{64}$/.test(env.TOWN_SIGNER_KEY)) return { ready: false, reason: 'TOWN_SIGNER_KEY unset' };
  const cfg = contextAgents(env);
  const names = [...(cfg.town ? [cfg.town] : []), ...Object.values(cfg.estates)];
  if (!names.length) return { ready: false, reason: 'CONTEXT_AGENTS names no context agent (spec 436 §5.5 T1: charter faith-town.workspace / faith-estate.workspace)' };
  let creds: Record<string, { grant?: unknown; leaf?: unknown }>;
  try { creds = JSON.parse(contextAgentCredentialsRaw(env) || '{}'); } catch { return { ready: false, reason: 'CONTEXT_AGENT_CREDENTIALS is not JSON (all parts joined)' }; }
  const missing = names.filter((n) => !isWireDoc(creds[n]?.grant) || !isWireDoc(creds[n]?.leaf));
  if (missing.length) return { ready: false, reason: `no vault credentials for ${missing.join(', ')} (T2: the steward issues the grant + leaf)` };
  return { ready: true, agents: names };
}

/** The day's rollup: the latest sample per source on that day plus how many samples were taken — counts, never a person. */
export function dayRollup(samples: PulseSampleV1[], day: string, town?: TownManifest, infraRows: InfraRowV1[] = []): { type: 'ap.town-pulse.v1'; day: string; samples: number; services: Record<string, { samples: number; up: number }>; chain: unknown; inference: unknown; estates: Record<string, unknown>; pulse?: unknown } {
  const onDay = samples.filter((s) => s.at.startsWith(day));
  // Spec 437 §5 — the day's infra status per resource, its cost rows, cost per completed run and the unattributed list, lag labels intact
  // (no series: the record is the day's word, the DO keeps the curve).
  const perf = town ? readPerformance(town, samples, infraRows, { window: '24h', nowMs: Date.parse(`${day}T23:59:59.999Z`), detail: true }) : null;
  const pulse = perf ? { infrastructure: perf.infrastructure.map((r) => ({ platform: r.platform, account: r.account, resource: r.resource, kind: r.kind, owner: r.owner, status: r.latest?.status ?? 'unknown', ok: r.latest?.ok ?? false, asOf: r.latest?.asOf ?? null, lagClass: r.latest?.lagClass ?? null, metrics: r.latest?.metrics ?? {} })), cost: perf.cost.map((c) => ({ ...c, days: c.days.filter((d) => d.day === day) })).filter((c) => c.days.length), costPerCompletedRun: perf.costPerCompletedRun, unattributed: perf.unattributed, sources: perf.sources, complete: perf.complete } : undefined;
  const services: Record<string, { samples: number; up: number }> = {};
  for (const s of onDay.filter((x) => x.kind === 'service')) { const c = services[s.id] ?? { samples: 0, up: 0 }; c.samples += 1; if (s.ok) c.up += 1; services[s.id] = c; }
  const latest = (kind: PulseSampleV1['kind'], id?: string) => { const xs = onDay.filter((x) => x.kind === kind && x.ok && (!id || x.id === id)); return xs.length ? xs[xs.length - 1]!.payload : null; };
  const estates: Record<string, unknown> = {};
  for (const s of onDay.filter((x) => x.kind === 'estate' && x.ok)) estates[s.id] = s.payload;
  return { type: 'ap.town-pulse.v1', day, samples: onDay.length, services, chain: latest('chain'), inference: latest('inference'), estates, ...(pulse ? { pulse } : {}) };
}

/** Write one record into one context agent's vault as that agent. `{ ok }` or the vault's reason — never silent. */
export async function writeContextRecord(env: PulseRecordEnv, agentName: string, recordType: string, data: unknown, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { ok: false; error: string }> {
  const ready = pulseRecordReadiness(env);
  if (!ready.ready) return { ok: false, error: ready.reason };
  const creds = (JSON.parse(contextAgentCredentialsRaw(env)) as Record<string, { grant: WireDoc; leaf: WireDoc }>)[agentName];
  if (!creds) return { ok: false, error: `no credentials for ${agentName}` };
  const grant = toDelegation(creds.grant), leaf = toDelegation(creds.leaf);
  const signer = privateKeyToAccount(env.TOWN_SIGNER_KEY as Hex);
  if (signer.address.toLowerCase() !== leaf.delegate.toLowerCase()) return { ok: false, error: `the signer key is ${signer.address}, ${agentName}'s leaf names ${leaf.delegate}` };
  const agent = grant.delegator.toLowerCase() as Address;
  const audience = env.VAULT_AUDIENCE ?? 'urn:mcp:server:person';
  const signDigest = async (d: Hex): Promise<Hex> => signer.sign({ hash: d });
  try {
    const { token } = await mintDelegationToken({ iss: agentName, aud: audience, sub: agent, delegation: grant, sessionKeyAddress: leaf.delegate, sessionDelegation: leaf, usageLimit: 1, ttlSeconds: 300 } as never, async (message: string) => signDigest(hashMessage(message)));
    const now = Date.now();
    const toolArgs = { recordType, data };
    // THE PROOF IS SIGNED OVER WHAT THE SERVER RECOMPUTES. `withDelegation` strips `token`,
    // `quorumProof` and `invocationProof` from the handler's input and hashes THE REST — and this door
    // hands it `{ token, invocationProof, args }`, so the rest is `{ args }`, never the args alone.
    // Signing `toolArgs` gave `arguments_mismatch`, surfaced only as a flat 401 `invalid_invocation_proof`.
    const invocationProof = await buildInvocationProof({ chainId: Number(env.CHAIN_ID ?? '0'), audience, principal: agent, sessionKey: leaf.delegate, operation: 'set_vault_record', args: { args: toolArgs }, rawDelegationToken: token, requestId: crypto.randomUUID(), issuedAt: now, expiresAt: now + 30_000, sign: signDigest } as never);
    const res = await fetchImpl(`${env.VAULT_URL!.replace(/\/$/, '')}/mcp/native`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ token, invocationProof, tool: 'set_vault_record', args: toolArgs }) });
    const out = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; code?: string; detail?: string };
    return res.ok && out.ok ? { ok: true } : { ok: false, error: `vault refused ${recordType} for ${agentName}: ${out.error ?? out.code ?? res.status}${out.detail ? ` (${out.detail})` : ''}` };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

/** The daily pass: the town's rollup to the town agent, each estate's slice to its estate agent. Returns what landed and what did not. */
export async function recordDay(env: PulseRecordEnv, samples: PulseSampleV1[], day: string, fetchImpl: typeof fetch = fetch, town?: TownManifest, infraRows: InfraRowV1[] = []): Promise<Array<{ agent: string; recordType: string; ok: boolean; error?: string }>> {
  const cfg = contextAgents(env);
  const roll = dayRollup(samples, day, town, infraRows);
  const out: Array<{ agent: string; recordType: string; ok: boolean; error?: string }> = [];
  if (cfg.town) { const r = await writeContextRecord(env, cfg.town, `pulse.day:${day}`, roll, fetchImpl); out.push({ agent: cfg.town, recordType: `pulse.day:${day}`, ok: r.ok, ...(r.ok ? {} : { error: r.error }) }); }
  for (const [estate, agent] of Object.entries(cfg.estates)) {
    const p = roll.pulse as { infrastructure?: Array<{ owner: { kind: string; id: string } | null }>; cost?: Array<{ owner: { kind: string; id: string } | null }>; costPerCompletedRun?: Record<string, unknown> } | undefined;
    const mine = (o: { kind: string; id: string } | null) => o?.kind === 'estate' && o.id === estate;
    const slice = { type: 'ap.town-pulse.v1', day, estate, samples: roll.samples, heartbeat: roll.estates[estate] ?? null, chain: roll.chain, inference: roll.inference, ...(p ? { pulse: { infrastructure: (p.infrastructure ?? []).filter((r) => mine(r.owner)), cost: (p.cost ?? []).filter((c) => mine(c.owner)), costPerCompletedRun: p.costPerCompletedRun?.[estate] ?? null } } : {}) };
    const r = await writeContextRecord(env, agent, `pulse.day:${day}`, slice, fetchImpl);
    out.push({ agent, recordType: `pulse.day:${day}`, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
  }
  return out;
}
