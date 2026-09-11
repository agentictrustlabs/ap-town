// Spec 349 §2 — a capability word resolves to a declared id by a rule a reviewer can run by hand; never a widening.
import { describe, it, expect } from 'vitest';
import { resolveCapabilityWord, capabilityIdsInText, idTokens, wordTokens } from '../src/capability-resolution.js';
import { CAPABILITY_SYNONYMS } from '../src/whitelabel.js';

const declared = ['gc:CFnDiscipleshipCurricula', 'gc:CFnBibleStudyTools', 'gc:CFnLayTheologicalTraining'];

describe('capability resolution', () => {
  it('tokenizes ids by their capitals and drops the scheme prefix', () => {
    expect(idTokens('gc:CFnDiscipleshipCurricula')).toEqual(['discipleship', 'curricul']);
    expect(idTokens('gc:CFnBibleStudyTools')).toEqual(['bible', 'study', 'tool']);
  });
  it('maps the community\'s words through the synonym table and stems', () => {
    expect(wordTokens('study plans', CAPABILITY_SYNONYMS)).toEqual(['curricul']);
    expect(wordTokens('discipleship curricula', CAPABILITY_SYNONYMS)).toEqual(['discipleship', 'curricul']);
  });
  it('resolves a word to exactly one declared id, with the reason', () => {
    const r = resolveCapabilityWord('study plans', declared, CAPABILITY_SYNONYMS);
    expect(r.resolvedTo).toBe('gc:CFnDiscipleshipCurricula');
    expect(r.because).toContain('study plans');
    expect(resolveCapabilityWord('gc:CFnDiscipleshipCurricula', declared, CAPABILITY_SYNONYMS).resolvedTo).toBe('gc:CFnDiscipleshipCurricula');
  });
  it('leaves an unknown word unresolved and names the reason — never a widening', () => {
    const r = resolveCapabilityWord('basket weaving', declared, CAPABILITY_SYNONYMS);
    expect(r.resolvedTo).toBeNull();
    expect(r.because).toContain('matches no capability');
    expect(resolveCapabilityWord('gc:Nope', declared, CAPABILITY_SYNONYMS)).toMatchObject({ resolvedTo: null, because: 'an id no registered agent declares' });
  });
  it('names the candidates when several ids fit', () => {
    const r = resolveCapabilityWord('study', [...declared, 'gc:CFnStudyGuides'], CAPABILITY_SYNONYMS);
    expect(r.resolvedTo).toBeNull();
    expect(r.candidates.length).toBe(2);
  });
  it('finds the ids a text asks for, all words present', () => {
    expect(capabilityIdsInText('discipleship curricula on justification', declared, CAPABILITY_SYNONYMS)).toEqual(['gc:CFnDiscipleshipCurricula']);
    expect(capabilityIdsInText('a study on justification', declared, CAPABILITY_SYNONYMS)).toEqual([]);
  });
});
