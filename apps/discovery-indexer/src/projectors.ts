// Facet projectors — the extension point for "every on-chain datum that relates to a Smart Agent".
//
// Each projector reads ONE on-chain source for a given SA and emits an ontology-shaped, SHACL-tagged
// facet. The indexer runs ALL projectors per agent and merges their facets into a single A-box node keyed
// by the SA. Adding a source = drop a FacetProjector here; the pipeline, store, and UI are unchanged.

import { keccak256, toBytes, type Address, type Hex, type PublicClient } from 'viem';
import { RESOLVER_ABI, REGISTRY_ABI, REGISTRY_STATUS, PROFILE_RESOLVER_ABI, RELATIONSHIP_ABI, EDGE_STATUS } from './abi.js';
import { PREDICATE, SHAPE, OFFERING_CLASS, offeringIri } from './ontology.js';
import type { ProjectedChildNode, ProjectedFacet } from './store.js';

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

/** One offering as served by a service host's public `GET /offerings` card (spec 286 / service-agent
 *  `projectOfferings`). We type only the fields we project; unknown fields are ignored. */
interface CardOffering {
  agentId?: string; skillId?: string; version?: string; name?: string; description?: string;
  effect?: string; exposure?: string; family?: string; requiredCapabilities?: string[];
  hasInputSchema?: boolean; status?: string;
}
interface OfferingsCard { ok?: boolean; agentId?: string; view?: string; observedAt?: number; offerings?: CardOffering[] }

const CRAWL_TIMEOUT_MS = 5000;
/** sha256 of the raw card body (provenance digest). Web Crypto is available in the Worker (nodejs_compat)
 *  + Node 20 runtimes the indexer runs in. */
async function digestOf(body: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
  return 'sha256:' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Offerings facet (spec 286, ADR-0040 amended) — crawl the agent's PUBLIC A2A card and project each public
 *  skill as a first-class Offering CHILD node, typed host-asserted + carrying provenance (sourceEndpoint /
 *  observedAt / cardDigest). Single-tenant hosts serve exactly one SA, so we fetch `<a2aEndpoint>/offerings`
 *  with NO tenant param and REQUIRE the host's self-reported agentId to equal the SA we're crawling (a host
 *  may not project offerings for a different SA). PUBLIC view only — private/operational skills are never
 *  fetched, never indexed. A failed/absent/foreign crawl returns empty (present:false) — never a fallback
 *  to a second source (ADR-0013). */
const offerings: FacetProjector = {
  kind: 'offerings',
  async project({ client, profileResolver, sa, chainId }): Promise<ProjectedFacet> {
    const empty = (pending?: string): ProjectedFacet => ({ kind: 'offerings', present: false, shapeIri: SHAPE.Offering, conforms: true, data: {}, children: [], pending });
    const a2a = (await client.readContract({ address: profileResolver, abi: PROFILE_RESOLVER_ABI, functionName: 'getStringProperty', args: [sa, pred('a2aEndpoint')] }).catch(() => '')) as string;
    if (!a2a) return empty();
    const url = `${a2a.replace(/\/$/, '')}/offerings?view=public`;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS) });
      if (!res.ok) return empty(`crawl ${url} → HTTP ${res.status}`);
      const text = await res.text();
      const card = JSON.parse(text) as OfferingsCard;
      // Single-tenant trust check: the host must claim exactly this SA, or we don't index its offerings.
      if (card.agentId && card.agentId.toLowerCase() !== sa.toLowerCase()) {
        return empty(`crawl ${url} → agentId ${card.agentId} ≠ ${sa} (foreign-SA card; not indexed)`);
      }
      const list = Array.isArray(card.offerings) ? card.offerings : [];
      const observedAt = typeof card.observedAt === 'number' ? card.observedAt : Math.floor(Date.now() / 1000);
      const cardDigest = await digestOf(text);
      const children: ProjectedChildNode[] = list.filter((o) => o.skillId).map((o) => {
        const data: Record<string, string | number | string[]> = {
          [PREDICATE.skillId]: o.skillId!,
          [PREDICATE.sourceEndpoint]: a2a,
          [PREDICATE.observedAt]: observedAt,
          [PREDICATE.cardDigest]: cardDigest,
        };
        if (o.version) data[PREDICATE.offeringVersion] = o.version;
        if (o.name) data[PREDICATE.offeringName] = o.name;
        if (o.description) data[PREDICATE.description] = o.description;
        if (o.effect) data[PREDICATE.effect] = o.effect;
        if (o.exposure) data[PREDICATE.exposure] = o.exposure;
        if (o.family) data[PREDICATE.offeringFamily] = o.family;
        if (typeof o.hasInputSchema === 'boolean') data[PREDICATE.hasInputSchema] = String(o.hasInputSchema);
        if (o.status) data[PREDICATE.offeringStatus] = o.status;
        if (o.requiredCapabilities?.length) data[PREDICATE.requiredCapability] = o.requiredCapabilities;
        return { iri: offeringIri(chainId, sa, o.skillId!), type: OFFERING_CLASS, linkPredicate: PREDICATE.hasOffering, data };
      });
      return { kind: 'offerings', present: children.length > 0, shapeIri: SHAPE.Offering, conforms: true, data: { [PREDICATE.sourceEndpoint]: a2a, [PREDICATE.observedAt]: observedAt }, children };
    } catch (e) {
      return empty(`crawl ${url} → ${String((e as Error)?.message ?? e)}`);
    }
  },
};

/** The projector registry — every PUBLIC source that relates to a Smart Agent (on-chain + the agent's own
 *  public A2A card, ADR-0040 amended). Extend here. */
export const PROJECTORS: FacetProjector[] = [naming, profile, registry, relationship, attestation, offerings];
