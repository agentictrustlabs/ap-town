// UI client for the discovery A2A agent. The browser NEVER talks to GraphDB (or even the MCP) directly —
// it goes through the discovery agent: UI → demo-discovery-a2a → demo-discovery-mcp → GraphDB knowledge
// base. The A2A agent ranks by relevance + verifiable trust and (increasingly) by stated intent + mandate.

const A2A_URL = (import.meta.env?.VITE_DISCOVERY_A2A_URL as string | undefined) ?? 'https://demo-discovery-a2a.richardpedersen3.workers.dev';

export interface DiscoverResult {
  agent: string;
  name: string | null;
  smartAgent: string;
  facets: string[];
  shaclConforms: boolean;
  registered?: boolean;
  skills?: string | null; // publicly-asserted skill labels (spec 282)
  score: number;
  why: string[];
  satisfiedMandates?: string[];
}

export interface DiscoverResponse {
  ok: boolean;
  query: string;
  intent: unknown;
  source?: string;
  note?: string;
  matched?: number;
  droppedByMandates?: number;
  results: DiscoverResult[];
  error?: string;
}

export interface DiscoverMandates { requireRegistered?: boolean; requireSkill?: string }

export const DISCOVERY_AGENT_URL = A2A_URL;

/** Fetch the agent's card (the A2A self-description). */
export async function fetchAgentCard(): Promise<Record<string, unknown>> {
  const res = await fetch(`${A2A_URL}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`agent-card ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

export interface AgentDetail {
  ok: boolean;
  agent?: string;
  triples?: { p: string; o: string }[];
  error?: string;
}

/** Fetch one agent's full A-box node (every on-chain facet) via the A2A → MCP → GraphDB. */
export async function getAgentDetail(key: string): Promise<AgentDetail> {
  const res = await fetch(`${A2A_URL}/agent?key=${encodeURIComponent(key)}`);
  return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as AgentDetail;
}

/** Invoke the discover-agents skill: an intent DESCRIPTION (+ optional precise query + mandates) → ranked
 *  agents. `intent` ranks (fitScore); `query` is a precise substring filter; mandates hard-filter. */
export async function discover(input: { query?: string; intent?: string; mandates?: DiscoverMandates }): Promise<DiscoverResponse> {
  const payload: Record<string, unknown> = {};
  if (input.query) payload.query = input.query;
  if (input.intent) payload.intent = { need: input.intent };
  if (input.mandates && (input.mandates.requireRegistered || input.mandates.requireSkill)) payload.mandates = input.mandates;
  const res = await fetch(`${A2A_URL}/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as DiscoverResponse;
  if (!res.ok && body.ok !== false) return { ok: false, query: input.query ?? '', intent: input.intent ?? null, results: [], error: `HTTP ${res.status}` };
  return body;
}
