// WHAT A QUERY DOES, not what it looks like — spec 357 §2/§4, W1.
//
// The guards this replaces were regexes over query TEXT: reject `INSERT|DELETE|…`, reject `SERVICE`,
// reject any mention of the custody graph. They were correct for the queries they were written against,
// and they are a FILTER rather than a DECISION — each new evasion is a new pattern, and the pattern list
// can never state what it permits.
//
// A parsed query can. Every check below is a property of the syntax tree: this is a CONSTRUCT, it reads
// no named graph, it federates nowhere. A query that does not parse is refused rather than guessed at.
//
// WHAT THIS IS NOT: it is not an authorization decision. The knowledge base holds only public,
// on-chain-derivable facts (ADR-0040) — a query here decides what is SHOWN, never what may be seen, and
// nothing in this file may ever be cited as the reason something was disclosed (spec 357 §4).
import { Parser } from 'sparqljs';

export type KbQueryForm = 'SELECT' | 'ASK' | 'CONSTRUCT' | 'DESCRIBE';

export interface KbQueryOk { ok: true; form: KbQueryForm; hasLimit: boolean }
export interface KbQueryRefused { ok: false; refusal: string }
export type KbQueryDecision = KbQueryOk | KbQueryRefused;

/**
 * The cheap pre-filter, kept deliberately. It is redundant with the parse for everything the parser
 * understands — and it still earns its place for what a parser accepts happily: an update verb inside a
 * string literal is harmless, but a custody-graph IRI ANYWHERE in a query is a query nobody should be
 * writing, whatever position it holds in the tree.
 */
const CUSTODY_GRAPH_REF = /urn:ap:c(ustody|m)/i;

/** Named graphs a caller-supplied query may name. Empty: the public A-box is the DEFAULT graph, and the
 *  only named graph this KB has is the custody membership one, which answers existence and never
 *  enumeration (ADR-0040). A query that names any graph is refused rather than filtered. */
const ALLOWED_GRAPHS: readonly string[] = [];

/** Every node in a parsed query, depth-first. sparqljs nests patterns, groups, subqueries and expressions
 *  in a dozen shapes; walking them all is the only way a check can say "nowhere in this query". */
function* nodes(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) { for (const v of value) yield* nodes(v); return; }
  if (value === null || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  yield obj;
  for (const v of Object.values(obj)) yield* nodes(v);
}

/**
 * Decide whether this query may run.
 *
 * `allow` is the caller's surface talking: the admin KB browser reads in every read-only form, while the
 * ANSWER path takes CONSTRUCT alone — a table of bindings is not a domain, and an answer shaped like the
 * domain is the whole point of asking (spec 357 §2).
 */
export function decideKbQuery(query: string, allow: readonly KbQueryForm[]): KbQueryDecision {
  const q = query.trim();
  if (!q) return { ok: false, refusal: 'empty query' };
  if (CUSTODY_GRAPH_REF.test(q)) return { ok: false, refusal: 'the custody membership graph is not directly queryable' };

  let parsed: Record<string, unknown>;
  try {
    parsed = new Parser().parse(q) as unknown as Record<string, unknown>;
  } catch (e) {
    // Refused, not repaired. A validator that fixes a query has silently answered a different one.
    return { ok: false, refusal: `not a valid SPARQL query: ${(e as Error).message.split('\n')[0]}` };
  }

  // An UPDATE parses as its own type — no verb list to keep current.
  if (parsed.type !== 'query') return { ok: false, refusal: 'read-only: only SPARQL queries may run here' };

  const form = String(parsed.queryType ?? '').toUpperCase() as KbQueryForm;
  if (!allow.includes(form)) {
    return { ok: false, refusal: `this surface answers ${allow.join(' / ')} queries; that is a ${form || 'unknown'}` };
  }

  for (const node of nodes(parsed)) {
    // Federation makes the STORE fetch a URL while evaluating — SSRF from its network position, which no
    // read of a local knowledge base ever needs.
    if (node.type === 'service') return { ok: false, refusal: 'SPARQL SERVICE (federation) is not allowed' };
    if (node.type === 'graph') {
      const graph = node.name as { termType?: string; value?: string } | undefined;
      // A VARIABLE graph is the worse of the two: it does not name a graph, it ranges over EVERY named
      // graph — the custody membership one included. Refused in its own words, because "graph <g> is not
      // queryable" would describe it as though `g` were an IRI somebody could have picked differently.
      if (graph?.termType === 'Variable') {
        return { ok: false, refusal: 'GRAPH ?var ranges over every named graph and is not allowed here' };
      }
      const name = String(graph?.value ?? '');
      if (!ALLOWED_GRAPHS.includes(name)) {
        return { ok: false, refusal: name ? `named graph <${name}> is not queryable here` : 'named-graph patterns are not allowed here' };
      }
    }
  }
  // FROM / FROM NAMED choose the dataset out from under the default graph — the same question as GRAPH,
  // asked in the header.
  const from = parsed.from as { default?: unknown[]; named?: unknown[] } | undefined;
  if ((from?.default?.length ?? 0) > 0 || (from?.named?.length ?? 0) > 0) {
    return { ok: false, refusal: 'FROM / FROM NAMED are not allowed here' };
  }

  return { ok: true, form, hasLimit: typeof parsed.limit === 'number' };
}
