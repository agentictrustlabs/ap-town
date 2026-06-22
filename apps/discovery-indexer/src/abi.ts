// On-chain READ surface the indexer consumes — naming/profile/relationship views + the AgentRegistryBase
// getEntry/isActive views + the Attested event. These are app-declared view/event fragments (an indexer
// declares what it reads); `@agenticprimitives/registry-kit` owns the registry WRITE + lifecycle-event
// ABI (`AGENT_REGISTRY_BASE_ABI`), which this indexer doesn't consume. Ontology IRIs + SHACL shapes ARE
// de-vendored — imported from `@agenticprimitives/ontology` (see ./ontology.ts).

import type { Abi } from 'viem';

/** AgentNameRegistry — on-chain enumeration of every name under a parent (storage views, no log scan). */
export const NAME_REGISTRY_ABI = [
  { type: 'function', name: 'childCount', stateMutability: 'view', inputs: [{ name: 'parentNode', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'childLabelhashes', stateMutability: 'view', inputs: [{ name: 'parentNode', type: 'bytes32' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'childNode', stateMutability: 'view', inputs: [{ name: 'parentNode', type: 'bytes32' }, { name: 'lh', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
] as const satisfies Abi;

/** AgentNameUniversalResolver — node → SA, SA → canonical name, + profile attribute reads. */
export const RESOLVER_ABI = [
  { type: 'function', name: 'resolveName', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'reverseResolveString', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'resolveString', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'resolveBytes32', stateMutability: 'view', inputs: [{ name: 'node', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
] as const satisfies Abi;

/** AgentRegistryBase — the registry facet (views + lifecycle events). Mirrors registry-kit. */
export const REGISTRY_ABI = [
  {
    type: 'function', name: 'getEntry', stateMutability: 'view',
    inputs: [{ name: 'registryId', type: 'bytes32' }, { name: 'entryId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple', components: [
        { name: 'subjectAgent', type: 'address' }, { name: 'cardHash', type: 'bytes32' },
        { name: 'bindingProofHash', type: 'bytes32' }, { name: 'claimsRoot', type: 'bytes32' },
        { name: 'status', type: 'uint8' }, { name: 'registeredAtBucket', type: 'uint64' }, { name: 'expiresAt', type: 'uint64' },
      ],
    }],
  },
  { type: 'function', name: 'isActive', stateMutability: 'view', inputs: [{ name: 'registryId', type: 'bytes32' }, { name: 'entryId', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const satisfies Abi;

export const REGISTRY_STATUS = ['none', 'active', 'suspended', 'revoked'] as const;

/** AgentProfileResolver — per-agent profile properties (spec 217). */
export const PROFILE_RESOLVER_ABI = [
  { type: 'function', name: 'getStringProperty', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'getBytes32Property', stateMutability: 'view', inputs: [{ name: 'agent', type: 'address' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'bytes32' }] },
] as const satisfies Abi;

/** AgentNameResolver attribute store (spec 280) — node-keyed string attributes (a2aEndpoint, mcpEndpoint,
 *  displayName, …) written by the connect ceremony's `setStringAttribute`. Read by `getString(node,
 *  predicate)`. DISTINCT from the AgentProfileResolver (address-keyed `getStringProperty`) and from the
 *  universal resolver (`resolveName`); a2a/mcp endpoints live HERE, not on the profile resolver. */
export const NAME_ATTR_RESOLVER_ABI = [
  { type: 'function', name: 'getString', stateMutability: 'view', inputs: [{ name: 'subject', type: 'bytes32' }, { name: 'predicate', type: 'bytes32' }], outputs: [{ type: 'string' }] },
] as const satisfies Abi;

/** AgentRelationship — per-SA trust-fabric edges (spec 230). Clean per-subject/object views. */
export const RELATIONSHIP_ABI = [
  { type: 'function', name: 'getEdgesBySubject', stateMutability: 'view', inputs: [{ name: 'subject', type: 'address' }], outputs: [{ type: 'bytes32[]' }] },
  { type: 'function', name: 'getEdgesByObject', stateMutability: 'view', inputs: [{ name: 'object_', type: 'address' }], outputs: [{ type: 'bytes32[]' }] },
  {
    type: 'function', name: 'getEdge', stateMutability: 'view', inputs: [{ name: 'edgeId', type: 'bytes32' }],
    outputs: [{
      type: 'tuple', components: [
        { name: 'edgeId', type: 'bytes32' }, { name: 'subject', type: 'address' }, { name: 'object_', type: 'address' },
        { name: 'relationshipType', type: 'bytes32' }, { name: 'status', type: 'uint8' }, { name: 'createdBy', type: 'address' },
        { name: 'createdAt', type: 'uint64' }, { name: 'updatedAt', type: 'uint64' }, { name: 'metadataURI', type: 'string' }, { name: 'metadataHash', type: 'bytes32' },
      ],
    }],
  },
] as const satisfies Abi;
export const EDGE_STATUS = ['proposed', 'confirmed', 'active', 'revoked'] as const;

/** AttestationRegistry — EAS-aligned (spec 242). Per-subject attestations are found via the Attested
 *  event (subject indexed); validity via isValid(uid). Subsumes skill / geo / agreement CLAIMS (each a
 *  credentialType), which are attestations, not separate per-SA registries. */
export const ATTESTATION_ABI = [
  {
    type: 'event', name: 'Attested',
    inputs: [{ name: 'subject', type: 'address', indexed: true }, { name: 'issuer', type: 'address', indexed: true }, { name: 'credentialType', type: 'bytes32', indexed: true }, { name: 'uid', type: 'bytes32', indexed: false }],
  },
  { type: 'function', name: 'isValid', stateMutability: 'view', inputs: [{ name: 'uid', type: 'bytes32' }], outputs: [{ type: 'bool' }] },
] as const satisfies Abi;

/** AgentNameRegistry — the "this SA now has a name" signal for the event-driven watcher. `agent` is the SA
 *  (indexed), so a PrimaryNameSet log directly names an SA to (re)project. */
export const NAMING_EVENTS_ABI = [
  { type: 'event', name: 'PrimaryNameSet', inputs: [{ name: 'agent', type: 'address', indexed: true }, { name: 'node', type: 'bytes32', indexed: true }] },
] as const satisfies Abi;

/** AgentRegistryBase lifecycle events — the "registration changed" signal. Registered carries subjectAgent
 *  directly; renew/suspend/revoke carry (registryId, entryId) only → resolve subjectAgent via getEntry. */
export const REGISTRY_EVENTS_ABI = [
  { type: 'event', name: 'RegistryEntryRegistered', inputs: [{ name: 'registryId', type: 'bytes32', indexed: true }, { name: 'entryId', type: 'bytes32', indexed: true }, { name: 'subjectAgent', type: 'address', indexed: true }, { name: 'cardHash', type: 'bytes32', indexed: false }, { name: 'bindingProofHash', type: 'bytes32', indexed: false }] },
  { type: 'event', name: 'RegistryEntryRenewed', inputs: [{ name: 'registryId', type: 'bytes32', indexed: true }, { name: 'entryId', type: 'bytes32', indexed: true }, { name: 'expiresAt', type: 'uint64', indexed: false }] },
  { type: 'event', name: 'RegistryEntrySuspended', inputs: [{ name: 'registryId', type: 'bytes32', indexed: true }, { name: 'entryId', type: 'bytes32', indexed: true }, { name: 'reasonHash', type: 'bytes32', indexed: false }] },
  { type: 'event', name: 'RegistryEntryRevoked', inputs: [{ name: 'registryId', type: 'bytes32', indexed: true }, { name: 'entryId', type: 'bytes32', indexed: true }, { name: 'reasonHash', type: 'bytes32', indexed: false }] },
] as const satisfies Abi;

/** AgentAccount custody-membership events (PUBLIC on-chain, ADR-0040). `initialize` re-emits these for the
 *  INITIAL set too (AgentAccount.sol:371/409-410), so scanning the four events alone — filtered to the
 *  enumerated agent set — yields the complete CURRENT custodian membership (EOA custodians + the PIA the
 *  passkey path also adds) and passkey digests. No factory-event decoding needed. */
export const CUSTODY_EVENTS_ABI = [
  { type: 'event', name: 'CustodianAdded', inputs: [{ name: 'owner', type: 'address', indexed: true }] },
  { type: 'event', name: 'CustodianRemoved', inputs: [{ name: 'owner', type: 'address', indexed: true }] },
  { type: 'event', name: 'PasskeyAdded', inputs: [{ name: 'credentialIdDigest', type: 'bytes32', indexed: true }, { name: 'x', type: 'uint256', indexed: false }, { name: 'y', type: 'uint256', indexed: false }, { name: 'rpIdHash', type: 'bytes32', indexed: false }] },
  { type: 'event', name: 'PasskeyRemoved', inputs: [{ name: 'credentialIdDigest', type: 'bytes32', indexed: true }] },
] as const satisfies Abi;
