// PASSAGE RETRIEVAL OVER THE PUBLIC TIER — spec 413 W1. `POST /kb/retrieve {query, topK, topics?}`.
//
// Embeds the query with Workers AI, asks Vectorize for the nearest passages, and keeps those at or above ONE FIXED
// floor. The index is a projection of the public knowledge base, written only by the indexer: agent descriptions the
// A-box already holds, and shelf works their owners made public AND released (ADR-0040 amendment 2026-09-24). This
// Worker holds no vault binding and must never gain one (`check:no-vector-over-vault`).
//
// ONE MECHANISM (ADR-0013). Nothing below widens a query that found nothing: no second, looser floor, no larger topK, no
// SPARQL in its place. Empty is the answer, returned with the floor that produced it.
//
// NOTHING IS KEPT. The query is embedded and discarded — not logged, not stored, never written back to the tier.

export interface RetrieveEnv {
  /** Workers AI. */
  AI?: { run(model: string, inputs: Record<string, unknown>): Promise<unknown> };
  /** The public-tier vector index (Vectorize), written by the indexer. */
  KB_VECTORS?: VectorIndex;
}

export interface VectorIndex {
  query(vector: number[], opts: { topK: number; returnMetadata?: 'all' | 'indexed' | 'none'; filter?: Record<string, unknown> }): Promise<{ matches: Array<{ id: string; score: number; metadata?: Record<string, unknown> }> }>;
}

/** The embedding model the index was built with. MUST equal the indexer's (`demo-discovery-indexer/src/vectors.ts`);
 *  every vector carries the model in its metadata, and a vector from another model is dropped and counted, never scored
 *  against a query it cannot be compared with. */
export const EMBEDDING_MODEL = '@cf/baai/bge-base-en-v1.5';
/** Cosine similarity below which a passage is not an answer. Fixed: a floor that moves when nothing clears it is a
 *  second mechanism wearing the first one's name. */
export const SCORE_FLOOR = 0.62;
const TOP_K_MAX = 10;
const QUERY_MAX_CHARS = 1000;

export interface PassageV1 {
  kind: 'shelf' | 'agent';
  subject: string;
  title: string;
  text: string;
  score: number;
  sourceUrl?: string;
  entryId?: string;
  releaseId?: string;
  commitment?: string;
  observedAt?: string;
}

export type RetrieveResult =
  | { ok: true; passages: PassageV1[]; floor: number; model: string; topics?: string[]; dropped?: number }
  | { ok: false; error: string };

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** The text that is embedded: the query, and the playbook's declared topics said as such. */
export function embeddedText(query: string, topics: string[]): string {
  const q = query.trim().slice(0, QUERY_MAX_CHARS);
  return topics.length ? `${q}\n(topics: ${topics.join(', ')})` : q;
}

export async function retrievePassages(env: RetrieveEnv, input: { query?: unknown; topK?: unknown; topics?: unknown }): Promise<RetrieveResult> {
  if (!env.AI || !env.KB_VECTORS) return { ok: false, error: 'no vector index is bound on this discovery tier (AI + KB_VECTORS)' };
  const query = typeof input.query === 'string' ? input.query.trim() : '';
  if (!query) return { ok: false, error: 'query required' };
  const topK = Math.max(1, Math.min(TOP_K_MAX, Number.isFinite(Number(input.topK)) && Number(input.topK) > 0 ? Math.floor(Number(input.topK)) : 5));
  const topics = Array.isArray(input.topics) ? input.topics.filter((t): t is string => typeof t === 'string' && !!t.trim()).slice(0, 12) : [];

  const embedded = (await env.AI.run(EMBEDDING_MODEL, { text: [embeddedText(query, topics)] })) as { data?: number[][] };
  const vector = embedded?.data?.[0];
  if (!Array.isArray(vector) || !vector.length) return { ok: false, error: 'the embedding model returned no vector' };

  const { matches } = await env.KB_VECTORS.query(vector, { topK, returnMetadata: 'all' });
  let dropped = 0;
  const passages: PassageV1[] = [];
  for (const m of matches ?? []) {
    const md = m.metadata ?? {};
    if (md.model !== EMBEDDING_MODEL) { dropped++; continue; }
    if (m.score < SCORE_FLOOR) continue;
    const kind = md.kind === 'shelf' ? 'shelf' : md.kind === 'agent' ? 'agent' : null;
    const text = str(md.text);
    const subject = str(md.subject);
    if (!kind || !text || !subject) { dropped++; continue; }
    passages.push({
      kind, subject, text, title: str(md.title) ?? subject, score: Math.round(m.score * 1000) / 1000,
      ...(str(md.sourceUrl) ? { sourceUrl: str(md.sourceUrl) } : {}),
      ...(str(md.entryId) ? { entryId: str(md.entryId) } : {}),
      ...(str(md.releaseId) ? { releaseId: str(md.releaseId) } : {}),
      ...(str(md.commitment) ? { commitment: str(md.commitment) } : {}),
      ...(str(md.observedAt) ? { observedAt: str(md.observedAt) } : {}),
    });
  }
  return { ok: true, passages, floor: SCORE_FLOOR, model: EMBEDDING_MODEL, ...(topics.length ? { topics } : {}), ...(dropped ? { dropped } : {}) };
}
