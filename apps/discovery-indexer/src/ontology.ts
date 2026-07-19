// De-vendored ontology surface: the canonical IRIs come from @agenticprimitives/ontology (single source,
// no drift) now that this lives in the monorepo. We only add the few naming/profile/relationship/
// attestation FACET predicates the indexer projects that the ontology package's PREDICATE map doesn't
// expose yet — built on the package's canonical NS (and ideally promoted into the ontology later).

import { keccak256, toHex, type Hex } from 'viem';
import { NS, CLASS as ONT_CLASS, SHAPE as ONT_SHAPE, PREDICATE as ONT_PREDICATE } from '@agenticprimitives/ontology';

export { NS };
export const CLASS = ONT_CLASS;

/** On-chain `agentKind` (bytes32) → the kind subclass IRI (spec 225 / tbox). The value is the canonical
 *  enum id keccak256(toHex("person"|"org"|"service")) (agent-naming AGENT_KIND_ID / AgentNamePredicates),
 *  read node-keyed off the AgentNameResolver. Maps the 3 on-chain agentKinds onto the OWL kind subclasses so
 *  the A-box agents can be queried as PersonAgent / OrganizationAgent / ServiceAgent — never inferred from
 *  names or any other heuristic (ADR-0040: only on-chain-derivable facts). Returns null when unset/unknown. */
export const AGENT_KIND_PRED: Hex = keccak256(toHex('atl:agentKind'));
const AGENT_KIND_CLASS: Record<string, string> = {
  [keccak256(toHex('person'))]: ONT_CLASS.PersonAgent,
  [keccak256(toHex('org'))]: ONT_CLASS.OrganizationAgent,
  [keccak256(toHex('service'))]: ONT_CLASS.ServiceAgent,
};
const ZERO_B32 = `0x${'00'.repeat(32)}`;
export function agentKindClass(value: Hex | string | null | undefined): string | null {
  if (!value || value === ZERO_B32) return null;
  return AGENT_KIND_CLASS[value.toLowerCase()] ?? null;
}

export const SHAPE = {
  ...ONT_SHAPE,
  // approf profile shape isn't in the package SHAPE map yet; use the canonical NS until it is.
  AgentProfile: `${NS.approf}AgentProfileShape`,
  // spec 286 — a crawled, host-asserted Offering node (one per (agent × public skill)).
  Offering: `${NS.apdisc}OfferingShape`,
} as const;

/** spec 286 — a first-class Offering node class (agent × asserted public skill), crawled from the public
 *  A2A card. host-asserted + carries provenance; never an authority (ADR-0040 amended). */
export const OFFERING_CLASS = `${NS.apdisc}Offering`;

/** G1 — a projected AgentRelationship edge, typed with the EXISTING trust vocabulary
 *  (`tbox/trust.ttl` aptrust:TrustGraphEdge — "an evidence-backed edge between agents or facets in the
 *  public trust graph"). No new class is minted for this. */
export const RELATIONSHIP_EDGE_CLASS = `${NS.aptrust}TrustGraphEdge`;
/** G1 — a projected AttestationRegistry row, typed apatt:Attestation (tbox/attestation.ttl: "On-chain row
 *  in AttestationRegistry.sol"). Existing term, reused. */
export const ATTESTATION_CLASS = ONT_CLASS.Attestation;

export const PREDICATE = {
  ...ONT_PREDICATE,
  // facet projection terms (canonical NS; superset of the package's registry/discovery predicates)
  smartAgent: `${NS.ap}smartAgent`,
  name: `${NS.apnam}name`,
  node: `${NS.apnam}node`,
  // Name-record metadata (AgentNameRegistry storage views — on-chain-derivable, ADR-0040).
  nameRegisteredAt: `${NS.apnam}registeredAt`, // unix seconds the node was registered
  nameExpiry: `${NS.apnam}expiry`,             // unix seconds the registration expires (0 = none)
  displayName: `${NS.approf}displayName`,
  description: `${NS.approf}description`,
  authOrigin: `${NS.approf}authOrigin`,
  skills: `${NS.approf}skills`,
  a2aEndpoint: `${NS.approf}a2aEndpoint`, // spec 280 — the agent's A2A host (its live skills card)
  mcpEndpoint: `${NS.approf}mcpEndpoint`,
  appContext: `${NS.apdisc}appContext`,
  orgRole: `${NS.apdisc}orgRole`,
  serviceUrl: `${NS.apdisc}serviceUrl`,
  siteUrl: `${NS.apdisc}siteUrl`,
  // G2/G3/G4 (facet-registries §6) — owner-asserted, opt-in, PUBLIC discovery-ranking profile properties,
  // on the same rail as atl:skills. Flat comma-separated strings for parity with skills (structure waits
  // for spec 330). languages = BCP-47 lowercase; regions = ISO 3166 / GeoFeatureRegistry codes uppercase;
  // focusAreas = free labels (soft boost only, NEVER a hard filter — a focus area is an emphasis).
  languages: `${NS.approf}languages`,
  regions: `${NS.approf}regions`,
  focusAreas: `${NS.approf}focusAreas`,
  claimsRoot: `${NS.apreg}claimsRoot`,
  blockNumber: `${NS.apreg}blockNumber`,
  lifecycleStatus: `${NS.apreg}lifecycleStatus`,
  expiresAt: `${NS.apreg}expiresAt`,
  cardHash: `${NS.apreg}cardHash`,
  bindingProofHash: `${NS.apreg}bindingProofHash`,
  // ── G1: the trust fabric (relationship + attestation facets) ───────────────────────────────────────
  // Facet LINK predicates — the agent → child-node edges. Same IRIs the store's FACET_PRED already used
  // for the JSON-LD shape, now first-class in the SPARQL graph too.
  hasRelationship: `${NS.ap}hasRelationship`, // agent → aptrust:TrustGraphEdge
  hasAttestation: `${NS.ap}hasAttestation`,   // agent → apatt:Attestation
  // Relationship-edge terms. `aprel:` is a declared namespace with NO T-box file and no terms, and
  // tbox/trust.ttl types the EDGE (aptrust:TrustGraphEdge) but declares no subject/object/type/status
  // properties. These four ap: terms were already coined here by the original relationship projector;
  // they are kept verbatim (nothing new is minted) and should be promoted into tbox/trust.ttl.
  edgeId: `${NS.ap}edgeId`,
  relationshipType: `${NS.ap}relationshipType`, // the well-known label ('RECOMMENDS', …), not the hash
  relationshipTypeId: `${NS.ap}relationshipTypeId`, // the raw on-chain bytes32, always emitted
  relObject: `${NS.ap}relatedAgent`,           // AGENT-level: the counterparty SA (denormalized, per side)
  edgeStatus: `${NS.ap}edgeStatus`,
  edgeDirection: `${NS.ap}edgeDirection`,      // AGENT-level only — 'subject'|'object' is endpoint-relative
  // NEW TERMS (minted here, declared openly): the on-chain edge is ONE record shared by both endpoints, and
  // the edge node's IRI is derived from the deterministic on-chain edgeId, so BOTH agents project the SAME
  // subject. Its properties must therefore be endpoint-INDEPENDENT — `edgeDirection`/`relatedAgent` are
  // relative to whoever is looking, so they stay on the agent, and the shared node states the edge
  // absolutely. Nothing in tbox/trust.ttl, tbox/core.ttl or the (term-less) `aprel:` namespace names the
  // subject/object of a TrustGraphEdge, so these two are genuinely new and should be promoted into
  // tbox/trust.ttl alongside the four terms above.
  edgeSubject: `${NS.ap}edgeSubject`,
  edgeObject: `${NS.ap}edgeObject`,
  edgeCount: `${NS.ap}edgeCount`,
  activeEdgeCount: `${NS.ap}activeEdgeCount`,
  // Attestation terms — the T-box DOES define these (tbox/attestation.ttl), so use the real apatt: ones
  // rather than the ap:-local aliases the dropped projector used.
  attestationUid: `${NS.apatt}uid`,
  credentialType: `${NS.apatt}credentialType`,
  // No apatt: issuer/validity property exists in tbox/attestation.ttl (the on-chain struct has `issuer`
  // and isValid(uid), the T-box does not model them). Kept as the pre-existing ap:-local terms rather
  // than silently minting apatt: ones — flagged for T-box promotion.
  attestationIssuer: `${NS.ap}attestationIssuer`,
  attestationValid: `${NS.ap}attestationValid`,
  attestationCount: `${NS.ap}attestationCount`,
  validAttestationCount: `${NS.ap}validAttestationCount`,
  // spec 286 — Offering node terms (crawled from the public A2A card; host-asserted + provenance).
  hasOffering: `${NS.apdisc}hasOffering`,       // agent → offering
  ofAgent: `${NS.apdisc}ofAgent`,               // offering → agent
  skillId: `${NS.apdisc}skillId`,
  offeringName: `${NS.apdisc}offeringName`,
  offeringVersion: `${NS.apdisc}offeringVersion`,
  effect: `${NS.apdisc}effect`,
  exposure: `${NS.apdisc}exposure`,
  offeringFamily: `${NS.apdisc}family`,
  requiredCapability: `${NS.apdisc}requiredCapability`,  // multivalued — one triple per capability
  hasInputSchema: `${NS.apdisc}hasInputSchema`,
  offeringStatus: `${NS.apdisc}offeringStatus`,
  // provenance (ADR-0040 amended): a crawled offering carries where + when it was observed.
  sourceEndpoint: `${NS.apdisc}sourceEndpoint`,
  observedAt: `${NS.apdisc}observedAt`,
  cardDigest: `${NS.apdisc}cardDigest`,
} as const;

/** Canonical A-box id for a Smart Agent (CAIP-10-style, chain-scoped). */
export function agentIri(chainId: number, sa: string): string {
  return `urn:ap:agent:eip155:${chainId}:${sa.toLowerCase()}`;
}

/** A-box id for one crawled Offering — deterministic per (agent × skill) so re-crawls converge (spec 286). */
export function offeringIri(chainId: number, sa: string, skillId: string): string {
  return `urn:ap:offering:eip155:${chainId}:${sa.toLowerCase()}:${skillId.replace(/[^a-zA-Z0-9.\-]/g, '_')}`;
}

/** A-box id for one relationship edge (G1). The on-chain edgeId is already deterministic
 *  (keccak256(subject, object, relationshipType)), so BOTH endpoints project the SAME node — the edge is
 *  one subject in the graph, linked from each side, not two copies. */
export function relationshipEdgeIri(chainId: number, edgeId: string): string {
  return `urn:ap:relationship:eip155:${chainId}:${edgeId.toLowerCase()}`;
}

/** A-box id for one attestation (G1) — keyed by the EAS-style deterministic UID. */
export function attestationIri(chainId: number, uid: string): string {
  return `urn:ap:attestation:eip155:${chainId}:${uid.toLowerCase()}`;
}

/** Well-known AgentRelationship type ids → their label (AgentRelationshipPredicates.sol / the
 *  agent-relationships SDK RELATIONSHIP_TYPE map). Governor-registered types outside this set project
 *  the raw bytes32 under `relationshipTypeId` only — never guessed. */
const RELATIONSHIP_TYPE_LABEL: Record<string, string> = Object.fromEntries(
  ['HAS_MEMBER', 'HAS_GOVERNANCE_OVER', 'VALIDATION_TRUST', 'PARTNERSHIP', 'OPERATES_ON_BEHALF_OF', 'RECOMMENDS']
    .map((n) => [keccak256(toHex(n)).toLowerCase(), n]),
);
export function relationshipTypeLabel(id: Hex | string | null | undefined): string | null {
  if (!id) return null;
  return RELATIONSHIP_TYPE_LABEL[String(id).toLowerCase()] ?? null;
}
