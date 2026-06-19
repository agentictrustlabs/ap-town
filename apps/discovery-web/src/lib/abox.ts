// The fixture discovery A-box + live verification.
//
// Every signed card + binding proof here is built with the REAL @agenticprimitives SDK functions and
// verified live in the browser — this is a reference UI, not a mock. For the demo each agent is keyed by
// a throwaway EOA minted at runtime (generatePrivateKey — NOT identity/custody) and the injected ERC-1271
// verifier does ECDSA recovery; real agents are ERC-4337 Smart Agents whose `isValidSignature` a viem
// PublicClient would satisfy instead (the verifier is injected, so that's the only swap).
// The production explorer + GraphDB indexer live in external repos (ADR-0037); this is the substrate they
// project. Reads here are over the fixture A-box; the live registry address is cited for provenance.

import { recoverAddress, sha256, toHex, type Address, type Hex } from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import {
  hashAgentCard,
  buildSignedAgentCardBundle,
  verifySignedAgentCardBundle,
  type AgentCard,
  type SignedAgentCardBundleV1,
  type Erc1271Verifier,
  type VerifySignedAgentCardResult,
} from '@agenticprimitives/agent-profile';
import {
  buildEntryBindingProof,
  verifyEntryBindingProof,
  hashBindingProofBody,
  type RegistryEntryBindingProofV1,
  type RegistryId,
  type RegistryEntryId,
  type Sha256,
  type BindingProofResult,
} from '@agenticprimitives/registry-kit';
import { CLASS, PREDICATE, SHAPE } from '@agenticprimitives/ontology';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/base-sepolia';

export const CHAIN_ID = 84532;
/** The live, deployed registry the fixture entries are modelled against (cited for provenance). */
export const REGISTRY_ADDRESS = CONTRACTS.agentRegistryBase as Address;
export const ONTOLOGY = { CLASS, PREDICATE, SHAPE };

const SHA = /^sha256:[0-9a-fA-F]{64}$/;

function sha256Of(value: unknown): Sha256 {
  return `sha256:${sha256(toHex(JSON.stringify(value))).slice(2)}` as Sha256;
}

/** Injected ERC-1271 read — demo form: ECDSA recovery against the agent's EOA address. */
export const verifier: Erc1271Verifier = {
  async verifyHash({ address, hash, signature }) {
    try {
      const recovered = await recoverAddress({ hash, signature });
      return recovered.toLowerCase() === address.toLowerCase();
    } catch {
      return false;
    }
  },
};

export type EntryStatus = 'active' | 'suspended' | 'revoked' | 'expired';

export interface ClaimDef {
  slotId: string;
  label: string;
  value: string;
}

interface AgentDef {
  slug: string;
  name: string;
  blurb: string;
  card: AgentCard;
  registryId: RegistryId;
  registryLabel: string;
  status: EntryStatus;
  claims: ClaimDef[];
  /** Demonstrate fail-closed verification: tamper the served card after signing. */
  tamper?: boolean;
  /** ISO expiry; for the `expired` fixture it is in the past. */
  expiresAt?: string;
}

const AGENT_DEFS: AgentDef[] = [
  {
    slug: 'acme-translate',
    name: 'Acme Translation',
    blurb: 'A2A translation service agent — 40 language pairs, human-in-the-loop QA.',
    card: { type: 'service', displayName: 'Acme Translation', endpoint: 'https://acme.example/a2a', description: '40 language pairs' },
    registryId: 'urn:ap:registry:a2a-services',
    registryLabel: 'A2A Services',
    status: 'active',
    claims: [
      { slotId: 'urn:ap:registry-claim-slot:capability', label: 'Capability', value: 'text-translation' },
      { slotId: 'urn:ap:registry-claim-slot:sla', label: 'SLA', value: 'p95 < 2s' },
    ],
  },
  {
    slug: 'northwind-research',
    name: 'Northwind Research',
    blurb: 'Org agent offering market-research synthesis with cited sources.',
    card: { type: 'org', displayName: 'Northwind Research', homepage: 'https://northwind.example' },
    registryId: 'urn:ap:registry:a2a-services',
    registryLabel: 'A2A Services',
    status: 'active',
    claims: [
      { slotId: 'urn:ap:registry-claim-slot:capability', label: 'Capability', value: 'research-synthesis' },
      { slotId: 'urn:ap:registry-claim-slot:domain-control', label: 'Domain control', value: 'northwind.example (proven)' },
    ],
  },
  {
    slug: 'pii-vault',
    name: 'Helios PII Vault',
    blurb: 'MCP server exposing consented personal-data tools under delegation.',
    card: { type: 'mcpServer', displayName: 'Helios PII Vault', endpoint: 'https://helios.example/mcp', verification: ['signed-url'], tools: ['read_profile', 'read_highlights'] },
    registryId: 'urn:ap:registry:mcp-data',
    registryLabel: 'MCP Data Servers',
    status: 'active',
    claims: [{ slotId: 'urn:ap:registry-claim-slot:capability', label: 'Capability', value: 'consented-pii-read' }],
  },
  {
    slug: 'stale-indexer',
    name: 'Stale Indexer',
    blurb: 'Entry whose listing has lapsed — past its expiry, so discovery treats it as inactive.',
    card: { type: 'service', displayName: 'Stale Indexer', endpoint: 'https://stale.example/a2a' },
    registryId: 'urn:ap:registry:a2a-services',
    registryLabel: 'A2A Services',
    status: 'expired',
    claims: [{ slotId: 'urn:ap:registry-claim-slot:capability', label: 'Capability', value: 'indexing' }],
    expiresAt: '2026-01-01T00:00:00Z',
  },
  {
    slug: 'spoofed-card',
    name: 'Spoofed Listing',
    blurb: 'A registry served a card that does not match its signature — verification must fail closed.',
    card: { type: 'service', displayName: 'Spoofed Listing', endpoint: 'https://spoof.example/a2a' },
    registryId: 'urn:ap:registry:a2a-services',
    registryLabel: 'A2A Services',
    status: 'active',
    claims: [{ slotId: 'urn:ap:registry-claim-slot:capability', label: 'Capability', value: 'unknown' }],
    tamper: true,
  },
];

export interface RegistryEntryView {
  registryId: RegistryId;
  registryLabel: string;
  entryId: RegistryEntryId;
  subjectAgent: Address;
  cardHash: Sha256;
  bindingProofHash: Sha256;
  claimHashes: Sha256[];
  status: EntryStatus;
  issuedAt: string;
  expiresAt?: string;
}

export interface AgentRecord {
  slug: string;
  name: string;
  blurb: string;
  cardType: string;
  claims: ClaimDef[];
  bundle: SignedAgentCardBundleV1;
  proof: RegistryEntryBindingProofV1;
  entry: RegistryEntryView;
}

const ISSUED_AT = '2026-06-18T12:00:00Z';

async function buildAgent(def: AgentDef): Promise<AgentRecord> {
  const account = privateKeyToAccount(generatePrivateKey());
  const subjectAgent = account.address as Address;
  const sign = (digest: Hex) => account.sign({ hash: digest });

  const claimHashes = def.claims.map((c) => sha256Of(c));
  const entryId = `urn:ap:registry-entry:${def.slug}` as RegistryEntryId;

  const bundle = await buildSignedAgentCardBundle(
    { card: def.card, subjectAgent, chainId: CHAIN_ID, issuedAt: ISSUED_AT, expiresAt: def.expiresAt },
    sign,
  );
  const proof = await buildEntryBindingProof(
    { registryId: def.registryId, entryId, subjectAgent, cardHash: bundle.cardHash, claimHashes, issuedAt: ISSUED_AT },
    sign,
  );
  const bindingProofHash = await hashBindingProofBody(proof);

  // A spoofed listing: the registry serves a card whose body no longer matches the signed cardHash.
  if (def.tamper) {
    bundle.card = { ...def.card, displayName: 'Acme Translation (impostor)' } as AgentCard;
  }

  return {
    slug: def.slug,
    name: def.name,
    blurb: def.blurb,
    cardType: def.card.type,
    claims: def.claims,
    bundle,
    proof,
    entry: {
      registryId: def.registryId,
      registryLabel: def.registryLabel,
      entryId,
      subjectAgent,
      cardHash: bundle.cardHash,
      bindingProofHash,
      claimHashes,
      status: def.status,
      issuedAt: ISSUED_AT,
      expiresAt: def.expiresAt,
    },
  };
}

let _abox: Promise<AgentRecord[]> | null = null;
export function loadAbox(): Promise<AgentRecord[]> {
  if (!_abox) _abox = Promise.all(AGENT_DEFS.map(buildAgent));
  return _abox;
}

// ─── Live verification + evidence path ───────────────────────────────

export interface ShapeCheck {
  shapeIri: string;
  label: string;
  ok: boolean;
}

export interface EvidencePath {
  card: VerifySignedAgentCardResult;
  binding: BindingProofResult;
  shapes: ShapeCheck[];
  shapesOk: boolean;
  /** Effective liveness, mirroring AgentRegistryBase.isActive: active AND not past expiry. */
  live: boolean;
  /** Explainable trust determination over the public evidence (NOT authority to act). */
  confidence: number;
  reasons: string[];
  // Fixture provenance (apdisc) — what the production indexer would record per query.
  graphSnapshot: string;
  inferenceProfile: string;
}

function checkShapes(rec: AgentRecord): ShapeCheck[] {
  const e = rec.entry;
  return [
    {
      shapeIri: SHAPE.RegistryEntry,
      label: 'RegistryEntry',
      ok: !!e.registryId && !!e.entryId && SHA.test(e.cardHash) && SHA.test(e.bindingProofHash) && !!e.status,
    },
    {
      shapeIri: SHAPE.SignedAgentCard,
      label: 'SignedAgentCard',
      ok: SHA.test(rec.bundle.cardHash) && !!rec.bundle.subjectAgent,
    },
    {
      shapeIri: SHAPE.RegistryEntryBindingProof,
      label: 'RegistryEntryBindingProof',
      ok: SHA.test(rec.proof.proofHash) && SHA.test(rec.proof.cardHash),
    },
  ];
}

export async function verifyEvidence(rec: AgentRecord, now = Date.now()): Promise<EvidencePath> {
  const card = await verifySignedAgentCardBundle(rec.bundle, { verifier, now });
  const binding = await verifyEntryBindingProof(rec.proof, { verifier });
  const shapes = checkShapes(rec);
  const shapesOk = shapes.every((s) => s.ok);

  const expired = !!rec.entry.expiresAt && now > Date.parse(rec.entry.expiresAt);
  const live = rec.entry.status === 'active' && !expired;

  const reasons: string[] = [];
  let confidence = 0;
  if (card.ok) { confidence += 0.4; reasons.push('Signed card verified — cardHash binds to the subject agent (ERC-1271).'); }
  else reasons.push(`Signed card FAILED verification (${card.reason}).`);
  if (binding.ok) { confidence += 0.3; reasons.push('Binding proof verified — the entry is a facet of this agent + card.'); }
  else reasons.push(`Binding proof FAILED verification (${binding.reason}).`);
  if (shapesOk) { confidence += 0.1; reasons.push('Projected node conforms to the AP SHACL shapes.'); }
  if (live) { confidence += 0.2; reasons.push('Registry entry is active and unexpired.'); }
  else reasons.push(`Entry is not live (status: ${expired ? 'expired' : rec.entry.status}).`);

  return {
    card,
    binding,
    shapes,
    shapesOk,
    live,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
    graphSnapshot: 'urn:ap:graph-snapshot:fixture-2026-06-18',
    inferenceProfile: 'urn:ap:inference-profile:rdfs+shacl@1',
  };
}

// ─── Admin-only exposure findings (ap:abox:pentest) ──────────────────

export interface ExposureFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'triaged' | 'mitigated';
  affectsSlug: string;
  title: string;
  detail: string;
}

export const EXPOSURE_FINDINGS: ExposureFinding[] = [
  {
    id: 'apsec:finding:spoofed-card-1',
    severity: 'high',
    status: 'open',
    affectsSlug: 'spoofed-card',
    title: 'Served card does not match its signed cardHash',
    detail: 'The registry served a card body whose hash differs from the SignedAgentCard. Verification fails closed (card_hash_mismatch); the listing must not be trusted or surfaced to users.',
  },
  {
    id: 'apsec:finding:stale-indexer-1',
    severity: 'low',
    status: 'triaged',
    affectsSlug: 'stale-indexer',
    title: 'Lapsed entry still resolvable',
    detail: 'Entry is past expiry but still readable on-chain. isActive() returns false; discovery must treat it as inactive. Informational — no spoofing risk.',
  },
  {
    id: 'apsec:finding:pii-vault-1',
    severity: 'medium',
    status: 'open',
    affectsSlug: 'pii-vault',
    title: 'PII-tool MCP server lacks a domain-control claim',
    detail: 'The endpoint exposes consented-PII tools but fills no domain-control claim slot. Recommend requiring a domain-control-proof membership hook on the mcp-data registry.',
  },
];
