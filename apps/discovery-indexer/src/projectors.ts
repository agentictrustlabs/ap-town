// Facet projectors — the extension point for "every on-chain datum that relates to a Smart Agent".
//
// Each projector reads ONE on-chain source for a given SA and emits an ontology-shaped, SHACL-tagged
// facet. The indexer runs ALL projectors per agent and merges their facets into a single A-box node keyed
// by the SA. Adding a source = drop a FacetProjector here; the pipeline, store, and UI are unchanged.

import { keccak256, toBytes, type Address, type Hex, type PublicClient } from 'viem';
import { RESOLVER_ABI, REGISTRY_ABI, REGISTRY_STATUS, PROFILE_RESOLVER_ABI, RELATIONSHIP_ABI, EDGE_STATUS } from './abi.js';
import { PREDICATE, SHAPE } from './ontology.js';
import type { ProjectedFacet } from './store.js';

void RESOLVER_ABI;

/** A pre-scanned attestation (from the one Attested-log sweep), grouped by subject. */
export interface AttestationHit { uid: Hex; credentialType: Hex; issuer: Address; valid: boolean }

export interface ProjectCtx {
  client: PublicClient;
  chainId: number;
  sa: Address;
  name: string | null;
  node: Hex;
  resolver: Address;
  registry: Address;
  profileResolver: Address;
  relationship: Address;
  discoveryRegistryId: string;
  /** subject(lowercased) → attestations, pre-scanned once by the indexer. */
  attestations: Map<string, AttestationHit[]>;
}

export interface FacetProjector {
  kind: string;
  project(ctx: ProjectCtx): Promise<ProjectedFacet>;
}

const ZERO32 = `0x${'00'.repeat(32)}`;
// On-chain profile predicate id. AgentProfileResolver writes under keccak256("atl:<key>")
// (AgentProfilePredicates.ATL_*); the bare keccak256("<key>") used before never matched, so profile facets
// silently never projected. Prefix the canonical `atl:` namespace so reads hit the stored predicate.
const pred = (key: string) => keccak256(toBytes(`atl:${key}`));
const sha = (b: Hex) => `sha256:${b.slice(2)}`;
const urn = (s: string) => keccak256(toBytes(s));

/** Naming facet — canonical name + node (always present; it's how we found the agent). */
const naming: FacetProjector = {
  kind: 'naming',
  async project({ name, node }) {
    return { kind: 'naming', present: true, shapeIri: SHAPE.CanonicalAgentId, conforms: !!name, data: { [PREDICATE.name]: name, [PREDICATE.node]: node } };
  },
};

/** Profile facet — on-chain profile properties via AgentProfileResolver.getStringProperty(SA, predicate). */
const PROFILE_KEYS: Array<[string, string]> = [
  ['authOrigin', PREDICATE.authOrigin],
  ['displayName', PREDICATE.displayName],
  ['description', PREDICATE.description],
  ['skills', PREDICATE.skills], // spec 282 — publicly-asserted skill labels (atl:skills)
  ['a2aEndpoint', PREDICATE.a2aEndpoint], // spec 280 — the agent's A2A host (its live skills card)
  ['mcpEndpoint', PREDICATE.mcpEndpoint],
];
const profile: FacetProjector = {
  kind: 'profile',
  async project({ client, profileResolver, sa }) {
    const data: Record<string, unknown> = {};
    for (const [key, iri] of PROFILE_KEYS) {
      const v = (await client.readContract({ address: profileResolver, abi: PROFILE_RESOLVER_ABI, functionName: 'getStringProperty', args: [sa, pred(key)] }).catch(() => '')) as string;
      if (v) data[iri] = v;
    }
    const present = Object.keys(data).length > 0;
    return { kind: 'profile', present, shapeIri: SHAPE.AgentProfile, conforms: present, data };
  },
};

/** Registry facet — the AgentRegistryBase entry, if onboarding has written one. */
const registry: FacetProjector = {
  kind: 'registry',
  async project({ client, registry: reg, discoveryRegistryId, name }) {
    if (!name) return { kind: 'registry', present: false, shapeIri: SHAPE.RegistryEntry, conforms: true, data: {} };
    const regId = urn(discoveryRegistryId);
    const entryId = urn(`urn:ap:registry-entry:${name}`);
    try {
      const e = (await client.readContract({ address: reg, abi: REGISTRY_ABI, functionName: 'getEntry', args: [regId, entryId] })) as { cardHash: Hex; bindingProofHash: Hex; claimsRoot: Hex; status: number; expiresAt: bigint };
      const live = (await client.readContract({ address: reg, abi: REGISTRY_ABI, functionName: 'isActive', args: [regId, entryId] })) as boolean;
      return {
        kind: 'registry', present: true, shapeIri: SHAPE.RegistryEntry,
        conforms: e.cardHash !== ZERO32 && e.bindingProofHash !== ZERO32 && !!REGISTRY_STATUS[e.status],
        data: { [PREDICATE.lifecycleStatus]: REGISTRY_STATUS[e.status] ?? 'none', [PREDICATE.cardHash]: sha(e.cardHash), [PREDICATE.bindingProofHash]: sha(e.bindingProofHash), [PREDICATE.claimsRoot]: sha(e.claimsRoot), [PREDICATE.expiresAt]: Number(e.expiresAt) || null, live },
      };
    } catch {
      return { kind: 'registry', present: false, shapeIri: SHAPE.RegistryEntry, conforms: true, data: {} };
    }
  },
};

/** Relationship facet — trust-fabric edges where the SA is subject or object (per-SA views, no log scan). */
const relationship: FacetProjector = {
  kind: 'relationship',
  async project({ client, relationship: rel, sa }) {
    const edgeStatus = (s: number) => EDGE_STATUS[s] ?? 'unknown';
    const collect = async (fn: 'getEdgesBySubject' | 'getEdgesByObject', dir: string) => {
      const ids = (await client.readContract({ address: rel, abi: RELATIONSHIP_ABI, functionName: fn, args: [sa] }).catch(() => [] as readonly Hex[])) as readonly Hex[];
      return Promise.all([...ids].map(async (id) => {
        const e = (await client.readContract({ address: rel, abi: RELATIONSHIP_ABI, functionName: 'getEdge', args: [id] })) as { subject: Address; object_: Address; relationshipType: Hex; status: number };
        return { [PREDICATE.edgeDirection]: dir, [PREDICATE.relationshipType]: e.relationshipType, [PREDICATE.relObject]: dir === 'subject' ? e.object_ : e.subject, [PREDICATE.edgeStatus]: edgeStatus(e.status) };
      }));
    };
    const edges = [...(await collect('getEdgesBySubject', 'subject')), ...(await collect('getEdgesByObject', 'object'))];
    return { kind: 'relationship', present: edges.length > 0, shapeIri: SHAPE.RegistryEntry, conforms: true, data: { 'ap:edges': edges, 'ap:edgeCount': edges.length } };
  },
};

/** Attestation facet — EAS-aligned attestations where the SA is subject (incl. skill/geo/agreement claims
 *  as credentialType). Read from the indexer's single pre-scanned Attested-log sweep. */
const attestation: FacetProjector = {
  kind: 'attestation',
  async project({ attestations, sa }) {
    const hits = attestations.get(sa.toLowerCase()) ?? [];
    const data = {
      'ap:attestationCount': hits.length,
      'ap:attestations': hits.map((h) => ({ [PREDICATE.attestationUid]: h.uid, [PREDICATE.credentialType]: h.credentialType, [PREDICATE.attestationIssuer]: h.issuer, [PREDICATE.attestationValid]: h.valid })),
    };
    return { kind: 'attestation', present: hits.length > 0, shapeIri: null, conforms: true, data };
  },
};

/** The projector registry — every on-chain source that relates to a Smart Agent. Extend here. */
export const PROJECTORS: FacetProjector[] = [naming, profile, registry, relationship, attestation];
