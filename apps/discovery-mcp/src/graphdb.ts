// GraphDB (Ontotext, agentkg.io) read access for the discovery MCP. Holds creds server-side (Worker
// secrets) and runs SPARQL SELECT over the `smart-agents` A-box that agent-indexer populates.

export interface Env {
  GRAPHDB_QUERY_URL: string;
  GRAPHDB_USER?: string;
  GRAPHDB_PASSWORD?: string;
  GRAPHDB_TOKEN?: string;
}

const PREFIXES = `
PREFIX ap: <https://agenticprimitives.dev/ns/core#>
PREFIX apnam: <https://agenticprimitives.dev/ns/naming#>
PREFIX apreg: <https://agenticprimitives.dev/ns/registry#>
PREFIX approf: <https://agenticprimitives.dev/ns/profile#>
`;

function authHeader(env: Env): Record<string, string> {
  if (env.GRAPHDB_TOKEN) return { authorization: `Bearer ${env.GRAPHDB_TOKEN}` };
  if (env.GRAPHDB_USER) return { authorization: `Basic ${btoa(`${env.GRAPHDB_USER}:${env.GRAPHDB_PASSWORD ?? ''}`)}` };
  return {};
}

export interface Binding { [k: string]: { value: string; type: string } }

export async function sparqlSelect(env: Env, query: string): Promise<Binding[]> {
  const res = await fetch(env.GRAPHDB_QUERY_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/sparql-query', accept: 'application/sparql-results+json', ...authHeader(env) },
    body: PREFIXES + query,
  });
  if (!res.ok) throw new Error(`GraphDB ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const json = (await res.json()) as { results?: { bindings?: Binding[] } };
  return json.results?.bindings ?? [];
}

const esc = (s: string) => s.replace(/["\\]/g, '\\$&');

export interface AgentResult {
  agent: string;
  name: string | null;
  smartAgent: string;
  facets: string[];
  shaclConforms: boolean;
}

/** Free-text search over the A-box: match name (and, when present, profile displayName/description). */
export async function searchAgents(env: Env, q: string, limit = 25): Promise<AgentResult[]> {
  const filter = q.trim()
    ? `FILTER( CONTAINS(LCASE(STR(?name)), LCASE("${esc(q)}")) || CONTAINS(LCASE(STR(?dn)), LCASE("${esc(q)}")) )`
    : '';
  const rows = await sparqlSelect(env, `
    SELECT ?a ?sa ?name ?conforms WHERE {
      ?a a ap:Agent ; ap:smartAgent ?sa .
      OPTIONAL { ?a apnam:name ?name }
      OPTIONAL { ?a approf:displayName ?dn }
      OPTIONAL { ?a <http://www.w3.org/ns/shacl#conforms> ?conforms }
      ${filter}
    } ORDER BY ?name LIMIT ${Math.min(Math.max(limit, 1), 200)}`);
  return Promise.all(rows.map(async (r) => {
    const agent = r.a!.value;
    return { agent, smartAgent: r.sa?.value ?? '', name: r.name?.value ?? null, shaclConforms: r.conforms?.value !== 'false', facets: await facetsOf(env, agent) };
  }));
}

/** Which facet edges this agent has in the A-box (naming/profile/registry/relationship/attestation). */
async function facetsOf(env: Env, agentIri: string): Promise<string[]> {
  const rows = await sparqlSelect(env, `
    SELECT DISTINCT ?fp WHERE { <${agentIri}> ?fp ?o . FILTER(STRSTARTS(STR(?fp), "https://agenticprimitives.dev/ns/core#has")) }`);
  return rows.map((r) => r.fp!.value.split('#has')[1]!.toLowerCase());
}

/** Describe an ontology term FROM THE GRAPH (the loaded T-box/C-box): label, comment, type, domain,
 *  range. Accepts a full IRI or a bare local name (resolved by matching the IRI end or rdfs:label). */
export async function describeTerm(env: Env, term: string): Promise<{ iri: string; props: { p: string; o: string }[] } | null> {
  const byIri = term.startsWith('http');
  const sel = byIri
    ? `BIND(<${term}> AS ?t)`
    : `?t ?anyp ?anyo . FILTER( STRENDS(LCASE(STR(?t)), LCASE("#${esc(term)}")) || EXISTS { ?t <http://www.w3.org/2000/01/rdf-schema#label> "${esc(term)}" } )`;
  const idRows = await sparqlSelect(env, `SELECT DISTINCT ?t WHERE { ${sel} } LIMIT 1`);
  if (!idRows.length) return null;
  const iri = idRows[0]!.t!.value;
  const props = await sparqlSelect(env, `SELECT ?p ?o WHERE { <${iri}> ?p ?o }`);
  return { iri, props: props.map((r) => ({ p: r.p!.value, o: r.o!.value })) };
}

/** List the SHACL NodeShapes (C-box) loaded in the graph — the conformance contract for the A-box. */
export async function listShapes(env: Env): Promise<{ shape: string; label: string | null }[]> {
  const rows = await sparqlSelect(env, `
    SELECT ?s ?l WHERE { ?s a <http://www.w3.org/ns/shacl#NodeShape> . OPTIONAL { ?s <http://www.w3.org/2000/01/rdf-schema#label> ?l } } ORDER BY ?s`);
  return rows.map((r) => ({ shape: r.s!.value, label: r.l?.value ?? null }));
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
