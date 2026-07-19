// facet-registries G8 — `description` was written by two projector tiers under ONE IRI.
//
// `PROFILE_KEYS` (SA-keyed, AgentProfileResolver, tier 3 — the agent's own self-description) and
// `NAME_ATTR_KEYS` (node-keyed, AgentNameAttributeResolver, tier 2 — the name record's description,
// written by the NAME's owner) both mapped `description` to `approf:description` and both merged into the
// SAME `data` object. The name-attr loop runs second, so tier 2 silently DESTROYED tier 3 — the winner
// decided by nothing but the order of two `const` declarations in one file.
//
// On the live substrate no agent held both values at once, so nothing visibly broke; these tests hold the
// invariant regardless, because "no agent has both yet" is a property of today's data, not of the code.

import { describe, expect, it } from 'vitest';
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { PROJECTORS } from '../src/projectors.js';
import { PREDICATE } from '../src/ontology.js';

const PROFILE_RESOLVER = '0x00000000000000000000000000000000000000p1' as Address;
const NAME_RESOLVER = '0x00000000000000000000000000000000000000n1' as Address;
const pred = (key: string) => keccak256(toBytes(`atl:${key}`));

/** A PublicClient stub that answers the two description reads with DIFFERENT values — the exact situation
 *  the collision hid. Everything else reads empty. */
function stubClient(profileDescription: string, nameDescription: string) {
  return {
    async readContract(args: { address: string; functionName: string; args: readonly unknown[] }) {
      const p = args.args[1] as Hex;
      if (args.functionName === 'getStringProperty' && args.address === PROFILE_RESOLVER) {
        return p === pred('description') ? profileDescription : '';
      }
      if (args.functionName === 'getString' && args.address === NAME_RESOLVER) {
        return p === pred('description') ? nameDescription : '';
      }
      return '';
    },
  } as never;
}

const projectProfile = (profileDescription: string, nameDescription: string) => {
  const profile = PROJECTORS.find((p) => p.kind === 'profile')!;
  return profile.project({
    client: stubClient(profileDescription, nameDescription),
    chainId: 84532,
    sa: '0x000000000000000000000000000000000000dEaD' as Address,
    name: 'someone.impact',
    node: `0x${'11'.repeat(32)}` as Hex,
    nameRegistry: '0x0000000000000000000000000000000000000001' as Address,
    resolver: '0x0000000000000000000000000000000000000002' as Address,
    nameResolver: NAME_RESOLVER,
    registry: '0x0000000000000000000000000000000000000003' as Address,
    profileResolver: PROFILE_RESOLVER,
    relationship: '0x0000000000000000000000000000000000000004' as Address,
    discoveryRegistryId: 'urn:ap:registry:test',
    attestations: new Map(),
    attestationsScanned: false,
  });
};

const AGENT_BIO = 'Spanish and EU succession planner for cross-border families.';
const NAME_BLURB = 'UUPG organization agent discoverable by public Agent Naming metadata.';

describe('G8 — the two description tiers keep their own IRIs', () => {
  it('projects BOTH when both exist on chain (this is the case that used to lose one)', async () => {
    const f = await projectProfile(AGENT_BIO, NAME_BLURB);
    expect(f.data[PREDICATE.description]).toBe(AGENT_BIO);
    expect(f.data[PREDICATE.nameDescription]).toBe(NAME_BLURB);
    // The regression itself: the SA-keyed value must not be the name-record one.
    expect(f.data[PREDICATE.description]).not.toBe(NAME_BLURB);
  });

  it('the two IRIs are genuinely different terms', () => {
    expect(PREDICATE.description).toBe('https://agenticprimitives.dev/ns/profile#description');
    expect(PREDICATE.nameDescription).toBe('https://agenticprimitives.dev/ns/naming#description');
  });

  it('an agent with only a name-record description does not claim a profile self-description', async () => {
    const f = await projectProfile('', NAME_BLURB);
    expect(f.data[PREDICATE.description]).toBeUndefined();
    expect(f.data[PREDICATE.nameDescription]).toBe(NAME_BLURB);
  });

  it('an agent with only a profile description is unaffected', async () => {
    const f = await projectProfile(AGENT_BIO, '');
    expect(f.data[PREDICATE.description]).toBe(AGENT_BIO);
    expect(f.data[PREDICATE.nameDescription]).toBeUndefined();
  });

  it('no two profile-facet keys share an IRI — the module-load guard is armed', async () => {
    // Importing ../src/projectors.js at all runs the guard; if any future entry reuses an IRI across the
    // two tiers the import throws and every test in this file fails loudly rather than one value vanishing.
    await expect(import('../src/projectors.js')).resolves.toBeDefined();
  });

  it("an offering's description is an apdisc: term, not the agent-profile one", () => {
    // Third writer (offerings projector). Distinct SUBJECT, so it never clobbered anything — but
    // `approf:description` is rdfs:domain approf:AgentProfile, so it typed every crawled Offering as an
    // agent profile.
    expect(PREDICATE.offeringDescription).toBe('https://agenticprimitives.dev/ns/discovery#offeringDescription');
    expect(PREDICATE.offeringDescription).not.toBe(PREDICATE.description);
  });
});
