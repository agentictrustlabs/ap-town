// Load the agentic-trust ontology (T-box classes/properties + C-box SHACL shapes + controlled
// vocabularies + standards mappings) into the GraphDB `smart-agents` repo, so the knowledge base is
// SELF-DESCRIBING: ontology + shapes + A-box instances in one graph (RDFS/OWL reasoning + SHACL run over
// the union). This is what makes discovery a power example of the ontology.
//
// In the monorepo we resolve the TTL via @agenticprimitives/ontology's /artifacts API (no vendored copy,
// no hardcoded path) and upload into a named graph (replace-on-PUT via the RDF4J Graph Store Protocol).

import { readFileSync, existsSync } from 'node:fs';
import { ARTIFACTS, artifactPath } from '@agenticprimitives/ontology/artifacts';

// Load .env (gitignored) so `pnpm load-ontology` picks up GRAPHDB creds; shell env always wins.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
}

const ONTOLOGY_GRAPH = process.env.ONTOLOGY_GRAPH ?? 'urn:ap:ontology';
const STATEMENTS = process.env.GRAPHDB_URL ?? 'https://graphdb.agentkg.io/repositories/smart-agents/statements';

function auth(): Record<string, string> {
  if (process.env.GRAPHDB_GDB_TOKEN) return { 'X-GraphDB-Auth-Token': process.env.GRAPHDB_GDB_TOKEN };
  if (process.env.GRAPHDB_TOKEN) return { authorization: `Bearer ${process.env.GRAPHDB_TOKEN}` };
  if (process.env.GRAPHDB_USER) return { authorization: `Basic ${Buffer.from(`${process.env.GRAPHDB_USER}:${process.env.GRAPHDB_PASSWORD ?? ''}`).toString('base64')}` };
  return {};
}

function graphEndpoint(): string {
  const base = STATEMENTS.replace(/\/statements$/, '');
  return `${base}/rdf-graphs/service?graph=${encodeURIComponent(ONTOLOGY_GRAPH)}`;
}

async function main() {
  const files = [...ARTIFACTS.tbox, ...ARTIFACTS.cbox, ...ARTIFACTS.mappings];
  const endpoint = graphEndpoint();
  console.log(`[load-ontology] ${files.length} ontology files (@agenticprimitives/ontology) → ${endpoint}`);
  let i = 0;
  for (const rel of files) {
    const body = readFileSync(artifactPath(rel), 'utf8');
    const method = i === 0 ? 'PUT' : 'POST'; // PUT clears the named graph first, POST appends
    const res = await fetch(endpoint, { method, headers: { 'content-type': 'text/turtle', ...auth() }, body });
    if (!res.ok) { console.error(`[load-ontology] ${method} ${rel} → ${res.status} ${await res.text().catch(() => '')}`); process.exit(1); }
    console.log(`  ${method === 'PUT' ? '⟲' : '+'} ${rel}`);
    i++;
  }
  console.log(`[load-ontology] loaded ${files.length} ontology files into graph <${ONTOLOGY_GRAPH}>`);
}

await main();
