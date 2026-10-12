// WHICH ESTATE IS THIS AGENT'S? — spec 435 §4, the half a public reader can compute.
//
// THE ONLY HONEST ANSWER TODAY IS "INFERRED". §4's table has four rungs and the top one — a live
// `TownStanding` attestation naming the estate — does not exist yet (spec 435 W1/W3). What a reader CAN do is
// compare the agent's own on-chain endpoint against the estate hosts this town's manifest declares, and that
// is what this does. The result carries `how`, and nothing promotes it: an inference never becomes an
// attestation by being displayed next to one.
//
// WHY NOT THE NAME ROOT. §4 lists "its typed name sits under the estate's nameRoots" as an inference, and in
// a town with ONE estate it is a good one. This town has two, and they share `me`, `org`, `team`, `svc`,
// `workspace`, `treasury`, `registry`, `church` and `circle` — so a name root here places an agent in both
// estates at once, which is not an inference but a coin toss with a citation. It is therefore used only to
// say an agent is nameable in this town, never to pick which estate is its.
//
// NOTHING HERE IS AUTHORITY (spec 429 D2). Being placed in an estate says nothing about what the agent may
// do, and the estate's Home decides what it may do there regardless of what this computes.
import type { TownManifest, TownEstate } from './types';

export type PlacementHow = 'agent-zone' | 'estate-a2a' | 'unplaced';

export interface AgentRosterRow {
  name: string | null;
  smartAgent: string;
  displayName?: string | null;
  agentType?: string | null;
  kind?: string | null;
  tld?: string | null;
  a2aEndpoint?: string | null;
  mcpEndpoint?: string | null;
}

export interface PlacedAgent extends AgentRosterRow {
  estate: string | null;
  how: PlacementHow;
}

// The WORDS for each rung live in the page that renders them, not here: this module decides which rung a row
// is on, and a second copy of the sentence in a package nothing reads is a sentence that drifts out of date
// while looking authoritative. What must not drift is the rung vocabulary itself, and that is the type above.

const hostOf = (url: string): string | null => { try { return new URL(url).host.toLowerCase(); } catch { return null; } };

/** Place one row, or say it is unplaced. First match in manifest order; estates do not share hosts. */
export function placeAgent(row: AgentRosterRow, town: TownManifest): PlacedAgent {
  const host = row.a2aEndpoint ? hostOf(row.a2aEndpoint) : null;
  if (host) {
    for (const e of town.estates) {
      const zone = e.agentZone?.toLowerCase();
      if (zone && (host === zone || host.endsWith(`.${zone}`))) return { ...row, estate: e.id, how: 'agent-zone' };
    }
    for (const e of town.estates) {
      if (hostOf(e.a2a) === host) return { ...row, estate: e.id, how: 'estate-a2a' };
    }
  }
  return { ...row, estate: null, how: 'unplaced' };
}

export function placeAgents(rows: AgentRosterRow[], town: TownManifest): PlacedAgent[] {
  return rows.map((r) => placeAgent(r, town));
}

/** One estate's placed agents, and the counts a page leads with. `unplaced` is its own bucket, never zero. */
export interface EstateRoster {
  estate: string;
  agents: PlacedAgent[];
  /** By ADR-0046 class — person, org, service — plus `undeclared`, which is a real state and not a gap. */
  byKind: Record<'person' | 'org' | 'service' | 'undeclared', number>;
  /** How many of them serve an MCP door of their own. */
  withMcp: number;
}

const CLASS_OF: Record<string, 'person' | 'org' | 'service'> = {
  PersonAgent: 'person', OrganizationAgent: 'org', ServiceAgent: 'service',
  person: 'person', org: 'org', service: 'service',
};

export function estateRoster(rows: AgentRosterRow[], town: TownManifest, estateId: string): EstateRoster {
  const agents = placeAgents(rows, town).filter((a) => a.estate === estateId);
  const byKind = { person: 0, org: 0, service: 0, undeclared: 0 };
  for (const a of agents) {
    const cls = (a.kind ? CLASS_OF[a.kind] : undefined) ?? (a.agentType ? CLASS_OF[a.agentType] : undefined) ?? 'undeclared';
    byKind[cls] += 1;
  }
  return { estate: estateId, agents, byKind, withMcp: agents.filter((a) => !!a.mcpEndpoint).length };
}

/** Is this estate one this town knows? A page asked for an unknown id should say so, not render an empty one. */
export function estateOf(town: TownManifest, estateId: string): TownEstate | null {
  return town.estates.find((e) => e.id === estateId) ?? null;
}
