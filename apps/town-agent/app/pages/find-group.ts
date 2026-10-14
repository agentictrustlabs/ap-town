// WHAT KIND OF ANSWER IS THIS — the one rule that makes the Find page readable.
//
// The registry answers two different questions and the page used to render both as one flat list. Typing a name
// returned 120 rows: the agent you named was rank 1, and it looked exactly like the 109 rows scoring 0.14 and
// under, which are simply the page of the knowledge base the registry read in order to rank anything at all
// (measured 2026-10-14). The information was there and unreadable.
//
// So: a NAME MATCH is a lookup and is shown as one. A fit match is a ranking and is shown as one. The rest is
// what the registry read, kept — it is part of the registry's answer and the portal takes nothing away — but
// behind a control, because a visible low band is still a wall.
//
// Nothing here scores, re-orders within a group, or edits a line of the registry's text. Order inside every
// group is the registry's own.
import type { FindHit } from '../types';

/** Below this, a row carries no signal from the words at all. Evidence alone (registry standing, SHACL, facets)
 *  tops out at 0.18 on this corpus; anything the words touched starts at 0.61. The gap is wide and the cut sits
 *  in it — but it IS a constant over a score the registry may retune, so it is named, measured, and tested on
 *  fixtures that fail loudly if the two populations ever meet. The durable fix is a `textHit` flag per result
 *  from the registry, and then this goes away. */
export const TEXT_FLOOR = 0.3;

export interface Grouped {
  /** The thing the typed string names, when the typed string names something. */
  exact: FindHit[];
  /** Names that begin with it, then names that merely contain it — each in the registry's order. */
  like: FindHit[];
  /** Ranked by fit on the words, with the name matches removed so they are not answered twice. */
  fit: FindHit[];
  /** Read by the registry, pointing at nothing in the question. */
  rest: FindHit[];
  /** The label and ending the query parsed to, when it is name-shaped at all. */
  asName: { label: string; tld: string | null } | null;
}

const NAME_SHAPED = /^([a-z0-9-]{3,63})(?:\.([a-z]{2,20}))?$/;

/** The label part of a name (`nathan` of `nathan.me`), lower-cased; null for a row with no name. */
const labelOf = (h: FindHit): string | null => (h.name ? (h.name.toLowerCase().split('@')[0] ?? '').split('.')[0] ?? null : null);
const endOf = (h: FindHit): string | null => {
  const base = h.name ? h.name.toLowerCase().split('@')[0] ?? '' : '';
  const parts = base.split('.');
  return parts.length > 1 ? parts[parts.length - 1] ?? null : null;
};

/**
 * Group one answer. `named` is the registry's own substring read when the question was name-shaped — it is
 * authoritative and untruncated, where the ranked page is neither — and it is used in preference to picking
 * name matches out of the ranked page. Both are deduplicated by Smart Agent, since an agent found both ways
 * is one agent.
 */
export function groupFindResults(query: string, results: FindHit[], named?: FindHit[] | null): Grouped {
  const q = query.trim().toLowerCase();
  const m = NAME_SHAPED.exec(q);
  const asName = m ? { label: m[1]!, tld: m[2] ?? null } : null;
  if (!asName) return { exact: [], like: [], fit: results.filter((r) => r.score >= TEXT_FLOOR), rest: results.filter((r) => r.score < TEXT_FLOOR), asName: null };

  // Every row that carries the typed label in its name, from whichever read saw it.
  const byAgent = new Map<string, FindHit>();
  for (const h of [...(named ?? []), ...results]) {
    const l = labelOf(h);
    if (l && l.includes(asName.label) && !byAgent.has(h.smartAgent)) byAgent.set(h.smartAgent, h);
  }
  const hits = [...byAgent.values()];
  // An ending typed is an ending meant: `nathan.me` is not answered by `nathan.org`.
  const isExact = (h: FindHit): boolean => labelOf(h) === asName.label && (!asName.tld || endOf(h) === asName.tld);
  const exact = hits.filter(isExact);
  const like = [
    ...hits.filter((h) => !isExact(h) && (labelOf(h) ?? '').startsWith(asName.label)),
    ...hits.filter((h) => !isExact(h) && !(labelOf(h) ?? '').startsWith(asName.label)),
  ];
  const isName = new Set(hits.map((h) => h.smartAgent));
  const ranked = results.filter((r) => !isName.has(r.smartAgent));
  return { exact, like, fit: ranked.filter((r) => r.score >= TEXT_FLOOR), rest: ranked.filter((r) => r.score < TEXT_FLOOR), asName };
}

/** A line every card in a group repeats says nothing about any of them; it is said once above them instead.
 *  Plain string equality over what the registry wrote — no phrase is known to this code, and none is dropped. */
export function sharedWhy(group: FindHit[]): string[] {
  if (group.length < 2) return [];
  const first = group[0]!.why ?? [];
  return first.filter((line) => group.every((h) => (h.why ?? []).includes(line)));
}
