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
} as const;

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
} as const;

/** Canonical A-box id for a Smart Agent (CAIP-10-style, chain-scoped). */
export function agentIri(chainId: number, sa: string): string {
  return `urn:ap:agent:eip155:${chainId}:${sa.toLowerCase()}`;
}
