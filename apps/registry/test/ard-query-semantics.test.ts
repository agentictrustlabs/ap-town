/**
 * ARD §5.3 query semantics — the two rules that make a registry interoperable rather than merely shaped
 * like one, plus the ordering contract for List.
 */
import { describe, it, expect } from 'vitest';
import { resolveFilterKey, planArdSearch, ardAgentsResponse } from '../src/ard.js';

describe('§5.3.1 — a filter key is matched by its IRI, not by its prefix', () => {
  // "this is what makes namespaced filtering work across publishers: a client filtering on okf:taxonomy
  // matches any entry whose author bound the same namespace, regardless of the prefix that author chose."
  // We matched the literal string, so a client that bound its OWN prefix to our namespace was told the
  // registry does not filter a term it does in fact index.
  it('resolves a client prefix bound to this registry’s namespace', () => {
    expect(resolveFilterKey('zz:agentType', { zz: 'https://agenticprimitives.dev/ns/core#' })).toBe('ap:agentType');
  });

  it('leaves our own prefix, and core terms, alone', () => {
    expect(resolveFilterKey('ap:agentType', undefined)).toBe('ap:agentType');
    expect(resolveFilterKey('tags', { zz: 'https://x/' })).toBe('tags');
    expect(resolveFilterKey('type', undefined)).toBe('type');
  });

  it('invents no match for an unbound prefix, nor for a namespace we do not publish', () => {
    expect(resolveFilterKey('okf:taxonomy', undefined)).toBe('okf:taxonomy');
    expect(resolveFilterKey('okf:taxonomy', { okf: 'https://openknowledgeformat.org/ns#' })).toBe('okf:taxonomy');
  });

  it('a query that binds our prefix to something ELSE does not thereby reach our term', () => {
    // The IRI decides, not the spelling. This one resolves to nothing of ours and is refused downstream.
    expect(resolveFilterKey('ap:agentType', { ap: 'https://example.invalid/other#' })).toBe('ap:agentType');
  });

  it('end to end: a foreign prefix now reaches the planner as a supported mandate', () => {
    const r = planArdSearch({ query: { '@context': { zz: 'https://agenticprimitives.dev/ns/core#' }, text: 'x', filter: { 'zz:agentType': ['person'] } } });
    expect('code' in r).toBe(false);
    expect(!('code' in r) && r.mandates.requireAgentType).toBe('person');
  });
});

describe('§5.3.2 — text is required for search', () => {
  it('refuses a search with no text, and names the endpoint that takes none', () => {
    const r = planArdSearch({ query: { filter: { tags: ['person'] } } }, { textRequired: true });
    expect('code' in r && r.code).toBe('INVALID_ARGUMENT');
    expect('code' in r && r.message).toMatch(/explore/);
  });

  it('allows a filter-only query where the spec does — explore, whose text is optional', () => {
    expect('code' in planArdSearch({ query: { filter: { tags: ['person'] } } })).toBe(false);
  });
});

describe('§5.3.4 — orderBy either orders or is refused', () => {
  const rows = [
    { agent: 'urn:b', name: 'bob.me', smartAgent: `0x${'b'.repeat(40)}`, displayName: 'Bob', agentType: 'person', tld: 'me', a2aEndpoint: 'https://bob.example' },
    { agent: 'urn:a', name: 'ann.me', smartAgent: `0x${'a'.repeat(40)}`, displayName: 'Ann', agentType: 'person', tld: 'me', a2aEndpoint: 'https://ann.example' },
  ] as never[];
  const names = (r: unknown) => ((r as { items: { displayName?: string }[] }).items).map((i) => i.displayName);

  it('orders ascending and descending — they must not be the same list', () => {
    // Accepted-and-ignored was the bug: `name` and `name DESC` returned identical order, so a client
    // could not tell a sort it did not get from a sort that happened to look like that.
    expect(names(ardAgentsResponse(rows, { orderBy: 'name' }))).toEqual(['Ann', 'Bob']);
    expect(names(ardAgentsResponse(rows, { orderBy: 'name DESC' }))).toEqual(['Bob', 'Ann']);
  });

  it('refuses a field it cannot order by, rather than silently ignoring it', () => {
    const r = ardAgentsResponse(rows, { orderBy: 'created_at' });
    expect('code' in r && r.code).toBe('INVALID_ARGUMENT');
  });

  it('refuses a direction it does not understand', () => {
    expect('code' in ardAgentsResponse(rows, { orderBy: 'name SIDEWAYS' })).toBe(true);
  });
});
