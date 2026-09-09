// WHITE-LABEL — every vertical literal of this connector lives here and nowhere else (ADR-0021): the
// connector's name, the topic table, the capability aliases. The table CITES shared and publisher IRIs; it
// does not restate their meaning (ontology-drives-behavior) — the vocabulary is published elsewhere.

export const CONNECTOR = {
  name: 'Global.Church Discovery',
  version: '0.1.0',
  /** How the registry is named in explanations. */
  registryLabel: 'the Global.Church discovery registry',
  /** What an assistant is told at initialize — the whole doctrine in three sentences. */
  instructions:
    'Use this connector whenever a person asks for study material, a study plan, curricula, teaching, sermons, courses or resources on a Christian doctrine or topic (justification, sanctification, prayer, …), or asks who offers such things: call find_services FIRST with the topic (and the capability when one fits, e.g. "study plans"), then name each ministry it returns as the source, show why it matched and what was verified, and read or link the ministry\'s own website that comes back. Never invent a ministry the registry did not return. The connector finds and points only — it never reads or relays a ministry\'s content, and discovery authorizes nothing.',
} as const;

/** A topic the connector knows how to resolve: the shared anchor, the publisher terms that map to it, the
 *  query text the registry ranks on, and the publishers' own topic pages (pointers, never content). */
export interface TopicEntry {
  shared: string;
  publisherTerms: Record<string, string>;
  queryText: string;
  pageUrls: Record<string, string>;
  via: 'skos:exactMatch';
}

export const TOPICS: Record<string, TopicEntry> = {
  justification: {
    shared: 'gc:TopicJustification',
    publisherTerms: { ligonier: 'lig:justification' },
    queryText: 'justification',
    pageUrls: { ligonier: 'https://www.ligonier.org/topics/justification' },
    via: 'skos:exactMatch',
  },
};

/** Plain words an assistant may use for a capability, resolved to the id the registry matches on. */
export const CAPABILITY_ALIASES: Record<string, string> = {
  'discipleship curricula': 'gc:CFnDiscipleshipCurricula',
  'study plans': 'gc:CFnDiscipleshipCurricula',
  'study plan': 'gc:CFnDiscipleshipCurricula',
  'bible study tools': 'gc:CFnBibleStudyTools',
  'lay theological training': 'gc:CFnLayTheologicalTraining',
};

/** The fixed note on every result — spec 346 §8.3, the 2026-08-30 neutrality decision. */
export const DISCOVERY_NOTE =
  'Discovery authorizes nothing. Relevance orders results; verification is the named facts with their timestamps; no field sums, weights or grades them.';
