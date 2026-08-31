/**
 * A renamed derived type must still decode.
 *
 * THE BUG THIS PINS (2026-08-31, found in production): this file built its own
 * `keccak256(<current name>)` → concept map. When `workspace-coordinator` was renamed to `workspace`,
 * agent-naming and agent-profile both learned the legacy encoding and this map did not — so a correctly
 * typed `.workspace` agent projected as UNTYPED, disappeared from the discovery type facet, and could not
 * be filtered for. Nothing errored; the type just silently wasn't there.
 *
 * A second decoder is the defect, not the missing entry — so the real fix was to delegate to
 * `decodeAgentType`, and what this pins is that the delegation holds for BOTH encodings.
 */
import { describe, it, expect } from 'vitest';
import { keccak256, toHex } from 'viem';
import { agentTypeClass, agentTypeConcept } from '../src/ontology.js';

const ZERO = `0x${'00'.repeat(32)}` as const;

describe('the on-chain derived type decodes to one concept', () => {
  it('decodes the CURRENT encoding of every type', () => {
    for (const [slug, concept] of [
      ['person', 'PersonType'], ['org', 'OrgType'], ['team', 'TeamType'], ['service', 'ServiceType'],
      ['workspace', 'WorkspaceType'], ['treasury', 'TreasuryType'], ['registry', 'RegistryType'],
      ['church', 'ChurchType'], ['circle', 'CircleType'],
    ] as const) {
      expect(agentTypeConcept(keccak256(toHex(slug)))).toContain(concept);
    }
  });

  it('decodes the LEGACY encoding a chain still carries — workspace-coordinator is a workspace', () => {
    const legacy = keccak256(toHex('workspace-coordinator'));
    expect(agentTypeConcept(legacy)).toContain('WorkspaceType');
    expect(agentTypeClass(legacy)).toContain('WorkspaceAgent');
    // and it decodes to the SAME thing the current encoding does — one type, two encodings.
    expect(agentTypeConcept(legacy)).toBe(agentTypeConcept(keccak256(toHex('workspace'))));
  });

  it('is null for undeclared and for a value that names no type', () => {
    expect(agentTypeConcept(ZERO)).toBeNull();
    expect(agentTypeConcept(null)).toBeNull();
    expect(agentTypeConcept(keccak256(toHex('not-a-type')))).toBeNull();
    expect(agentTypeClass(ZERO)).toBeNull();
  });
});
