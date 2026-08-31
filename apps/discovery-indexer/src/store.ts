// Pluggable A-box read store. The indexer projects ONE node per Smart Agent, carrying every available
// on-chain facet (naming, profile, registry entry, relationships, attestations, …) as SHACL-shaped data.
// The discovery API queries this; the UI renders it. Default: JSON-LD file (zero infra). Production:
// GraphDB at agentkg.io via SPARQL UPDATE.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CLASS, NS, PREDICATE, agentIri } from './ontology.js';
import { CUSTODY_GRAPH, CUSTODY_MEMBER_CLASS, custodyMemberIri } from './custody.js';

/** A first-class CHILD node a facet projects alongside the agent (spec 286 Offerings). It is its OWN
 *  subject (deterministic IRI), `rdf:type`d, linked from the agent via `linkPredicate`, and carries its own
 *  scalar/multivalued triples. Re-crawls converge: the store deletes an agent's existing children (by the
 *  link predicate) before re-inserting, so removed children drop out. */
export interface ProjectedChildNode {
  iri: string;
  type: string;            // rdf:type IRI
  linkPredicate: string;   // agent → child predicate IRI (also drives idempotent cleanup)
  /** Child's own props, IRI-keyed. A string[] value emits one triple per element (multivalued). */
  data: Record<string, string | number | string[]>;
}

/** One on-chain facet of an agent, ontology-shaped + SHACL-tagged. Everything keys off the SA. */
export interface ProjectedFacet {
  /** Facet source, e.g. 'naming' | 'profile' | 'registry' | 'relationship' | 'attestation' | 'offerings'. */
  kind: string;
  /** Whether this facet exists on-chain for the agent. */
  present: boolean;
  /** The SHACL NodeShape (ontology C-box) this facet conforms to, if any. */
  shapeIri: string | null;
  /** Lightweight SHACL conformance of the projected data (full engine validation is a pipeline stage). */
  conforms: boolean;
  /** Ontology-IRI-keyed facet data (the triples). */
  data: Record<string, unknown>;
  /** First-class child nodes this facet projects (own subjects, linked from the agent). Optional.
   *  DEFINED (even empty) = the read SUCCEEDED → the store refreshes/clears this agent's children under
   *  `childLink`. UNDEFINED = the read is UNKNOWN → the store preserves what is already indexed (ADR-0013:
   *  a failed read is not "zero"). */
  children?: ProjectedChildNode[];
  /** The agent → child link predicate this facet OWNS. Required alongside `children` so an empty array can
   *  still clear stale children (with no child to read the predicate off). */
  childLink?: string;
  /** If not yet implemented: the on-chain source this projector will read. */
  pending?: string;
}

export interface AgentNode {
  chainId: number;
  smartAgent: string;
  name: string | null;
  node: string;
  /** The agent-kind subclass IRI (ap:PersonAgent / OrganizationAgent / ServiceAgent), decoded from the
   *  on-chain `agentKind` — null when the agent declares no kind on-chain (then it's typed only ap:Agent;
   *  we never infer kind from names/heuristics, ADR-0040). */
  kindClass?: string | null;
  /** The DERIVED class IRI (spec 346 §2.1: ap:TeamAgent / ap:WorkspaceAgent / ap:Treasury / ap:RegistryAgent …),
   *  decoded from the SA-keyed on-chain `atl:agentType` — null when undeclared. Never inferred from the suffix. */
  derivedClass?: string | null;
  facets: ProjectedFacet[];
  provenance: { source: string; block: number; indexedAt: string };
}

export interface AboxStore {
  upsert(nodes: AgentNode[]): Promise<void>;
  /** Replace the custody-membership set (ADR-0040): opaque, public, on-chain-reproducible tokens written
   *  to a private named graph, never as plaintext agent→custodian edges. Full-rebuild — for the full run. */
  setCustodyTokens(tokens: string[]): Promise<void>;
  /** Add custody tokens WITHOUT a full rebuild (the targeted on-create projection — must not wipe others). */
  addCustodyTokens(tokens: string[]): Promise<void>;
  flush(): Promise<void>;
  describe(): string;
}

const FACET_PRED: Record<string, string> = {
  naming: `${NS.ap}hasNamingRecord`,
  profile: `${NS.ap}hasProfile`,
  registry: `${NS.ap}hasRegistryEntry`,
  relationship: PREDICATE.hasRelationship,
  attestation: PREDICATE.hasAttestation,
  offerings: `${NS.ap}hasOfferings`,
};

/** Every agent → child-node link predicate the projectors can emit (spec 286 offerings + the G1 trust
 *  fabric). These drive BOTH the idempotent child cleanup and the "don't orphan children on an agent
 *  re-projection" filter, so a new child-bearing facet is one entry here — not a second special case. */
const CHILD_LINK_PREDICATES = [PREDICATE.hasOffering, PREDICATE.hasRelationship, PREDICATE.hasAttestation] as const;

const SH_CONFORMS = 'http://www.w3.org/ns/shacl#conforms';

function nodeToJsonLd(n: AgentNode) {
  const present = n.facets.filter((f) => f.present);
  return {
    '@id': agentIri(n.chainId, n.smartAgent),
    '@type': [CLASS.Agent, ...(n.kindClass ? [n.kindClass] : []), ...(n.derivedClass ? [n.derivedClass] : [])],
    [PREDICATE.smartAgent]: n.smartAgent,
    [PREDICATE.name]: n.name,
    [PREDICATE.node]: n.node,
    'sh:conforms': present.every((f) => f.conforms),
    ...Object.fromEntries(present.map((f) => [
      FACET_PRED[f.kind] ?? `${NS.ap}has_${f.kind}`,
      { ...f.data, 'sh:shape': f.shapeIri, 'sh:conforms': f.conforms, ...(f.children?.length ? { 'ap:children': f.children } : {}) },
    ])),
    'ap:facetCoverage': n.facets.map((f) => ({ kind: f.kind, present: f.present, pending: f.pending ?? null })),
    'prov:wasDerivedFrom': n.provenance.source,
    [PREDICATE.blockNumber]: n.provenance.block,
  };
}

/** JSON-LD file store — the zero-infra default. */
export class JsonLdFileStore implements AboxStore {
  private nodes = new Map<string, AgentNode>();
  private custody: string[] = [];
  constructor(private path: string) {}
  async upsert(nodes: AgentNode[]) { for (const n of nodes) this.nodes.set(n.smartAgent.toLowerCase(), n); }
  async setCustodyTokens(tokens: string[]) { this.custody = tokens; }
  async addCustodyTokens(tokens: string[]) { this.custody = [...new Set([...this.custody, ...tokens])]; }
  async flush() {
    const doc = {
      '@context': { ap: NS.ap, apnam: NS.apnam, apreg: NS.apreg, apdisc: NS.apdisc, sh: 'http://www.w3.org/ns/shacl#', prov: 'http://www.w3.org/ns/prov#' },
      '@graph': [...this.nodes.values()].map(nodeToJsonLd),
      // Custody membership (ADR-0040): opaque, reproducible tokens in a separate named graph — no agent link.
      [CUSTODY_GRAPH]: this.custody.map((t) => ({ '@id': custodyMemberIri(t as `0x${string}`), '@type': CUSTODY_MEMBER_CLASS })),
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

// NEW-IDX-1: escape control characters too, not just backslash + double-quote. A crawled PUBLIC A2A card /
// profile field is attacker-supplied; a raw newline / tab / control char produced a malformed SPARQL
// string literal that failed the WHOLE INSERT batch (availability — one self-published card griefs the
// indexer). Named escapes for the common whitespace controls; \uXXXX for the rest of the C0 range.
/** A JSON-LD style IRI reference in facet data — serialized as `<iri>`, never as a literal. */
export const isIriRef = (v: unknown): v is { '@id': string } => typeof v === 'object' && v !== null && typeof (v as { '@id'?: unknown })['@id'] === 'string';

export const lit = (v: string) =>
  `"${v
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)}"`;

/** GraphDB / SPARQL 1.1 Update store (agentkg.io). Enabled when GRAPHDB_URL is set. Idempotent: each
 *  agent's subject is DELETEd then re-INSERTed so re-runs converge (no duplicate triples). */
export class SparqlGraphStore implements AboxStore {
  private pending: AgentNode[] = [];
  private custody: string[] | null = null;
  private custodyInsert: string[] = [];
  constructor(private endpoint: string, private auth: SparqlAuth = {}) {}
  async upsert(nodes: AgentNode[]) { this.pending.push(...nodes); }
  async setCustodyTokens(tokens: string[]) { this.custody = tokens; }
  async addCustodyTokens(tokens: string[]) { this.custodyInsert.push(...tokens); }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/sparql-update' };
    if (this.auth.gdbToken) h['X-GraphDB-Auth-Token'] = this.auth.gdbToken;
    else if (this.auth.token) h.authorization = `Bearer ${this.auth.token}`;
    else if (this.auth.user) h.authorization = `Basic ${Buffer.from(`${this.auth.user}:${this.auth.password ?? ''}`).toString('base64')}`;
    return h;
  }

  async flush() {
    const stmts: string[] = [];
    if (this.pending.length) {
      const subjects: string[] = [];
      // Agents with a FRESH child projection this batch (a facet returned a defined `children` array, i.e. the
      // crawl SUCCEEDED). Only these get their child nodes + links cleared and rewritten; an agent whose crawl
      // FAILED (children undefined → facet present:false) keeps its existing children (a failed read is
      // "unknown", not "zero" — ADR-0013). The discovery indexer Worker cannot fetch a same-account host
      // (Cloudflare loopback), so its crawl always fails and MUST preserve the CLI-populated offerings.
      const freshChildSubjects = new Map<string, Set<string>>(); // linkPredicate → subjects refreshed
      const triples = this.pending.flatMap((n) => {
        const s = `<${agentIri(n.chainId, n.smartAgent)}>`;
        subjects.push(s);
        const t = [`${s} a <${CLASS.Agent}> .`, `${s} <${PREDICATE.smartAgent}> ${lit(n.smartAgent)} .`];
        if (n.kindClass) t.push(`${s} a <${n.kindClass}> .`); // agent-kind subclass, when declared on-chain
        if (n.derivedClass) t.push(`${s} a <${n.derivedClass}> .`); // derived type (spec 346), when declared on-chain
        if (n.name) t.push(`${s} <${PREDICATE.name}> ${lit(n.name)} .`);
        t.push(`${s} <${PREDICATE.node}> ${lit(n.node)} .`);
        t.push(`${s} <${PREDICATE.blockNumber}> ${n.provenance.block} .`);
        // G7 — `sh:conforms` existed ONLY in the dev JSON-LD store, so the discovery matcher's
        // `requireShaclConforms` mandate filtered on a value the MCP defaulted to `true` for every agent:
        // it always passed. Emit the same aggregate the JSON-LD store computes (every PRESENT facet
        // conforms) so the mandate actually discriminates. A mandate that silently passes is worse than
        // an absent one.
        t.push(`${s} <${SH_CONFORMS}> ${n.facets.filter((f) => f.present).every((f) => f.conforms)} .`);
        for (const f of n.facets.filter((x) => x.present)) {
          // G1 ROOT CAUSE: this gate used to be `typeof v === 'string' || typeof v === 'number'`, so the
          // relationship/attestation facets — whose values were ARRAYS — emitted nothing at all. Arrays are
          // now multivalued: one triple per element, exactly as the child-node writer below already did.
          // (The `startsWith('http')` half of the gate is correct — it means "the key is an IRI, not a
          // CURIE" — and the projectors now emit full IRIs, which is the other half of the fix.)
          for (const [k, v] of Object.entries(f.data)) {
            if (!k.startsWith('http')) continue;
            for (const item of Array.isArray(v) ? v : [v]) {
              if (typeof item === 'number') t.push(`${s} <${k}> ${item} .`);
              else if (typeof item === 'string') t.push(`${s} <${k}> ${lit(item)} .`);
              else if (isIriRef(item)) t.push(`${s} <${k}> <${item['@id']}> .`); // object-valued (e.g. ap:agentType → skos concept)
            }
          }
          // First-class child nodes: own subject, typed, linked from the agent — spec 286 Offerings and the
          // G1 trust fabric (aptrust:TrustGraphEdge / apatt:Attestation). A defined `children` array (even
          // empty) marks a SUCCESSFUL read → this agent's children under THAT link predicate get refreshed
          // below; `undefined` means "unknown" and preserves whatever is already indexed (ADR-0013).
          if (Array.isArray(f.children)) {
            for (const c of f.children) {
              (freshChildSubjects.get(c.linkPredicate) ?? freshChildSubjects.set(c.linkPredicate, new Set()).get(c.linkPredicate)!).add(s);
            }
            // An empty children array still marks its facet's link predicate fresh, so removed children drop
            // out. The projector declares which predicate it owns via `childLink`.
            if (f.childLink) (freshChildSubjects.get(f.childLink) ?? freshChildSubjects.set(f.childLink, new Set()).get(f.childLink)!).add(s);
            for (const c of f.children) {
              const ci = `<${c.iri}>`;
              t.push(`${s} <${c.linkPredicate}> ${ci} .`, `${ci} a <${c.type}> .`, `${ci} <${PREDICATE.ofAgent}> ${s} .`);
              for (const [k, v] of Object.entries(c.data)) {
                if (!k.startsWith('http')) continue;
                for (const item of Array.isArray(v) ? v : [v]) {
                  t.push(`${ci} <${k}> ${typeof item === 'number' ? item : isIriRef(item) ? `<${item['@id']}>` : lit(item)} .`);
                }
              }
            }
          }
        }
        return t;
      });
      // (a) Per child-link predicate, for the agents whose read of THAT facet succeeded: clear their OLD
      //     child nodes (reachable via the link, while it still exists) + the links; both re-inserted below.
      //     A relationship edge is shared by both endpoints, so the child node is only truly orphaned when
      //     no agent still links it — `?c ?p ?o` cleanup here is scoped to the re-projected agents' links,
      //     and the counterpart re-link is re-INSERTed by that agent's own projection.
      for (const link of CHILD_LINK_PREDICATES) {
        const fresh = [...(freshChildSubjects.get(link) ?? [])];
        if (!fresh.length) continue;
        const lp = `<${link}>`;
        stmts.push(`DELETE { ?c ?p ?o } WHERE { VALUES ?a { ${fresh.join(' ')} } ?a ${lp} ?c . ?c ?p ?o }`);
        stmts.push(`DELETE { ?a ${lp} ?c } WHERE { VALUES ?a { ${fresh.join(' ')} } ?a ${lp} ?c }`);
      }
      // (b) Idempotent reset of each agent's OWN triples — but PRESERVE every child link so a failed/absent
      //     read never orphans previously-indexed children (fresh ones were already cleared in (a)).
      const keepLinks = CHILD_LINK_PREDICATES.map((p) => `?p != <${p}>`).join(' && ');
      stmts.push(`DELETE { ?s ?p ?o } WHERE { VALUES ?s { ${subjects.join(' ')} } ?s ?p ?o FILTER(${keepLinks}) }`);
      stmts.push(`INSERT DATA {\n${triples.join('\n')}\n}`);
    }
    if (this.custody !== null) {
      // Full rebuild of the opaque custody-membership graph (ADR-0040): drop then re-insert, so revoked
      // custodians drop out. Tokens are public + on-chain-reproducible; no agent→custodian edge is stored.
      stmts.push(`DROP SILENT GRAPH <${CUSTODY_GRAPH}>`);
      if (this.custody.length) {
        const cm = this.custody.map((t) => `<${custodyMemberIri(t as `0x${string}`)}> a <${CUSTODY_MEMBER_CLASS}> .`).join('\n');
        stmts.push(`INSERT DATA { GRAPH <${CUSTODY_GRAPH}> {\n${cm}\n} }`);
      }
    }
    if (this.custodyInsert.length) {
      // Targeted projection: ADD this agent's tokens without dropping the graph (don't disturb others).
      const cm = this.custodyInsert.map((t) => `<${custodyMemberIri(t as `0x${string}`)}> a <${CUSTODY_MEMBER_CLASS}> .`).join('\n');
      stmts.push(`INSERT DATA { GRAPH <${CUSTODY_GRAPH}> {\n${cm}\n} }`);
    }
    if (!stmts.length) return;
    const res = await fetch(this.endpoint, { method: 'POST', headers: this.headers(), body: stmts.join(';\n') });
    if (!res.ok) throw new Error(`SPARQL update failed: ${res.status} ${await res.text().catch(() => '')}`);
    this.pending = [];
    this.custody = null;
    this.custodyInsert = [];
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
