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

/** A skill as listed on an arbitrary agent's A2A card (treasury/discovery/etc. all carry `skills[]`). */
export interface A2aCardSkill { id: string; name?: string; description?: string; effect?: string }
export interface A2aCard { name?: string; type?: string; view?: string; skills?: A2aCardSkill[] }

/** Fetch ANY agent's live A2A card from its bound endpoint (spec 280 a2aEndpoint → /.well-known/agent-card.json).
 *  The host must allow cross-origin GET (the treasury + discovery hosts set CORS).
 *
 *  `view='authenticated'` REQUESTS the fine-skill card but does not obtain it: since spec 338 §8 /
 *  W4-b a host grants the extended card only to a caller that proved control of its Smart Agent
 *  (challenge + signature in `x-ap-*` headers). This browser surface carries no such proof, so it
 *  receives the PUBLIC card — check the returned `view` field rather than assuming. Showing
 *  family-level skills here is the correct outcome, not a regression.
 *
 *  Card visibility was never authorization anyway — invocation re-checks delegation + policy. */
export async function fetchA2aCard(endpoint: string, view?: 'authenticated'): Promise<A2aCard> {
  const base = endpoint.replace(/\/+$/, '');
  const res = await fetch(`${base}/.well-known/agent-card.json${view ? '?view=authenticated' : ''}`);
  if (!res.ok) throw new Error(`agent-card ${res.status}`);
  return res.json() as Promise<A2aCard>;
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

/** One crawled offering (spec 286) — a public skill an agent advertises, projected into the A-box from its
 *  public A2A card (host-asserted + provenance: where + when it was observed). */
export interface CrawledOffering {
  skillId: string;
  name: string | null;
  effect: string | null;
  exposure: string | null;
  family: string | null;
  status: string | null;
  hasInputSchema: boolean;
  requiredCapabilities: string[];
  sourceEndpoint: string | null;
  observedAt: number | null;
  cardDigest: string | null;
}
export interface OfferingsResponse { ok: boolean; key?: string; offerings?: CrawledOffering[]; error?: string }

/** Fetch one agent's CRAWLED offerings from the A-box (UI → A2A → MCP → GraphDB). This is the indexed,
 *  query-ready view (spec 286 P3) — distinct from `fetchA2aCard` which hits the LIVE card for the freshest
 *  snapshot / re-verification. */
export async function getOfferings(key: string): Promise<OfferingsResponse> {
  const res = await fetch(`${A2A_URL}/offerings?key=${encodeURIComponent(key)}`);
  return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as OfferingsResponse;
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
