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
    'Use this connector whenever a person asks for study material, a study plan, curricula, teaching, sermons, courses or resources on a Christian doctrine or topic (justification, sanctification, prayer, …), or asks who offers such things. FIRST call discover_agents with the topic (and the capability when one fits, e.g. "study plans"); THEN call invoke_agent on the agent it returned with the person\'s ask in plain words (a study plan, a reading list, what it offers) — the ministry\'s own agent answers from its own catalog, and its reply carries the items with their links as a results artifact. Present that reply as the ministry\'s answer, naming the ministry as the source and keeping every link it gave; use get_task to finish a task that came back working. find_services and get_service only list who is registered and what was verified, for "who offers X" questions. Never invent a ministry the registry did not return and never supply resources of your own beside the agent\'s. The connector finds, points and relays a task — it never reads a ministry\'s content itself, and discovery authorizes nothing.',
} as const;

/** A topic the connector knows how to resolve: the shared anchor, the publisher terms that map to it, and the
 *  query text the registry ranks on. NO page pointers (spec 387 W2): content is reached only through the
 *  publisher's own agent — discover → inspect → invoke — never by a URL this table hands out. */
export interface TopicEntry {
  shared: string;
  publisherTerms: Record<string, string>;
  queryText: string;
  via: 'skos:exactMatch';
}

export const TOPICS: Record<string, TopicEntry> = {
  justification: {
    shared: 'gc:TopicJustification',
    publisherTerms: { ligonier: 'lig:justification' },
    queryText: 'justification',
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
