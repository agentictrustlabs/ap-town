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

// Spec 357 W2 — an example that the endpoint would refuse teaches a shape nobody can use. These are the
// corpus a query generator learns from, so they are held to the same standard as a real query.
describe('the worked examples are queries this endpoint would actually run', () => {
  it('every example is a valid CONSTRUCT the answer path admits', async () => {
    const { KB_EXAMPLES } = await import('../../src/kb-schema.js');
    expect(KB_EXAMPLES.length).toBeGreaterThan(0);
    for (const ex of KB_EXAMPLES) {
      expect(decideKbQuery(ex.query, ['CONSTRUCT']), ex.question).toMatchObject({ ok: true, form: 'CONSTRUCT' });
    }
  });

  it('and each one states a LIMIT rather than relying on the cap', async () => {
    const { KB_EXAMPLES } = await import('../../src/kb-schema.js');
    for (const ex of KB_EXAMPLES) {
      expect(decideKbQuery(ex.query, ['CONSTRUCT']), ex.question).toMatchObject({ hasLimit: true });
    }
  });
});

// Spec 357 W4 — framing to the published context: the same shape every time, without losing data.
describe('JSON-LD framing (357 W4)', () => {
  it('compacts IRIs, unwraps a single literal/ref, and keeps multiplicity', async () => {
    const { frameForTest } = await import('../../src/graphdb.js') as unknown as { frameForTest: (n: unknown) => unknown };
    const framed = frameForTest({
      '@id': 'urn:ap:agent:eip155:34348:0xabc',
      '@type': ['https://agenticprimitives.dev/ns/core#OrganizationAgent'],
      'https://agenticprimitives.dev/ns/naming#name': [{ '@value': 'weld.org' }],
      'https://agenticprimitives.dev/ns/core#smartAgent': [{ '@value': '0xABC' }, { '@value': '0xDEF' }],
    }) as Record<string, unknown>;
    expect(framed['@type']).toEqual(['ap:OrganizationAgent']);       // compacted; @type stays an array (JSON-LD convention)
    expect(framed['apnam:name']).toBe('weld.org');                  // single literal unwrapped
    expect(framed['ap:smartAgent']).toEqual(['0xABC', '0xDEF']);    // multi stays an array
    expect(framed['@id']).toBe('urn:ap:agent:eip155:34348:0xabc');  // non-published IRI left whole
  });

  it('leaves an unpublished namespace whole rather than inventing a prefix', async () => {
    const { frameForTest } = await import('../../src/graphdb.js') as unknown as { frameForTest: (n: unknown) => unknown };
    const framed = frameForTest({ 'http://example.org/foo#bar': [{ '@value': 'x' }] }) as Record<string, unknown>;
    expect(Object.keys(framed)).toContain('http://example.org/foo#bar');
  });
});
