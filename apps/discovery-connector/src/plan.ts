// DETERMINISTIC PLANNING (spec 386 §1). A find_services call compiles to ONE exact ARD `POST /search` body.
// No model plans it: a reviewer's result is reproducible. A known topic contributes its query text and its
// shared anchor; an unknown topic passes the raw word as text and the explanation says so.
import { CAPABILITY_ALIASES, TOPICS, type TopicEntry } from './whitelabel.js';

export interface FindServicesArgs { topic?: string; capability?: string; language?: string; limit?: number }

export interface ArdSearchBody {
  query: { text: string; filter?: Record<string, string[]> };
  pageSize: number;
  federation: 'none';
}

export interface TopicResolution {
  word: string;
  known: boolean;
  shared?: string;
  publisherTerms?: Record<string, string>;
  via?: string;
  pageUrls?: Record<string, string>;
  explanation: string;
}

export function resolveTopic(word: string): TopicResolution {
  const key = word.trim().toLowerCase();
  const hit: TopicEntry | undefined = TOPICS[key];
  if (!hit) return { word, known: false, explanation: `“${word}” is not a topic this connector maps to a shared concept; the registry was searched on the word itself.` };
  const terms = Object.entries(hit.publisherTerms).map(([pub, term]) => `${term} (${pub})`).join(', ');
  return {
    word, known: true, shared: hit.shared, publisherTerms: hit.publisherTerms, via: hit.via, pageUrls: hit.pageUrls,
    explanation: `“${word}” → ${hit.shared}${terms ? ` ← ${hit.via} ← ${terms}` : ''}`,
  };
}

export function resolveCapability(said: string | undefined): string | undefined {
  const s = (said ?? '').trim();
  if (!s) return undefined;
  return CAPABILITY_ALIASES[s.toLowerCase()] ?? s;
}

export function planFindServices(args: FindServicesArgs): { body: ArdSearchBody; topic: TopicResolution | null; capability?: string; language?: string; refused?: string } {
  const topic = args.topic?.trim() ? resolveTopic(args.topic) : null;
  const capability = resolveCapability(args.capability);
  const lang = (args.language ?? '').trim().toLowerCase();
  if (lang && !/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(lang)) return { body: { query: { text: '' }, pageSize: 5, federation: 'none' }, topic, refused: `language must be a BCP-47 tag (got “${args.language}”)` };
  const limit = Number.isInteger(args.limit) && (args.limit as number) >= 1 ? Math.min(args.limit as number, 25) : 5;
  const text = topic ? (topic.known ? TOPICS[topic.word.trim().toLowerCase()]!.queryText : topic.word.trim()) : '';
  const filter: Record<string, string[]> = {};
  if (capability) filter.capabilities = [capability];
  if (lang) filter['ap:language'] = [lang];
  if (!text && !capability) return { body: { query: { text: '' }, pageSize: limit, federation: 'none' }, topic, refused: 'say a topic, a capability, or both — the registry needs a question' };
  return {
    body: { query: { text: text || (capability as string), ...(Object.keys(filter).length ? { filter } : {}) }, pageSize: limit, federation: 'none' },
    topic, ...(capability ? { capability } : {}), ...(lang ? { language: lang } : {}),
  };
}
