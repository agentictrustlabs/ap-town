// Spec 413 — passages: deterministic chunks and ids; an agent passage restates only what the A-box already says.
import { describe, it, expect } from 'vitest';
import { chunkText, vectorId, agentPassageText, CHUNK_CHARS } from '../src/vectors.js';
import { PREDICATE } from '../src/ontology.js';

describe('chunkText', () => {
  it('keeps a short text whole and splits a long one into bounded, overlapping, deterministic chunks', () => {
    expect(chunkText('  one paragraph.  ')).toEqual(['one paragraph.']);
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} says something worth reading about the subject at hand.`).join('\n\n');
    const a = chunkText(long);
    expect(a.length).toBeGreaterThan(1);
    expect(a.every((c) => c.length <= CHUNK_CHARS)).toBe(true);
    expect(chunkText(long)).toEqual(a);
  });
  it('ids are ≤ 64 bytes and stable per (kind, subject, entry, chunk)', async () => {
    const id = await vectorId('shelf', '0xABC', 'art-1', 0);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(await vectorId('shelf', '0xabc', 'art-1', 0)).toBe(id);
    expect(await vectorId('shelf', '0xabc', 'art-1', 1)).not.toBe(id);
  });
});

describe('agentPassageText', () => {
  const node = (data: Record<string, unknown>, children: Array<{ data: Record<string, unknown> }> = []) => ({
    chainId: 1, smartAgent: '0x1', name: 'carol.me', node: '0x', facets: [{ kind: 'profile', present: true, shapeIri: null, conforms: true, data, children: children as never }], provenance: { source: 'x', block: 1, indexedAt: '' },
  });
  it('restates the self-description and offering descriptions', () => {
    const t = agentPassageText(node({ [PREDICATE.description]: 'Writes on grief and hope.' }, [{ data: { [PREDICATE.offeringDescription]: 'Pastoral letters' } }]));
    expect(t).toBe('carol.me\nWrites on grief and hope.\nPastoral letters');
  });
  it('a name alone is not a passage', () => {
    expect(agentPassageText(node({}))).toBeNull();
  });
});
