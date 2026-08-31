// Agentic Resource Discovery (ARD v0.91) surface for the discovery registry — spec 347 §8.5, crosswalk
// docs/architecture/ard-acp-crosswalk.md. PURE builders only: the Hono routes in index.ts feed them KB rows and
// ranked matches. Doctrine that made this cheap: ARD's `score` is relevance ONLY and MUST NOT be read as trust —
// exactly spec 346 §8.3. So `score` here is the fit term × 100 and trust evidence rides under the `ap:`
// extension namespace, never blended. MCP surfaces are never entries (ADR-0057). Conformance code is app-level
// (ADR-0037); a third consumer moves these ~100 lines to the sibling `agent-projections` repo.

export const ARD_VERSION = '0.91';
export const ARD_CONTEXT_URL = 'https://agenticresourcediscovery.org/context/v1';
export const ARD_A2A_CARD_TYPE = 'application/a2a-agent-card+json';
export const ARD_REGISTRY_TYPE = 'application/ai-registry+json';
export const ARD_WELL_KNOWN_PATH = '/.well-known/ard.json';
export const AP_NS = 'https://agenticprimitives.dev/ns/core#';
/** The trust framework ARD entries declare (ARD §4.5.2 defers verification to the declared framework). */
export const AP_TRUST_SCHEMA = {
  identifier: 'agenticprimitives-smart-agent-card-binding',
  version: '1',
  governanceUri: 'https://github.com/agentictrustlabs/agenticprimitives/blob/master/specs/347-a2a-agent-card-and-projection-studio.md',
  verificationMethods: ['a2a-jws-es256', 'SmartAgentCardBindingV1', 'ap-registry-receipt'],
} as const;

export interface ArdTrustManifest {
  identity: string;
  identityType?: string;
  trustSchema?: typeof AP_TRUST_SCHEMA;
  attestations?: Array<{ type: string; uri: string }>;
  signature?: string;
}
export interface ArdEntry {
  '@context'?: unknown;
  identifier: string;
  displayName: string;
  type: string;
  url?: string;
  data?: unknown;
  description?: string;
  version?: string;
  updatedAt?: string;
  representativeQueries?: string[];
  capabilities?: string[];
  tags?: string[];
  metadata?: Record<string, string | number | boolean | null>;
  trustManifest?: ArdTrustManifest;
  [ext: `ap:${string}`]: unknown;
}
export interface ArdManifest { '@context': unknown; entries: ArdEntry[] }

/** The subset of a KB agent row the projector reads. Structural on purpose (no import of the MCP's types). */
export interface ArdAgentRowLike {
  name?: string | null;
  smartAgent: string;
  displayName?: string | null;
  description?: string | null;
  capabilityIds?: string[];
  agentType?: string | null;
  tld?: string | null;
  serviceRole?: string | null;
  focusAreas?: string | null;
  registryStatus?: string | null;
  /** `approf:a2aEndpoint` — the agent's A2A host. No host ⇒ not an ARD resource (nothing to `url`). */
  a2aEndpoint?: string | null;
  /** Curated public skill examples when the KB has them (crawled card `skills[].examples`). */
  examples?: string[] | null;
}

export const AP_CONTEXT = { ap: AP_NS, apdisc: 'https://agenticprimitives.dev/ns/discovery#' } as const;

/** URN grammar (ARD Appendix C): `urn:air:<publisher FQDN>:<namespace>:<agent-name>`. */
export const ARD_URN_PATTERN = /^urn:air:[a-zA-Z0-9.-]+(:[a-zA-Z0-9._-]+)+$/;

function hostOf(url: string): string | null {
  try { const u = new URL(url); return u.protocol === 'https:' ? u.host : null; } catch { return null; }
}
function labelOf(name: string | null | undefined, sa: string): string {
  const first = (name ?? '').split('@')[0]?.split('.')[0] ?? '';
  const label = first.toLowerCase().replace(/[^a-z0-9._-]/g, '');
  return label || sa.toLowerCase();
}

/** One ARD entry for one agent, or a reason it has none. Never throws on data; a missing host is an honest miss. */
export function ardEntryForAgent(row: ArdAgentRowLike, opts: { receiptUriFor?: (sa: string) => string | null; now?: string } = {}): { entry: ArdEntry } | { entry: null; reason: 'no-a2a-host' | 'bad-host' } {
  if (!row.a2aEndpoint) return { entry: null, reason: 'no-a2a-host' };
  const host = hostOf(row.a2aEndpoint);
  if (!host) return { entry: null, reason: 'bad-host' };
  const label = labelOf(row.name, row.smartAgent);
  const identifier = `urn:air:${host}:agent:${label}`;
  const tags = [row.agentType, row.serviceRole, row.tld ? `.${row.tld}` : null, ...(row.focusAreas ?? '').split(',').map((s) => s.trim()).filter(Boolean)].filter((t): t is string => !!t);
  const receipt = opts.receiptUriFor?.(row.smartAgent) ?? null;
  const entry: ArdEntry = {
    identifier,
    displayName: row.displayName || row.name || label,
    type: ARD_A2A_CARD_TYPE,
    url: `https://${host}/.well-known/agent-card.json`,
    ...(row.description ? { description: row.description } : {}),
    ...(row.examples && row.examples.length >= 2 ? { representativeQueries: row.examples.slice(0, 5) } : {}),
    ...(row.capabilityIds?.length ? { capabilities: [...row.capabilityIds] } : {}),
    ...(tags.length ? { tags: Array.from(new Set(tags)) } : {}),
    trustManifest: {
      identity: `https://${host}`,
      identityType: 'https-fqdn',
      trustSchema: AP_TRUST_SCHEMA,
      ...(receipt ? { attestations: [{ type: 'ap-registry-receipt', uri: receipt }] } : {}),
    },
    'ap:canonicalAgentId': row.smartAgent,
    ...(row.agentType ? { 'ap:agentType': row.agentType } : {}),
    ...(row.registryStatus ? { 'ap:registryStatus': row.registryStatus } : {}),
  };
  return { entry };
}

/** The registry's own entry (`application/ai-registry+json`) — what other registries list as a referral. */
export function ardRegistryEntry(origin: string, opts: { name: string; displayName: string; description: string; representativeQueries?: string[] }): ArdEntry {
  const host = hostOf(origin) ?? origin.replace(/^https?:\/\//, '');
  return {
    identifier: `urn:air:${host}:registry:${opts.name.toLowerCase().replace(/[^a-z0-9._-]/g, '')}`,
    displayName: opts.displayName,
    type: ARD_REGISTRY_TYPE,
    url: `${origin.replace(/\/$/, '')}/search`,
    description: opts.description,
    representativeQueries: opts.representativeQueries ?? ['find an agent that can help with a task', 'which registered agents offer a given capability', 'list organizations and teams in this registry'],
    capabilities: ['search', 'explore', 'agents'],
    trustManifest: { identity: `https://${host}`, identityType: 'https-fqdn', trustSchema: AP_TRUST_SCHEMA },
  };
}

export function ardManifest(entries: ArdEntry[]): ArdManifest {
  return { '@context': [ARD_CONTEXT_URL, AP_CONTEXT], entries };
}

// ─── Search ─────────────────────────────────────────────────────────────────────────────────────────────────

export type ArdFederation = 'auto' | 'referrals' | 'none';
export interface ArdSearchRequest {
  query?: { '@context'?: unknown; text?: string; filter?: Record<string, string[] | string> };
  federation?: ArdFederation;
  pageSize?: number;
  pageToken?: string;
}
export interface ArdSearchPlan {
  need: string;
  /** Mandates in the discovery a2a's own vocabulary. */
  mandates: { requireCapabilityId?: string; requireAgentType?: string; requireKind?: string; requireRegistered?: boolean };
  /** False when `filter.type` names only types this registry cannot serve ⇒ empty result, not an error. */
  typeServable: boolean;
  federation: ArdFederation;
  pageSize: number;
  offset: number;
}
export type ArdError = { status: 400 | 404; code: 'INVALID_ARGUMENT' | 'NOT_FOUND'; message: string };

const DERIVED_TYPES = new Set(['person', 'org', 'team', 'service', 'workspace', 'treasury', 'registry', 'church', 'circle']);
const ROOT_KINDS = new Set(['person', 'org', 'service']);

function arr(v: string[] | string | undefined): string[] { return v === undefined ? [] : Array.isArray(v) ? v : [v]; }

export function decodePageToken(t: string | undefined): number | null {
  if (!t) return 0;
  try { const o = JSON.parse(atob(t)) as { offset?: unknown }; return typeof o.offset === 'number' && o.offset >= 0 ? o.offset : null; } catch { return null; }
}
export function encodePageToken(offset: number): string { return btoa(JSON.stringify({ offset })); }

/** ARD query → discovery plan. Within a key = OR, across keys = AND (ARD §5.3.1); we serve one value per
 *  structured key in W1 and say so with INVALID_ARGUMENT rather than silently taking the first. */
export function planArdSearch(body: ArdSearchRequest): ArdSearchPlan | ArdError {
  const q = body.query ?? {};
  const filter = q.filter ?? {};
  const pageSize = body.pageSize === undefined ? 10 : body.pageSize;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return { status: 400, code: 'INVALID_ARGUMENT', message: 'pageSize must be an integer in 1..100' };
  const federation = body.federation ?? 'auto';
  if (!['auto', 'referrals', 'none'].includes(federation)) return { status: 400, code: 'INVALID_ARGUMENT', message: 'federation must be auto|referrals|none' };
  const offset = decodePageToken(body.pageToken);
  if (offset === null) return { status: 400, code: 'INVALID_ARGUMENT', message: 'pageToken is not one this registry issued' };
  const types = arr(filter.type);
  const typeServable = types.length === 0 || types.includes(ARD_A2A_CARD_TYPE);
  const mandates: ArdSearchPlan['mandates'] = {};
  const caps = arr(filter.capabilities);
  if (caps.length > 1) return { status: 400, code: 'INVALID_ARGUMENT', message: 'filter.capabilities: one value per query in this registry' };
  if (caps[0]) mandates.requireCapabilityId = caps[0];
  const apType = arr(filter['ap:agentType']);
  if (apType.length > 1) return { status: 400, code: 'INVALID_ARGUMENT', message: 'filter.ap:agentType: one value per query' };
  if (apType[0]) { if (!DERIVED_TYPES.has(apType[0])) return { status: 400, code: 'INVALID_ARGUMENT', message: `unknown ap:agentType ${apType[0]}` }; mandates.requireAgentType = apType[0]; }
  // `tags` are free filter tokens; a tag naming a derived type or root kind becomes the matching HARD mandate,
  // any other tag is unsupported here (ARD lets registries pick which terms they filter — §5.3 SHOULD).
  for (const t of arr(filter.tags)) {
    if (DERIVED_TYPES.has(t) && !mandates.requireAgentType) mandates.requireAgentType = t;
    else if (ROOT_KINDS.has(t) && !mandates.requireKind) mandates.requireKind = t;
    else return { status: 400, code: 'INVALID_ARGUMENT', message: `filter.tags: unsupported tag "${t}" (supported: derived agent types)` };
  }
  const known = new Set(['type', 'capabilities', 'tags', 'ap:agentType', 'ap:registered']);
  for (const k of Object.keys(filter)) if (!known.has(k)) return { status: 400, code: 'INVALID_ARGUMENT', message: `filter.${k} is not a term this registry filters` };
  if (arr(filter['ap:registered'])[0] === 'true') mandates.requireRegistered = true;
  return { need: (q.text ?? '').toString().trim(), mandates, typeServable, federation, pageSize, offset };
}

/** A ranked discovery match, structurally (the discovery a2a's `matchCandidate` output). */
export interface RankedLike extends ArdAgentRowLike {
  /** The FIT term alone (0..1). The blended spec-281 `score` is NOT used here — trust is not relevance. */
  fitScore: number;
  trustScore?: number;
  why?: string[];
  shaclConforms?: boolean;
}

export interface ArdSearchResult extends ArdEntry { score: number; source: string }
export interface ArdSearchResponse { '@context': unknown; results: ArdSearchResult[]; referrals?: ArdEntry[]; pageToken?: string }

export function ardSearchResponse(ranked: RankedLike[], plan: ArdSearchPlan, opts: { source: string; referrals?: ArdEntry[]; receiptUriFor?: (sa: string) => string | null }): ArdSearchResponse {
  const entries: ArdSearchResult[] = [];
  for (const r of ranked) {
    const e = ardEntryForAgent(r, { receiptUriFor: opts.receiptUriFor });
    if (!e.entry) continue;
    entries.push({
      ...e.entry,
      score: Math.max(0, Math.min(100, Math.round(r.fitScore * 100))),
      source: opts.source,
      // Trust evidence stays a SEPARATE, namespaced signal (spec 346 §8.3; ARD §5.3.2 "MUST NOT be interpreted as trust").
      'ap:trustEvidence': { ...(r.trustScore !== undefined ? { confidence: r.trustScore } : {}), ...(r.why ? { cites: r.why } : {}), ...(r.shaclConforms !== undefined ? { shaclConforms: r.shaclConforms } : {}), note: 'public evidence — informs nothing about authority to act' },
    });
  }
  const page = entries.slice(plan.offset, plan.offset + plan.pageSize);
  const next = plan.offset + plan.pageSize < entries.length ? encodePageToken(plan.offset + plan.pageSize) : undefined;
  return {
    '@context': [ARD_CONTEXT_URL, AP_CONTEXT],
    results: page,
    ...(plan.federation !== 'none' && opts.referrals?.length ? { referrals: opts.referrals } : {}),
    ...(next ? { pageToken: next } : {}),
  };
}

// ─── Explore ────────────────────────────────────────────────────────────────────────────────────────────────

export interface ArdExploreRequest { query?: ArdSearchRequest['query']; resultType?: { facets?: Array<{ field: string; limit?: number; minCount?: number }> } }
/** What the MCP `/facets` aggregate looks like, structurally. */
export interface FacetsLike { agentTypes?: Array<{ value: string; count: number }>; kinds?: Array<{ value: string; count: number }>; capabilityIds?: Array<{ value: string; count: number }>; tlds?: Array<{ value: string; count: number }>; total?: number }

const FACET_FIELDS: Record<string, keyof Omit<FacetsLike, 'total'> | 'type'> = { type: 'type', capabilities: 'capabilityIds', 'ap:agentType': 'agentTypes', tags: 'agentTypes', 'ap:tld': 'tlds', 'ap:kind': 'kinds' };

export function ardExploreResponse(req: ArdExploreRequest, facets: FacetsLike): { resultType: 'facets'; facets: Record<string, { buckets: Array<{ value: string; count: number }>; otherCount?: number }> } | ArdError {
  const out: Record<string, { buckets: Array<{ value: string; count: number }>; otherCount?: number }> = {};
  for (const f of req.resultType?.facets ?? [{ field: 'type' }]) {
    const key = FACET_FIELDS[f.field];
    if (!key) return { status: 400, code: 'INVALID_ARGUMENT', message: `facet field "${f.field}" is not exposed by this registry` };
    const limit = f.limit && f.limit > 0 ? f.limit : 50;
    const min = f.minCount ?? 1;
    const total = facets.total ?? (facets.kinds ?? []).reduce((n, b) => n + b.count, 0);
    let buckets = key === 'type' ? [{ value: ARD_A2A_CARD_TYPE, count: total }] : [...(facets[key] ?? [])].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
    buckets = buckets.filter((b) => b.count >= min);
    const shown = buckets.slice(0, limit);
    const otherCount = buckets.slice(limit).reduce((n, b) => n + b.count, 0);
    out[f.field] = { buckets: shown, ...(otherCount ? { otherCount } : {}) };
  }
  return { resultType: 'facets', facets: out };
}

// ─── List (GET /agents) ─────────────────────────────────────────────────────────────────────────────────────

/** GET /agents — a paginated `{ items[], pageToken? }` object (what the ARD conformance tool v0.9.1 probes for).
 * Minimal EBNF filter: `type = "<media type>"` and/or `tags:"<tag>"`, joined by AND. Anything else ⇒ 400. */
export function parseAgentsFilter(filter: string | undefined): { type?: string; tag?: string } | ArdError {
  if (!filter?.trim()) return {};
  const out: { type?: string; tag?: string } = {};
  for (const clause of filter.split(/\s+AND\s+/i)) {
    let m = /^type\s*=\s*"([^"]+)"$/i.exec(clause.trim());
    if (m) { out.type = m[1]!; continue; }
    m = /^tags\s*:\s*"([^"]+)"$/i.exec(clause.trim());
    if (m) { out.tag = m[1]!; continue; }
    return { status: 400, code: 'INVALID_ARGUMENT', message: `filter clause not supported: ${clause.trim()}` };
  }
  return out;
}
export function ardAgentsResponse(rows: ArdAgentRowLike[], opts: { type?: string; tag?: string; pageSize?: number; pageToken?: string }): { '@context': unknown; items: ArdEntry[]; pageToken?: string } | ArdError {
  const pageSize = opts.pageSize ?? 20;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) return { status: 400, code: 'INVALID_ARGUMENT', message: 'pageSize must be an integer in 1..100' };
  const offset = decodePageToken(opts.pageToken);
  if (offset === null) return { status: 400, code: 'INVALID_ARGUMENT', message: 'pageToken is not one this registry issued' };
  if (opts.type && opts.type !== ARD_A2A_CARD_TYPE) return { '@context': [ARD_CONTEXT_URL, AP_CONTEXT], items: [] };
  const entries = rows.map((r) => ardEntryForAgent(r).entry).filter((e): e is ArdEntry => !!e)
    .filter((e) => !opts.tag || (e.tags ?? []).includes(opts.tag))
    .sort((a, b) => a.identifier.localeCompare(b.identifier));
  const page = entries.slice(offset, offset + pageSize);
  const next = offset + pageSize < entries.length ? encodePageToken(offset + pageSize) : undefined;
  return { '@context': [ARD_CONTEXT_URL, AP_CONTEXT], items: page, ...(next ? { pageToken: next } : {}) };
}

export function ardError(e: ArdError) { return { error: { code: e.code, message: e.message } }; }
