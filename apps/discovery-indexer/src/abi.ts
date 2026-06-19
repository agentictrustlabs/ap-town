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
