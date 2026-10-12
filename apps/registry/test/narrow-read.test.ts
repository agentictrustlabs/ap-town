// THE BUDGET THE NARROW READ SPENDS — the 2026-10-12 defect.
//
// Asked "find an agent that offers people group counts", the registry spent all three of its extra lookups on
// the whole phrase, "agent" and "that", and never read `people` — the only word in the description of the one
// agent in the town whose whole job is people-group counts. It answered "nothing matched" about it.
import { describe, it, expect } from 'vitest';
import { narrowReadTokens } from '../src/index';

describe('a narrow read spends its lookups on the question’s own words', () => {
  it('reads the phrase first, then the words that are not the furniture of asking', () => {
    const t = narrowReadTokens('find an agent that offers people group counts');
    expect(t[0]).toBe('find an agent that offers people group counts');
    expect(t.slice(1)).toEqual(['people', 'group', 'counts']);
  });

  it('drops the words that are in every question and almost no description', () => {
    for (const w of ['agent', 'that', 'offers', 'find', 'registry', 'which', 'questions']) {
      expect(narrowReadTokens(`${w} grief`).slice(1), w).toEqual(['grief']);
    }
  });

  it('keeps the phrase alone when every word was furniture — it does not widen to them', () => {
    expect(narrowReadTokens('which agent can answer questions')).toEqual(['which agent can answer questions']);
  });

  it('counts a repeated word once and stays inside the budget', () => {
    const t = narrowReadTokens('scripture scripture study plans on justification by faith alone in reformed teaching');
    expect(new Set(t).size).toBe(t.length);
    expect(t.length).toBeLessThanOrEqual(6);
  });

  it('drops words too short to narrow anything', () => {
    expect(narrowReadTokens('a plan on grief').slice(1)).toEqual(['plan', 'grief']);
  });
});
