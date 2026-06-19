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
  score: number;
  why: string[];
}

export interface DiscoverResponse {
  ok: boolean;
  query: string;
  intent: string | null;
  source?: string;
  note?: string;
  results: DiscoverResult[];
  error?: string;
}

export const DISCOVERY_AGENT_URL = A2A_URL;

/** Fetch the agent's card (the A2A self-description). */
export async function fetchAgentCard(): Promise<Record<string, unknown>> {
  const res = await fetch(`${A2A_URL}/.well-known/agent-card.json`);
  if (!res.ok) throw new Error(`agent-card ${res.status}`);
  return res.json() as Promise<Record<string, unknown>>;
}

/** Invoke the discover-agents skill: query (+ optional intent / mandates) → best agents. */
export async function discover(input: { query: string; intent?: string; mandates?: string }): Promise<DiscoverResponse> {
  const res = await fetch(`${A2A_URL}/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as DiscoverResponse;
  if (!res.ok && body.ok !== false) return { ok: false, query: input.query, intent: input.intent ?? null, results: [], error: `HTTP ${res.status}` };
  return body;
}
