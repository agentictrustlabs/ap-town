// GraphDB (Ontotext, agentkg.io) read access for the discovery MCP. Holds creds server-side (Worker
// secrets) and runs SPARQL SELECT over the `smart-agents` A-box that agent-indexer populates.

import type { RetrieveEnv } from './retrieve.js';
import { decodeDistribution, type AgentDistributionV1 } from './distribution.js';
import { decideKbQuery } from './sparql-guard.js';
export interface Env extends RetrieveEnv {
  GRAPHDB_QUERY_URL: string;
  GRAPHDB_USER?: string;
  GRAPHDB_PASSWORD?: string;
  GRAPHDB_TOKEN?: string;
}

/** `ap:agentTypeScheme` concept IRI → the DerivedAgentType slug (spec 346 §11). Unknown/absent → null.
 *
 *  `WorkspaceCoordinatorType` is a concept the A-box may still carry: rows projected before the
 *  2026-08-31 rename hold it, and a read tier that refuses to decode its own history reports a correctly
 *  typed agent as untyped — which is exactly what happened (every `.workspace` agent dropped out of the
 *  type facet). Reading honours the past; the indexer only ever WRITES the current concept. */
const AGENT_TYPE_SLUG: Record<string, string> = {
  PersonType: 'person', OrgType: 'org', TeamType: 'team', ServiceType: 'service',
  WorkspaceType: 'workspace', TreasuryType: 'treasury', RegistryType: 'registry', ChurchType: 'church', HouseholdType: 'household', CircleType: 'circle',
  WorkspaceCoordinatorType: 'workspace',
};
export function derivedTypeSlug(iri: string | undefined): string | null {
  if (!iri) return null;
  return AGENT_TYPE_SLUG[iri.split('#').pop() ?? ''] ?? null;
}

const PREFIXES = `
PREFIX ap: <https://agenticprimitives.dev/ns/core#>
PREFIX apnam: <https://agenticprimitives.dev/ns/naming#>
PREFIX apreg: <https://agenticprimitives.dev/ns/registry#>
PREFIX approf: <https://agenticprimitives.dev/ns/profile#>
PREFIX apdisc: <https://agenticprimitives.dev/ns/discovery#>
PREFIX apatt: <https://agenticprimitives.dev/ns/attestation#>
PREFIX aptrust: <https://agenticprimitives.dev/ns/trust#>
`;

/**
 * THE DATASET A QUERY MAY SEE — finding KC-2b, fixed where it lives.
 *
 * GraphDB's default dataset for a query with no FROM is the UNION of every graph, so the custody
 * membership tokens were reachable from a plain default-graph pattern — `?s a ap:CustodyMember` returned
 * them — without naming the graph KC-2's guard refuses to name. That guard was doing what it said and
 * still not what it meant: no filter over query TEXT can help, because the query does not have to mention
 * the graph at all.
 *
 * So the dataset is CONSTRUCTED here rather than inherited. Every caller-supplied query runs against the
 * unnamed default graph (the A-box) plus the T-box, and nothing else. `sesame:nil` is how RDF4J/GraphDB
 * names the null context in the SPARQL protocol; naming it is what stops "default" meaning "everything".
 *
 * The custody graph is then reachable by exactly ONE code path — `checkCustody`, which recomputes a
 * single token and asks whether it exists. That is the property ADR-0040 always claimed and the
 * deployment did not have.
 */
const NULL_CONTEXT = 'http://www.openrdf.org/schema/sesame#nil';
const ONTOLOGY_GRAPH = 'urn:ap:ontology';
const CUSTODY_GRAPH_IRI = 'urn:ap:custody';
/** Spec 413 — published works (public + owner-released shelf documents), projected by the indexer after it verified the
 *  owner's signature (ADR-0040 amendment 2026-09-24). Public by construction, so it joins the public dataset. */
const SHELF_GRAPH = 'urn:ap:shelf';

/** The dataset for public reads: the A-box, the T-box and the shelf graph. Deliberately NOT the custody graph. */
const PUBLIC_DATASET = [NULL_CONTEXT, ONTOLOGY_GRAPH, SHELF_GRAPH];
/** The one dataset that can see custody — used only by the existence check. */
const CUSTODY_DATASET = [CUSTODY_GRAPH_IRI];

function endpoint(env: Env, graphs: readonly string[]): string {
  const url = new URL(env.GRAPHDB_QUERY_URL);
  for (const g of graphs) url.searchParams.append('default-graph-uri', g);
  return url.toString();
}

function authHeader(env: Env): Record<string, string> {
  if (env.GRAPHDB_TOKEN) return { authorization: `Bearer ${env.GRAPHDB_TOKEN}` };
  if (env.GRAPHDB_USER) return { authorization: `Basic ${btoa(`${env.GRAPHDB_USER}:${env.GRAPHDB_PASSWORD ?? ''}`)}` };
  return {};
}

export interface Binding { [k: string]: { value: string; type: string } }

export async function sparqlSelect(env: Env, query: string, opts: { dataset?: readonly string[] } = {}): Promise<Binding[]> {
  const res = await fetch(endpoint(env, opts.dataset ?? PUBLIC_DATASET), {
    method: 'POST',
    headers: { 'content-type': 'application/sparql-query', accept: 'application/sparql-results+json', ...authHeader(env) },
    body: PREFIXES + query,
  });
  if (!res.ok) throw new Error(`GraphDB ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = (await res.json()) as { results?: { bindings?: Binding[] } };
  return json.results?.bindings ?? [];
}

// ── Read-only SPARQL over the public A-box (spec 357 W1) ───────────────────────────────────────────────
// The A-box is world-readable (ADR-0040), so exposing READ SPARQL over it is fine. What must not be
// exposed is federation (SERVICE makes the STORE fetch a URL — SSRF from its network position) or the
// custody membership graph (existence checks only, never enumeration). Those were the KC-2 findings.
//
// The DECISION now lives in `decideKbQuery`, which parses. The regexes it replaced could only say what a
// query did not look like; a syntax tree says what it does. See `src/sparql-guard.ts`.
const RESULT_CAP = 2000;
/** Wall clock. A public read tier owes a caller an answer or a refusal, not an open connection. */
const QUERY_TIMEOUT_MS = 15_000;
export interface KbResult { vars: string[]; rows: Record<string, string>[] }

async function askGraphDb(env: Env, query: string, accept: string): Promise<Response> {
  const res = await fetch(endpoint(env, PUBLIC_DATASET), {
    method: 'POST',
    headers: { 'content-type': 'application/sparql-query', accept, ...authHeader(env) },
    body: PREFIXES + query,
    signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GraphDB ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res;
}

/** The ADMIN KB browser: every read-only form, because navigating a T-box means ASK-ing and DESCRIBE-ing
 *  as much as selecting. Bindings out — this surface shows a table on purpose. */
export async function runKbQuery(env: Env, query: string): Promise<KbResult> {
  const decision = decideKbQuery(query, ['SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE']);
  if (!decision.ok) throw new Error(decision.refusal);
  const capped = decision.form === 'SELECT' && !decision.hasLimit ? `${query.trim()}\nLIMIT ${RESULT_CAP}` : query.trim();
  const res = await askGraphDb(env, capped, 'application/sparql-results+json');
  const json = (await res.json()) as { head?: { vars?: string[] }; results?: { bindings?: Binding[] }; boolean?: boolean };
  if (typeof json.boolean === 'boolean') return { vars: ['result'], rows: [{ result: String(json.boolean) }] };
  const vars = json.head?.vars ?? [];
  const rows = (json.results?.bindings ?? []).map((b) => Object.fromEntries(vars.map((v) => [v, b[v]?.value ?? ''])));
  return { vars, rows };
}

/**
 * The ANSWER path — spec 357 §3. CONSTRUCT only, JSON-LD out.
 *
 * A SELECT returns variable bindings: a table, whose columns mean whatever the query author had in mind.
 * A CONSTRUCT returns a GRAPH — entities with types and properties from the ontology — which serialises
 * as JSON-LD without anybody inventing a shape for it. That is why the answer path takes one form and not
 * the other, and why refusing the other is a feature rather than a restriction.
 *
 * FRAMED to a published `@context` (spec 357 W4): the store emits EXPANDED JSON-LD — full IRIs, every
 * value a `[{ "@value": … }]` array — which is stable but unreadable and different in shape for every
 * query. The context below maps the namespaces we actually serve to short prefixes and unwraps
 * single-valued literals, so an answer is the SAME JSON-LD whoever asked and whatever they asked, without
 * a triplestore-side frame or a jsonld.js dependency in the Worker. It is deterministic string work over
 * a graph the guard already bounded — no network, no context fetch (ADR-0040 stays intact).
 */
export interface KbGraphResult { jsonld: unknown; query: string; '@context'?: Record<string, string> }

/** The published prefixes — the interop contract for ARD/ACP consumers (crosswalk in docs). Stable: a
 *  consumer keys off these, so a prefix is added, never repurposed. */
export const KB_JSONLD_CONTEXT: Record<string, string> = {
  ap: 'https://agenticprimitives.dev/ns/core#',
  apnam: 'https://agenticprimitives.dev/ns/naming#',
  apreg: 'https://agenticprimitives.dev/ns/registry#',
  approf: 'https://agenticprimitives.dev/ns/profile#',
  apdisc: 'https://agenticprimitives.dev/ns/discovery#',
  aps: 'https://agenticprimitives.dev/ns/skill#',
  aporg: 'https://agenticprimitives.dev/ns/org#',
};

/** Compact one IRI to `prefix:local` when its namespace is published; leave it whole otherwise (an
 *  unpublished IRI compacted to a bare local would be a lie about which vocabulary it is). */
function compactIri(iri: string): string {
  for (const [pfx, ns] of Object.entries(KB_JSONLD_CONTEXT)) {
    if (iri.startsWith(ns)) return `${pfx}:${iri.slice(ns.length)}`;
  }
  return iri;
}

/** Expanded JSON-LD → framed. `@id`/`@type` compacted; a single `[{ "@value" }]` unwrapped to the value;
 *  a single `[{ "@id" }]` unwrapped to the reference. Multi-valued stays an array — losing multiplicity to
 *  make a shape prettier is the framing lying about the data. */
export function frameForTest(node: unknown): unknown { return frameNode(node); }
/** A `{ "@value": … }` or single `{ "@id": … }` wrapper → its bare value. Anything else → frameNode. */
function unwrapValue(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if ('@value' in o && Object.keys(o).every((k) => k === '@value' || k === '@type' || k === '@language')) return o['@value'];
    if ('@id' in o && Object.keys(o).length === 1) return compactIri(String(o['@id']));
  }
  return frameNode(v);
}

function frameNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    const mapped = node.map(unwrapValue);
    return mapped.length === 1 ? mapped[0] : mapped;   // one value is the value; many stays a list
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (k === '@id') out['@id'] = compactIri(String(v));
      else if (k === '@type') out['@type'] = Array.isArray(v) ? v.map((t) => compactIri(String(t))) : compactIri(String(v));
      else out[compactIri(k)] = frameNode(v);
    }
    return out;
  }
  return node;
}

export async function runKbConstruct(env: Env, query: string): Promise<KbGraphResult> {
  const decision = decideKbQuery(query, ['CONSTRUCT']);
  if (!decision.ok) throw new Error(decision.refusal);
  const q = query.trim();
  // A CONSTRUCT's LIMIT bounds the SOLUTIONS its template is applied to, which is the thing that can run
  // away here. Unbounded, one careless triple pattern returns the graph.
  const capped = decision.hasLimit ? q : `${q}\nLIMIT ${RESULT_CAP}`;
  const res = await askGraphDb(env, capped, 'application/ld+json');
  const expanded = await res.json();
  // Framed to the published context — the same shape every time (spec 357 W4). The graph is under
  // `@graph`, so a single-node result and a many-node result read the same way.
  const nodes = Array.isArray(expanded) ? expanded : (expanded as { '@graph'?: unknown[] })['@graph'] ?? [expanded];
  return {
    '@context': KB_JSONLD_CONTEXT,
    jsonld: { '@context': KB_JSONLD_CONTEXT, '@graph': (nodes as unknown[]).map(frameNode) },
    // The query travels with the answer (spec 357 §4): an answer whose query nobody can inspect is a claim.
    query: capped,
  };
}

// ── Custody check (ADR-0040) ──────────────────────────────────────────────────────────────────────────
// Custodian membership is PUBLIC on-chain data; the indexer projects it as OPAQUE, public, on-chain-
// reproducible tokens — sha256(lower(credential)|lower(smartAgent)) — into a private named graph. We answer
// "does this viewer's credential control that agent?" by recomputing the token and asking whether it EXISTS
// (exact-match only — never an enumeration, never an agent→custodian edge). MUST hash identically to
// discovery-indexer/src/custody.ts.
const CUSTODY_GRAPH = 'urn:ap:custody';
const CUSTODY_MEMBER_CLASS = 'https://agenticprimitives.dev/ns/core#CustodyMember';

async function custodyToken(credential: string, smartAgent: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${credential.toLowerCase()}|${smartAgent.toLowerCase()}`));
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Which of `smartAgents` does `credential` (an EOA, passkey-PIA, or passkey credentialIdDigest) custody?
 *  One SELECT over the membership graph; returns { saLower → boolean }. */
export async function checkCustody(env: Env, smartAgents: string[], credential: string): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const tokenBySa = new Map<string, string>(); // token → saLower
  for (const sa of smartAgents) { out[sa.toLowerCase()] = false; tokenBySa.set(await custodyToken(credential, sa), sa.toLowerCase()); }
  if (!tokenBySa.size) return out;
  const values = [...tokenBySa.keys()].map((t) => `<urn:ap:cm:${t}>`).join(' ');
  // The ONE query that may see the membership graph, and it asks only "do these exact tokens exist".
  // Every other path runs against PUBLIC_DATASET, which does not include it (KC-2b).
  const rows = await sparqlSelect(
    env,
    `SELECT ?m WHERE { GRAPH <${CUSTODY_GRAPH}> { VALUES ?m { ${values} } ?m a <${CUSTODY_MEMBER_CLASS}> } }`,
    { dataset: CUSTODY_DATASET },
  );
  for (const r of rows) { const sa = tokenBySa.get(r.m!.value.replace('urn:ap:cm:', '')); if (sa) out[sa] = true; }
  return out;
}

const esc = (s: string) => s.replace(/["\\]/g, '\\$&');

// NEW-DISC-3: an IRI interpolated into `<...>` in a SPARQL query must be validated, not just trusted for
// starting with 'http'. The SPARQL IRIREF production forbids <>"{}|^`\ and 0x00-0x20 (controls + space)
// inside the brackets — a `term` containing any of those breaks out of the IRI and injects query syntax.
// Require a scheme + reject every IRIREF-illegal char (fail-closed: caller sees null, not an injected query).
// eslint-disable-next-line no-control-regex
const isSafeIri = (iri: string): boolean => /^[a-z][a-z0-9+.-]*:\/\//i.test(iri) && !/[<>"{}|^`\\\u0000-\u0020]/.test(iri);

export interface AgentResult {
  agent: string;
  name: string | null;
  smartAgent: string;
  facets: string[];
  shaclConforms: boolean;
  /** Enriched matchable facets (spec 281; present when in the A-box, else null/empty). */
  registryStatus?: string | null; // apreg:lifecycleStatus ('active' | 'suspended' | 'revoked' | null)
  displayName?: string | null;     // approf:displayName
  /** The agent's OWN self-description — SA-keyed on AgentProfileResolver, survives a rename, exists for
   *  nameless agents. This is the one to show as "about this agent" and the one the matcher ranks on. */
  description?: string | null;     // approf:description
  /** facet-registries G8 — the NAME RECORD's description: node-keyed, written by the NAME's owner, and it
   *  transfers with the name. A DIFFERENT fact from `description`, which is why it now has a different
   *  IRI. Until the fix both were projected under `approf:description` and this one, being read second,
   *  silently replaced the agent's own. Surfaced separately rather than dropped: consumers choose. */
  nameDescription?: string | null; // apnam:description
  skills?: string | null;          // approf:skills — publicly-asserted skill labels (spec 282)
  /** Spec 331 — the canonical capability ids parsed out of `skills`. `keccak256` of each is a
   *  `SkillDefinitionRegistry` skillId. Always an array; `[]` means "declared nothing structured". */
  capabilityIds?: string[];
  appContext?: string | null;      // apdisc:appContext
  orgRole?: string | null;         // apdisc:orgRole
  serviceUrl?: string | null;      // apdisc:serviceUrl
  siteUrl?: string | null;         // apdisc:siteUrl
  /** G2/G3/G4 — owner-asserted, comma-separated discovery-ranking facets (approf:*). */
  languages?: string | null;       // BCP-47 tags, lowercase
  regions?: string | null;         // ISO 3166 / GeoFeatureRegistry codes, uppercase
  focusAreas?: string | null;      // subject-domain labels — soft rank ONLY, never a hard filter
  /** G1 — the trust fabric, invisible to discovery until the projector/store fix. */
  activeRelationships?: number;    // ap:activeEdgeCount
  attestations?: number;           // ap:attestationCount
  validAttestations?: number;      // ap:validAttestationCount
  /** Claimed-capability tier — DISTINCT non-self issuers of valid endorsements (self + volume already
   *  collapsed at projection). The honest corroboration count the trust matcher reads; per-CAPABILITY
   *  endorsement detail (for the declared-AND-endorsed fit boost) is a drill-down via getTrustFabric. */
  independentEndorsers?: number;   // ap:independentEndorserCount
  /** spec 346 §8.5 — the DERIVED agent type slug ('person' | 'org' | 'team' | 'service' | 'workspace' |
   *  'treasury' | 'registry') decoded from `ap:agentType` (the SA-keyed on-chain record), or null when undeclared.
   *  `tld` is the name's suffix (a projection, never authority); `serviceRole` the open-set role. */
  agentType?: string | null;
  tld?: string | null;
  serviceRole?: string | null;
  /** spec 347 §8.5 — the agent's `atl:distribution` fact (`approf:distribution`): how to obtain + run its
   *  software (`acp?`, `version?`, `npx`/`uvx`/`binary`), parsed FAIL-CLOSED from the on-chain JSON literal.
   *  `null` = undeclared OR unparsable (an unreadable record is not a distribution). The ACP registry /
   *  ARD projections read `acp === true` as eligibility. Distribution only — never a trust signal. */
  distribution: AgentDistributionV1 | null;
  /** spec 280 — the agent's A2A host (`approf:a2aEndpoint`, node-keyed on the name resolver, projected onto
   *  the agent node). The live card lives at `<a2aEndpoint>/.well-known/agent-card.json`. */
  a2aEndpoint: string | null;
  /** Agent-kind subclass local name ('PersonAgent' | 'OrganizationAgent' | 'ServiceAgent') or null.
   *  Projected from the on-chain agentKind (ADR-0046 trichotomy); needed so the matcher's `requireKind`
   *  mandate (G7) can filter instead of merely recording a satisfied string. */
  kind?: string | null;
}

/** The largest page `searchAgents` will return. Was 200 and SILENT: `limit=500` and `limit=1000` both
 *  returned exactly 200 rows with nothing in the response saying so, and the KB now holds more than 200
 *  agents — so any caller enriching a candidate set from one bulk `/search` read silently dropped every
 *  agent outside the window, even though its facets were correctly in GraphDB. The cap now (a) is larger,
 *  (b) is REPORTED via `SearchPage.truncated`, and (c) has an exact alternative for the enrichment use
 *  case: `lookupAgents`, which filters server-side by the caller's own SA list and does not scale with KB
 *  size. A cap that lies is the actual bug. */
export const SEARCH_MAX_LIMIT = 1000;

export interface SearchPage {
  results: AgentResult[];
  /** Total rows the caller asked for vs got: true ⇒ MORE agents matched than were returned. Callers that
   *  enrich a fixed candidate set must treat `truncated: true` as "this read is not authoritative" and use
   *  `lookupAgents` instead — never as "those agents have no facets". */
  truncated: boolean;
  limit: number;
  returned: number;
}

/** Free-text search over the A-box, enriched with the matchable facets the intent/mandate matcher needs
 *  (spec 281): registry lifecycle status + profile displayName/description. All public, on-chain-derived
 *  (ADR-0040). Match name OR profile text when a query is given. */
export async function searchAgents(env: Env, q: string, limit = 25): Promise<AgentResult[]> {
  return (await searchAgentsPage(env, q, limit)).results;
}

/** As `searchAgents`, but reports whether the page was truncated. */
export async function searchAgentsPage(env: Env, q: string, limit = 25): Promise<SearchPage> {
  const want = Math.min(Math.max(limit, 1), SEARCH_MAX_LIMIT);
  // Over-fetch by ONE so truncation is DETECTED rather than assumed.
  const rows = await runAgentQuery(env, q, '', want + 1);
  const truncated = rows.length > want;
  return { results: rows.slice(0, want), truncated, limit: want, returned: Math.min(rows.length, want) };
}

/** EXACT, bounded read of the given Smart Agents — the enrichment path. Filters server-side by the SA list
 *  the caller already holds, so the result is complete by construction and its cost scales with the
 *  CANDIDATE count, not with the size of the knowledge base. This is what a consult/routing flow should
 *  call; `searchAgents` is for discovery over an unknown field.
 *
 *  Chunked so a large roster cannot build a SPARQL filter big enough to be rejected. Returns only agents
 *  that exist in the KB — an absent SA means "not in the KB", which the caller can distinguish from a
 *  failed read (this throws on transport failure rather than returning a short list). */
const LOOKUP_CHUNK = 100;
export async function lookupAgents(env: Env, smartAgents: string[]): Promise<AgentResult[]> {
  const wanted = [...new Set(smartAgents.map((s) => s.trim().toLowerCase()).filter((s) => /^0x[0-9a-f]{40}$/.test(s)))];
  if (!wanted.length) return [];
  const out: AgentResult[] = [];
  for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
    const chunk = wanted.slice(i, i + LOOKUP_CHUNK);
    // LCASE both sides: `ap:smartAgent` literals were written with mixed casing across indexer generations
    // (viem returns checksummed addresses; older rows are lowercased), so an exact literal match would
    // silently miss rows — the same class of bug this defect is about.
    const values = chunk.map((s) => `"${esc(s)}"`).join(' ');
    const clause = `VALUES ?salc { ${values} } FILTER(LCASE(STR(?sa)) = ?salc)`;
    out.push(...(await runAgentQuery(env, '', clause, chunk.length)));
  }
  return out;
}

/** Capability ids declared inside the profile's capability value — exact tokenization on a comma
 *  boundary, never substring matching, so no token ever partially matches another.
 *
 *  The shape rule lives in `capability-claims`, which owns the catalog and therefore the id vocabulary.
 *  The copy that was here demanded a CURIE colon and silently dropped every DOTTED id the substrate
 *  catalog uses (`messaging.deliver`, `interactions.deliverCredential`), so no agent could be
 *  discovered by them. Three apps each had their own version of this rule and two were wrong. */
export { parseCapabilityIds } from '@agenticprimitives/capability-claims';
import { parseCapabilityIds } from '@agenticprimitives/capability-claims';

/** The one agent-row query both `searchAgentsPage` and `lookupAgents` use, so the two paths can never
 *  drift in which facets they expose. `extraClause` is trusted, caller-built SPARQL (never user text). */
async function runAgentQuery(env: Env, q: string, extraClause: string, limit: number): Promise<AgentResult[]> {
  // `focusAreas` joins the free-text OR (it is descriptive subject-domain text, and widening an OR can only
  // ADD candidates — it is never a filter). `languages`/`regions` deliberately do NOT: they are code lists
  // that the matcher scores structurally, and substring-matching codes produces nonsense hits ("es" ⊂ "test").
  const filter = q.trim()
    ? `FILTER( CONTAINS(LCASE(STR(?name)), LCASE("${esc(q)}")) || CONTAINS(LCASE(STR(?dn)), LCASE("${esc(q)}")) || CONTAINS(LCASE(STR(?desc)), LCASE("${esc(q)}")) || CONTAINS(LCASE(STR(?skills)), LCASE("${esc(q)}")) || CONTAINS(LCASE(STR(?focus)), LCASE("${esc(q)}")) )`
    : '';
  // Every bound var here is SINGLE-VALUED per agent, so this stays one row per agent with no GROUP BY and
  // no DISTINCT (the per-agent `SELECT DISTINCT ?p` fan-out previously blew GraphDB's group-by heap guard).
  // Multivalued trust-fabric detail (the individual edges) is a drill-down: `getRelationships`.
  //
  // Spec 331 W2 — `approf:declaresCapabilityId` is deliberately NOT bound here even though the indexer
  // now emits it. It is MULTIVALUED (one triple per declared id), so binding it would fan this query out
  // to one row per agent per capability and need exactly the GROUP BY the heap guard rules out. It costs
  // nothing to leave out: `approf:skills` is the string those triples are parsed FROM, so the row already
  // carries the same information single-valued, and `capabilityIds` below tokenizes it server-side so
  // every consumer gets identical parsing instead of reimplementing it. The triples remain in the graph
  // for SPARQL consumers that want to query BY capability rather than read an agent row.
  const rows = await sparqlSelect(env, `
    SELECT ?a ?sa ?name ?conforms ?dn ?desc ?ndesc ?status ?skills ?ctx ?role ?svc ?site ?langs ?regions ?focus ?dist ?a2a ?edges ?atts ?vatts ?iendorse ?kind ?atype ?tld ?srole WHERE {
      ?a a ap:Agent ; ap:smartAgent ?sa .
      ${extraClause}
      OPTIONAL { ?a apnam:name ?name }
      OPTIONAL { ?a approf:displayName ?dn }
      OPTIONAL { ?a approf:description ?desc }
      # G8 — the node-keyed name-record description, its own IRI now. Bound alongside (never instead of)
      # the SA-keyed one, so the tier that used to be clobbered is visible rather than merely un-lost.
      OPTIONAL { ?a apnam:description ?ndesc }
      OPTIONAL { ?a approf:skills ?skills }
      OPTIONAL { ?a approf:languages ?langs }
      OPTIONAL { ?a approf:regions ?regions }
      OPTIONAL { ?a approf:focusAreas ?focus }
      # spec 347 §8.5 — the distribution JSON literal (parsed below, fail-closed) + the A2A host both sit on
      # the agent node: the indexer's profile projector merges the SA-keyed and node-keyed tiers into ONE
      # data object on the agent node (G8 guard keeps their IRIs disjoint).
      OPTIONAL { ?a approf:distribution ?dist }
      OPTIONAL { ?a approf:a2aEndpoint ?a2a }
      OPTIONAL { ?a apdisc:appContext ?ctx }
      OPTIONAL { ?a apdisc:orgRole ?role }
      OPTIONAL { ?a apdisc:serviceUrl ?svc }
      OPTIONAL { ?a apdisc:siteUrl ?site }
      OPTIONAL { ?a apreg:lifecycleStatus ?status }
      OPTIONAL { ?a ap:activeEdgeCount ?edges }
      OPTIONAL { ?a ap:attestationCount ?atts }
      OPTIONAL { ?a ap:validAttestationCount ?vatts }
      OPTIONAL { ?a ap:independentEndorserCount ?iendorse }
      OPTIONAL { ?a a ?kind . FILTER(?kind IN (ap:PersonAgent, ap:OrganizationAgent, ap:ServiceAgent)) }
      OPTIONAL { ?a ap:agentType ?atype }
      OPTIONAL { ?a apnam:tld ?tld }
      OPTIONAL { ?a ap:serviceRole ?srole }
      OPTIONAL { ?a <http://www.w3.org/ns/shacl#conforms> ?conforms }
      ${filter}
    } ORDER BY ?name LIMIT ${Math.min(Math.max(limit, 1), SEARCH_MAX_LIMIT + 1)}`);
  // Facets are derived from the fields the single query ALREADY binds — name → naming, lifecycleStatus →
  // registry, displayName/description/skills → profile. This deliberately AVOIDS a per-agent
  // `SELECT DISTINCT ?p` (N concurrent DISTINCT queries blew GraphDB's group-by/distinct heap guard on the
  // grown dataset). One query, no DISTINCT — the live-relevant facets without the memory blowup.
  return rows.map((r) => {
    const num = (b?: { value: string }) => (b?.value ? Number(b.value) : 0);
    const edges = num(r.edges), atts = num(r.atts);
    const facets: string[] = [];
    if (r.name?.value) facets.push('naming');
    if (r.status?.value) facets.push('registry');
    if (r.dn?.value || r.desc?.value || r.skills?.value || r.langs?.value || r.regions?.value || r.focus?.value) facets.push('profile');
    // `ndesc` is deliberately a DISCOVERY (name-record) signal, not a profile one: counting it as
    // 'profile' would re-assert exactly the tier confusion G8 is about.
    if (r.ctx?.value || r.role?.value || r.svc?.value || r.site?.value || r.ndesc?.value) facets.push('discovery');
    // G1 — these two facets could never appear before: the projectors emitted CURIE keys with array values,
    // which the SPARQL store dropped, so `facets` maxed out at 4 and trustScore was registration-only.
    if (edges > 0) facets.push('relationship');
    if (atts > 0) facets.push('attestation');
    return {
      agent: r.a!.value,
      smartAgent: r.sa?.value ?? '',
      name: r.name?.value ?? null,
      shaclConforms: r.conforms?.value !== 'false',
      registryStatus: r.status?.value ?? null,
      displayName: r.dn?.value ?? null,
      description: r.desc?.value ?? null,
      nameDescription: r.ndesc?.value ?? null,
      skills: r.skills?.value ?? null,
      // The CURIE-shaped tokens inside `skills`, parsed once here so every consumer agrees on what a
      // declared capability id is. Empty (not null) when the agent published only free-text labels —
      // "declared nothing structured" is a real answer and must not read as "unknown".
      capabilityIds: parseCapabilityIds(r.skills?.value),
      languages: r.langs?.value ?? null,
      regions: r.regions?.value ?? null,
      focusAreas: r.focus?.value ?? null,
      distribution: decodeDistribution(r.dist?.value),
      a2aEndpoint: r.a2a?.value ?? null,
      appContext: r.ctx?.value ?? null,
      orgRole: r.role?.value ?? null,
      serviceUrl: r.svc?.value ?? null,
      siteUrl: r.site?.value ?? null,
      activeRelationships: edges,
      attestations: atts,
      validAttestations: num(r.vatts),
      independentEndorsers: num(r.iendorse),
      kind: r.kind?.value ? (r.kind.value.split('#').pop() ?? null) : null,
      agentType: derivedTypeSlug(r.atype?.value),
      tld: r.tld?.value ?? null,
      serviceRole: r.srole?.value ?? null,
      facets,
    };
  });
}

/** G1 — one projected trust-fabric edge (`aptrust:TrustGraphEdge`, from AgentRelationship on-chain). The
 *  edge node is SHARED by both endpoints (its IRI derives from the deterministic on-chain edgeId), so its
 *  subject/object are absolute; `direction`/`counterparty` are computed relative to the agent asked about. */
export interface RelationshipResult {
  edgeId: string;
  relationshipType: string | null; // well-known label ('RECOMMENDS', …) — null for a non-well-known type
  relationshipTypeId: string;      // the raw on-chain bytes32, always present
  subject: string;
  object: string;
  counterparty: string;
  direction: 'subject' | 'object';
  status: string;                  // proposed | confirmed | active | revoked
}

/** G1 — one projected attestation (`apatt:Attestation`, from AttestationRegistry's Attested log). */
export interface AttestationResult {
  uid: string;
  credentialType: string;
  issuer: string;
  valid: boolean;
  /** Claimed-capability tier: for a capability endorsement, the endorsed capability's skillId
   *  (`= keccak256(capabilityId)`, the SkillDefinitionRegistry anchor). Empty for a bare association. */
  schemaId: string;
  /** On-chain epochBucket (attest time / EPOCH_SECONDS) — 0 when unknown. Lets a consumer decay staleness. */
  issuedAt: number;
}

const agentSelector = (key: string) => key.startsWith('0x')
  ? `?a ap:smartAgent ?sa . FILTER(LCASE(STR(?sa)) = LCASE("${esc(key)}"))`
  : `?a apnam:name "${esc(key)}" .`;

/** The trust fabric of one agent (by name or SA): its relationship edges and its attestations. Before the
 *  G1 fix these returned nothing for every agent on the substrate — no triple existed to query. */
export async function getTrustFabric(env: Env, key: string): Promise<{ relationships: RelationshipResult[]; attestations: AttestationResult[] }> {
  const sel = agentSelector(key);
  const relRows = await sparqlSelect(env, `
    SELECT ?e ?eid ?type ?tid ?subj ?obj ?st WHERE {
      ?a a ap:Agent . ${sel}
      ?a ap:hasRelationship ?e .
      ?e ap:edgeId ?eid ; ap:edgeSubject ?subj ; ap:edgeObject ?obj ; ap:edgeStatus ?st ; ap:relationshipTypeId ?tid .
      OPTIONAL { ?e ap:relationshipType ?type }
    } ORDER BY ?eid`);
  const saRows = await sparqlSelect(env, `SELECT ?sa WHERE { ?a a ap:Agent . ${sel} ?a ap:smartAgent ?sa } LIMIT 1`);
  const me = (saRows[0]?.sa?.value ?? '').toLowerCase();
  const relationships = relRows.map((r) => {
    const subject = r.subj!.value.toLowerCase();
    const direction: 'subject' | 'object' = subject === me ? 'subject' : 'object';
    return {
      edgeId: r.eid!.value,
      relationshipType: r.type?.value ?? null,
      relationshipTypeId: r.tid!.value,
      subject,
      object: r.obj!.value.toLowerCase(),
      counterparty: direction === 'subject' ? r.obj!.value.toLowerCase() : subject,
      direction,
      status: r.st!.value,
    };
  });
  const attRows = await sparqlSelect(env, `
    SELECT ?uid ?ct ?iss ?valid ?schema ?issued WHERE {
      ?a a ap:Agent . ${sel}
      ?a ap:hasAttestation ?at .
      ?at apatt:uid ?uid ; apatt:credentialType ?ct .
      OPTIONAL { ?at ap:attestationIssuer ?iss }
      OPTIONAL { ?at ap:attestationValid ?valid }
      OPTIONAL { ?at ap:attestationSchemaId ?schema }
      OPTIONAL { ?at ap:attestationIssuedAt ?issued }
    } ORDER BY ?uid`);
  const attestations = attRows.map((r) => ({
    uid: r.uid!.value,
    credentialType: r.ct!.value,
    issuer: r.iss?.value ?? '',
    valid: r.valid?.value === 'true',
    schemaId: r.schema?.value ?? '',
    issuedAt: r.issued?.value ? Number(r.issued.value) : 0,
  }));
  return { relationships, attestations };
}

export interface NameListing {
  name: string;
  smartAgent: string;
  /** Unix seconds the name was registered on-chain (AgentNameRegistry.registeredAt); null if not yet
   *  reindexed with the naming-metadata projection. */
  registeredAt: number | null;
  /** Unix seconds the registration expires; null = no expiry recorded. */
  expiresAt: number | null;
  /** spec 346 §8.5 — the DERIVED agent type slug ('person' | 'org' | 'team' | 'service' | 'workspace' |
   *  'treasury' | 'registry') decoded from `ap:agentType` (the SA-keyed on-chain record), or null when undeclared.
   *  `tld` is the name's suffix (a projection, never authority); `serviceRole` the open-set role. */
  agentType?: string | null;
  tld?: string | null;
  serviceRole?: string | null;
  /** Agent-kind subclass local name ('PersonAgent' | 'OrganizationAgent' | 'ServiceAgent') or null. */
  kind: string | null;
  displayName: string | null;
  /** approf:description — the agent's own, SA-keyed. */
  description: string | null;
  /** apnam:description — the NAME RECORD's, node-keyed (facet-registries G8). Different fact, different
   *  author, transfers with the name. Most UUPG org/alliance agents carry only this one. */
  nameDescription: string | null;
  appContext: string | null;
  orgRole: string | null;
  serviceUrl: string | null;
  siteUrl: string | null;
}

/** Every named agent in the KB, most-recently-registered first (apnam:registeredAt is projected off
 *  AgentNameRegistry storage — on-chain-derivable, ADR-0040). Names indexed before the metadata
 *  projection landed sort last (unbound registeredAt) until the next reindex. */
export async function listNames(env: Env, limit = 100): Promise<NameListing[]> {
  const rows = await sparqlSelect(env, `
    SELECT ?sa ?name ?reg ?exp ?kind ?dn ?desc ?ndesc ?ctx ?role ?svc ?site ?atype ?tld ?srole WHERE {
      ?a a ap:Agent ; ap:smartAgent ?sa ; apnam:name ?name .
      OPTIONAL { ?a apnam:registeredAt ?reg }
      OPTIONAL { ?a apnam:expiry ?exp }
      OPTIONAL { ?a approf:displayName ?dn }
      OPTIONAL { ?a approf:description ?desc }
      OPTIONAL { ?a apnam:description ?ndesc }   # G8 — name-record description, distinct from the above
      OPTIONAL { ?a apdisc:appContext ?ctx }
      OPTIONAL { ?a apdisc:orgRole ?role }
      OPTIONAL { ?a apdisc:serviceUrl ?svc }
      OPTIONAL { ?a apdisc:siteUrl ?site }
      OPTIONAL { ?a a ?kind . FILTER(?kind IN (ap:PersonAgent, ap:OrganizationAgent, ap:ServiceAgent)) }
      OPTIONAL { ?a ap:agentType ?atype } OPTIONAL { ?a apnam:tld ?tld } OPTIONAL { ?a ap:serviceRole ?srole }
    } ORDER BY DESC(?reg) ?name LIMIT ${Math.min(Math.max(limit, 1), 500)}`);
  return rows.map((r) => ({
    name: r.name!.value,
    smartAgent: r.sa?.value ?? '',
    registeredAt: r.reg?.value ? Number(r.reg.value) : null,
    expiresAt: r.exp?.value ? Number(r.exp.value) : null,
    kind: r.kind?.value ? (r.kind.value.split('#').pop() ?? null) : null,
    agentType: derivedTypeSlug(r.atype?.value), tld: r.tld?.value ?? null, serviceRole: r.srole?.value ?? null,
    displayName: r.dn?.value ?? null,
    description: r.desc?.value ?? null,
    nameDescription: r.ndesc?.value ?? null,
    appContext: r.ctx?.value ?? null,
    orgRole: r.role?.value ?? null,
    serviceUrl: r.svc?.value ?? null,
    siteUrl: r.site?.value ?? null,
  }));
}

export async function listAgentsByContext(env: Env, appContext: string, orgRole = '', limit = 100): Promise<NameListing[]> {
  const roleFilter = orgRole ? `?a apdisc:orgRole "${esc(orgRole)}" .` : '';
  const rows = await sparqlSelect(env, `
    SELECT ?sa ?name ?reg ?exp ?kind ?dn ?desc ?ndesc ?ctx ?role ?svc ?site ?atype ?tld ?srole WHERE {
      ?a a ap:Agent ; ap:smartAgent ?sa ; apnam:name ?name ; apdisc:appContext "${esc(appContext)}" .
      ${roleFilter}
      OPTIONAL { ?a apnam:registeredAt ?reg }
      OPTIONAL { ?a apnam:expiry ?exp }
      OPTIONAL { ?a approf:displayName ?dn }
      OPTIONAL { ?a approf:description ?desc }
      OPTIONAL { ?a apnam:description ?ndesc }   # G8 — name-record description, distinct from the above
      OPTIONAL { ?a apdisc:appContext ?ctx }
      OPTIONAL { ?a apdisc:orgRole ?role }
      OPTIONAL { ?a apdisc:serviceUrl ?svc }
      OPTIONAL { ?a apdisc:siteUrl ?site }
      OPTIONAL { ?a a ?kind . FILTER(?kind IN (ap:PersonAgent, ap:OrganizationAgent, ap:ServiceAgent)) }
      OPTIONAL { ?a ap:agentType ?atype } OPTIONAL { ?a apnam:tld ?tld } OPTIONAL { ?a ap:serviceRole ?srole }
    } ORDER BY ?name LIMIT ${Math.min(Math.max(limit, 1), 500)}`);
  return rows.map((r) => ({
    name: r.name!.value,
    smartAgent: r.sa?.value ?? '',
    registeredAt: r.reg?.value ? Number(r.reg.value) : null,
    expiresAt: r.exp?.value ? Number(r.exp.value) : null,
    kind: r.kind?.value ? (r.kind.value.split('#').pop() ?? null) : null,
    agentType: derivedTypeSlug(r.atype?.value), tld: r.tld?.value ?? null, serviceRole: r.srole?.value ?? null,
    displayName: r.dn?.value ?? null,
    description: r.desc?.value ?? null,
    nameDescription: r.ndesc?.value ?? null,
    appContext: r.ctx?.value ?? null,
    orgRole: r.role?.value ?? null,
    serviceUrl: r.svc?.value ?? null,
    siteUrl: r.site?.value ?? null,
  }));
}

/** Describe an ontology term FROM THE GRAPH (the loaded T-box/C-box): label, comment, type, domain,
 *  range. Accepts a full IRI or a bare local name (resolved by matching the IRI end or rdfs:label). */
export async function describeTerm(env: Env, term: string): Promise<{ iri: string; props: { p: string; o: string }[] } | null> {
  const byIri = term.startsWith('http');
  // NEW-DISC-3: an IRI term is interpolated into `<...>` — validate it (SPARQL injection guard) before use.
  if (byIri && !isSafeIri(term)) return null;
  const sel = byIri
    ? `BIND(<${term}> AS ?t)`
    : `?t ?anyp ?anyo . FILTER( STRENDS(LCASE(STR(?t)), LCASE("#${esc(term)}")) || EXISTS { ?t <http://www.w3.org/2000/01/rdf-schema#label> "${esc(term)}" } )`;
  const idRows = await sparqlSelect(env, `SELECT DISTINCT ?t WHERE { ${sel} } LIMIT 1`);
  if (!idRows.length) return null;
  const iri = idRows[0]!.t!.value;
  // The resolved IRI is fed into a second query — validate it too (defence in depth).
  if (!isSafeIri(iri)) return null;
  const props = await sparqlSelect(env, `SELECT ?p ?o WHERE { <${iri}> ?p ?o }`);
  return { iri, props: props.map((r) => ({ p: r.p!.value, o: r.o!.value })) };
}

/** List the SHACL NodeShapes (C-box) loaded in the graph — the conformance contract for the A-box. */
export async function listShapes(env: Env): Promise<{ shape: string; label: string | null }[]> {
  const rows = await sparqlSelect(env, `
    SELECT ?s ?l WHERE { ?s a <http://www.w3.org/ns/shacl#NodeShape> . OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?l } } ORDER BY ?s`);
  return rows.map((r) => ({ shape: r.s!.value, label: r.l?.value ?? null }));
}

/** A crawled offering (spec 286) — one public skill a service agent advertises, projected into the A-box
 *  from its public A2A card (host-asserted + provenance). */
export interface OfferingResult {
  skillId: string;
  name: string | null;
  /** apdisc:offeringDescription — the card's per-skill blurb. Was projected as `approf:description`
   *  (facet-registries G8, third writer) and read by nothing; now its own term, and selected. */
  description: string | null;
  effect: string | null;
  exposure: string | null;
  family: string | null;
  status: string | null;
  hasInputSchema: boolean;
  requiredCapabilities: string[];
  sourceEndpoint: string | null;
  observedAt: number | null;
  cardDigest: string | null;
}

/** The crawled Offerings of one agent (by name or SA). Each is a first-class `apdisc:Offering` node linked
 *  from the agent via `apdisc:hasOffering` (spec 286). `requiredCapabilities` is multivalued → grouped. */
export async function getOfferings(env: Env, key: string): Promise<OfferingResult[]> {
  const sel = key.startsWith('0x')
    ? `?a ap:smartAgent ?sa . FILTER(LCASE(STR(?sa)) = LCASE("${esc(key)}"))`
    : `?a apnam:name "${esc(key)}" .`;
  const rows = await sparqlSelect(env, `
    SELECT ?o ?skill ?name ?desc ?effect ?exposure ?family ?status ?schema ?cap ?src ?obs ?dig WHERE {
      ?a a ap:Agent . ${sel}
      ?a apdisc:hasOffering ?o .
      ?o apdisc:skillId ?skill .
      OPTIONAL { ?o apdisc:offeringName ?name }
      OPTIONAL { ?o apdisc:offeringDescription ?desc }
      OPTIONAL { ?o apdisc:effect ?effect }
      OPTIONAL { ?o apdisc:exposure ?exposure }
      OPTIONAL { ?o apdisc:family ?family }
      OPTIONAL { ?o apdisc:offeringStatus ?status }
      OPTIONAL { ?o apdisc:hasInputSchema ?schema }
      OPTIONAL { ?o apdisc:requiredCapability ?cap }
      OPTIONAL { ?o apdisc:sourceEndpoint ?src }
      OPTIONAL { ?o apdisc:observedAt ?obs }
      OPTIONAL { ?o apdisc:cardDigest ?dig }
    } ORDER BY ?skill`);
  // Group by offering node — requiredCapability is multivalued so a skill spans multiple rows.
  const byNode = new Map<string, OfferingResult>();
  for (const r of rows) {
    const id = r.o!.value;
    let cur = byNode.get(id);
    if (!cur) {
      cur = {
        skillId: r.skill?.value ?? '',
        name: r.name?.value ?? null,
        description: r.desc?.value ?? null,
        effect: r.effect?.value ?? null,
        exposure: r.exposure?.value ?? null,
        family: r.family?.value ?? null,
        status: r.status?.value ?? null,
        hasInputSchema: r.schema?.value === 'true',
        requiredCapabilities: [],
        sourceEndpoint: r.src?.value ?? null,
        observedAt: r.obs?.value ? Number(r.obs.value) : null,
        cardDigest: r.dig?.value ?? null,
      };
      byNode.set(id, cur);
    }
    if (r.cap?.value && !cur.requiredCapabilities.includes(r.cap.value)) cur.requiredCapabilities.push(r.cap.value);
  }
  return [...byNode.values()];
}

/** All triples for one agent (by name or SA) — the full A-box node. */
export async function getAgent(env: Env, key: string): Promise<{ agent: string; triples: { p: string; o: string }[] } | null> {
  const sel = key.startsWith('0x')
    ? `?a ap:smartAgent ?sa . FILTER(LCASE(STR(?sa)) = LCASE("${esc(key)}"))`
    : `?a apnam:name "${esc(key)}" .`;
  const idRows = await sparqlSelect(env, `SELECT ?a WHERE { ?a a ap:Agent . ${sel} } LIMIT 1`);
  if (!idRows.length) return null;
  const agent = idRows[0]!.a!.value;
  const rows = await sparqlSelect(env, `SELECT ?p ?o WHERE { <${agent}> ?p ?o }`);
  return { agent, triples: rows.map((r) => ({ p: r.p!.value, o: r.o!.value })) };
}

// ─── Facets (spec 346 §8.5; discovery filter UX) ──────────────────────────────────────────────────────
// One grouped aggregate per facet — never N queries — so the dropdowns' option lists and "n agents" counts
// stay flat as the KB grows. Every value is something an agent actually DECLARED on chain (bottom-up), never
// the downstream capability catalog (the substrate does not load it — spec 331).
export interface FacetCount { value: string; count: number }
export interface Facets {
  /** Derived agent type slugs (`ap:agentType`), e.g. person / org / team / church … */
  agentTypes: FacetCount[];
  /** Root kinds (`rdf:type` ap:PersonAgent | OrganizationAgent | ServiceAgent) as person / org / service. */
  kinds: FacetCount[];
  /** Declared capability ids (`approf:declaresCapabilityId`, CURIE-shaped). */
  capabilityIds: FacetCount[];
  /** Name suffixes (`apnam:tld`). */
  tlds: FacetCount[];
  /** Agents with NO declared derived type (they count as the generic type of their root when filtering). */
  undeclaredType: number;
}
const KIND_SLUG: Record<string, string> = { PersonAgent: 'person', OrganizationAgent: 'org', ServiceAgent: 'service' };
export async function getFacets(env: Env): Promise<Facets> {
  const count = (rows: Binding[], key: string, map: (v: string) => string | null = (v) => v): FacetCount[] =>
    rows.map((r) => ({ value: map(r[key]?.value ?? '') ?? '', count: Number(r.n?.value ?? 0) })).filter((f) => f.value).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  const [types, kinds, caps, tlds, undeclared] = await Promise.all([
    sparqlSelect(env, `SELECT ?t (COUNT(DISTINCT ?a) AS ?n) WHERE { ?a ap:smartAgent ?sa ; ap:agentType ?t } GROUP BY ?t`),
    sparqlSelect(env, `SELECT ?k (COUNT(DISTINCT ?a) AS ?n) WHERE { ?a ap:smartAgent ?sa ; a ?k . FILTER(?k IN (ap:PersonAgent, ap:OrganizationAgent, ap:ServiceAgent)) } GROUP BY ?k`),
    sparqlSelect(env, `SELECT ?c (COUNT(DISTINCT ?a) AS ?n) WHERE { ?a ap:smartAgent ?sa ; approf:declaresCapabilityId ?c } GROUP BY ?c`),
    sparqlSelect(env, `SELECT ?t (COUNT(DISTINCT ?a) AS ?n) WHERE { ?a ap:smartAgent ?sa ; apnam:tld ?t } GROUP BY ?t`),
    sparqlSelect(env, `SELECT (COUNT(DISTINCT ?a) AS ?n) WHERE { ?a ap:smartAgent ?sa . FILTER NOT EXISTS { ?a ap:agentType ?t } }`),
  ]);
  return {
    agentTypes: count(types, 't', (v) => derivedTypeSlug(v)),
    kinds: count(kinds, 'k', (v) => KIND_SLUG[v.split('#').pop() ?? ''] ?? null),
    capabilityIds: count(caps, 'c'),
    tlds: count(tlds, 't'),
    undeclaredType: Number(undeclared[0]?.n?.value ?? 0),
  };
}
