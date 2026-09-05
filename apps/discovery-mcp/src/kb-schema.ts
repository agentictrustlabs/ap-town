// WHAT THIS KNOWLEDGE BASE ACTUALLY CONTAINS — spec 357 W2, the grounding corpus.
//
// The failure this exists to prevent has already happened twice. `ask-discovery.ts` records the first: a
// planner asked to write SPARQL against a schema it half-knows produced
// `VALUES ?type { <https://vocab.account.tech/types/Person> … }` and would have answered "I don't know"
// with total confidence had the endpoint accepted it. The second was mine, by hand, building W1: I wrote
// `apnam:primaryName` because it is what the predicate OUGHT to be called, got an empty result, and had
// no way to tell "nothing matches" from "that predicate does not exist".
//
// Both are the same failure — writing a query against vocabulary you believe in rather than vocabulary
// that is there — and both are fixed by the same thing: describe the store from the store.
//
// PROJECTED, NOT WRITTEN. Two properties matter and neither survives a hand-kept list:
//
//   DECLARED — the class/property exists, with the label and comment the T-box gives it. The T-box is
//              loaded into this store from `packages/ontology`, so reading it here reads the same source
//              the ontology package holds, at the place the query will actually run.
//   USED     — something in the A-box is an instance of it, or something uses it. A predicate that is
//              declared and unused is a predicate a generated query will match nothing with, and telling
//              a model about it is telling it a plausible falsehood. Counts are included for that reason:
//              they are how a reader tells a real relationship from an aspirational one.
//
// EXCLUDED, DELIBERATELY: custody vocabulary. `ap:CustodyMember` answers one question — can this
// credential make that agent act — and is neither membership nor authority (tbox/core.ttl says so at
// length). Advertising the class here would hand a query-writing model the exact term finding KC-2b says
// nobody should be querying, and would invite answering "what am I part of" from control of a key.
import { sparqlSelect, type Env } from './graphdb.js';

const AP_NS = 'https://agenticprimitives.dev/ns/';
/** Never described, never suggested — see the header. Matched on the IRI so a rename cannot slip past. */
const EXCLUDED = /CustodyMember|urn:ap:c(ustody|m)/i;
/** A T-box comment in this repo is a paragraph explaining what a term is NOT. Priceless in the source,
 *  and a prompt cannot carry forty of them — so the corpus carries the opening sentence. */
const COMMENT_CHARS = 240;
const MAX_TERMS = 60;

export interface KbTerm {
  iri: string;
  label?: string;
  comment?: string;
  /** How many instances (a class) or uses (a property) exist. The honest signal that a term is real. */
  count: number;
}

export interface KbSchema {
  classes: KbTerm[];
  properties: KbTerm[];
  /** Worked question → query pairs, each one validated against the same guard that admits a real query. */
  examples: Array<{ question: string; query: string }>;
  notes: string[];
  generatedAt: string;
}

const firstSentence = (text: string): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= COMMENT_CHARS) return t;
  const cut = t.slice(0, COMMENT_CHARS);
  const stop = cut.lastIndexOf('. ');
  return (stop > 60 ? cut.slice(0, stop + 1) : cut) + '…';
};

async function describe(env: Env, iris: string[]): Promise<Map<string, { label?: string; comment?: string }>> {
  const out = new Map<string, { label?: string; comment?: string }>();
  if (!iris.length) return out;
  const values = iris.map((i) => `<${i}>`).join(' ');
  const rows = await sparqlSelect(env, `
    SELECT ?t ?label ?comment WHERE {
      VALUES ?t { ${values} }
      OPTIONAL { ?t <http://www.w3.org/2000/01/rdf-schema#label> ?label }
      OPTIONAL { ?t <http://www.w3.org/2000/01/rdf-schema#comment> ?comment }
    }`);
  for (const r of rows) {
    const iri = r.t?.value;
    if (!iri) continue;
    const prev = out.get(iri) ?? {};
    out.set(iri, {
      ...prev,
      ...(r.label?.value ? { label: r.label.value } : {}),
      ...(r.comment?.value ? { comment: firstSentence(r.comment.value) } : {}),
    });
  }
  return out;
}

/** One isolate-local cache. The schema changes when the indexer runs, not per request, and rebuilding it
 *  costs four round trips to GraphDB — which a per-question generation loop would otherwise pay every time. */
let cached: { at: number; value: KbSchema } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function kbSchema(env: Env, opts: { fresh?: boolean } = {}): Promise<KbSchema> {
  if (!opts.fresh && cached && Date.now() - cached.at < TTL_MS) return cached.value;

  const [classRows, propRows] = await Promise.all([
    sparqlSelect(env, `
      SELECT ?c (COUNT(?s) AS ?n) WHERE {
        ?s a ?c .
        FILTER(STRSTARTS(STR(?c), "${AP_NS}"))
      } GROUP BY ?c ORDER BY DESC(?n) LIMIT ${MAX_TERMS}`),
    sparqlSelect(env, `
      SELECT ?p (COUNT(*) AS ?n) WHERE {
        ?s ?p ?o .
        FILTER(STRSTARTS(STR(?p), "${AP_NS}"))
      } GROUP BY ?p ORDER BY DESC(?n) LIMIT ${MAX_TERMS}`),
  ]);

  const classIris = classRows.map((r) => r.c?.value ?? '').filter((i) => i && !EXCLUDED.test(i));
  const propIris = propRows.map((r) => r.p?.value ?? '').filter((i) => i && !EXCLUDED.test(i));
  const [classDesc, propDesc] = await Promise.all([describe(env, classIris), describe(env, propIris)]);

  const term = (iri: string, count: string | undefined, desc: Map<string, { label?: string; comment?: string }>): KbTerm => ({
    iri, count: Number(count ?? 0), ...desc.get(iri),
  });

  const value: KbSchema = {
    classes: classIris.map((iri) => term(iri, classRows.find((r) => r.c?.value === iri)?.n?.value, classDesc)),
    properties: propIris.map((iri) => term(iri, propRows.find((r) => r.p?.value === iri)?.n?.value, propDesc)),
    examples: KB_EXAMPLES,
    notes: [
      'Every class and property listed here HAS DATA in this store; the count says how much. Nothing outside this list exists here — a term that is not listed will match nothing.',
      'rdf:type (a) is used throughout and is not listed as a property; an agent typically has several types at once (ap:Agent, its derived type, and prov: equivalents).',
      'Agents are subjects of the form urn:ap:agent:eip155:<chain>:<address>. The address itself is a literal on ap:smartAgent.',
      'This store answers about PUBLIC, on-chain-derivable facts only. It holds no membership rosters, no vault records, no private relationships — a question about those cannot be answered here, and an empty result is the truthful answer rather than a reason to widen the query.',
    ],
    generatedAt: new Date().toISOString(),
  };
  cached = { at: Date.now(), value };
  return value;
}

/**
 * WORKED EXAMPLES — question → the query that answers it.
 *
 * Curated rather than generated, and few rather than many: their job is to show the SHAPE of a good query
 * against this store (the subject form, that a name lives on `apnam:name`, that a type is one of several
 * on the same subject), not to enumerate what can be asked. Every one is checked by a unit test against
 * the same guard that admits a real query, so an example can never teach a shape the endpoint refuses.
 */
export const KB_EXAMPLES: Array<{ question: string; query: string }> = [
  {
    question: 'Which organizations are in the directory, and what are they called?',
    query: `CONSTRUCT {
  ?a a <${AP_NS}core#OrganizationAgent> ; <${AP_NS}naming#name> ?name ; <${AP_NS}core#smartAgent> ?address .
} WHERE {
  ?a a <${AP_NS}core#OrganizationAgent> ; <${AP_NS}naming#name> ?name ; <${AP_NS}core#smartAgent> ?address .
} LIMIT 50`,
  },
  {
    question: 'Which agents have "weld" in their name?',
    query: `CONSTRUCT {
  ?a <${AP_NS}naming#name> ?name ; <${AP_NS}core#smartAgent> ?address .
} WHERE {
  ?a <${AP_NS}naming#name> ?name ; <${AP_NS}core#smartAgent> ?address .
  FILTER(CONTAINS(LCASE(?name), "weld"))
} LIMIT 50`,
  },
  {
    question: 'What is agent 0xACD0b849395fDEA550A66636439090E3C700609c — everything the directory knows?',
    query: `CONSTRUCT { ?a ?p ?o } WHERE {
  ?a <${AP_NS}core#smartAgent> "0xACD0b849395fDEA550A66636439090E3C700609c" ; ?p ?o .
} LIMIT 100`,
  },
];
