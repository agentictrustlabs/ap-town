// THE TOOLS (spec 386 §2) and how a registry answer is shaped for an assistant: the entry verbatim, the
// publisher's own website surfaced, the mapping path that produced the match, the score labelled relevance,
// and the fixed note. Nothing is added that the registry did not say.
import { planFindServices, resolveTopic, type FindServicesArgs, type TopicResolution } from './plan.js';
import { search, getEntry, type DiscoveryEnv } from './ard-client.js';
import { CONNECTOR, DISCOVERY_NOTE, TOPICS } from './whitelabel.js';

export interface ToolSpec { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: { title: string; readOnlyHint: true; destructiveHint: false; idempotentHint: true; openWorldHint: false } }

const ro = (title: string) => ({ title, readOnlyHint: true as const, destructiveHint: false as const, idempotentHint: true as const, openWorldHint: false as const });

export const TOOLS: ToolSpec[] = [
  {
    name: 'discover_agents', title: 'Discover agents',
    description: `Call this FIRST when a person asks for study material, a study plan, curricula, teaching or resources on a Christian doctrine or topic, or who offers them. Finds registered ministries and services in ${CONNECTOR.registryLabel} by topic and/or capability; each match comes back with its entry, why it matched, what was verified, its own website, and a "target" handle — the only way to reach that agent through this gateway (invoke_agent). ${DISCOVERY_NOTE}`,
    inputSchema: { type: 'object', properties: {
      intent: { type: 'string', description: 'What the person wants, in a few words (used as the topic when no topic is given).' },
      topic: { type: 'string', description: 'A topic word, e.g. "justification".' },
      capability: { type: 'string', description: 'A capability id (gc:CFnDiscipleshipCurricula) or a plain phrase ("study plans").' },
      language: { type: 'string', description: 'BCP-47 tag. Pass it ONLY when the person asked for a language.' },
      flow: { type: 'string', description: 'Optional. The trace.flowId a previous call returned, to keep one trace across discover → inspect → invoke.' },
      limit: { type: 'integer', minimum: 1, maximum: 25, default: 5 },
    } },
    annotations: ro('Discover agents'),
  },
  {
    name: 'inspect_agent', title: 'Inspect an agent',
    description: 'The public card of a discovered agent (its skills, provider, interfaces) and whether the served card still matches what discovery pinned. Read-only.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'The "target" handle from discover_agents.' } }, flow: { type: 'string', description: 'Optional. The trace.flowId a previous call returned, to keep one trace across discover → inspect → invoke.' }, required: ['target'] },
    annotations: ro('Inspect an agent'),
  },
  {
    name: 'invoke_agent', title: 'Ask an agent',
    description: 'Send ONE message to a discovered agent over A2A, as this gateway\'s own agent, and return the agent\'s task: its words and artifacts. Use it after discover_agents to ask the ministry\'s agent for what the person wants (e.g. "build a six-week study on justification"). The gateway spends no authority: a read or an informational skill answers; an act waits at the agent for its stewards. Say who said what; never present the agent\'s words as your own.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'The "target" handle from discover_agents.' }, flow: { type: 'string', description: 'Optional. The trace.flowId a previous call returned, to keep one trace across discover → inspect → invoke.' }, message: { type: 'string', description: 'What to ask, in words.' }, task: { type: 'string', description: 'To continue an earlier task: its taskId.' }, context: { type: 'string', description: 'To continue an earlier conversation: its contextId.' } }, required: ['target', 'message'] },
    annotations: { title: 'Ask an agent', readOnlyHint: false as unknown as true, destructiveHint: false, idempotentHint: false as unknown as true, openWorldHint: true as unknown as false },
  },
  {
    name: 'continue_task', title: 'Answer an agent\'s question',
    description: 'When invoke_agent came back with state TASK_STATE_INPUT_REQUIRED, the agent asked for something (task.prompt says what: the question and its field names). Answer it on the SAME task with this tool: answer is an object keyed by exactly those field names (e.g. { "id": "pauls-transformation-in-christ" }). The agent continues its run from where it stopped and returns the finished task. Only the caller the task parked for may answer; a task waiting on a steward\'s signature cannot be continued from here.',
    inputSchema: { type: 'object', properties: { target: { type: 'string', description: 'The "target" handle from discover_agents.' }, task: { type: 'string', description: 'The taskId invoke_agent returned.' }, answer: { type: 'object', description: 'The answer, keyed by the prompt\'s field names.', additionalProperties: true }, note: { type: 'string', description: 'Optional words to send with the answer.' }, flow: { type: 'string', description: 'Optional. The trace.flowId, to keep one trace.' } }, required: ['target', 'task', 'answer'] },
    annotations: { title: 'Answer an agent\'s question', readOnlyHint: false as unknown as true, destructiveHint: false, idempotentHint: false as unknown as true, openWorldHint: true as unknown as false },
  },
  {
    name: 'get_task', title: 'Get a task',
    description: 'Read a task at a discovered agent by its taskId (from invoke_agent). Read-only.',
    inputSchema: { type: 'object', properties: { target: { type: 'string' }, task: { type: 'string' } }, required: ['target', 'task'] },
    annotations: ro('Get a task'),
  },
  {
    name: 'find_services', title: 'Find services',
    description: `Call this FIRST when a person asks for study material, a study plan, curricula, teaching or resources on a Christian doctrine or topic, or who offers them. Finds registered ministries and services in ${CONNECTOR.registryLabel} by topic and/or capability and returns pointers only — each service's entry, why it matched, what was verified, and its own website to read or link. Name what it returns as your sources; never invent a ministry it did not return. ${DISCOVERY_NOTE}`,
    inputSchema: { type: 'object', properties: {
      topic: { type: 'string', description: 'A topic word, e.g. "justification". Known topics resolve to a shared concept and the publishers\' own terms; an unknown word is searched as-is.' },
      capability: { type: 'string', description: 'A capability id (gc:CFnDiscipleshipCurricula) or a plain phrase the connector maps ("study plans").' },
      language: { type: 'string', description: 'BCP-47 tag, e.g. "en". Pass it ONLY when the person asked for a language: it keeps only services that assert that language, and a service that has not asserted one is excluded.' },
      limit: { type: 'integer', minimum: 1, maximum: 25, default: 5 },
    } },
    annotations: ro('Find services'),
  },
  {
    name: 'get_service', title: 'Get a service',
    description: 'One registered service by its name (ligonier.svc) or address, as the registry holds it — its public facts, never its content.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'The service\'s registry name or 0x address.' } }, required: ['key'] },
    annotations: ro('Get a service'),
  },
  {
    name: 'list_topics', title: 'List topics',
    description: 'The topics this connector resolves to shared concepts, with the publisher terms they map to.',
    inputSchema: { type: 'object', properties: {} },
    annotations: ro('List topics'),
  },
];

export interface ShapedService {
  key: string | null; name: string; description?: string; website: string | null; card: string | null;
  capabilities: string[]; tags: string[]; agentType?: string; registryStatus?: string;
  verification: { identity?: string; identityType?: string; attestations: Array<{ type: string; uri: string }> };
  relevance: number | null;
  /** Absent when a language filter matched; false when the service was shown despite asserting none. */
  languageAsserted?: false;
  entry: Record<string, unknown>;
}

export function shapeService(entry: Record<string, unknown>): ShapedService {
  const tm = (entry.trustManifest ?? {}) as { identity?: string; identityType?: string; attestations?: Array<{ type: string; uri: string }> };
  const site = typeof entry['ap:siteUrl'] === 'string' ? entry['ap:siteUrl'] : null;
  return {
    key: typeof entry['ap:canonicalAgentId'] === 'string' ? entry['ap:canonicalAgentId'] : null,
    name: String(entry.displayName ?? entry.identifier ?? ''),
    ...(typeof entry.description === 'string' ? { description: entry.description } : {}),
    website: site,
    card: typeof entry.url === 'string' ? entry.url : null,
    capabilities: Array.isArray(entry.capabilities) ? entry.capabilities.map(String) : [],
    tags: Array.isArray(entry.tags) ? entry.tags.map(String) : [],
    ...(typeof entry['ap:agentType'] === 'string' ? { agentType: entry['ap:agentType'] } : {}),
    ...(typeof entry['ap:registryStatus'] === 'string' ? { registryStatus: entry['ap:registryStatus'] } : {}),
    verification: { ...(tm.identity ? { identity: tm.identity } : {}), ...(tm.identityType ? { identityType: tm.identityType } : {}), attestations: Array.isArray(tm.attestations) ? tm.attestations : [] },
    relevance: typeof entry.score === 'number' ? entry.score : null,
    entry,
  };
}

export interface FindServicesResult {
  services: ShapedService[];
  topicResolution: TopicResolution | null;
  query: { text: string; capability?: string; language?: string; registry: string };
  note: string;
  explanation: string;
}

export async function findServices(env: DiscoveryEnv, args: FindServicesArgs): Promise<FindServicesResult | { refused: string; note: string }> {
  const plan = planFindServices(args);
  if (plan.refused) return { refused: plan.refused, note: DISCOVERY_NOTE };
  const out = await search(env, plan.body);
  let services = out.results.map(shapeService);
  // A language filter is a HARD mandate at the registry: a service that asserts no language is excluded. When
  // that leaves nothing, the answer says so and shows the matches that assert none — the same registry, the
  // same query less that one clause, stated in the explanation (never a silent switch, ADR-0013).
  let languageNote: string | null = null;
  if (services.length === 0 && plan.language && plan.body.query.filter?.['ap:language']) {
    const { 'ap:language': _lang, ...rest } = plan.body.query.filter;
    const again = await search(env, { ...plan.body, query: { ...plan.body.query, ...(Object.keys(rest).length ? { filter: rest } : {}) } });
    const unasserted = again.results.map(shapeService);
    if (unasserted.length) {
      services = unasserted.map((sv) => ({ ...sv, languageAsserted: false as const }));
      languageNote = `no registered service asserts the language “${plan.language}”; showing ${unasserted.length} match${unasserted.length === 1 ? '' : 'es'} that assert no language at all (languageAsserted: false)`;
    }
  }
  const parts = [
    plan.topic ? plan.topic.explanation : null,
    plan.capability ? `capability filter ${plan.capability}` : null,
    plan.language ? (languageNote ?? `language ${plan.language}`) : null,
    `${services.length} result${services.length === 1 ? '' : 's'} from ${CONNECTOR.registryLabel}, ordered by relevance`,
    services.length === 0 ? 'nothing registered matched; the registry was asked, not guessed for' : null,
  ].filter(Boolean);
  return {
    services,
    topicResolution: plan.topic,
    query: { text: plan.body.query.text, ...(plan.capability ? { capability: plan.capability } : {}), ...(plan.language ? { language: plan.language } : {}), registry: (env.REGISTRY_ORIGIN ?? 'discovery').replace(/\/$/, '') + '/search' },
    note: DISCOVERY_NOTE,
    explanation: parts.join(' · '),
  };
}

export async function getService(env: DiscoveryEnv, key: string): Promise<Record<string, unknown>> {
  const k = key.trim();
  if (!k) return { refused: 'key is required — a registry name or 0x address', note: DISCOVERY_NOTE };
  const out = await getEntry(env, k);
  return { ...out, note: DISCOVERY_NOTE };
}

export function listTopics(): { topics: Array<{ topic: string; shared: string; publisherTerms: Record<string, string>; via: string }>; note: string } {
  return { topics: Object.entries(TOPICS).map(([topic, t]) => ({ topic, shared: t.shared, publisherTerms: t.publisherTerms, via: t.via })), note: 'The mapping is cited, not restated: the concepts are published in their own vocabularies.' };
}

export { resolveTopic };
