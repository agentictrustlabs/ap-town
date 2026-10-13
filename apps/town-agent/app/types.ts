// What the portal reads from its own Worker (`/api/town`): the manifest's summary, each service with its signals,
// and the naming service's summary of the town's names (or null when it could not be asked).
import type { ServiceView } from '../worker/signals';
export type { ServiceView };

export interface EstateSummary {
  id: string; home: string; edge: string; a2a: string; nameRoots: string[]; repo: string;
  /** The estate's own name on the chain (`<label>.estate`) — the agent that IS this estate. Stable; the URL moves. */
  estateName?: string;
  /** The DNS zone this estate serves its agents' cards under; absent = its agents are reached through its edge by name. */
  agentZone?: string;
}
/** Who answers for a context and at which door (spec 436 §5.5) — `null` when the Ask is not chartered for it. */
export interface ContextAgentView { context: 'town' | 'estate'; estate?: string; name: string; card: string | null; cardHost: string | null }
export interface NameRow { name: string; label: string; owner: string; kind: string }
export interface NamesSummary { total: number; block: number; roots: Array<{ tld: string; names: string | null; kind: string; legacy: boolean; count: number; sample: NameRow[] }> }
export interface TownData {
  town: string; status: string;
  chain: { id: number; generation: string; rpc: string };
  estates: EstateSummary[];
  services: ServiceView[];
  names: NamesSummary | null;
  /** The context agents the Ask sends questions to: the town's, and one per estate that has one. */
  agents?: { town: ContextAgentView | null; estates: Record<string, ContextAgentView> };
  /** A demo persona this deployment offers as a one-click sign-in (`DEMO_CONNECT`); absent ⇒ no demo door. */
  demoConnect?: string;
  /** Spec 437 I4 — what the town runs on that nothing meters, as the manifest declares it. Never amounts. */
  vendors?: Array<{ id: string; what: string; billing: 'plan' | 'usage' | 'per-unit' | 'free'; where?: string; note?: string; metered?: string }>;
  card: string;
  /** Spec 437 I4 — the accounts' ids and labels (never a token), for the Infra tab's names. */
  accounts?: { cloudflare?: Array<{ id: string; label: string }>; vercel?: { teamId: string; label?: string }; azure?: { subscriptionId: string; resourceGroups: string[]; label?: string }; graphdb?: { url: string; label?: string } } | null;
}
export interface FindHit {
  name: string | null; smartAgent: string; score: number; why: string[]; registered?: boolean; shaclConforms?: boolean;
  agentType?: string | null; tld?: string | null; kind?: string; facets?: string[]; capabilityIds?: string[];
  offerings?: Array<{ skillId?: string; name?: string | null }>; validAttestations?: number; activeRelationships?: number;
}
export interface FindResult {
  ok: boolean; query: string; type: string; registered: boolean; matched?: number;
  droppedBy?: Record<string, number>;
  /** What the registry READ, so "nothing matched" is distinguishable from "the page did not reach it": the broad
   *  page's size, whether the knowledge base held more, and how many rows the question's own words added. */
  page?: { limit: number; returned: number; truncated: boolean; named: number };
  results: FindHit[]; error?: string;
}
export interface Facets { ok: boolean; agentTypes: Array<{ value: string; count: number }>; kinds: Array<{ value: string; count: number }>; capabilityIds: Array<{ value: string; count: number }>; undeclaredType?: number }
export interface AgentDetail {
  key: string;
  /** Which estate this agent is placed in (spec 435 §4) — an INFERENCE from its own endpoint, carrying the rule. */
  placement?: { estate: string | null; how: 'agent-zone' | 'estate-a2a' | 'unplaced' };
  /** Spec 438 §13 — its record AS IT REPORTS IT at its own door: counts, and the judgments others signed. */
  record?: AgentPublicRecord | { unavailable: string };
  agent: { ok: boolean; agent?: string; triples?: Array<{ p: string; o: string }>; error?: string };
  offerings: { ok?: boolean; offerings?: Array<{ skillId: string; name: string | null; effect?: string | null; exposure?: string | null; family?: string | null; status?: string | null; source?: string | null }>; error?: string } | null;
}

/** One MCP server as `/api/mcp` and `/api/estate/:id` report it (spec 435 §5). `up` is `null` where no probe
 *  is declared, which is not the same as down — a binding-only server has no door to knock on. */
export interface McpServerRow {
  id: string;
  description: string;
  exposure: 'binding' | 'authenticated' | 'open';
  scale: 'town' | 'estate';
  estate?: string;
  serviceId?: string;
  url?: string;
  worker?: string;
  agentName?: string;
  probe?: string;
  up?: boolean | null;
  status?: number;
}

/** One agent as the roster reports it, with the estate this town INFERRED for it and how. Never attested:
 *  spec 435 §4's top rung is an attestation that does not exist yet, and an inference never promotes. */
export interface PlacedAgentRow {
  name: string | null;
  smartAgent: string;
  displayName?: string | null;
  agentType?: string | null;
  kind?: string | null;
  tld?: string | null;
  a2aEndpoint?: string | null;
  mcpEndpoint?: string | null;
  estate: string | null;
  how: 'agent-zone' | 'estate-a2a' | 'unplaced';
}

/** `/api/estate/:id` — the manifest's own account of one estate, its MCP servers, and the agents placed in it. */
export interface EstateDetail {
  estate: EstateSummary & {
    namingGate?: string;
    kms?: { tenant: string | null; backend?: string };
    workers?: string[];
    pagesProjects?: string[];
    vercelProjects?: string[];
    azureResources?: string[];
    lanes?: Record<string, string>;
  };
  mcpServers: McpServerRow[];
  agents:
    | { estate: string; agents: PlacedAgentRow[]; byKind: Record<'person' | 'org' | 'service' | 'undeclared', number>; withMcp: number; truncated: boolean; read: number }
    | { unavailable: string };
  agent: ContextAgentView | null;
  chain: { id: number; generation: string; rpc: string };
  town: string;
}

/** `/api/mcp` — every server the manifest declares, plus the agents that serve a door of their own. */
export interface McpCensus {
  town: string;
  servers: McpServerRow[];
  agentDoors: { rows: PlacedAgentRow[]; read: number; truncated: boolean } | { unavailable: string };
}

/** `/api/endpoint?url=` — what the manifest says serves an endpoint, and the town MCP's latest reading of it
 *  (spec 437 I4). `reading.metrics` is `null` on the public read and says so; it is never zeroed. */
export interface EndpointInfo {
  attribution: {
    url: string;
    host: string;
    how: 'mcp-server' | 'service-host' | 'estate-lane' | 'estate-zone' | 'estate-door' | 'unattributed';
    worker?: string;
    serviceId?: string;
    estate?: string;
    mcpServerId?: string;
    repo?: string;
    app?: string;
    vercelProject?: string;
    note: string;
  };
  /** The GitHub link, deep into the app directory when the manifest names one. */
  source: string | null;
  detail: boolean;
  reading: {
    resource: string; platform: string; account: string; kind: string;
    status: string; asOf: string; lagClass: string | null; ok: boolean; error?: string;
    metrics: Record<string, number | null> | null;
    series?: Array<{ at: string; metrics: Record<string, number | null> }>;
    withheld?: string;
  } | null;
  unavailable?: string;
}

/** What `record.public.ask` answers (spec 438 §13). Counts and signed judgments; nothing of any run. */
export interface AgentPublicRecord {
  agent: string;
  record: {
    total: number;
    endings: Record<string, number>;
    lastEndedAt?: string;
    evidence: { complete: number; incomplete: number; unknown: number; unreported: number; effectUncertain: number };
    assessment: { runsAssessed: number; runsUnassessed: number; current: number; stale: number; superseded: number; evaluators: string[]; criteria: string[]; outcomes: Record<string, number> };
    work: { runsWithWork: number; endeavors: string[]; continuations: number };
  };
  judgments: Array<{
    digest: string; signature: string; evaluator: string; evaluatorKind: string;
    criteria: { outcomeId: string; revision: number; digest: string; statedAt: string };
    subject: { runRef: string; recordDigest: string; at: string };
    results: Array<{ criterionId: string; outcome: string }>;
    at: string;
  }>;
  read: number;
  assessmentsRead: boolean;
  answer?: string;
  askedAt?: string;
}
