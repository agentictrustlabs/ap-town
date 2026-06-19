// Pluggable A-box read store. The indexer projects ONE node per Smart Agent, carrying every available
// on-chain facet (naming, profile, registry entry, relationships, attestations, …) as SHACL-shaped data.
// The discovery API queries this; the UI renders it. Default: JSON-LD file (zero infra). Production:
// GraphDB at agentkg.io via SPARQL UPDATE.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CLASS, NS, PREDICATE, agentIri } from './ontology.js';

/** One on-chain facet of an agent, ontology-shaped + SHACL-tagged. Everything keys off the SA. */
export interface ProjectedFacet {
  /** Facet source, e.g. 'naming' | 'profile' | 'registry' | 'relationship' | 'attestation'. */
  kind: string;
  /** Whether this facet exists on-chain for the agent. */
  present: boolean;
  /** The SHACL NodeShape (ontology C-box) this facet conforms to, if any. */
  shapeIri: string | null;
  /** Lightweight SHACL conformance of the projected data (full engine validation is a pipeline stage). */
  conforms: boolean;
  /** Ontology-IRI-keyed facet data (the triples). */
  data: Record<string, unknown>;
  /** If not yet implemented: the on-chain source this projector will read. */
  pending?: string;
}

export interface AgentNode {
  chainId: number;
  smartAgent: string;
  name: string | null;
  node: string;
  facets: ProjectedFacet[];
  provenance: { source: string; block: number; indexedAt: string };
}

export interface AboxStore {
  upsert(nodes: AgentNode[]): Promise<void>;
  flush(): Promise<void>;
  describe(): string;
}

const FACET_PRED: Record<string, string> = {
  naming: `${NS.ap}hasNamingRecord`,
  profile: `${NS.ap}hasProfile`,
  registry: `${NS.ap}hasRegistryEntry`,
  relationship: `${NS.ap}hasRelationship`,
  attestation: `${NS.ap}hasAttestation`,
};

function nodeToJsonLd(n: AgentNode) {
  const present = n.facets.filter((f) => f.present);
  return {
    '@id': agentIri(n.chainId, n.smartAgent),
    '@type': CLASS.Agent,
    [PREDICATE.smartAgent]: n.smartAgent,
    [PREDICATE.name]: n.name,
    [PREDICATE.node]: n.node,
    'sh:conforms': present.every((f) => f.conforms),
    ...Object.fromEntries(present.map((f) => [
      FACET_PRED[f.kind] ?? `${NS.ap}has_${f.kind}`,
      { ...f.data, 'sh:shape': f.shapeIri, 'sh:conforms': f.conforms },
    ])),
    'ap:facetCoverage': n.facets.map((f) => ({ kind: f.kind, present: f.present, pending: f.pending ?? null })),
    'prov:wasDerivedFrom': n.provenance.source,
    [PREDICATE.blockNumber]: n.provenance.block,
  };
}

/** JSON-LD file store — the zero-infra default. */
export class JsonLdFileStore implements AboxStore {
  private nodes = new Map<string, AgentNode>();
  constructor(private path: string) {}
  async upsert(nodes: AgentNode[]) { for (const n of nodes) this.nodes.set(n.smartAgent.toLowerCase(), n); }
  async flush() {
    const doc = {
      '@context': { ap: NS.ap, apnam: NS.apnam, apreg: NS.apreg, apdisc: NS.apdisc, sh: 'http://www.w3.org/ns/shacl#', prov: 'http://www.w3.org/ns/prov#' },
      '@graph': [...this.nodes.values()].map(nodeToJsonLd),
    };
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(doc, null, 2));
  }
  describe() { return `JSON-LD file → ${this.path}`; }
}

export interface SparqlAuth {
  /** GraphDB token / bearer (Authorization: Bearer …, or X-GraphDB-Auth-Token if `gdbToken`). */
  token?: string;
  gdbToken?: string;
  /** HTTP Basic (GraphDB security): user + password. */
  user?: string;
  password?: string;
}

const lit = (v: string) => `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** GraphDB / SPARQL 1.1 Update store (agentkg.io). Enabled when GRAPHDB_URL is set. Idempotent: each
 *  agent's subject is DELETEd then re-INSERTed so re-runs converge (no duplicate triples). */
export class SparqlGraphStore implements AboxStore {
  private pending: AgentNode[] = [];
  constructor(private endpoint: string, private auth: SparqlAuth = {}) {}
  async upsert(nodes: AgentNode[]) { this.pending.push(...nodes); }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/sparql-update' };
    if (this.auth.gdbToken) h['X-GraphDB-Auth-Token'] = this.auth.gdbToken;
    else if (this.auth.token) h.authorization = `Bearer ${this.auth.token}`;
    else if (this.auth.user) h.authorization = `Basic ${Buffer.from(`${this.auth.user}:${this.auth.password ?? ''}`).toString('base64')}`;
    return h;
  }

  async flush() {
    if (!this.pending.length) return;
    const subjects: string[] = [];
    const triples = this.pending.flatMap((n) => {
      const s = `<${agentIri(n.chainId, n.smartAgent)}>`;
      subjects.push(s);
      const t = [`${s} a <${CLASS.Agent}> .`, `${s} <${PREDICATE.smartAgent}> ${lit(n.smartAgent)} .`];
      if (n.name) t.push(`${s} <${PREDICATE.name}> ${lit(n.name)} .`);
      t.push(`${s} <${PREDICATE.node}> ${lit(n.node)} .`);
      t.push(`${s} <${PREDICATE.blockNumber}> ${n.provenance.block} .`);
      for (const f of n.facets.filter((x) => x.present)) {
        for (const [k, v] of Object.entries(f.data)) {
          if (k.startsWith('http') && (typeof v === 'string' || typeof v === 'number')) {
            t.push(`${s} <${k}> ${typeof v === 'number' ? v : lit(v)} .`);
          }
        }
      }
      return t;
    });
    // Idempotent upsert: clear each subject's existing triples, then insert the fresh projection.
    const update = `DELETE { ?s ?p ?o } WHERE { VALUES ?s { ${subjects.join(' ')} } ?s ?p ?o };\nINSERT DATA {\n${triples.join('\n')}\n}`;
    const res = await fetch(this.endpoint, { method: 'POST', headers: this.headers(), body: update });
    if (!res.ok) throw new Error(`SPARQL update failed: ${res.status} ${await res.text().catch(() => '')}`);
    this.pending = [];
  }
  describe() { return `SPARQL/GraphDB → ${this.endpoint}${this.auth.user || this.auth.token || this.auth.gdbToken ? ' (authed)' : ' (no auth)'}`; }
}

export function storeFromEnv(): AboxStore {
  const url = process.env.GRAPHDB_URL;
  if (url) {
    return new SparqlGraphStore(url, {
      token: process.env.GRAPHDB_TOKEN,
      gdbToken: process.env.GRAPHDB_GDB_TOKEN,
      user: process.env.GRAPHDB_USER,
      password: process.env.GRAPHDB_PASSWORD,
    });
  }
  return new JsonLdFileStore(process.env.ABOX_OUT ?? 'abox-out/discovery-graph.jsonld');
}
