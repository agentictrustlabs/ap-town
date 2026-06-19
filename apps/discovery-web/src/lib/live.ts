// Live (Base Sepolia) reader — assembles an agent from the public on-chain facets that are AVAILABLE,
// keyed by the Smart Agent address: agent-naming (name), AgentRegistryBase (registry entry, if onboarded),
// and best-effort profile. "Registry info comes from on-chain + public data that is available" — the
// registry ENTRY is the discovery anchor, but an agent surfaces from whatever public data exists, so a
// named agent appears before its entry is written (registration is part of onboarding).
//
// This is the INTERIM reference read path: direct readContract over SPECIFIC known agents (no enumeration
// — that's the indexer's job; ADR-0012 forbids log scans in product reads). The scalable path is the
// external indexer → read store → edge-cached discovery API (see docs/architecture/discovery-scale-architecture.md).
// The UI can still client-side RE-VERIFY any single agent from cited facts, so this read path is untrusted.

import { createPublicClient, http, keccak256, encodePacked, toBytes, type Abi, type Address, type Hex } from 'viem';
import { urnToBytes32 } from '@agenticprimitives/registry-kit';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/base-sepolia';
import type { Sha256 } from '@agenticprimitives/agent-profile';

const RPC_URL = (import.meta.env?.VITE_RPC_URL as string | undefined) ?? 'https://sepolia.base.org';
const REGISTRY = CONTRACTS.agentRegistryBase as Address;
const RESOLVER = CONTRACTS.agentNameUniversalResolver as Address;

const client = createPublicClient({ transport: http(RPC_URL) });

// Only the read views the UI needs (the registry-kit ABI is write/event-only by design; the app declares
// the view fragments it reads — keeps registry-kit verify-only, ADR-0038).
const REGISTRY_VIEW_ABI = [
  {
    type: 'function', name: 'getEntry', stateMutability: 'view',
    inputs: [{ name: 'registryId', type: 'bytes32' }, { name: 'entryId', type: 'bytes32' }],
    outputs: [{
      name: '', type: 'tuple', components: [
        { name: 'subjectAgent', type: 'address' }, { name: 'cardHash', type: 'bytes32' },
        { name: 'bindingProofHash', type: 'bytes32' }, { name: 'claimsRoot', type: 'bytes32' },
        { name: 'status', type: 'uint8' }, { name: 'registeredAtBucket', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
      ],
    }],
  },
  {
    type: 'function', name: 'isActive', stateMutability: 'view',
    inputs: [{ name: 'registryId', type: 'bytes32' }, { name: 'entryId', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi;

const RESOLVER_ABI = [
  { type: 'function', name: 'resolveName', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ name: '', type: 'address' }] },
  { type: 'function', name: 'reverseResolveString', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ name: '', type: 'string' }] },
] as const satisfies Abi;

const ZERO = '0x0000000000000000000000000000000000000000';
const STATUS = ['none', 'active', 'suspended', 'revoked'] as const;

/** ENS-style recursive namehash (matches AgentNameRegistry on-chain + the agent-naming SDK). */
function namehash(name: string): Hex {
  let node = `0x${'00'.repeat(32)}` as Hex;
  if (!name) return node;
  const labels = name.split('.');
  for (let i = labels.length - 1; i >= 0; i--) {
    node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, keccak256(toBytes(labels[i]!))]));
  }
  return node;
}

function toSha256(b: Hex): Sha256 {
  return `sha256:${b.slice(2)}` as Sha256;
}

/** The discovery registry + the agents the UI watches. entryId convention: `urn:ap:registry-entry:<name>`,
 *  so onboarding writes a deterministic id the explorer already tracks. The smoke-test entry (already
 *  on-chain) proves the live read path end to end today. */
export const LIVE_REGISTRY_ID = 'urn:ap:registry:impact-agents';
export interface WatchedAgent { name: string; registryId: string; entryId: string; note?: string }
export const WATCHED: WatchedAgent[] = [
  { name: 'lbsb.impact', registryId: LIVE_REGISTRY_ID, entryId: 'urn:ap:registry-entry:lbsb.impact', note: 'Licensed-scripture provider (external Bible app, KMS-custodied).' },
  { name: 'fbsb.impact', registryId: LIVE_REGISTRY_ID, entryId: 'urn:ap:registry-entry:fbsb.impact', note: 'Free-scripture provider (external Bible app, KMS-custodied).' },
  { name: 'smoke-test demo', registryId: 'urn:ap:registry:smoke-test', entryId: 'urn:ap:registry-entry:smoke-1', note: 'The deploy-verification entry — proves the live read path now.' },
];

export interface LiveEntryView {
  subjectAgent: Address;
  cardHash: Sha256;
  bindingProofHash: Sha256;
  claimsRoot: Sha256;
  status: (typeof STATUS)[number];
  expiresAt: number;
  live: boolean;
}

export interface LiveAgent {
  watched: WatchedAgent;
  /** Resolved Smart Agent address (from agent-naming), if the name resolves. */
  subjectAgent: Address | null;
  /** Canonical reverse-resolved name (the SA's own forced-unique name). */
  reverseName: string | null;
  /** The registry entry, if onboarding has written one. null = named + on-chain, not yet listed. */
  entry: LiveEntryView | null;
  error?: string;
}

export const LIVE = { registry: REGISTRY, resolver: RESOLVER, rpc: RPC_URL, chainId: 84532 };

async function readAgent(w: WatchedAgent): Promise<LiveAgent> {
  try {
    const subjectAgent = (await client.readContract({
      address: RESOLVER, abi: RESOLVER_ABI, functionName: 'resolveName', args: [namehash(w.name)],
    }).catch(() => ZERO)) as Address;
    const resolved = subjectAgent && subjectAgent !== ZERO ? subjectAgent : null;

    const reverseName = resolved
      ? ((await client.readContract({ address: RESOLVER, abi: RESOLVER_ABI, functionName: 'reverseResolveString', args: [resolved] }).catch(() => '')) as string) || null
      : null;

    const regId = urnToBytes32(w.registryId as `urn:ap:registry:${string}`);
    const entryId = urnToBytes32(w.entryId as `urn:ap:registry-entry:${string}`);
    let entry: LiveEntryView | null = null;
    try {
      const e = (await client.readContract({ address: REGISTRY, abi: REGISTRY_VIEW_ABI, functionName: 'getEntry', args: [regId, entryId] })) as {
        subjectAgent: Address; cardHash: Hex; bindingProofHash: Hex; claimsRoot: Hex; status: number; registeredAtBucket: bigint; expiresAt: bigint;
      };
      const live = (await client.readContract({ address: REGISTRY, abi: REGISTRY_VIEW_ABI, functionName: 'isActive', args: [regId, entryId] })) as boolean;
      entry = {
        subjectAgent: e.subjectAgent,
        cardHash: toSha256(e.cardHash),
        bindingProofHash: toSha256(e.bindingProofHash),
        claimsRoot: toSha256(e.claimsRoot),
        status: STATUS[e.status] ?? 'none',
        expiresAt: Number(e.expiresAt),
        live,
      };
    } catch {
      entry = null; // EntryNotFound — named + on-chain, not yet listed (registration is an onboarding step)
    }

    return { watched: w, subjectAgent: resolved, reverseName, entry };
  } catch (err) {
    return { watched: w, subjectAgent: null, reverseName: null, entry: null, error: String((err as Error)?.message ?? err) };
  }
}

export function loadLive(): Promise<LiveAgent[]> {
  return Promise.all(WATCHED.map(readAgent));
}
