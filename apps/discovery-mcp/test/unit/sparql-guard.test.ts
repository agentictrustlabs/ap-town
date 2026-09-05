// Spec 357 W1 — the decision is the syntax tree's.
//
// Each case here is a query a regex filter either let through or would have needed a new pattern for.
// The point of the parse is that these are all the SAME check: what does this query DO.
import { describe, it, expect } from 'vitest';
import { decideKbQuery } from '../../src/sparql-guard.js';

const READ_ALL = ['SELECT', 'ASK', 'CONSTRUCT', 'DESCRIBE'] as const;
const refusal = (q: string, allow: readonly string[] = READ_ALL): string => {
  const d = decideKbQuery(q, allow as never);
  return d.ok ? '(allowed)' : d.refusal;
};

describe('decideKbQuery', () => {
  it('allows an ordinary read and reports its form', () => {
    const d = decideKbQuery('SELECT ?s WHERE { ?s ?p ?o } LIMIT 10', READ_ALL as never);
    expect(d).toMatchObject({ ok: true, form: 'SELECT', hasLimit: true });
  });

  it('reports a missing LIMIT so the caller can cap it', () => {
    expect(decideKbQuery('SELECT ?s WHERE { ?s ?p ?o }', READ_ALL as never)).toMatchObject({ hasLimit: false });
  });

  it('refuses updates — as a query TYPE, not a verb list', () => {
    expect(refusal('INSERT DATA { <urn:a> <urn:b> <urn:c> }')).toMatch(/read-only/);
    expect(refusal('DELETE WHERE { ?s ?p ?o }')).toMatch(/read-only/);
    // Not on any verb list, and still an update.
    expect(refusal('WITH <urn:g> DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }')).toMatch(/read-only/);
  });

  it('refuses federation wherever it hides', () => {
    expect(refusal('SELECT ?s WHERE { SERVICE <http://evil.example/x> { ?s ?p ?o } }')).toMatch(/federation/);
    // Nested inside a subquery + OPTIONAL — the shape a flat regex over the whole string still catches,
    // but only because it never looks at structure. This one asserts the walk reaches it.
    expect(refusal(`SELECT ?s WHERE { OPTIONAL { { SELECT ?s WHERE { SERVICE <http://evil.example/> { ?s ?p ?o } } } } }`))
      .toMatch(/federation/);
  });

  it('refuses named graphs, including the custody one under any spelling', () => {
    expect(refusal('SELECT ?s WHERE { GRAPH <urn:ap:other> { ?s ?p ?o } }')).toMatch(/not queryable|not allowed/);
    // A variable graph is the worse case: it ranges over every named graph, so it reaches custody
    // without ever naming it.
    expect(refusal('SELECT ?s WHERE { GRAPH ?g { ?s ?p ?o } }')).toMatch(/ranges over every named graph/);
    expect(refusal('SELECT ?s FROM NAMED <urn:ap:custody> WHERE { ?s ?p ?o }')).toMatch(/custody/);
    expect(refusal('SELECT ?s WHERE { ?s ?p <urn:ap:cm-token> }')).toMatch(/custody/);
  });

  it('refuses FROM, which chooses the dataset in the header instead of the body', () => {
    expect(refusal('SELECT ?s FROM <urn:ap:elsewhere> WHERE { ?s ?p ?o }')).toMatch(/FROM/);
  });

  // The answer path takes one form. A table of bindings is not the domain.
  it('narrows by surface: the answer path is CONSTRUCT only', () => {
    expect(decideKbQuery('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', ['CONSTRUCT'])).toMatchObject({ ok: true, form: 'CONSTRUCT' });
    expect(refusal('SELECT ?s WHERE { ?s ?p ?o }', ['CONSTRUCT'])).toMatch(/that is a SELECT/);
  });

  it('refuses what it cannot parse, rather than repairing it', () => {
    expect(refusal('SELECT ?s WHERE { ?s ?p')).toMatch(/not a valid SPARQL query/);
    expect(refusal('   ')).toMatch(/empty query/);
  });
});
