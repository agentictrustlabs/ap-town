// demo-discovery-a2a — the discovery agent surface (mirrors demo-bible-a2a). Advertises a
// `discover-agents` skill and orchestrates the discovery MCP over the knowledge base: query → MCP
// search_agents → rank → best agents (+ evidence). Browser → A2A → MCP → GraphDB.
//
// v1 ranking is lexical + facet-richness; this is the seam where INTENT + MANDATE matching grows — the
// agent will parse a stated intent/mandate, expand it (skills/geo/trust), query the graph, and return the
// best agents with an explainable evidence path. It evolves into a full-featured discovery app.

import { Hono } from 'hono';
import { ARD_WELL_KNOWN_PATH, ardEntryForAgent, ardRegistryEntry, ardManifest, planArdSearch, ardSearchResponse, ardExploreResponse, parseAgentsFilter, ardAgentsResponse, ardError, type RankedLike, applyRelevanceCutoff, facetsOverMatches } from './ard.js';
import { ACP_REGISTRY_PATH, acpRegistry } from './acp.js';
import { cors } from 'hono/cors';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

// ── The claimed-capability tier (capability-architecture.md §2 `aps:claimsCapability`) ──────────────────
// An endorsement rides the ATTESTATION rail (relayable, issuer signs only) with:
//   subject = endorsed SA · issuer = endorser SA · schemaId = keccak256(capabilityId) = the SkillDefinition
//   skillId · credentialType = CAPABILITY_ENDORSEMENT · credentialHash = commitment to the private vault VC.
// The matcher reads only the PUBLIC commitment; the statement/proficiency stays a private VC. keccak here
// lets the matcher match its declared capability id STRINGS against endorsement skillIds without a lookup.
const keccakHex = (s: string): string => {
  const d = keccak_256(utf8ToBytes(s));
  let h = '0x';
  for (const b of d) h += b.toString(16).padStart(2, '0');
  return h;
};
/** capabilityId (`adv:X`) → on-chain skillId. Same convention as SkillDefinitionRegistry, the advisory
 *  catalog's `skillIdOf`, and capability-claims `computeSkillId` — one identity all four agree on. */
const skillIdOf = (capabilityId: string): string => keccakHex(capabilityId);
/** attestations `CREDENTIAL_TYPE.CapabilityEndorsement` — the discriminator that marks an attestation as a
 *  capability endorsement (vs a bare association/validation). Kept in lockstep with the SDK constant. */
const CAPABILITY_ENDORSEMENT_TYPE = keccakHex('CapabilityEndorsementCredential');
/** AttestationRegistry.EPOCH_SECONDS — the issued-at bucket size, to convert `issuedAt` back to seconds. */
const EPOCH_SECONDS = 3600;
/** Staleness decay horizon: an endorsement decays linearly to 0 over 2× this (~1yr). Revocation is the hard
 *  lever (an invalid endorsement counts 0 outright); decay handles the soft "old and never renewed" case. */
const ENDORSEMENT_HALFLIFE_S = 180 * 86400;
/** Relationship types that make an endorser NON-INDEPENDENT of the subject (one governs/employs/acts-for the
 *  other). The only on-chain, generic signal of same-org there is; where absent, the endorsement weight is
 *  capped instead (see fitScore) — undetected collusion must never be able to dominate. */
const GOVERNANCE_TYPES = new Set(['HAS_GOVERNANCE_OVER', 'HAS_MEMBER', 'OPERATES_ON_BEHALF_OF']);

interface Env {
  MCP_URL?: string;
  AGENT_NAME?: string;
  A2A_PUBLIC_ORIGIN?: string;
  // Service binding to demo-discovery-mcp (production; Workers can't fetch each other by public URL).
  MCP?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
}

/** A crawled per-skill offering (spec 286), as surfaced by the MCP get_offerings tool. */
interface OfferingLite { skillId: string; effect?: string | null; family?: string | null; status?: string | null }
/** One capability endorsement of a subject (from GET /trust): who endorsed, for which capability (skillId),
 *  whether still valid (non-revoked), and when (epochBucket). */
interface EndorsementLite { issuer: string; skillId: string; valid: boolean; issuedAt: number }
interface AgentResult {
  agent: string; name: string | null; smartAgent: string; facets: string[]; shaclConforms: boolean;
  /** spec 346 — derived type slug / name suffix / service role, as the MCP surfaces them (null when undeclared). */
  agentType?: string | null; tld?: string | null; serviceRole?: string | null;
  registryStatus?: string | null; displayName?: string | null; skills?: string | null;
  /** `approf:description` — the agent's OWN, SA-keyed self-description. Every use below (the requireSkill
   *  haystack, the `geo` fallback, the lexical haystack) means THIS tier and only this tier.
   *
   *  facet-registries G8: the node-keyed NAME-RECORD description used to be projected under this same IRI
   *  and, being read second, replaced this one — so the matcher could silently be ranking a registration
   *  blurb ("UUPG organization agent discoverable by public Agent Naming metadata") as an advisor's bio.
   *  It now arrives separately as `nameDescription` and is deliberately NOT surfaced or ranked here: it is
   *  written by the NAME's owner about the registration, so it is neither a capability assertion (wrong
   *  input for requireSkill) nor a coverage claim (wrong input for the geo fallback). Left to the MCP,
   *  which returns it for consumers that want it. */
  description?: string | null;
  /** Spec 331 — canonical capability ids parsed out of `skills` by the MCP. `[]` = declared nothing
   *  structured, which is a real answer and must never be read as "unknown, assume it matches". */
  capabilityIds?: string[];
  /** spec 347 §8.5 — `approf:a2aEndpoint` (the agent's A2A host; ARD entries need it) and the parsed
   *  `approf:distribution` fact (ACP registry eligibility), both as the MCP surfaces them; null when undeclared. */
  a2aEndpoint?: string | null; distribution?: import('./acp.js').AcpDistributionLike | null; siteUrl?: string | null;
  /** G2/G3/G4 — owner-asserted, comma-separated discovery-ranking facets (approf:languages/regions/focusAreas). */
  languages?: string | null; regions?: string | null; focusAreas?: string | null;
  /** G1 — the trust fabric, now actually projected into the graph. */
  activeRelationships?: number; attestations?: number; validAttestations?: number;
  /** Claimed-capability tier — DISTINCT non-self issuers of valid endorsements (self + volume already
   *  collapsed at projection). Absolute corroboration; feeds trustScore. */
  independentEndorsers?: number;
  /** Per-capability endorsement detail (from GET /trust), attached only for capability-driven queries.
   *  Each is one endorsement of THIS subject; the abuse rules are applied over them per capability. */
  endorsements?: EndorsementLite[];
  /** Counterparties on the subject's ACTIVE governance/membership edges — an endorser in this set is
   *  non-independent (same-org) and is discounted. Sourced from the same /trust read. */
  governanceCounterparties?: string[];
  /** 'PersonAgent' | 'OrganizationAgent' | 'ServiceAgent' | null — the projected on-chain agentKind. */
  kind?: string | null;
  /** Crawled offerings (spec 286), attached on demand when skill-level matching is requested. */
  offerings?: OfferingLite[];
}

// spec 281 — structured intent (soft rank) + mandates (hard filters). `requireSkillId` (spec 286) is an
// EXACT per-skill mandate over the agent's crawled Offerings (vs `requireSkill`, fuzzy over coarse labels).
// `languages`/`regions` are code sets: rankable as intent, enforceable as mandates. `focusAreas` is intent-
// ONLY by design (facet-registries G4) — a focus area is an emphasis, not a boundary, so there is
// deliberately no `requireFocusArea` mandate.
interface Intent {
  need?: string; skills?: string[]; geo?: string; languages?: string[]; regions?: string[]; focusAreas?: string[];
  /** Spec 331 — canonical capability ids the question resolved to. THE dominant fit signal.
   *  Resolution happens org-side, once per question, against the catalog the caller owns. */
  capabilityIds?: string[];
  /** Descendants of `capabilityIds` in the catalog DAG, pre-expanded by the caller. A candidate
   *  declaring one of these did not declare what was asked for — it declared something NARROWER,
   *  which is a weaker but real match. Expanded caller-side because the substrate does not (and must
   *  not) hold a downstream domain catalog. */
  specializationIds?: string[];
}
interface Mandates {
  requireRegistered?: boolean; requireShaclConforms?: boolean; requireKind?: string;
  /** spec 346 — the DERIVED agent type slug (person | org | team | service | workspace | treasury |
   *  registry | church | circle). HARD, exact. An agent with NO declared type is treated as the GENERIC type of
   *  its root (an undeclared org-root agent IS an organization, but is not a team/church/circle) — so
   *  requireAgentType='org' keeps legitimate undeclared orgs, while 'team' never floods with unknowns. */
  requireAgentType?: string;
  requireSkill?: string; requireSkillId?: string; geo?: string;
  requireLanguage?: string; requireRegion?: string;
  /** Spec 331 — the one facet filter that is safe by construction: an id was declared or it was not,
   *  with no free text in between. Candidates who declared NOTHING structured are exempt, not
   *  eliminated (the same fail-open-to-fewer-signals rule the other facet mandates use). */
  requireCapabilityId?: string;
  /** Trust-fabric mandates (G1) — meaningless before the relationship/attestation facets reached the graph. */
  requireAttestation?: boolean; requireRelationship?: boolean;
}

/** Parse a comma-separated on-chain code list into a lowercased set. Empty/absent ⇒ empty set (an agent
 *  that has not published the facet is NOT claiming universality — see `mandatePass`). */
const codeSet = (v: string | null | undefined): string[] =>
  (v ?? '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/** BCP-47 match: an agent publishing `pt-br` satisfies a request for `pt`, but not vice-versa. */
const langMatches = (have: string[], want: string) =>
  have.some((h) => h === want || h.startsWith(`${want}-`));

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

const mcpUrl = (env: Env) => (env.MCP_URL ?? 'http://127.0.0.1:8790').replace(/\/$/, '');
const mcpGet = async (env: Env, path: string) => {
  const res = env.MCP ? await env.MCP.fetch(`https://mcp${path}`) : await fetch(`${mcpUrl(env)}${path}`);
  return res.json() as Promise<any>;
};
const mcpPost = async (env: Env, path: string, body: unknown) => {
  const init = { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = env.MCP ? await env.MCP.fetch(`https://mcp${path}`, init) : await fetch(`${mcpUrl(env)}${path}`, init);
  return res.json() as Promise<any>;
};

// spec 286 — attach each candidate's crawled Offerings (MCP get_offerings) so the matcher ranks over the
// full per-skill set. Bounded to keep one /discover call from fanning out to hundreds of MCP reads; the cap
// is LOGGED (never a silent truncation — ADR-0013). A per-agent fetch failure leaves `offerings` undefined
// (the matcher degrades to coarse-label matching for that agent — empty is an answer, not a fallback).
const OFFERINGS_FETCH_CAP = 40;
async function enrichOfferings(env: Env, agents: AgentResult[]): Promise<void> {
  const slice = agents.slice(0, OFFERINGS_FETCH_CAP);
  if (agents.length > OFFERINGS_FETCH_CAP) {
    console.warn(`[discovery-a2a] offering enrichment capped at ${OFFERINGS_FETCH_CAP}/${agents.length} candidates — narrow the query for full per-skill ranking`);
  }
  await Promise.all(slice.map(async (a) => {
    const r = await mcpGet(env, `/offerings?key=${encodeURIComponent(a.smartAgent || a.name || '')}`).catch(() => null);
    if (r?.ok && Array.isArray(r.offerings)) {
      a.offerings = r.offerings.map((o: OfferingLite) => ({ skillId: o.skillId, effect: o.effect ?? null, family: o.family ?? null, status: o.status ?? null }));
    }
  }));
}

// Claimed-capability tier — attach each candidate's endorsements + governance edges (MCP GET /trust) so the
// matcher can rank "declared AND independently endorsed for capability X" above a bare declaration. Fetched
// ONLY for capability-driven queries (the only time it can matter), bounded + logged like enrichOfferings
// (no silent truncation, ADR-0013). A per-agent failure leaves `endorsements` undefined → the candidate
// keeps exactly its bare declaration, never a phantom boost.
const ENDORSEMENT_FETCH_CAP = 40;
async function enrichEndorsements(env: Env, agents: AgentResult[]): Promise<void> {
  const slice = agents.slice(0, ENDORSEMENT_FETCH_CAP);
  if (agents.length > ENDORSEMENT_FETCH_CAP) {
    console.warn(`[discovery-a2a] endorsement enrichment capped at ${ENDORSEMENT_FETCH_CAP}/${agents.length} candidates — narrow the query for full per-capability endorsement ranking`);
  }
  await Promise.all(slice.map(async (a) => {
    const r = await mcpGet(env, `/trust?key=${encodeURIComponent(a.smartAgent || a.name || '')}`).catch(() => null);
    if (!r?.ok) return;
    const atts: any[] = Array.isArray(r.attestations) ? r.attestations : [];
    a.endorsements = atts
      .filter((x) => String(x.credentialType ?? '').toLowerCase() === CAPABILITY_ENDORSEMENT_TYPE && x.schemaId)
      .map((x) => ({ issuer: String(x.issuer ?? '').toLowerCase(), skillId: String(x.schemaId).toLowerCase(), valid: x.valid === true, issuedAt: Number(x.issuedAt ?? 0) }));
    const rels: any[] = Array.isArray(r.relationships) ? r.relationships : [];
    a.governanceCounterparties = [...new Set(rels
      .filter((e) => e.status === 'active' && GOVERNANCE_TYPES.has(String(e.relationshipType)))
      .map((e) => String(e.counterparty ?? '').toLowerCase()))];
  }));
}

/**
 * The claimed-capability tier applied to ONE capability, with every abuse rule the docs named:
 *   - self-endorsement (issuer == subject)  → dropped                                         [enforced]
 *   - volume gaming (N from one issuer)      → deduped by issuer (max weight kept)             [enforced]
 *   - staleness                              → revoked ⇒ 0; else linearly decayed by age       [enforced]
 *   - same-org collusion                     → issuer on a public governance/membership edge to the subject
 *       is heavily discounted                                                          [enforced-when-detectable]
 * Same-org is only detectable where a PUBLIC governance/membership edge exists (person↔org edges are private
 * by default, ADR-0025), so where it is not, the caller CAPS the total endorsement contribution instead —
 * undetected collusion can never dominate. Returns the summed INDEPENDENT weight (distinct decayed,
 * discounted voices) for `capabilityId` — 0 when nobody independent, on-topic and current has endorsed it.
 */
function independentEndorsementWeight(a: AgentResult, capabilityId: string, nowS: number): number {
  const want = skillIdOf(capabilityId);
  const self = (a.smartAgent || '').toLowerCase();
  const gov = new Set(a.governanceCounterparties ?? []);
  const byIssuer = new Map<string, number>();
  for (const e of a.endorsements ?? []) {
    if (!e.valid || e.skillId !== want || e.issuer === self) continue; // revoked / off-topic / self
    let w = 1;
    if (gov.has(e.issuer)) w *= 0.15;                                   // same-org (public edge) discount
    if (e.issuedAt > 0) {                                               // staleness decay
      const ageS = Math.max(0, nowS - e.issuedAt * EPOCH_SECONDS);
      w *= Math.max(0, 1 - ageS / (2 * ENDORSEMENT_HALFLIFE_S));
    }
    byIssuer.set(e.issuer, Math.max(byIssuer.get(e.issuer) ?? 0, w));   // volume dedupe by issuer
  }
  return [...byIssuer.values()].reduce((sum, w) => sum + w, 0);
}

app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-a2a' }));

app.get('/.well-known/agent-card.json', (c) => {
  const origin = (c.env.A2A_PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, '');
  return c.json({
    protocolVersion: '1.0',
    name: 'Discovery Agent',
    description: 'Finds the best Smart Agents for a stated need. Queries the AP discovery knowledge graph (agent-naming + on-chain facets) through the discovery MCP, ranks by relevance + verifiable trust, and returns candidates with an evidence path. Evolves into intent + mandate driven matching.',
    provider: { organization: 'Agentic Primitives — Discovery', url: origin },
    capabilities: { streaming: false, pushNotifications: false },
    defaultInputModes: ['application/json'],
    defaultOutputModes: ['application/json'],
    skills: [
      {
        id: 'discover-agents',
        name: 'Discover agents',
        description: 'Given a query (and, increasingly, an intent + mandate), return the best matching agents from the knowledge graph with relevance + trust evidence.',
        tags: ['discovery', 'registry', 'intent-matching', 'knowledge-graph'],
        examples: ['scripture provider', 'org agents in .impact', 'lbsb'],
      },
    ],
  });
});

// Agentic-trust ontology IRIs (apdisc: discovery vocabulary). Results are typed as the ontology's own
// MatchCandidate / TrustDetermination / EvidencePath so the agent's output IS the ontology in motion.
const APDISC = 'https://agenticprimitives.dev/ns/discovery#';
const AP = 'https://agenticprimitives.dev/ns/core#';

// spec 281 — filter → score → surface (ported from smart-agent 001, adapted to rank AGENTS).
const W_FIT = 0.6;   // intent fit (soft)        — smart-agent's proximity weight
const W_TRUST = 0.4; // public trust signals     — smart-agent's outcome weight
const isRegistered = (a: AgentResult) => a.registryStatus === 'active' || a.facets.includes('registry');

/** Hard MANDATE filter: returns the list of satisfied mandate keys, or null if ANY required mandate fails
 *  (→ candidate dropped). Derived purely from public facets (ADR-0040). */
/** The mandate key that eliminated a candidate — surfaced per key in the response (`droppedBy`) so the UI can say
 *  WHICH filter emptied the list, not just that one did. */
type MandateKey = keyof Mandates;
const GENERIC_OF_ROOT: Record<string, string> = { person: 'person', org: 'org', organization: 'org', service: 'service' };

function mandatePass(a: AgentResult, m: Mandates | undefined): string[] | { failed: MandateKey } {
  const satisfied: string[] = [];
  if (!m) return satisfied;
  if (m.requireRegistered) { if (!isRegistered(a)) return { failed: 'requireRegistered' }; satisfied.push('registered'); }
  if (m.requireShaclConforms) { if (!a.shaclConforms) return { failed: 'requireShaclConforms' }; satisfied.push('shaclConforms'); }
  if (m.requireSkill) { const hay = [a.skills, a.description, a.displayName, ...(a.offerings ?? []).map((o) => o.skillId)].filter(Boolean).join(' ').toLowerCase(); if (!hay.includes(m.requireSkill.toLowerCase())) return { failed: 'requireSkill' }; satisfied.push(`skill:${m.requireSkill}`); }
  if (m.requireSkillId) { const want = m.requireSkillId.toLowerCase(); if (!(a.offerings ?? []).some((o) => o.skillId.toLowerCase().includes(want))) return { failed: 'requireSkillId' }; satisfied.push(`offering:${m.requireSkillId}`); }
  if (m.requireAgentType) {
    const want = m.requireAgentType.toLowerCase();
    const declared = (a.agentType ?? '').toLowerCase();
    const rootGeneric = GENERIC_OF_ROOT[(a.kind ?? '').toLowerCase().replace(/agent$/, '')] ?? null;
    const ok = declared ? declared === want : rootGeneric === want; // undeclared ⇒ the generic type of its root
    if (!ok) return { failed: 'requireAgentType' };
    satisfied.push(`agentType:${m.requireAgentType}${declared ? '' : ' (undeclared, by root)'}`);
  }
  // G3 — `geo` used to be a substring search over the free-text description blob, applied as a HARD filter:
  // an advisor who covers the EU but lacks the literal token was silently eliminated. It is now set
  // membership over the agent's published `approf:regions` codes, with the description search kept ONLY as
  // a fallback for agents that have not published the structured facet yet (so the change cannot drop a
  // candidate that used to pass). Prefer `requireRegion` — `geo` stays for existing callers.
  if (m.geo) {
    const want = m.geo.toLowerCase();
    const regions = codeSet(a.regions);
    const ok = regions.length ? regions.includes(want) : (a.description ?? '').toLowerCase().includes(want);
    if (!ok) return { failed: 'geo' };
    satisfied.push(`geo:${m.geo}`);
  }
  // Spec 331 §4.3 — hard, and safe: exact set membership over declared ids, with the exemption that
  // makes a filter honest. A candidate who declared no capability ids at all is UNKNOWN, not out of
  // scope, and passes; eliminating an unknown is the `mandates.geo` failure this design exists to
  // remove. Region and language stay SOFT by default and are only ever filters when a caller asks.
  if (m.requireCapabilityId) {
    const want = m.requireCapabilityId.toLowerCase();
    const declared = (a.capabilityIds ?? []).map((x) => x.toLowerCase());
    if (declared.length && !declared.includes(want)) return { failed: 'requireCapabilityId' };
    satisfied.push(`capability:${m.requireCapabilityId}`);
  }
  if (m.requireRegion) { const want = m.requireRegion.toLowerCase(); if (!codeSet(a.regions).includes(want)) return { failed: 'requireRegion' }; satisfied.push(`region:${m.requireRegion}`); }
  if (m.requireLanguage) { const want = m.requireLanguage.toLowerCase(); if (!langMatches(codeSet(a.languages), want)) return { failed: 'requireLanguage' }; satisfied.push(`language:${m.requireLanguage}`); }
  if (m.requireAttestation) { if (!(a.validAttestations ?? 0)) return { failed: 'requireAttestation' }; satisfied.push('attested'); }
  if (m.requireRelationship) { if (!(a.activeRelationships ?? 0)) return { failed: 'requireRelationship' }; satisfied.push('relationship'); }
  // G7 — `requireKind` used to push a satisfied string and filter NOTHING. `kindClass` (ap:PersonAgent /
  // OrganizationAgent / ServiceAgent, ADR-0046) IS projected and is now bound by the MCP, so the mandate
  // enforces. Accepts 'person' | 'org' | 'service' or the full class local name.
  if (m.requireKind) {
    const want = m.requireKind.toLowerCase().replace(/agent$/, '');
    const have = (a.kind ?? '').toLowerCase().replace(/agent$/, '');
    const alias: Record<string, string> = { org: 'organization', organisation: 'organization' };
    if (!have || (alias[want] ?? want) !== have) return { failed: 'requireKind' };
    satisfied.push(`kind:${m.requireKind}`);
  }
  return satisfied;
}

/** What a candidate matched on, beyond the score — used for evidence and for the tie-break. */
interface FitBreakdown {
  score: number;
  /** How many of the needed capability ids this candidate declared exactly. */
  capabilityHits: number;
  /** How many needed region codes it covers. Only ever a BOOST — see `mandatePass`. */
  regionHits: number;
  /** True when nothing structured resolved and the score rests on lexical matching alone. */
  lexicalOnly: boolean;
}

/**
 * Soft INTENT fit (0..1) — spec 331 §4.2.
 *
 *   0.55 capabilityMatch   exact set intersection on declared capability ids
 * + 0.15 specializationMatch  a declared id specializes a needed one
 * + 0.10 regionMatch       exact code-set membership
 * + 0.10 languageMatch     BCP-47 subtag prefix
 * + 0.10 focusMatch        capped token containment
 * + 0.15 lexicalFallback   ONLY when no capability id was requested
 *
 * The shape of this function is the whole point of the migration. Before it, ranking was substring
 * containment over a joined text blob, which is why "Spain" scored against the token
 * `jurisdiction-spain` and every routing question passed for a reason that would not survive a
 * rewording. Capability ids are EXACT: an id was declared or it was not.
 *
 * ── The catalog is NOT loaded here, deliberately ──
 * `specializationIds` is supplied by the CALLER, already expanded. Resolving a question to
 * capability ids and walking the catalog DAG is an org-side act performed once per question
 * (§4.1) — and the advisory catalog is a downstream domain artifact this substrate must not
 * depend on. So the substrate scores structure it is handed; it never owns the vocabulary.
 *
 * ── Absence is never a penalty ──
 * A candidate that published no regions contributes 0 to `regionMatch` — the same as one whose
 * regions did not match. Not matching costs the boost; it never costs the seat.
 */
function fitScore(a: AgentResult, intent: Intent, cites: string[]): FitBreakdown {
  const need = (intent.need ?? '').trim().toLowerCase();
  const declared = (a.capabilityIds ?? []).map((x) => x.toLowerCase());
  const needed = (intent.capabilityIds ?? []).map((x) => x.toLowerCase());
  const endorseNowS = Math.floor(Date.now() / 1000);
  let s = 0;

  // ── capabilityMatch — exact, and the dominant term ──
  const exact = needed.filter((id) => declared.includes(id));
  if (needed.length && exact.length) {
    s += 0.55 * (exact.length / needed.length);
    for (const id of exact) cites.push(`declared ${id} (exact)`);
  }

  // ── specializationMatch — a declared id is a NARROWER form of something asked for ──
  // Walks the DAG downward only: declaring the parent never implies the child. `specializationIds`
  // are the descendants the caller expanded, so a request for "manager selection" surfaces the
  // private-fund specialist without the specialist's parent claim being invented here.
  const specIds = (intent.specializationIds ?? []).map((x) => x.toLowerCase());
  const specHits = declared.filter((id) => specIds.includes(id) && !exact.includes(id));
  if (specHits.length) {
    s += 0.15;
    for (const id of specHits) cites.push(`declared ${id}, specializes a requested capability`);
  }

  // ── claimed-capability tier — declared AND independently endorsed beats a bare declaration ──
  // Applies ONLY to a capability the candidate itself declared exactly (`exact`): you cannot be boosted for
  // a capability you never claimed, which kills "peers endorse me for things I don't do". `independent-
  // EndorsementWeight` has already dropped self-endorsements, deduped volume by issuer, decayed staleness
  // and discounted same-org. The boost is capped HARD (≤0.10 total, ≤0.05 per capability): endorsement
  // corroborates a declared capability's fit — it can never manufacture fit for an undeclared one, nor
  // outweigh the declaration itself. A gameable boost is worse than none — the explicit bar. The cap is
  // also what contains undetectable same-org collusion: even fully colluded, endorsement moves rank by ≤0.10.
  let endorseBoost = 0;
  for (const id of exact) {
    const w = independentEndorsementWeight(a, id, endorseNowS);
    if (w > 0) {
      endorseBoost += Math.min(0.05, 0.05 * w);
      cites.push(`declared ${id} AND independently endorsed (${w.toFixed(2)} independent voice(s))`);
    }
  }
  s += Math.min(0.10, endorseBoost);

  // ── region / language / focus — facets, all soft (see §4.3 and `mandatePass`) ──
  const regions = codeSet(a.regions);
  const wantRegions = [...(intent.regions ?? []), ...(intent.geo ? [intent.geo] : [])].map((r) => r.toLowerCase());
  const matchedRegions = [...new Set(wantRegions.filter((r) => regions.includes(r)))];
  if (wantRegions.length && matchedRegions.length) {
    s += 0.10 * Math.min(1, matchedRegions.length / wantRegions.length);
    cites.push(`covers ${matchedRegions.map((r) => r.toUpperCase()).join(', ')} (requested)`);
  }

  const langs = codeSet(a.languages);
  const matchedLangs = (intent.languages ?? []).map((l) => l.toLowerCase()).filter((l) => langMatches(langs, l));
  if ((intent.languages ?? []).length && matchedLangs.length) {
    s += 0.10 * Math.min(1, matchedLangs.length / (intent.languages ?? []).length);
    cites.push(`speaks ${matchedLangs.join(', ')} (requested)`);
  }

  // The one lexical rule kept, and safe precisely because a focus area can never filter.
  const focus = codeSet(a.focusAreas);
  const matchedFocus = (intent.focusAreas ?? []).map((f) => f.toLowerCase())
    .filter((f) => focus.some((x) => x.includes(f) || f.includes(x)));
  if (matchedFocus.length) {
    s += Math.min(0.10, 0.05 * matchedFocus.length);
    cites.push(`focus: ${matchedFocus.join(', ')}`);
  }

  // ── lexicalFallback — hack #3 demoted and made VISIBLE, not deleted ──
  // Gated on the caller having requested NO capability id. A question the catalog cannot parse still
  // routes; it just says so in its evidence, so a result that passes for the old reason is
  // inspectable instead of indistinguishable from a structured one (ADR-0013).
  const lexicalOnly = needed.length === 0;
  if (lexicalOnly) {
    // The capability ids are part of the haystack: they are the most specific words an agent has
    // published about itself, and leaving them out meant a query naming a capability in prose could not
    // reach the agent that declares it.
    const hay = [a.name, a.displayName, a.description, a.skills, (a.capabilityIds ?? []).join(' ')]
      .filter(Boolean).join(' ').toLowerCase();
    let lex = 0;
    if (!need) lex = 0.15;
    else {
      const toks = need.split(/\s+/).filter((t) => t.length > 2);
      const tokHits = toks.filter((t) => hay.includes(t)).length;
      if (toks.length) lex = tokHits / toks.length;
      if (a.name?.toLowerCase().includes(need)) lex = 1;
    }
    for (const sk of intent.skills ?? []) if (hay.includes(sk.toLowerCase())) lex = Math.min(1, lex + 0.2);
    if (lex > 0) {
      // WEIGHT 0.85, not 0.15. `lexicalOnly` is a property of the QUERY, not of the candidate — when no
      // capability id resolved, every candidate is scored this way, so there is no structured signal for
      // a small cap to protect. Capping it anyway made a perfect text match score 15/100 while a total
      // mismatch scored 0, which is an ordering with almost no range and an ARD `score` that reads as
      // "nothing matched" even for the best hit. Scaling a term that is the only term is
      // ORDER-PRESERVING, so /discover ranks exactly as before; only the reported magnitude changes.
      s += 0.85 * lex;
      cites.push('— no capability id resolved from the question; ranked on text alone');
    }
  }

  // spec 286 — crawled per-skill Offerings: a precise, callable advertisement. Kept, but it can no
  // longer outweigh a declared capability the way it did when everything was lexical.
  const offered = (a.offerings ?? []).map((o) => o.skillId.toLowerCase());
  if (offered.length) {
    const wantToks = [...needed, ...(intent.skills ?? []).map((s2) => s2.toLowerCase())];
    const matched = [...new Set(offered.filter((id) => wantToks.some((t) => id.includes(t))))];
    if (matched.length) { s += Math.min(0.10, 0.05 * matched.length); cites.push(`offers ${matched.length} matching skill(s): ${matched.slice(0, 3).join(', ')}`); }
  }

  return {
    score: Math.min(s, 1),
    capabilityHits: exact.length + specHits.length,
    regionHits: matchedRegions.length,
    lexicalOnly,
  };
}

/** Absolute public-trust signal (0..1) — registry standing, SHACL conformance, facet richness, and (G1) the
 *  actual TRUST FABRIC: bilateral relationship edges and third-party attestations.
 *
 *  Until the projector/store fix, no relationship or attestation triple existed in the graph at all, so
 *  `facets` maxed out at 4 and this score was effectively REGISTRATION-ONLY: an agent that ten peers had
 *  endorsed scored exactly the same as one nobody had ever vouched for. The two terms below are what makes
 *  the ranking honest. Both are deliberately weighted BELOW registration and saturate quickly — a public
 *  edge is cheap to create, so it is corroboration, never authority (ADR-0040), and the caps stop an agent
 *  from farming reciprocal edges to the top of the list.
 *
 *  Requester-RELATIVE trust (is this counterparty in *my* graph?) and outcome history remain deferred to
 *  spec 281; this is the absolute, public-evidence score. */
function trustScore(a: AgentResult, cites: string[]): number {
  let s = 0;
  if (isRegistered(a)) { s += 0.5; cites.push('active registry entry'); }
  if (a.shaclConforms) { s += 0.2; cites.push('SHACL-conformant (cbox shapes)'); }
  s += Math.min(a.facets.length, 6) * 0.05;
  if (a.facets.length) cites.push(`${a.facets.length} on-chain facet(s): ${a.facets.join(', ')}`);
  // Bilateral, on-chain-confirmed relationship edges (both parties consented; ACTIVE only).
  const edges = a.activeRelationships ?? 0;
  if (edges > 0) { s += Math.min(0.15, 0.05 * edges); cites.push(`${edges} active relationship edge(s) in the public trust fabric`); }
  // Claimed-capability tier — third-party endorsement corroboration. Uses DISTINCT NON-SELF issuers
  // (`independentEndorsers`), not raw attestation volume: self-endorsement counts for nothing and N
  // endorsements from one issuer count once — both already collapsed at projection (capability-architecture
  // §2, facet-registries anti-pattern 5). Capped below registration and saturating fast: an endorsement is
  // cheap to create, so it corroborates, never authorises (ADR-0040), and same-org collusion the graph
  // cannot see is contained by this cap. This replaces the pre-endorsement `validAttestations` term, which
  // counted self-endorsements and volume — exactly the gameable signal the claimed tier exists to fix.
  const endorsers = a.independentEndorsers ?? 0;
  if (endorsers > 0) { s += Math.min(0.10, 0.05 * endorsers); cites.push(`${endorsers} independent endorser(s) (self-endorsement & volume excluded)`); }
  return Math.min(s, 1);
}

/** Score + surface one mandate-passing candidate as an ontology-typed apdisc:MatchCandidate. */
function matchCandidate(a: AgentResult, intent: Intent, satisfiedMandates: string[]) {
  const cites: string[] = [];
  const f = fitScore(a, intent, cites);
  const fit = f.score;
  const trust = trustScore(a, cites);
  const score = Math.round(Math.min(W_FIT * fit + W_TRUST * trust, 1) * 100) / 100;
  return {
    '@type': `${APDISC}MatchCandidate`,
    [`${APDISC}candidateAgent`]: { '@type': `${AP}Agent`, [`${AP}smartAgent`]: a.smartAgent, name: a.name, facets: a.facets },
    [`${APDISC}hasTrustDetermination`]: {
      '@type': `${APDISC}TrustDetermination`,
      [`${APDISC}confidence`]: score,
      [`${APDISC}citesEvidence`]: cites,
      note: 'over PUBLIC evidence — informs ranking, not authority to act',
    },
    [`${APDISC}hasEvidencePath`]: {
      '@type': `${APDISC}EvidencePath`,
      'sh:conforms': a.shaclConforms,
      citedFacets: a.facets,
      agentNode: a.agent,
      basis: {
        fitScore: Math.round(fit * 100) / 100, trustScore: Math.round(trust * 100) / 100,
        weights: { fit: W_FIT, trust: W_TRUST },
        // Named so a caller can assert WHICH term carried a result, not just that it won. A result
        // whose only term is the lexical fallback is a routing question the catalog cannot parse —
        // it is reported, never hidden.
        capabilityHits: f.capabilityHits, regionHits: f.regionHits, lexicalOnly: f.lexicalOnly,
      },
    },
    [`${APDISC}matchScore`]: score,
    [`${APDISC}matchScoreBasis`]: Math.round(score * 10000), // smart-agent SHACL-precision convention (0..10000)
    satisfiedMandates,
    // flattened convenience fields (UI):
    name: a.name, smartAgent: a.smartAgent, facets: a.facets, shaclConforms: a.shaclConforms,
    registered: isRegistered(a), score, why: cites,
    capabilityIds: a.capabilityIds ?? [],
    capabilityHits: f.capabilityHits, regionHits: f.regionHits, lexicalOnly: f.lexicalOnly,
    offerings: a.offerings ?? [],
    // Structured discovery facets + trust fabric, surfaced so a caller can see WHY a candidate ranked.
    kind: a.kind ?? null, languages: a.languages ?? null, regions: a.regions ?? null, focusAreas: a.focusAreas ?? null,
    // spec 346 §8.5 — the DERIVED type (from the SA-keyed on-chain record), the name's suffix (a projection,
    // never authority) and the service role. Surfaced so a caller can group by type; never a ranking input.
    agentType: a.agentType ?? null, tld: a.tld ?? null, serviceRole: a.serviceRole ?? null,
    activeRelationships: a.activeRelationships ?? 0, attestations: a.attestations ?? 0, validAttestations: a.validAttestations ?? 0,
    // Claimed-capability tier — the honest independent-endorser count, plus the capability ids this
    // candidate was BOTH declared AND independently endorsed for (the ones the fit boost fired on).
    independentEndorsers: a.independentEndorsers ?? 0,
    endorsedCapabilityIds: (a.capabilityIds ?? [])
      .filter((id) => (intent.capabilityIds ?? []).map((x) => x.toLowerCase()).includes(id.toLowerCase())
        && independentEndorsementWeight(a, id, Math.floor(Date.now() / 1000)) > 0),
  };
}

// The discover skill (A2A-style; browser/clients POST here). Filter → score → surface (spec 281):
//   mandates = HARD filters (drop failures) · intent = SOFT rank (0.6·fit + 0.4·trust) · evidence path out.
// `intent` may be a structured object {need,skills?,geo?} OR a bare string (legacy = the need); a bare
// {query} still works (free-text), so existing callers (the Registry tab's loadRegistry) are unaffected.
/** The discovery pipeline (spec 281): fetch → enrich → HARD mandates → SOFT rank. Shared by `/discover` and the
 *  ARD `/search` surface so both rank the same way; only the response envelope differs. */
async function runDiscovery(env: Env, args: { q: string; intent: Intent; mandates?: Mandates; limit?: number }): Promise<{ ok: true; ranked: ReturnType<typeof matchCandidate>[]; candidates: AgentResult[]; dropped: number; droppedBy: Partial<Record<MandateKey, number>> } | { ok: false; error: string }> {
  const { intent, mandates, q } = args;
  const limit = args.limit ?? (q ? 25 : 100);
  const mcp = await mcpGet(env, `/search?q=${encodeURIComponent(q)}&limit=${limit}`).catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return { ok: false, error: mcp?.error ?? 'discovery MCP unavailable' };
  const candidates = mcp.results as AgentResult[];
  const needsOfferings = !!(mandates?.requireSkillId || mandates?.requireSkill || intent.skills?.length);
  if (needsOfferings) await enrichOfferings(env, candidates);
  const needsEndorsements = !!(intent.capabilityIds?.length || mandates?.requireCapabilityId);
  if (needsEndorsements) await enrichEndorsements(env, candidates);
  let dropped = 0;
  const droppedBy: Partial<Record<MandateKey, number>> = {};
  const ranked = candidates
    .map((a) => { const sat = mandatePass(a, mandates); if (!Array.isArray(sat)) { dropped++; droppedBy[sat.failed] = (droppedBy[sat.failed] ?? 0) + 1; return null; } return matchCandidate(a, intent, sat); })
    .filter((x): x is ReturnType<typeof matchCandidate> => x !== null)
    .sort((x, y) => (y.score as number) - (x.score as number)
      || y.capabilityHits - x.capabilityHits
      || y.regionHits - x.regionHits
      || Number(x.lexicalOnly) - Number(y.lexicalOnly)
      || (x.name ?? '').localeCompare(y.name ?? ''));
  return { ok: true, ranked, candidates, dropped, droppedBy };
}

app.post('/discover', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    query?: string; intent?: Intent | string; mandates?: Mandates; limit?: number;
  };
  const intent: Intent = typeof body.intent === 'string' ? { need: body.intent } : (body.intent ?? {});
  const mandates = body.mandates;
  const q = (body.query ?? '').toString();
  // An explicit `query` is a precise substring FILTER at the MCP; an intent `need` is a natural-language
  // DESCRIPTION that should RANK (fitScore), not filter — so runDiscovery fetches the broad candidate set when
  // intent-driven and lets the matcher rank it (see runDiscovery for the ordering rules).
  const run = await runDiscovery(c.env, { q, intent, mandates, limit: body.limit });
  if (!run.ok) return c.json({ ok: false, error: run.error }, 502);
  const { ranked, dropped, droppedBy } = run;
  return c.json({
    ok: true,
    '@context': { apdisc: APDISC, ap: AP, sh: 'http://www.w3.org/ns/shacl#' },
    '@type': `${APDISC}CandidateQuery`,
    query: q,
    intent,
    mandates: mandates ?? null,
    matched: ranked.length,
    droppedByMandates: dropped,
    // Per-mandate elimination counts so a UI can say WHICH filter emptied the list (design 2026-08-30).
    droppedBy,
    source: 'discovery-mcp → GraphDB (agentic-trust ontology: T-box + C-box SHACL + A-box)',
    results: ranked,
  });
});

// Agent detail — the full A-box node for one agent (every on-chain facet), via the MCP get_agent tool.
// Browser → A2A → MCP → GraphDB, same as discovery.
app.get('/agent', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  const r = await mcpGet(c.env, `/agent?key=${encodeURIComponent(key)}`).catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

// Offerings (spec 286) — the crawled per-skill Offerings one agent advertises (from its public A2A card,
// host-asserted + provenance). Browser → A2A → MCP → GraphDB. The drill-down behind a discovery result.
// Facets for the search filters — proxied straight through (same pattern as /offerings, /trust).
app.get('/facets', async (c) => {
  const r = await mcpGet(c.env, '/facets').catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

app.get('/offerings', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  const r = await mcpGet(c.env, `/offerings?key=${encodeURIComponent(key)}`).catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

// Trust fabric (G1) — one agent's relationship edges + attestations, the evidence behind its trust score.
// Browser → A2A → MCP → GraphDB. Returned nothing for every agent before the projector/store fix.
app.get('/trust', async (c) => {
  const key = c.req.query('key') ?? '';
  if (!key) return c.json({ ok: false, error: 'key (name or 0x SA) required' }, 400);
  const r = await mcpGet(c.env, `/trust?key=${encodeURIComponent(key)}`).catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

// Custody check (ADR-0040) — which candidate agents does the viewer's credential custody? Proxies the MCP
// check_custody tool (exact-match over opaque, on-chain-reproducible membership tokens). Browser → A2A →
// MCP → GraphDB. The credential is the viewer's own on-chain identifier (EOA / passkey digest); nothing is
// stored, and the answer reveals nothing the chain doesn't.
app.post('/custody', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { subjectAgents?: unknown; credential?: unknown };
  const r = await mcpPost(c.env, '/custody', { subjectAgents: body.subjectAgents, credential: body.credential }).catch((e) => ({ ok: false, error: String(e) }));
  return c.json(r);
});

// ─── ARD (Agentic Resource Discovery v0.91) — spec 347 §8.5, docs/architecture/ard-acp-crosswalk.md ────────
// The registry's public discovery envelope. `score` = relevance ONLY (the fit term); trust evidence is a separate
// namespaced signal. MCP surfaces are never entries (ADR-0057). Errors use ARD Appendix B codes.
const REGISTRY_DISPLAY = { name: 'discovery.registry', displayName: 'Agentic Primitives Discovery Registry', description: 'Smart-Agent-anchored agent registry: typed names, on-chain profiles, verifiable trust evidence. Serves ARD search over the public knowledge graph.', representativeQueries: ['find a registered agent for a task', 'which agents declare a given capability id', 'list the organizations, teams and services in this registry', 'discover a treasury or workspace agent agent'] };
const registryOrigin = (c: { env: Env; req: { url: string } }) => (c.env.A2A_PUBLIC_ORIGIN ?? new URL(c.req.url).origin).replace(/\/$/, '');
/** Join a ranked match back to its KB row: the match carries scores + evidence, the ROW carries the facts an
 *  ARD entry is built from (a2aEndpoint, description, capability ids). */
function toRanked(m: ReturnType<typeof matchCandidate>, rows: AgentResult[]): RankedLike {
  const basis = (m as Record<string, unknown>)[`${APDISC}hasEvidencePath`] as { basis?: { fitScore?: number; trustScore?: number } } | undefined;
  const row = rows.find((r) => r.smartAgent === m.smartAgent) ?? ({ smartAgent: m.smartAgent } as AgentResult);
  return { ...row, fitScore: basis?.basis?.fitScore ?? 0, trustScore: basis?.basis?.trustScore, why: m.why, shaclConforms: m.shaclConforms };
}

app.get(ARD_WELL_KNOWN_PATH, async (c) => {
  const origin = registryOrigin(c);
  const mcp = await mcpGet(c.env, '/search?q=&limit=500').catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return c.json({ error: { code: 'INTERNAL_ERROR', message: mcp?.error ?? 'discovery MCP unavailable' } }, 500);
  const entries = (mcp.results as AgentResult[]).map((r) => ardEntryForAgent(r).entry).filter((e): e is NonNullable<typeof e> => !!e);
  return c.json(ardManifest([ardRegistryEntry(origin, REGISTRY_DISPLAY), ...entries]), 200, { 'cache-control': 'public, max-age=300' });
});

app.post('/search', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Parameters<typeof planArdSearch>[0] | null;
  if (!body) return c.json(ardError({ status: 400, code: 'INVALID_ARGUMENT', message: 'body must be JSON' }), 400);
  const plan = planArdSearch(body, { textRequired: true }); // ARD §5.3.2 — /explore is the endpoint that takes no text
  if ('code' in plan) return c.json(ardError(plan), plan.status);
  const origin = registryOrigin(c);
  if (!plan.typeServable) return c.json({ '@context': undefined, results: [] });
  const run = await runDiscovery(c.env, { q: '', intent: { need: plan.need }, mandates: plan.mandates, limit: 100 });
  if (!run.ok) return c.json({ error: { code: 'INTERNAL_ERROR', message: run.error } }, 500);
  return c.json(ardSearchResponse(run.ranked.map((m) => toRanked(m, run.candidates)), plan, { source: `${origin}/search` }));
});

app.post('/explore', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Parameters<typeof ardExploreResponse>[0];
  // §5.3.3 — facets are computed over the MATCHED set, narrowed by the same text and filter as Search.
  // This used to hand the registry-wide aggregate straight back, so "which agent types match 'estate
  // planning'?" answered "which agent types exist?": a plausible number for a question nobody asked.
  // With NEITHER text nor filter the whole registry IS the matched set, and the cheap global aggregate
  // is then the right answer rather than a shortcut.
  const q = body.query ?? {};
  const narrowed = !!(q.text ?? '').toString().trim() || Object.keys(q.filter ?? {}).length > 0;
  let facets: unknown;
  if (narrowed) {
    const plan = planArdSearch({ query: q });
    if ('code' in plan) return c.json(ardError(plan), plan.status);
    if (!plan.typeServable) return c.json({ resultType: 'facets', facets: {} });
    const run = await runDiscovery(c.env, { q: '', intent: { need: plan.need }, mandates: plan.mandates, limit: 500 });
    if (!run.ok) return c.json({ error: { code: 'INTERNAL_ERROR', message: run.error } }, 500);
    // The SAME cutoff as Search — §5.3.3 requires one cutoff per registry, not one per endpoint.
    const matched = applyRelevanceCutoff(run.ranked.map((m) => toRanked(m, run.candidates)), plan.need.length > 0);
    facets = facetsOverMatches(matched);
  } else {
    const global = await mcpGet(c.env, '/facets').catch((e) => ({ ok: false, error: String(e) }));
    if (!global?.ok) return c.json({ error: { code: 'INTERNAL_ERROR', message: global?.error ?? 'discovery MCP unavailable' } }, 500);
    facets = global;
  }
  const out = ardExploreResponse(body, facets as Parameters<typeof ardExploreResponse>[1]);
  if ('code' in out) return c.json(ardError(out), out.status);
  return c.json(out);
});

app.get('/agents', async (c) => {
  const f = parseAgentsFilter(c.req.query('filter'));
  if ('code' in f) return c.json(ardError(f), f.status);
  const pageSize = c.req.query('pageSize') ? Number(c.req.query('pageSize')) : undefined;
  const mcp = await mcpGet(c.env, '/search?q=&limit=500').catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return c.json({ error: { code: 'INTERNAL_ERROR', message: mcp?.error ?? 'discovery MCP unavailable' } }, 500);
  const out = ardAgentsResponse(mcp.results as AgentResult[], { ...f, pageSize, pageToken: c.req.query('pageToken'), ...(c.req.query('orderBy') ? { orderBy: c.req.query('orderBy')! } : {}) });
  if ('code' in out) return c.json(ardError(out), out.status);
  return c.json(out, 200, { 'cache-control': 'public, max-age=300' });
});

// ─── ACP registry (Agent Client Protocol) — aggregate projection, spec 347 §8.5 ─────────────────────────────
// Schema-exact `{version, agents[]}`; eligible agents declare an ACP distribution on their canonical profile.
// Empty until the first agent does — honest, never seeded. `x-ap-skipped` says why rows were not listed.
app.get(ACP_REGISTRY_PATH, async (c) => {
  const mcp = await mcpGet(c.env, '/search?q=&limit=500').catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return c.json({ error: { code: 'INTERNAL_ERROR', message: mcp?.error ?? 'discovery MCP unavailable' } }, 500);
  const { registry, skipped } = acpRegistry(mcp.results as AgentResult[]);
  return c.json(registry, 200, { 'cache-control': 'public, max-age=300', 'x-ap-skipped': JSON.stringify(skipped) });
});

app.get('/', (c) => c.json({ service: 'demo-discovery-a2a', card: '/.well-known/agent-card.json', ard: { manifest: ARD_WELL_KNOWN_PATH, search: 'POST /search', explore: 'POST /explore', agents: 'GET /agents' }, acpRegistry: ACP_REGISTRY_PATH, discover: 'POST /discover {query?, intent?:{need,skills?,geo?,languages?,regions?,focusAreas?}, mandates?:{requireRegistered?,requireShaclConforms?,requireKind?,requireSkill?,requireSkillId?,requireLanguage?,requireRegion?,requireAttestation?,requireRelationship?,geo?}}', trust: 'GET /trust?key=', agent: 'GET /agent?key=', custody: 'POST /custody {subjectAgents,credential}' }));

export default app;
