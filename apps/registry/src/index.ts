// demo-discovery-a2a — the discovery agent surface (mirrors demo-bible-a2a). Advertises a
// `discover-agents` skill and orchestrates the discovery MCP over the knowledge base: query → MCP
// search_agents → rank → best agents (+ evidence). Browser → A2A → MCP → GraphDB.
//
// v1 ranking is lexical + facet-richness; this is the seam where INTENT + MANDATE matching grows — the
// agent will parse a stated intent/mandate, expand it (skills/geo/trust), query the graph, and return the
// best agents with an explainable evidence path. It evolves into a full-featured discovery app.

import { Hono } from 'hono';
import { cors } from 'hono/cors';

interface Env {
  MCP_URL?: string;
  AGENT_NAME?: string;
  A2A_PUBLIC_ORIGIN?: string;
  // Service binding to demo-discovery-mcp (production; Workers can't fetch each other by public URL).
  MCP?: { fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> };
}

/** A crawled per-skill offering (spec 286), as surfaced by the MCP get_offerings tool. */
interface OfferingLite { skillId: string; effect?: string | null; family?: string | null; status?: string | null }
interface AgentResult {
  agent: string; name: string | null; smartAgent: string; facets: string[]; shaclConforms: boolean;
  registryStatus?: string | null; displayName?: string | null; description?: string | null; skills?: string | null;
  /** G2/G3/G4 — owner-asserted, comma-separated discovery-ranking facets (approf:languages/regions/focusAreas). */
  languages?: string | null; regions?: string | null; focusAreas?: string | null;
  /** G1 — the trust fabric, now actually projected into the graph. */
  activeRelationships?: number; attestations?: number; validAttestations?: number;
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
interface Intent { need?: string; skills?: string[]; geo?: string; languages?: string[]; regions?: string[]; focusAreas?: string[] }
interface Mandates {
  requireRegistered?: boolean; requireShaclConforms?: boolean; requireKind?: string;
  requireSkill?: string; requireSkillId?: string; geo?: string;
  requireLanguage?: string; requireRegion?: string;
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
function mandatePass(a: AgentResult, m: Mandates | undefined): string[] | null {
  const satisfied: string[] = [];
  if (!m) return satisfied;
  if (m.requireRegistered) { if (!isRegistered(a)) return null; satisfied.push('registered'); }
  if (m.requireShaclConforms) { if (!a.shaclConforms) return null; satisfied.push('shaclConforms'); }
  if (m.requireSkill) { const hay = [a.skills, a.description, a.displayName, ...(a.offerings ?? []).map((o) => o.skillId)].filter(Boolean).join(' ').toLowerCase(); if (!hay.includes(m.requireSkill.toLowerCase())) return null; satisfied.push(`skill:${m.requireSkill}`); }
  if (m.requireSkillId) { const want = m.requireSkillId.toLowerCase(); if (!(a.offerings ?? []).some((o) => o.skillId.toLowerCase().includes(want))) return null; satisfied.push(`offering:${m.requireSkillId}`); }
  // G3 — `geo` used to be a substring search over the free-text description blob, applied as a HARD filter:
  // an advisor who covers the EU but lacks the literal token was silently eliminated. It is now set
  // membership over the agent's published `approf:regions` codes, with the description search kept ONLY as
  // a fallback for agents that have not published the structured facet yet (so the change cannot drop a
  // candidate that used to pass). Prefer `requireRegion` — `geo` stays for existing callers.
  if (m.geo) {
    const want = m.geo.toLowerCase();
    const regions = codeSet(a.regions);
    const ok = regions.length ? regions.includes(want) : (a.description ?? '').toLowerCase().includes(want);
    if (!ok) return null;
    satisfied.push(`geo:${m.geo}`);
  }
  if (m.requireRegion) { const want = m.requireRegion.toLowerCase(); if (!codeSet(a.regions).includes(want)) return null; satisfied.push(`region:${m.requireRegion}`); }
  if (m.requireLanguage) { const want = m.requireLanguage.toLowerCase(); if (!langMatches(codeSet(a.languages), want)) return null; satisfied.push(`language:${m.requireLanguage}`); }
  if (m.requireAttestation) { if (!(a.validAttestations ?? 0)) return null; satisfied.push('attested'); }
  if (m.requireRelationship) { if (!(a.activeRelationships ?? 0)) return null; satisfied.push('relationship'); }
  // G7 — `requireKind` used to push a satisfied string and filter NOTHING. `kindClass` (ap:PersonAgent /
  // OrganizationAgent / ServiceAgent, ADR-0046) IS projected and is now bound by the MCP, so the mandate
  // enforces. Accepts 'person' | 'org' | 'service' or the full class local name.
  if (m.requireKind) {
    const want = m.requireKind.toLowerCase().replace(/agent$/, '');
    const have = (a.kind ?? '').toLowerCase().replace(/agent$/, '');
    const alias: Record<string, string> = { org: 'organization', organisation: 'organization' };
    if (!have || (alias[want] ?? want) !== have) return null;
    satisfied.push(`kind:${m.requireKind}`);
  }
  return satisfied;
}

/** Soft INTENT fit (0..1): lexical relevance of the need against name + profile text + skills. */
function fitScore(a: AgentResult, intent: Intent, cites: string[]): number {
  const need = (intent.need ?? '').trim().toLowerCase();
  const hay = [a.name, a.displayName, a.description, a.skills].filter(Boolean).join(' ').toLowerCase();
  let s = 0;
  if (!need) { s = 0.15; }
  else {
    if (a.name?.toLowerCase().includes(need)) { s += 0.6; cites.push(`name matches “${intent.need}”`); }
    if (a.displayName?.toLowerCase().includes(need) || a.description?.toLowerCase().includes(need)) { s += 0.4; cites.push('profile text matches the need'); }
    const toks = need.split(/\s+/).filter((t) => t.length > 2);
    const tokHits = toks.filter((t) => hay.includes(t)).length;
    if (toks.length) { s += 0.4 * (tokHits / toks.length); if (tokHits) cites.push(`${tokHits}/${toks.length} need term(s) matched`); }
  }
  for (const sk of intent.skills ?? []) { if (hay.includes(sk.toLowerCase())) { s += 0.2; cites.push(`skill “${sk}” present`); } }
  // G2/G3/G4 — the structured discovery facets. Each is a SOFT boost: an agent that has not published the
  // facet is not penalised (it is unknown, not absent), and `focusAreas` is capped hardest because a focus
  // area is an emphasis, never a boundary (facet-registries G4 — it must never become a filter).
  const langs = codeSet(a.languages);
  const matchedLangs = (intent.languages ?? []).map((l) => l.toLowerCase()).filter((l) => langMatches(langs, l));
  if (matchedLangs.length) { s += Math.min(0.2, 0.1 * matchedLangs.length); cites.push(`speaks ${matchedLangs.join(', ')}`); }
  const regions = codeSet(a.regions);
  const matchedRegions = (intent.regions ?? []).map((r) => r.toLowerCase()).filter((r) => regions.includes(r));
  if (matchedRegions.length) { s += Math.min(0.2, 0.1 * matchedRegions.length); cites.push(`covers ${matchedRegions.map((r) => r.toUpperCase()).join(', ')}`); }
  // G3 — `intent.geo` was a DECLARED-BUT-DEAD field: no scoring function read it. It now soft-boosts
  // against the published region codes (the hard-filter version lives in `mandates.requireRegion`).
  if (intent.geo && regions.includes(intent.geo.toLowerCase())) { s += 0.1; cites.push(`covers ${intent.geo.toUpperCase()}`); }
  const focus = codeSet(a.focusAreas);
  const matchedFocus = (intent.focusAreas ?? []).map((f) => f.toLowerCase()).filter((f) => focus.some((x) => x.includes(f) || f.includes(x)));
  if (matchedFocus.length) { s += Math.min(0.15, 0.075 * matchedFocus.length); cites.push(`focus area(s): ${matchedFocus.join(', ')}`); }
  // The free-text need also gets credit for hitting a published focus area (a subject-domain match is
  // weaker evidence than a declared capability, so it is worth less than the skills boost above).
  if (need && focus.some((f) => need.includes(f) || f.includes(need))) { s += 0.1; cites.push('focus area matches the need'); }
  // spec 286 — boost on the crawled per-skill Offerings (a precise, callable advertisement, stronger than a
  // coarse label match): an offered skillId matching the need tokens or an intent skill.
  const offered = (a.offerings ?? []).map((o) => o.skillId.toLowerCase());
  if (offered.length) {
    const wantToks = [...(intent.skills ?? []).map((s2) => s2.toLowerCase()), ...((need ? need.split(/\s+/) : []).filter((t) => t.length > 2))];
    const matched = [...new Set(offered.filter((id) => wantToks.some((t) => id.includes(t))))];
    if (matched.length) { s += Math.min(0.3, 0.15 * matched.length); cites.push(`offers ${matched.length} matching skill(s): ${matched.slice(0, 3).join(', ')}`); }
  }
  return Math.min(s, 1);
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
  // Third-party attestations where this agent is the SUBJECT. Only VALID (non-revoked) ones count.
  const atts = a.validAttestations ?? 0;
  if (atts > 0) { s += Math.min(0.15, 0.05 * atts); cites.push(`${atts} valid attestation(s) from third parties`); }
  return Math.min(s, 1);
}

/** Score + surface one mandate-passing candidate as an ontology-typed apdisc:MatchCandidate. */
function matchCandidate(a: AgentResult, intent: Intent, satisfiedMandates: string[]) {
  const cites: string[] = [];
  const fit = fitScore(a, intent, cites);
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
      basis: { fitScore: Math.round(fit * 100) / 100, trustScore: Math.round(trust * 100) / 100, weights: { fit: W_FIT, trust: W_TRUST } },
    },
    [`${APDISC}matchScore`]: score,
    [`${APDISC}matchScoreBasis`]: Math.round(score * 10000), // smart-agent SHACL-precision convention (0..10000)
    satisfiedMandates,
    // flattened convenience fields (UI):
    name: a.name, smartAgent: a.smartAgent, facets: a.facets, shaclConforms: a.shaclConforms,
    registered: isRegistered(a), score, why: cites,
    offerings: a.offerings ?? [],
    // Structured discovery facets + trust fabric, surfaced so a caller can see WHY a candidate ranked.
    kind: a.kind ?? null, languages: a.languages ?? null, regions: a.regions ?? null, focusAreas: a.focusAreas ?? null,
    activeRelationships: a.activeRelationships ?? 0, attestations: a.attestations ?? 0, validAttestations: a.validAttestations ?? 0,
  };
}

// The discover skill (A2A-style; browser/clients POST here). Filter → score → surface (spec 281):
//   mandates = HARD filters (drop failures) · intent = SOFT rank (0.6·fit + 0.4·trust) · evidence path out.
// `intent` may be a structured object {need,skills?,geo?} OR a bare string (legacy = the need); a bare
// {query} still works (free-text), so existing callers (the Registry tab's loadRegistry) are unaffected.
app.post('/discover', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    query?: string; intent?: Intent | string; mandates?: Mandates; limit?: number;
  };
  const intent: Intent = typeof body.intent === 'string' ? { need: body.intent } : (body.intent ?? {});
  const mandates = body.mandates;
  // An explicit `query` is a precise substring FILTER at the MCP; an intent `need` is a natural-language
  // DESCRIPTION that should RANK (fitScore), not filter — so we fetch the broad candidate set (no MCP text
  // filter) and let the matcher rank it. Without this, "help managing a treasury" filtered to 0 (no name
  // contains that phrase). Fetch wider when intent-driven so ranking has the full field to work over.
  const q = (body.query ?? '').toString();
  const limit = body.limit ?? (q ? 25 : 100);

  const mcp = await mcpGet(c.env, `/search?q=${encodeURIComponent(q)}&limit=${limit}`).catch((e) => ({ ok: false, error: String(e) }));
  if (!mcp?.ok) return c.json({ ok: false, error: mcp?.error ?? 'discovery MCP unavailable' }, 502);

  const candidates = mcp.results as AgentResult[];

  // spec 286 — when matching turns on skill granularity (a skill mandate or intent skills), enrich candidates
  // with their crawled Offerings so the filter/rank works over the FULL per-skill set, not just coarse
  // labels. Bounded + logged (no silent truncation, ADR-0013); skip entirely when no skill signal is given.
  const needsOfferings = !!(mandates?.requireSkillId || mandates?.requireSkill || intent.skills?.length);
  if (needsOfferings) await enrichOfferings(c.env, candidates);

  let dropped = 0;
  const ranked = candidates
    .map((a) => { const sat = mandatePass(a, mandates); if (sat === null) { dropped++; return null; } return matchCandidate(a, intent, sat); })
    .filter((x): x is ReturnType<typeof matchCandidate> => x !== null)
    .sort((x, y) => (y.score as number) - (x.score as number));

  return c.json({
    ok: true,
    '@context': { apdisc: APDISC, ap: AP, sh: 'http://www.w3.org/ns/shacl#' },
    '@type': `${APDISC}CandidateQuery`,
    query: q,
    intent,
    mandates: mandates ?? null,
    matched: ranked.length,
    droppedByMandates: dropped,
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

app.get('/', (c) => c.json({ service: 'demo-discovery-a2a', card: '/.well-known/agent-card.json', discover: 'POST /discover {query?, intent?:{need,skills?,geo?,languages?,regions?,focusAreas?}, mandates?:{requireRegistered?,requireShaclConforms?,requireKind?,requireSkill?,requireSkillId?,requireLanguage?,requireRegion?,requireAttestation?,requireRelationship?,geo?}}', trust: 'GET /trust?key=', agent: 'GET /agent?key=', custody: 'POST /custody {subjectAgents,credential}' }));

export default app;
