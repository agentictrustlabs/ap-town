// THE DEFECT THIS FILTER EXISTS FOR, 2026-10-12.
//
// The town's Ask was asked which public agent could answer about global church people groups. `find_agents`
// ran a `/search` whose filter CONTAINS-ed the whole phrase, matched nothing, and the reply was "Nothing
// matched a search for “global church people groups”." Nothing was wrong with any gate; the search could
// only ever find text holding that exact sentence, which no agent's description does.
//
// So: every word must be present somewhere, and one shared word is not a match.
import { describe, it, expect } from 'vitest';
import { searchFilterClause } from '../../src/graphdb.js';

const words = (q: string): string[] => [...(searchFilterClause(q).matchAll(/LCASE\("([^"]*)"\)/g))].map((m) => m[1]!).filter((w, i, a) => a.indexOf(w) === i);

describe('a prose query is matched word by word', () => {
  it('requires every significant word, ANDed', () => {
    const f = searchFilterClause('global church people groups');
    expect(words('global church people groups')).toEqual(['global', 'church', 'people', 'groups']);
    // AND between the words — one shared word must not match.
    expect(f.split('&&')).toHaveLength(4);
  });

  it('ORs across the public text fields, name-record description included', () => {
    const f = searchFilterClause('grief');
    for (const v of ['?name', '?dn', '?desc', '?ndesc', '?skills', '?focus']) expect(f).toContain(v);
    expect(f).not.toContain('&&');
  });

  it('is strictly wider than the phrase match it replaced', () => {
    // Anything the old filter found held the phrase, and so held every one of its words.
    const f = searchFilterClause('outreach team greeley');
    for (const w of ['outreach', 'team', 'greeley']) expect(f).toContain(`"${w}"`);
  });

  it('drops words too short to narrow anything', () => {
    expect(words('a people group in india')).toEqual(['people', 'group', 'india']);
  });

  it('counts a repeated word once', () => {
    expect(words('church church outreach')).toEqual(['church', 'outreach']);
  });

  it('a query of only short words falls back to the phrase rather than matching everything', () => {
    const f = searchFilterClause('in a of');
    expect(f).toContain('in a of');
    expect(f).not.toContain('&&');
  });

  it('no query is no filter', () => {
    expect(searchFilterClause('   ')).toBe('');
  });

  it('introduces no ranking — the clause is a filter and carries no score or order', () => {
    const f = searchFilterClause('people groups');
    expect(f).not.toMatch(/ORDER|score|confidence|BIND/i);
  });

  it('escapes a quote rather than closing the literal', () => {
    expect(searchFilterClause('say "hi" please')).not.toMatch(/LCASE\(""\)/);
  });
});
