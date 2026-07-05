// NEW-IDX-1: the SPARQL literal builder must escape control characters, not just backslash + double-quote,
// so a crawled PUBLIC (attacker-supplied) A2A card / profile field carrying a raw newline / control char
// can't produce a malformed INSERT that fails the whole indexing batch.
import { describe, expect, it } from 'vitest';
import { lit } from '../src/store.js';

describe('lit() SPARQL literal escaping (NEW-IDX-1)', () => {
  it('escapes backslash + double-quote', () => {
    expect(lit('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
  it('escapes newline / carriage-return / tab (no raw control char in output)', () => {
    const out = lit('line1\nline2\ttabbed\rreturn');
    expect(out).toBe('"line1\\nline2\\ttabbed\\rreturn"');
    // no raw control byte survives into the literal body
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(out)).toBe(false);
  });
  it('escapes the rest of the C0 control range as \\uXXXX', () => {
    const out = lit('x\x00\x07\x1by');
    expect(out).toBe('"x\\u0000\\u0007\\u001by"');
  });
  it('leaves ordinary printable text untouched', () => {
    expect(lit('impact.agent hello world 123')).toBe('"impact.agent hello world 123"');
  });
});
