// De-vendored ontology surface: the canonical IRIs come from @agenticprimitives/ontology (single source,
// no drift) now that this lives in the monorepo. We only add the few naming/profile/relationship/
// attestation FACET predicates the indexer projects that the ontology package's PREDICATE map doesn't
// expose yet — built on the package's canonical NS (and ideally promoted into the ontology later).

import { NS, CLASS as ONT_CLASS, SHAPE as ONT_SHAPE, PREDICATE as ONT_PREDICATE } from '@agenticprimitives/ontology';

export { NS };
export const CLASS = ONT_CLASS;

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

export const PREDICATE = {
  ...ONT_PREDICATE,
  // facet projection terms (canonical NS; superset of the package's registry/discovery predicates)
  smartAgent: `${NS.ap}smartAgent`,
  name: `${NS.apnam}name`,
  node: `${NS.apnam}node`,
  displayName: `${NS.approf}displayName`,
  description: `${NS.approf}description`,
  authOrigin: `${NS.approf}authOrigin`,
  skills: `${NS.approf}skills`,
  a2aEndpoint: `${NS.approf}a2aEndpoint`, // spec 280 — the agent's A2A host (its live skills card)
  mcpEndpoint: `${NS.approf}mcpEndpoint`,
  claimsRoot: `${NS.apreg}claimsRoot`,
  blockNumber: `${NS.apreg}blockNumber`,
  lifecycleStatus: `${NS.apreg}lifecycleStatus`,
  expiresAt: `${NS.apreg}expiresAt`,
  cardHash: `${NS.apreg}cardHash`,
  bindingProofHash: `${NS.apreg}bindingProofHash`,
  relationshipType: `${NS.ap}relationshipType`,
  relObject: `${NS.ap}relatedAgent`,
  edgeStatus: `${NS.ap}edgeStatus`,
  edgeDirection: `${NS.ap}edgeDirection`,
  attestationUid: `${NS.ap}attestationUid`,
  credentialType: `${NS.ap}credentialType`,
  attestationIssuer: `${NS.ap}attestationIssuer`,
  attestationValid: `${NS.ap}attestationValid`,
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
