// The four fixtures this design was measured on (2026-10-14), kept as a test so that the day the registry's
// scoring changes shape, the page's one constant fails loudly instead of quietly splitting the wrong rows.
import { describe, it, expect } from 'vitest';
import { groupFindResults, sharedWhy, TEXT_FLOOR } from '../app/pages/find-group';
import type { FindHit } from '../app/types';

const hit = (name: string | null, score: number, why: string[] = ['ranked on text alone']): FindHit =>
  ({ name, smartAgent: `0x${(name ?? String(score)).replace(/[^a-z0-9]/g, '').padEnd(40, '0').slice(0, 40)}`, score, why });

describe('a name is a lookup, words are a ranking (2026-10-14)', () => {
  it('puts the name you typed on its own, and the ones merely like it under it', () => {
    const named = [hit('nathan.me', 0.24), hit('bram-nathan.me', 0.2), hit('nathan-step-ijq4.org', 0.2)];
    const results = [hit('nathan.me', 0.67), hit('bram-nathan.me', 0.63), hit('gc-gaps.svc', 0.85), hit('noise.org', 0.1)];
    const g = groupFindResults('nathan', results, named);
    expect(g.exact.map((h) => h.name)).toEqual(['nathan.me']);
    // starts-with before merely-contains, each in the order the registry gave
    expect(g.like.map((h) => h.name)).toEqual(['nathan-step-ijq4.org', 'bram-nathan.me']);
    // an agent found by name is answered once: it is not also in the ranking
    expect(g.fit.map((h) => h.name)).toEqual(['gc-gaps.svc']);
    expect(g.rest.map((h) => h.name)).toEqual(['noise.org']);
  });

  it('an ending typed is an ending meant', () => {
    const results = [hit('nathan.me', 0.67), hit('nathan.org', 0.63)];
    expect(groupFindResults('nathan.me', results, results).exact.map((h) => h.name)).toEqual(['nathan.me']);
    expect(groupFindResults('nathan.me', results, results).like.map((h) => h.name)).toEqual(['nathan.org']);
    // and with no ending typed, every kind under that label is an answer
    expect(groupFindResults('nathan', results, results).exact.map((h) => h.name)).toEqual(['nathan.me', 'nathan.org']);
  });

  it('a partial name finds it — the whole point', () => {
    const named = [hit('nathan.me', 0.24), hit('nadia-nathan.me', 0.2)];
    const g = groupFindResults('nath', [hit('unrelated.org', 0.12)], named);
    expect(g.exact).toEqual([]);
    expect(g.like.map((h) => h.name)).toEqual(['nathan.me', 'nadia-nathan.me']);
    expect(g.rest.map((h) => h.name)).toEqual(['unrelated.org']);
  });

  it('a name nobody holds groups to nothing, which is what lets the page offer to register it', () => {
    // `zzz` through the registry's substring door is 0 rows; the ranked page is still 100 rows of filler.
    const g = groupFindResults('zzqxy', [hit('something.org', 0.12), hit('other.me', 0.1)], []);
    expect(g.exact).toEqual([]); expect(g.like).toEqual([]); expect(g.fit).toEqual([]);
    expect(g.rest).toHaveLength(2);
    expect(g.asName).toEqual({ label: 'zzqxy', tld: null });
  });

  it('a sentence is not a name, and is ranked only', () => {
    const g = groupFindResults('a translation service', [hit('t.svc', 0.7), hit('x.org', 0.1)]);
    expect(g.asName).toBeNull();
    expect(g.exact).toEqual([]); expect(g.like).toEqual([]);
    expect(g.fit.map((h) => h.name)).toEqual(['t.svc']);
  });

  it('the floor sits in the gap the corpus actually has', () => {
    // Evidence-only rows measured at 0.10–0.18; anything the words touched at 0.61 and up.
    expect(TEXT_FLOOR).toBeGreaterThan(0.18);
    expect(TEXT_FLOOR).toBeLessThan(0.61);
  });

  it('says once what every card repeats, and keeps what only some of them say', () => {
    const a = hit('a.org', 0.7, ['ranked on text alone', 'in the registry']);
    const b = hit('b.org', 0.7, ['ranked on text alone', 'SHACL-conformant']);
    expect(sharedWhy([a, b])).toEqual(['ranked on text alone']);
    expect(sharedWhy([a])).toEqual([]);
  });
});
