// INFERENCE.SVC — the town's model gateway Worker (spec 434 §9). Two doors over one contract: `POST /v1/generate` (the
// contract, JSON or SSE) and `POST /v1/chat/completions` + `GET /v1/models` (OpenAI-compatible; `model` names a
// PROFILE). The handler is Ring 0's (`@agenticprimitives/model-gateway`); this Worker binds its ports: the KV policy
// store (seeds as the floor), the per-principal `BudgetDO` meter, the vault ledger (as inference.svc itself), and the two
// provider adapters with the Worker's secrets. Provider keys live HERE and nowhere else (G1). The town governs model
// access; it acts for no one (G8, 429 D2).
import {
  createGatewayHandler, anthropicAdapter, openAiCompatAdapter, chatRequestToGenerate, generateToChatCompletion, refusalToChatError, streamEventToChatChunks, isRefusal,
  type GatewayHandler, type MeterPort, type ReceiptLedgerPort, type InferenceReceiptV1, type InferenceOpsSummaryV1, type CallerCredentialV1, type GenerateRequestV1, type StreamEventV1,
} from '@agenticprimitives/model-gateway';
import { createFetchAnthropicClient } from '@agenticprimitives/orchestration-anthropic';
import { createFetchOpenAiCompatClient, type OpenAiCompatLike } from '@agenticprimitives/orchestration-openai-compat';
import type { Address } from 'viem';
import { kvPolicyStore, kvPrincipalResolver, seededPolicy, type PolicyEnv } from './policy-store.js';
import { vaultReceiptLedger, vaultLedgerReadiness, type VaultLedgerEnv } from './vault-ledger.js';
export { BudgetDO } from './budget-do.js';

export interface Env extends PolicyEnv, VaultLedgerEnv {
  BUDGET: DurableObjectNamespace;
  TOWN: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  /** JSON map `endpoint-origin → key` for OpenAI-compatible hosts beyond Gemini. */
  OPENAI_COMPAT_KEYS?: string;
  /** The town's ops token (the Pulse sampler); a steward session is W6. */
  TOWN_OPS_TOKEN?: string;
}

const GEMINI_OPENAI = 'https://generativelanguage.googleapis.com/v1beta/openai';
const json = (b: unknown, status = 200, headers: Record<string, string> = {}): Response => Response.json(b, { status, headers: { 'cache-control': 'no-store', ...headers } });

function adaptersFor(env: Env) {
  const compatClients = new Map<string, OpenAiCompatLike>();
  const keys = (() => { try { return JSON.parse(env.OPENAI_COMPAT_KEYS ?? '{}') as Record<string, string>; } catch { return {}; } })();
  const clientFor = (endpoint: string | undefined): OpenAiCompatLike => {
    const base = (endpoint ?? GEMINI_OPENAI).replace(/\/+$/, '');
    let c = compatClients.get(base);
    if (!c) {
      const origin = new URL(base).origin;
      const apiKey = keys[base] ?? keys[origin] ?? (origin === new URL(GEMINI_OPENAI).origin ? env.GEMINI_API_KEY : undefined) ?? '';
      c = createFetchOpenAiCompatClient({ baseUrl: base, apiKey });
      compatClients.set(base, c);
    }
    return c;
  };
  return {
    ...(env.ANTHROPIC_API_KEY ? { anthropic: anthropicAdapter({ client: createFetchAnthropicClient({ apiKey: env.ANTHROPIC_API_KEY }) }) } : {}),
    'openai-compat': openAiCompatAdapter({ clientFor }),
  };
}

function meterFor(env: Env): MeterPort {
  const call = async (principal: Address, body: unknown): Promise<Response> => env.BUDGET.get(env.BUDGET.idFromName(principal.toLowerCase())).fetch('https://budget/', { method: 'POST', body: JSON.stringify(body) });
  return {
    async reserve(i) { const r = await call(i.principal, { op: 'reserve', profile: i.profile, estimateTokens: i.estimateTokens, estimateMicroUsd: i.estimateMicroUsd, limits: i.limits }); return (await r.json()) as never; },
    async settle(i) { await call(i.principal, { op: 'settle', reservationId: i.reservationId, usage: i.usage, costMicroUsd: i.costMicroUsd }); },
    async hold(i) { await call(i.principal, { op: 'hold', reservationId: i.reservationId }); },
  };
}

/** Receipts go to the meter's 30-day table (the rollup source) AND, when provisioned, to inference.svc's vault (the record). */
function ledgerFor(env: Env, log: (l: string) => void): { ledger: ReceiptLedgerPort; vault: ReturnType<typeof vaultLedgerReadiness> } {
  const vault = vaultReceiptLedger(env, fetch, log);
  const readiness = vaultLedgerReadiness(env);
  return {
    vault: readiness,
    ledger: {
      async write(receipt: InferenceReceiptV1) {
        await env.BUDGET.get(env.BUDGET.idFromName(receipt.principal.toLowerCase())).fetch('https://budget/', { method: 'POST', body: JSON.stringify({ op: 'receipt', receipt }) });
        if (vault) await vault.write(receipt);
      },
    },
  };
}

function handlerFor(env: Env, ctx: ExecutionContext): { handler: GatewayHandler; vault: ReturnType<typeof vaultLedgerReadiness> } {
  const log = (l: string) => console.log(`[inference] ${l}`);
  const { ledger, vault } = ledgerFor(env, log);
  return { vault, handler: createGatewayHandler({ resolver: kvPrincipalResolver(env), policy: kvPolicyStore(env), meter: meterFor(env), ledger, adapters: adaptersFor(env), waitUntil: (p) => ctx.waitUntil(p), log }) };
}

const credentialOf = (req: Request): CallerCredentialV1 | null => {
  const auth = req.headers.get('authorization') ?? '';
  if (/^Bearer\s+\S+/i.test(auth)) return { kind: 'app-key', key: auth.replace(/^Bearer\s+/i, '').trim() };
  if (/^A2A-Session\s+/i.test(auth)) return { kind: 'session-wire', assertion: auth.slice('A2A-Session '.length), headers: (() => { const h: Record<string, string> = {}; req.headers.forEach((v, k) => { h[k] = v; }); return h; })(), method: 'model.generate' };
  return null;
};

function sse(run: (emit: (e: StreamEventV1) => void) => Promise<unknown>, chunksOf?: (e: StreamEventV1) => string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (e: StreamEventV1) => { for (const line of chunksOf ? chunksOf(e) : [`data: ${JSON.stringify(e)}\n\n`]) controller.enqueue(enc.encode(line)); };
      run(emit).then(() => { if (!chunksOf) controller.enqueue(enc.encode('data: [DONE]\n\n')); controller.close(); }).catch((e) => { emit({ type: 'error', message: e instanceof Error ? e.message : String(e) }); controller.close(); });
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' } });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' } });

    if (path === '/healthz' || path === '/health') {
      const seeds = seededPolicy();
      return json({ ok: true, service: 'inference', town: env.TOWN, profiles: seeds.profiles.map((p) => p.id), catalog: seeds.catalog.filter((c) => c.enabled).map((c) => `${c.provider}/${c.model}`), providers: { anthropic: !!env.ANTHROPIC_API_KEY, gemini: !!env.GEMINI_API_KEY }, vault: vaultLedgerReadiness(env), seedErrors: seeds.errors });
    }

    if (path === '/v1/ops/summary' && req.method === 'GET') {
      const tok = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      if (!env.TOWN_OPS_TOKEN || tok !== env.TOWN_OPS_TOKEN) return json({ error: 'the ops summary is read with the town ops token (a steward session is W6)' }, 401);
      const window = url.searchParams.get('window') ?? '24h';
      const ms = window === '30d' ? 30 * 86_400_000 : window === '7d' ? 7 * 86_400_000 : 86_400_000;
      const to = new Date(), from = new Date(to.getTime() - ms);
      const estate = url.searchParams.get('estate');
      const store = kvPolicyStore(env);
      const principals = await store.principals();
      const parts: InferenceOpsSummaryV1[] = [];
      for (const p of principals) {
        const r = await env.BUDGET.get(env.BUDGET.idFromName(p.toLowerCase())).fetch('https://budget/', { method: 'POST', body: JSON.stringify({ op: 'summary', from: from.toISOString(), to: to.toISOString() }) });
        parts.push((await r.json()) as InferenceOpsSummaryV1);
      }
      return json(mergeSummaries(parts, { from: from.toISOString(), to: to.toISOString() }, estate));
    }

    const caller = credentialOf(req);
    if (path === '/v1/models' && req.method === 'GET') {
      if (!caller) return json({ error: { message: 'authorization required (Bearer <app key>)', type: 'authentication_error', code: 'unknown_caller' } }, 401);
      const { handler } = handlerFor(env, ctx);
      const who = await handler.whoIs(caller);
      if (!who) return json({ error: { message: 'no principal could be established for this credential', type: 'authentication_error', code: 'unknown_caller' } }, 401);
      const store = kvPolicyStore(env);
      const [ent, catalog] = await Promise.all([store.entitlement(who.principal), store.catalog()]);
      const all = await Promise.all((await Promise.all(['planner-fast', 'composer-default', 'answer-stream', 'judge-thorough', 'selection-structured', 'private-analysis', 'embeddings-default', 'author', 'evals'].map((id) => store.profile(id)))).filter((x): x is NonNullable<typeof x> => !!x).map(async (x) => ({ id: x.profile.id, servesCapability: x.profile.servesCapability, maxOutputTokens: x.profile.maxOutputTokens, privacy: x.profile.privacy, version: x.version })));
      const mine = all.filter((p) => ent?.profiles.includes('*') || ent?.profiles.includes(p.id));
      return json({ object: 'list', data: mine.map((p) => ({ id: p.id, object: 'model', owned_by: 'inference.svc', ap_profile: p })), profiles: mine, principal: who.principal, catalog: catalog.filter((c) => c.enabled).map((c) => ({ provider: c.provider, model: c.model, capabilities: c.capabilities, privacy: c.privacy })) });
    }

    if (path === '/v1/generate' && req.method === 'POST') {
      if (!caller) return json({ refused: true, reason: 'unknown_caller', detail: 'authorization required (Bearer <app key>)' }, 401);
      const body = (await req.json().catch(() => null)) as GenerateRequestV1 | null;
      if (!body) return json({ refused: true, reason: 'invalid_request', detail: 'a JSON body is required' }, 400);
      const { handler } = handlerFor(env, ctx);
      if (body.stream) return sse((emit) => handler.stream(body, caller, emit));
      const out = await handler.generate(body, caller);
      if (isRefusal(out)) return json(out, refusalToChatError(out).status);
      return json(out);
    }

    if (path === '/v1/chat/completions' && req.method === 'POST') {
      if (!caller) return json({ error: { message: 'authorization required (Bearer <app key>)', type: 'authentication_error', code: 'unknown_caller' } }, 401);
      const t = chatRequestToGenerate(await req.json().catch(() => null));
      if (!t.ok) return json({ error: t.error }, t.status);
      const { handler } = handlerFor(env, ctx);
      if (t.request.stream) {
        const created = Math.floor(Date.now() / 1000);
        let id = 'pending';
        return sse((emit) => handler.stream(t.request, caller, (e) => { if (e.type === 'done') id = e.response.receipt.id; emit(e); }), (e) => streamEventToChatChunks(e, { id: e.type === 'done' ? e.response.receipt.id : id, profile: t.request.profile, created }));
      }
      const out = await handler.generate(t.request, caller);
      if (isRefusal(out)) { const err = refusalToChatError(out); return json(err.body, err.status); }
      return json(generateToChatCompletion(out));
    }

    return json({ error: 'not found', doors: ['POST /v1/generate', 'POST /v1/chat/completions', 'GET /v1/models', 'GET /v1/ops/summary', 'GET /healthz'] }, 404);
  },
};

/** The Worker-wide summary: every principal's rollup, merged; `estate` narrows to the receipts attributed to one estate. */
export function mergeSummaries(parts: InferenceOpsSummaryV1[], window: { from: string; to: string }, estate: string | null): InferenceOpsSummaryV1 {
  const addSlice = (into: Map<string, InferenceOpsSummaryV1['totals']>, s: InferenceOpsSummaryV1['totals']) => {
    const cur = into.get(s.key);
    if (!cur) { into.set(s.key, { ...s }); return; }
    into.set(s.key, { ...cur, requests: cur.requests + s.requests, answered: cur.answered + s.answered, failed: cur.failed + s.failed, refused: cur.refused + s.refused, tokensIn: cur.tokensIn + s.tokensIn, tokensOut: cur.tokensOut + s.tokensOut, costMicroUsd: cur.costMicroUsd + s.costMicroUsd, fallbacks: cur.fallbacks + s.fallbacks, latencyP50Ms: Math.max(cur.latencyP50Ms, s.latencyP50Ms), latencyP95Ms: Math.max(cur.latencyP95Ms, s.latencyP95Ms) });
  };
  const kept = estate ? parts.filter((p) => p.byEstate.some((e) => e.key === estate)) : parts;
  const groups = { byClient: new Map(), byProfile: new Map(), byProvider: new Map(), byModel: new Map(), byEstate: new Map() } as Record<'byClient' | 'byProfile' | 'byProvider' | 'byModel' | 'byEstate', Map<string, InferenceOpsSummaryV1['totals']>>;
  const totals = new Map<string, InferenceOpsSummaryV1['totals']>();
  let pending = 0;
  for (const p of kept) {
    addSlice(totals, { ...p.totals, key: 'total' }); pending += p.pendingReconciliation;
    for (const k of Object.keys(groups) as Array<keyof typeof groups>) for (const s of p[k]) if (!estate || k !== 'byEstate' || s.key === estate) addSlice(groups[k], s);
  }
  const empty = { key: 'total', requests: 0, answered: 0, failed: 0, refused: 0, tokensIn: 0, tokensOut: 0, costMicroUsd: 0, fallbacks: 0, latencyP50Ms: 0, latencyP95Ms: 0 };
  const sorted = (m: Map<string, InferenceOpsSummaryV1['totals']>) => [...m.values()].sort((a, b) => b.requests - a.requests);
  return { window, totals: totals.get('total') ?? empty, byClient: sorted(groups.byClient), byProfile: sorted(groups.byProfile), byProvider: sorted(groups.byProvider), byModel: sorted(groups.byModel), byEstate: sorted(groups.byEstate), pendingReconciliation: pending };
}
