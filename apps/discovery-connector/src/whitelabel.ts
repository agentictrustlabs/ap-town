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
    'Finds registered ministries and services through the Global.Church discovery registry and returns pointers: the entry, why it matched, what was verified, and the service\'s own website. It never reads or relays a ministry\'s content — go to the website it returns, or hand the person the link. Discovery authorizes nothing.',
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
