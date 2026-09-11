// A CAPABILITY SAID IN WORDS resolves to a DECLARED id — spec 349 §2 / 397 §7.4, deterministic and published.
//
// A person (or an assistant speaking for one) says "study plans"; the registry matches on ids like
// `gc:CFnDiscipleshipCurricula`. Resolution is a rule a reviewer can run by hand: the id's local part is split on
// its capitals (`Discipleship`, `Curricula`), a short prefix token (`CFn`, `Cap`) is dropped, every token is stemmed
// lightly (plans → plan, curricula/curriculum → curricul) and the query's words are mapped through the deployment's
// synonym table (`study plan` → curricula) and stemmed the same way; an id resolves when EVERY query token is among its
// tokens. Exactly one id ⇒ resolved; several ⇒ ambiguous, named; none ⇒ unresolved, said. Never a widening: an
// unresolved word leaves the filter unmet and the answer empty, with the reason on the response (ADR-0013).
//
// The same rule turns a TEXT query into ranking ids: an id all of whose tokens occur in the text is what the text
// asked for (`intent.capabilityIds`), so the score cites "declared … (exact)" instead of "ranked on text alone".

/** An id in `prefix:LocalPart` form, or a bare CamelCase / dotted id — anything that is not plain prose. */
export const looksLikeCapabilityId = (s: string): boolean => /^[a-z][\w-]*:[A-Za-z][\w.-]*$/.test(s) || /^[a-z][\w-]*(\.[a-z][\w-]*)+$/.test(s);

const STOP = new Set(['a', 'an', 'the', 'on', 'of', 'for', 'and', 'or', 'to', 'in', 'with', 'about', 'me', 'my', 'some', 'any', 'that', 'this', 'from', 'by', 'at', 'is', 'are', 'i', 'want', 'need', 'find', 'who', 'offers', 'offer']);

/** Light, reversible-enough stemming: plurals and the curricula/curriculum pair. Deterministic, no dictionary. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return w;
  if (/^curricul(a|um|ums)$/.test(w)) return 'curricul';
  if (/ies$/.test(w) && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(ses|xes|zes|ches|shes)$/.test(w) && w.length > 4) return w.slice(0, -2);
  if (/s$/.test(w) && !/ss$/.test(w) && w.length > 3) w = w.slice(0, -1);
  return w;
}

/** The tokens of a capability id: split the local part on capitals and separators, drop a short leading prefix token. */
export function idTokens(id: string): string[] {
  const local = id.includes(':') ? id.slice(id.indexOf(':') + 1) : id;
  const parts = local.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s._-]+/).filter(Boolean);
  let toks = parts.map(stem).filter(Boolean);
  // `CFn`, `Cap`, `Cx` — a scheme's own prefix (one or two short fragments), not a word anyone says.
  while (toks.length > 1 && toks[0]!.length <= 3) toks = toks.slice(1);
  return toks;
}

/** The query's words as tokens: synonyms applied first (longest phrase wins), then stop words dropped, then stemmed. */
export function wordTokens(text: string, synonyms: Record<string, string>): string[] {
  let t = ` ${text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()} `;
  for (const [phrase, to] of Object.entries(synonyms).sort((a, b) => b[0].length - a[0].length)) t = t.split(` ${phrase} `).join(` ${to} `);
  return [...new Set(t.trim().split(' ').filter((w) => w && !STOP.has(w)).map(stem).filter(Boolean))];
}

export interface CapabilityResolution {
  requested: string;
  /** The one id the words resolve to; null when none or several. */
  resolvedTo: string | null;
  /** How it was decided — the rule's own words, checkable against `candidates`. */
  because: string;
  candidates: string[];
}

/** Resolve one FILTER value (a word or phrase) against the ids the registry's agents declared. */
export function resolveCapabilityWord(word: string, declaredIds: readonly string[], synonyms: Record<string, string>): CapabilityResolution {
  const requested = word.trim();
  const lower = requested.toLowerCase();
  const exact = declaredIds.find((id) => id.toLowerCase() === lower);
  if (exact) return { requested, resolvedTo: exact, because: 'an id the registry knows, taken as is', candidates: [exact] };
  if (looksLikeCapabilityId(requested)) return { requested, resolvedTo: null, because: 'an id no registered agent declares', candidates: [] };
  const want = wordTokens(requested, synonyms);
  if (!want.length) return { requested, resolvedTo: null, because: 'no words to resolve', candidates: [] };
  const hits = declaredIds.filter((id) => { const have = new Set(idTokens(id)); return want.every((w) => have.has(w)); });
  if (hits.length === 1) return { requested, resolvedTo: hits[0]!, because: `“${requested}” → ${hits[0]} (every word of it — ${want.join(', ')} — is in the id)`, candidates: hits };
  if (hits.length > 1) return { requested, resolvedTo: null, because: `“${requested}” names ${hits.length} declared capabilities; name one`, candidates: hits };
  return { requested, resolvedTo: null, because: `“${requested}” (${want.join(', ')}) matches no capability any registered agent declares`, candidates: [] };
}

/** The ids a TEXT query asks for: every declared id all of whose tokens occur in the text. Ranking only, never a filter. */
export function capabilityIdsInText(text: string, declaredIds: readonly string[], synonyms: Record<string, string>): string[] {
  const have = new Set(wordTokens(text, synonyms));
  if (!have.size) return [];
  return declaredIds.filter((id) => { const toks = idTokens(id); return toks.length > 0 && toks.every((t) => have.has(t)); });
}
