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
  /** spec 346 — the DERIVED agent type declared on chain (person | org | team | service | workspace |
   *  treasury | registry), the name's suffix, and the service role. Null when the agent has not declared a type. */
  agentType?: string | null;
  tld?: string | null;
  serviceRole?: string | null;
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
  /** Per-mandate elimination counts (which filter emptied the list). */
  droppedBy?: Partial<Record<keyof DiscoverMandates | string, number>>;
  results: DiscoverResult[];
  error?: string;
}

export interface DiscoverMandates {
  requireRegistered?: boolean;
  /** Legacy fuzzy substring over labels/description — advanced only; the skill picker emits `requireCapabilityId`. */
  requireSkill?: string;
  /** Exact declared capability id (hard, fail-open on agents that declared nothing — spec 331 §4.3). */
  requireCapabilityId?: string;
  /** Root kind: person | org | service (hard). */
  requireKind?: string;
  /** Derived agent type slug (hard; undeclared agents count as the generic type of their root). */
  requireAgentType?: string;
}

export interface FacetCount { value: string; count: number }
export interface Facets {
  ok: boolean;
  agentTypes: FacetCount[];
  kinds: FacetCount[];
  capabilityIds: FacetCount[];
  tlds: FacetCount[];
  undeclaredType: number;
  error?: string;
}

/** Distinct declared facets + agent counts (one grouped query each, server-side). */
export async function getFacets(): Promise<Facets> {
  const res = await fetch(`${A2A_URL}/facets`);
  return res.json() as Promise<Facets>;
}

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
export async function discover(input: { query?: string; intent?: string | { need?: string; skills?: string[] }; mandates?: DiscoverMandates }): Promise<DiscoverResponse> {
  const payload: Record<string, unknown> = {};
  if (input.query) payload.query = input.query;
  // A string intent is the need; an object is passed through (need + soft skills). Never re-wrap an object —
  // `{ need: { need } }` made the a2a choke on a non-string need (the 2026-08-30 HTTP 500).
  if (typeof input.intent === 'string') payload.intent = { need: input.intent };
  else if (input.intent && Object.keys(input.intent).length) payload.intent = input.intent;
  // Forward mandates whenever ANY key is set (type / capability / kind / registered / skill).
  const m = input.mandates;
  if (m && Object.values(m).some((v) => v !== undefined && v !== false && v !== '')) payload.mandates = m;
  const res = await fetch(`${A2A_URL}/discover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Surface the server's own error body (the a2a returns {ok:false,error}) instead of a bare status.
    let detail = '';
    try { const j = (await res.json()) as { error?: string }; detail = j.error ? `: ${j.error}` : ''; } catch { /* non-JSON body */ }
    throw new Error(`discover HTTP ${res.status}${detail}`);
  }
  return res.json() as Promise<DiscoverResponse>;
}
