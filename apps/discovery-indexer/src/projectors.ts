// Facet projectors — the extension point for "every on-chain datum that relates to a Smart Agent".
//
// Each projector reads ONE on-chain source for a given SA and emits an ontology-shaped, SHACL-tagged
// facet. The indexer runs ALL projectors per agent and merges their facets into a single A-box node keyed
// by the SA. Adding a source = drop a FacetProjector here; the pipeline, store, and UI are unchanged.

import { keccak256, toBytes, type Address, type Hex, type PublicClient } from 'viem';
import { RESOLVER_ABI, NAME_REGISTRY_ABI, REGISTRY_ABI, REGISTRY_STATUS, PROFILE_RESOLVER_ABI, NAME_ATTR_RESOLVER_ABI, RELATIONSHIP_ABI, EDGE_STATUS } from './abi.js';
import {
  PREDICATE, SHAPE, OFFERING_CLASS, offeringIri,
  RELATIONSHIP_EDGE_CLASS, ATTESTATION_CLASS, relationshipEdgeIri, attestationIri, relationshipTypeLabel,
} from './ontology.js';
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
  /** AgentNameRegistry — name-record storage views (registeredAt / expiry). */
  nameRegistry: Address;
  resolver: Address;
  /** AgentNameResolver attribute store (spec 280) — node-keyed a2aEndpoint/mcpEndpoint read via getString. */
  nameResolver: Address;
  registry: Address;
  profileResolver: Address;
  relationship: Address;
  discoveryRegistryId: string;
  /** subject(lowercased) → attestations, pre-scanned once by the indexer. */
  attestations: Map<string, AttestationHit[]>;
  /** Whether the Attested-log sweep actually RAN for this projection. An empty `attestations` map with
   *  `attestationsScanned: false` means "unknown", not "none" (ADR-0013) — see the attestation projector. */
  attestationsScanned: boolean;
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

/** Naming facet — canonical name + node (always present; it's how we found the agent), plus the
 *  name-record metadata off AgentNameRegistry storage (registeredAt / expiry — ADR-0040: plain
 *  on-chain views, so the KB can answer "names by registration time" without a log scan). */
const naming: FacetProjector = {
  kind: 'naming',
  async project({ client, nameRegistry, name, node }) {
    const data: Record<string, unknown> = { [PREDICATE.name]: name, [PREDICATE.node]: node };
    const registeredAt = (await client.readContract({ address: nameRegistry, abi: NAME_REGISTRY_ABI, functionName: 'registeredAt', args: [node] }).catch(() => 0n)) as bigint;
    if (registeredAt > 0n) data[PREDICATE.nameRegisteredAt] = Number(registeredAt);
    const expiry = (await client.readContract({ address: nameRegistry, abi: NAME_REGISTRY_ABI, functionName: 'expiry', args: [node] }).catch(() => 0n)) as bigint;
    if (expiry > 0n) data[PREDICATE.nameExpiry] = Number(expiry);
    return { kind: 'naming', present: true, shapeIri: SHAPE.CanonicalAgentId, conforms: !!name, data };
  },
};

// Profile properties keyed by SA on the AgentProfileResolver (getStringProperty).
//
// G6 — `authOrigin` is NOT here. `packages/agent-profile/src/constants.ts` defines
// AUTH_ORIGIN = keccak256("authOrigin") with NO `atl:` prefix (spec 217), while `pred()` below prefixes
// everything, so this projector read keccak256("atl:authOrigin") — a key nothing has ever written. Spec 229
// states authOrigin is deliberately NOT written on-chain, so the predicate is also unregistered in
// OntologyTermRegistry and the write path reverts PredicateNotActive(). BOTH sides are therefore empty on
// chain: there is no data under either key to preserve, and the facet-registries doc's two options are
// "drop it from PROFILE_KEYS, or align the constant and register the term — but pick one". Dropping the
// read is the side with no on-chain data and no governance cost, so that is what is done here. The SDK
// constant is left untouched (it is spec-217 correct and not owned by this app).
const PROFILE_KEYS: Array<[string, string]> = [
  ['displayName', PREDICATE.displayName],
  ['description', PREDICATE.description],
  ['skills', PREDICATE.skills], // spec 282 — publicly-asserted skill labels (atl:skills)
  // G2/G3/G4 — owner-asserted discovery-ranking facets on the atl:skills rail. Registered on-chain by
  // packages/contracts/script/AddDiscoveryPredicates.s.sol; unregistered predicates revert on write, so
  // these three are read paths for data that CAN now be written (the G5 rule, applied forward).
  ['languages', PREDICATE.languages],   // BCP-47, comma-separated, lowercase
  ['regions', PREDICATE.regions],       // ISO 3166 / GeoFeatureRegistry codes, comma-separated, uppercase
  ['focusAreas', PREDICATE.focusAreas], // subject-domain labels, comma-separated
];
// Endpoint records keyed by NODE on the AgentNameResolver attribute store (getString) — spec 280. These
// live on a DIFFERENT resolver than the profile properties (the connect ceremony writes them via
// setStringAttribute(node, …)); reading them off the profileResolver/by-address silently returned nothing.
const NAME_ATTR_KEYS: Array<[string, string]> = [
  ['a2aEndpoint', PREDICATE.a2aEndpoint], // the agent's A2A host (its live skills card + offering crawl source)
  ['mcpEndpoint', PREDICATE.mcpEndpoint],
  ['appContext', PREDICATE.appContext],
  ['orgRole', PREDICATE.orgRole],
  ['serviceUrl', PREDICATE.serviceUrl],
  ['siteUrl', PREDICATE.siteUrl],
  ['description', PREDICATE.description],
];
/** Profile facet — profile properties (AgentProfileResolver, SA-keyed) + the spec-280 endpoint records
 *  (AgentNameResolver, node-keyed). */
const profile: FacetProjector = {
  kind: 'profile',
  async project({ client, profileResolver, nameResolver, sa, node }) {
    const data: Record<string, unknown> = {};
    for (const [key, iri] of PROFILE_KEYS) {
      const v = (await client.readContract({ address: profileResolver, abi: PROFILE_RESOLVER_ABI, functionName: 'getStringProperty', args: [sa, pred(key)] }).catch(() => '')) as string;
      if (v) data[iri] = v;
    }
    for (const [key, iri] of NAME_ATTR_KEYS) {
      const v = (await client.readContract({ address: nameResolver, abi: NAME_ATTR_RESOLVER_ABI, functionName: 'getString', args: [node, pred(key)] }).catch(() => '')) as string;
      if (v) data[iri] = v;
    }
    // Spec 331 W2 — project the CAPABILITY IDS out of atl:skills as their own triples.
    //
    // LENIENT by design: any CURIE-shaped token becomes a declaration, WITHOUT checking that a
    // definition for it exists in SkillDefinitionRegistry. That is spec 331 §9 open question 6,
    // answered here, and the reason is that strictness would buy nothing and cost correctness:
    //
    //   - It buys nothing, because the QUERY side is already strict. A matcher only ever looks for
    //     ids it resolved out of the catalog, so an id no catalog contains can never be matched —
    //     projecting it is inert, exactly like the unreferenced definition W0 tolerates.
    //   - It costs correctness, because the check is a network read. A transient RPC failure would
    //     be indistinguishable from "this agent does not declare that capability", and would
    //     silently un-declare a capability at rank time. That is the ADR-0013 silent-degradation
    //     failure, introduced into the one path this spec exists to make trustworthy.
    //
    // It also decouples the waves: an advisor's declaration projects correctly whether or not the
    // steward has published the definition yet.
    const skills = data[PREDICATE.skills];
    if (typeof skills === 'string') {
      const ids = skills.split(',').map((s) => s.trim()).filter((s) => /^[a-z][a-z0-9]*:[a-z0-9][a-z0-9-]*$/i.test(s));
      if (ids.length) data[PREDICATE.declaresCapabilityId] = [...new Set(ids)];
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

/** Relationship facet — trust-fabric edges where the SA is subject or object (per-SA views, no log scan).
 *
 *  G1: this used to emit `{ 'ap:edges': [ … ], 'ap:edgeCount': n }` — a CURIE key with an array value —
 *  which failed the SPARQL store's IRI-key + scalar-value gate on BOTH counts, so the entire trust fabric
 *  was silently dropped and only ever appeared in the dev JSON-LD store. Edges are now first-class CHILD
 *  NODES (the same `ProjectedChildNode` mechanism the offerings facet uses): each edge is its own subject,
 *  typed `aptrust:TrustGraphEdge` (an EXISTING term from tbox/trust.ttl), carrying the counterparty,
 *  relationship type, direction and status as separate triples — so a SPARQL consumer can filter on
 *  "?a ap:hasRelationship [ ap:relationshipType 'RECOMMENDS' ; ap:edgeStatus 'active' ]" rather than
 *  parsing a stringified blob. The agent itself additionally carries flat, denormalized scalars
 *  (edgeCount / activeEdgeCount) and one `ap:relatedAgent` triple per counterparty, for cheap ranking. */
const relationship: FacetProjector = {
  kind: 'relationship',
  async project({ client, relationship: rel, sa, chainId }): Promise<ProjectedFacet> {
    const edgeStatus = (s: number) => EDGE_STATUS[s] ?? 'unknown';
    // NO .catch here (ADR-0013): an RPC failure must surface as UNKNOWN (the indexer wraps project() and
    // returns present:false with no `children`, so the store PRESERVES existing edges) — never as "this
    // agent has zero relationships", which would wipe the real trust fabric on a transient read error.
    const collect = async (fn: 'getEdgesBySubject' | 'getEdgesByObject', dir: 'subject' | 'object') => {
      const ids = (await client.readContract({ address: rel, abi: RELATIONSHIP_ABI, functionName: fn, args: [sa] })) as readonly Hex[];
      return Promise.all([...ids].map(async (id) => {
        const e = (await client.readContract({ address: rel, abi: RELATIONSHIP_ABI, functionName: 'getEdge', args: [id] })) as { edgeId: Hex; subject: Address; object_: Address; relationshipType: Hex; status: number };
        return {
          id, dir, subject: e.subject.toLowerCase(), object: e.object_.toLowerCase(),
          counterparty: (dir === 'subject' ? e.object_ : e.subject).toLowerCase(),
          type: e.relationshipType, status: edgeStatus(e.status),
        };
      }));
    };
    const edges = [...(await collect('getEdgesBySubject', 'subject')), ...(await collect('getEdgesByObject', 'object'))];
    // The edge node's IRI comes from the deterministic ON-CHAIN edgeId, so both endpoints converge on one
    // subject — its triples are therefore stated ABSOLUTELY (subject/object), never relative to the side
    // being projected. The endpoint-relative view (counterparty + direction) lives on the agent.
    const children: ProjectedChildNode[] = edges.map((e) => {
      const data: Record<string, string | number | string[]> = {
        [PREDICATE.edgeId]: e.id,
        [PREDICATE.relationshipTypeId]: e.type,
        [PREDICATE.edgeSubject]: e.subject,
        [PREDICATE.edgeObject]: e.object,
        [PREDICATE.edgeStatus]: e.status,
      };
      // Only the six governor-registered well-known types get a human label; an unknown type projects its
      // raw bytes32 id alone rather than a guess (ADR-0013).
      const label = relationshipTypeLabel(e.type);
      if (label) data[PREDICATE.relationshipType] = label;
      return { iri: relationshipEdgeIri(chainId, e.id), type: RELATIONSHIP_EDGE_CLASS, linkPredicate: PREDICATE.hasRelationship, data };
    });
    const active = edges.filter((e) => e.status === 'active');
    return {
      kind: 'relationship', present: edges.length > 0, shapeIri: null, conforms: true,
      data: {
        [PREDICATE.edgeCount]: edges.length,
        [PREDICATE.activeEdgeCount]: active.length,
        // Multivalued — the store now emits one triple per element (the other half of the G1 fix).
        // ACTIVE edges only: a PROPOSED or REVOKED edge is not a trust relationship.
        [PREDICATE.relObject]: [...new Set(active.map((e) => e.counterparty))],
        [PREDICATE.edgeDirection]: [...new Set(active.map((e) => e.dir))],
      },
      children, childLink: PREDICATE.hasRelationship,
    };
  },
};

/** Attestation facet — EAS-aligned attestations where the SA is subject (incl. skill/geo/agreement claims
 *  as credentialType). Read from the indexer's single pre-scanned Attested-log sweep.
 *
 *  G1: same defect as the relationship facet (CURIE keys + array values → silently dropped). Each
 *  attestation is now its own `apatt:Attestation` node (an EXISTING tbox/attestation.ttl class) carrying
 *  `apatt:uid` / `apatt:credentialType` — also existing T-box terms.
 *
 *  `attestationsScanned` is the ADR-0013 guard: the targeted `/project` path used to hand the projector an
 *  EMPTY map, which is "not scanned", not "no attestations". Emitting `children: []` for that would have
 *  DELETED every real attestation from the graph on every re-projection. When the sweep did not run we
 *  return NO `children` key at all, and the store preserves what is indexed. */
const attestation: FacetProjector = {
  kind: 'attestation',
  async project({ attestations, attestationsScanned, sa, chainId }): Promise<ProjectedFacet> {
    const hits = attestations.get(sa.toLowerCase()) ?? [];
    const data = {
      [PREDICATE.attestationCount]: hits.length,
      [PREDICATE.validAttestationCount]: hits.filter((h) => h.valid).length,
    };
    if (!attestationsScanned) {
      return { kind: 'attestation', present: false, shapeIri: null, conforms: true, data: {}, pending: 'attestation log sweep not run for this projection — existing attestations preserved' };
    }
    const children: ProjectedChildNode[] = hits.map((h) => ({
      iri: attestationIri(chainId, h.uid),
      type: ATTESTATION_CLASS,
      linkPredicate: PREDICATE.hasAttestation,
      data: {
        [PREDICATE.attestationUid]: h.uid,
        [PREDICATE.credentialType]: h.credentialType,
        [PREDICATE.attestationIssuer]: h.issuer.toLowerCase(),
        [PREDICATE.attestationValid]: String(h.valid),
      },
    }));
    return { kind: 'attestation', present: hits.length > 0, shapeIri: null, conforms: true, data, children, childLink: PREDICATE.hasAttestation };
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
 *  fetched, never indexed.
 *
 *  CRAWL FAILURE ≠ ZERO OFFERINGS (ADR-0013). A fetch error / non-ok / foreign-SA / missing endpoint returns
 *  the facet with NO `children` key (undefined) → present:false → the store PRESERVES whatever offerings are
 *  already indexed (a failed read must not destroy good data). Only a SUCCESSFUL crawl returns a defined
 *  `children` array (possibly empty = genuinely zero) → the store then refreshes/clears them. This matters
 *  because the indexer Worker cannot fetch a same-account host (Cloudflare loopback, CF error 1042) — only
 *  the Node CLI can — so the Worker cron's crawl always fails and MUST leave the CLI-populated offerings be. */
const offerings: FacetProjector = {
  kind: 'offerings',
  async project({ client, nameResolver, sa, node, chainId }): Promise<ProjectedFacet> {
    // Failure/unknown: NO children key → store preserves existing offering nodes (never wipes on a failed read).
    const unknown = (pending?: string): ProjectedFacet => ({ kind: 'offerings', present: false, shapeIri: SHAPE.Offering, conforms: true, data: {}, pending });
    // a2aEndpoint is a node-keyed record on the AgentNameResolver (spec 280) — NOT on the profile resolver.
    const a2a = (await client.readContract({ address: nameResolver, abi: NAME_ATTR_RESOLVER_ABI, functionName: 'getString', args: [node, pred('a2aEndpoint')] }).catch(() => '')) as string;
    if (!a2a) return unknown();
    const url = `${a2a.replace(/\/$/, '')}/offerings?view=public`;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(CRAWL_TIMEOUT_MS) });
      if (!res.ok) return unknown(`crawl ${url} → HTTP ${res.status}`);
      const text = await res.text();
      const card = JSON.parse(text) as OfferingsCard;
      // Single-tenant trust check: the host must claim exactly this SA, or we don't index its offerings.
      if (card.agentId && card.agentId.toLowerCase() !== sa.toLowerCase()) {
        return unknown(`crawl ${url} → agentId ${card.agentId} ≠ ${sa} (foreign-SA card; not indexed)`);
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
      // Successful crawl → present:true (even with zero offerings, so the store refreshes/clears stale ones).
      // `childLink` declares the predicate this facet OWNS, so a successful crawl that returns ZERO
      // offerings still clears the agent's stale ones (with no child in the array, the store has nothing
      // else to read the predicate off). Preserves the pre-existing behaviour now that the store tracks
      // freshness per link predicate rather than assuming hasOffering is the only one.
      return { kind: 'offerings', present: true, shapeIri: SHAPE.Offering, conforms: true, data: { [PREDICATE.sourceEndpoint]: a2a, [PREDICATE.observedAt]: observedAt }, children, childLink: PREDICATE.hasOffering };
    } catch (e) {
      return unknown(`crawl ${url} → ${String((e as Error)?.message ?? e)}`);
    }
  },
};

/** The projector registry — every PUBLIC source that relates to a Smart Agent (on-chain + the agent's own
 *  public A2A card, ADR-0040 amended). Extend here. */
export const PROJECTORS: FacetProjector[] = [naming, profile, registry, relationship, attestation, offerings];
