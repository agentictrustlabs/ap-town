// THE PUBLIC TIER'S PASSAGES — spec 413. The indexer is the only writer of the vector index (Vectorize), exactly as it is
// the only writer of the A-box (ADR-0040). Two kinds of passage are written, both public by construction:
//
//   agent  one per named agent, restated from facts the A-box already holds (name, display name, descriptions, focus
//          areas, offering descriptions) — nothing a SPARQL read of the KB would not already return;
//   shelf  the chunks of a Library document its owner made public AND released with her signature, after the shelf
//          projector verified both (`shelf.ts`, ADR-0040 amendment 2026-09-24).
//
// Derived and rebuildable: wiping the index loses nothing that re-indexing does not restore.
import type { AgentNode } from './store.js';
import { PREDICATE } from './ontology.js';

/** MUST equal `demo-discovery-mcp/src/retrieve.ts` `EMBEDDING_MODEL`; each vector records it, and the reader drops any
 *  vector whose model differs rather than scoring it against a query embedded by another. */
export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
export const EMBEDDING_DIMENSIONS = 768;
/** A passage's size: small enough to quote, large enough to mean something. Metadata carries the text (Vectorize caps
 *  metadata at 10 KiB per vector). */
export const CHUNK_CHARS = 1_400;
const CHUNK_OVERLAP = 200;
const EMBED_BATCH = 50;

export interface WorkersAi { run(model: string, inputs: Record<string, unknown>): Promise<unknown> }
export interface VectorWriter {
  upsert(vectors: Array<{ id: string; values: number[]; metadata: Record<string, string | number> }>): Promise<unknown>;
  deleteByIds(ids: string[]): Promise<unknown>;
}

export interface PassageInput {
  kind: 'shelf' | 'agent';
  subject: string;
  title: string;
  text: string;
  sourceUrl?: string;
  entryId?: string;
  releaseId?: string;
  commitment?: string;
  observedAt: string;
}

/** Split text into overlapping passages on paragraph, then sentence, boundaries. Front matter is kept: a work's title
 *  and authors are part of what it is. Deterministic — the same text always yields the same chunks (and ids). */
export function chunkText(text: string, max = CHUNK_CHARS): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= max) return [clean];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + max);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('.\n'), window.lastIndexOf('? '), window.lastIndexOf('! '));
      const cut = para > max * 0.5 ? para : sentence > max * 0.5 ? sentence + 1 : -1;
      if (cut > 0) end = start + cut;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return out;
}

/** A vector id: ≤ 64 bytes (Vectorize's cap), stable per (kind, subject, entry, chunk). */
export async function vectorId(kind: string, subject: string, entryId: string, chunk: number): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${kind}|${subject.toLowerCase()}|${entryId}|${chunk}`));
  return [...new Uint8Array(buf)].slice(0, 24).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function embed(ai: WorkersAi, texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const r = (await ai.run(EMBEDDING_MODEL, { text: texts.slice(i, i + EMBED_BATCH) })) as { data?: number[][] };
    const data = r?.data ?? [];
    if (data.length !== Math.min(EMBED_BATCH, texts.length - i)) throw new Error(`embedding returned ${data.length} vectors for ${Math.min(EMBED_BATCH, texts.length - i)} passages`);
    out.push(...data);
  }
  return out;
}

/** Embed and write the passages of ONE source (a work, or an agent), returning the ids written. Chunk ids are
 *  deterministic, so a re-projection overwrites in place; the caller deletes any ids the previous projection wrote
 *  that this one did not (a work that got shorter). */
export async function writePassages(ai: WorkersAi, index: VectorWriter, p: PassageInput): Promise<string[]> {
  const chunks = chunkText(p.text);
  if (!chunks.length) return [];
  const values = await embed(ai, chunks.map((c) => (p.title && !c.startsWith(p.title) ? `${p.title}\n\n${c}` : c)));
  const ids = await Promise.all(chunks.map((_, i) => vectorId(p.kind, p.subject, p.entryId ?? 'agent', i)));
  await index.upsert(chunks.map((text, i) => ({
    id: ids[i]!,
    values: values[i]!,
    metadata: {
      model: EMBEDDING_MODEL, kind: p.kind, subject: p.subject.toLowerCase(), title: p.title.slice(0, 200), text, chunk: i,
      observedAt: p.observedAt,
      ...(p.sourceUrl ? { sourceUrl: p.sourceUrl } : {}),
      ...(p.entryId ? { entryId: p.entryId } : {}),
      ...(p.releaseId ? { releaseId: p.releaseId } : {}),
      ...(p.commitment ? { commitment: p.commitment } : {}),
    },
  })));
  return ids;
}

/** The A-box text of one agent, restated as a passage. Only the literals the KB already publishes; `null` when the
 *  agent says nothing about itself beyond its name (a name alone is `kb.question`'s, not a passage). */
export function agentPassageText(node: AgentNode): string | null {
  const keys = [PREDICATE.displayName, PREDICATE.description, PREDICATE.nameDescription, PREDICATE.focusAreas];
  const lines: string[] = [];
  const said = (v: unknown) => { for (const s of Array.isArray(v) ? v : [v]) if (typeof s === 'string' && s.trim() && !lines.includes(s.trim())) lines.push(s.trim()); };
  for (const f of node.facets) {
    if (!f.present) continue;
    for (const k of keys) said(f.data[k]);
    for (const child of f.children ?? []) said(child.data[PREDICATE.offeringDescription]);
  }
  const body = lines.filter((l) => l !== node.name);
  if (!body.length) return null;
  return [node.name, ...body].filter(Boolean).join('\n');
}

/** Write one passage per named agent that describes itself. Returns how many were written. */
export async function writeAgentPassages(ai: WorkersAi, index: VectorWriter, nodes: AgentNode[], observedAt = new Date().toISOString()): Promise<number> {
  let n = 0;
  for (const node of nodes) {
    const text = agentPassageText(node);
    if (!text || !node.name) continue;
    // One chunk per agent: a self-description is short, and a single id per agent means a re-projection replaces it.
    await writePassages(ai, index, { kind: 'agent', subject: node.smartAgent, title: node.name, text: text.slice(0, CHUNK_CHARS), observedAt });
    n++;
  }
  return n;
}
