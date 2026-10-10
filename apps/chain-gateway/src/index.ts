// Chain RPC gateway: token auth → method allow-list → gas-cap inject → per-app rate limit → read cache →
// forward to the private origin. Generic over the chain; every hostname lives in wrangler.toml [env.*].
// Spec 436 §6 — every request is also ONE SAMPLE into the ops rollup (`ChainOpsDO`): who (the token's app, its estate
// and kind), what (the method), how it went, how long the upstream took — served at `GET /ops/summary` for the Pulse.
import { isAllowed, isWrite, CACHE_TTL_S, injectEstimateGasCap, type Rpc } from './config';
import type { Sample } from './ops';
export { RateLimiter } from './ratelimit';
export { ChainOpsDO } from './ops-do';
export type { ChainGatewayOpsSummaryV1 } from './ops';
// ORIGIN_CLIENT_ID / ORIGIN_CLIENT_SECRET are secrets (`wrangler secret put`), never vars. They are what
// this gateway presents TO its origin. TOKENS answers "may this caller use the chain"; this pair answers
// "is this request really from the gateway". Without it, publishing the origin on a hostname makes the
// token check decorative — anyone who learns the hostname skips the allow-list, the gas cap and the rate
// limiter and talks to the node directly. On a free-gas chain that is an invitation to bloat the state,
// not just a read leak. Unset is allowed: a VNet-private origin needs no second factor, and an estate
// whose origin is fronted by Cloudflare Access sets the pair and nothing else changes.
interface Env { TOKENS: KVNamespace; RATE: DurableObjectNamespace; OPS?: DurableObjectNamespace; ORIGIN: string; ESTIMATE_GAS_CAP?: string; ORIGIN_CLIENT_ID?: string; ORIGIN_CLIENT_SECRET?: string; TOWN_OPS_TOKEN?: string; CHAIN_GENERATION?: string; }
/** A token row. `estate` and `kind` (spec 436 §6.1) attribute the caller to its context; rows written before 2026-10-10 lack them and read as an unattributed application. */
interface TokenRecord { app: string; readRps: number; writeRps: number; estate?: string; kind?: 'estate-app' | 'town-service' | 'application' }
const err = (id: unknown, code: number, message: string, status = 200) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }), { status, headers: { 'content-type': 'application/json' } });
const sha256 = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
// Cloudflare Access service-token header names — also ordinary headers, so an origin fronted some other
// way (nginx, say) can check the same pair without Access being involved.
export const originHeaders = (env: Pick<Env, 'ORIGIN_CLIENT_ID' | 'ORIGIN_CLIENT_SECRET'>): Record<string, string> => {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (env.ORIGIN_CLIENT_ID && env.ORIGIN_CLIENT_SECRET) { h['CF-Access-Client-Id'] = env.ORIGIN_CLIENT_ID; h['CF-Access-Client-Secret'] = env.ORIGIN_CLIENT_SECRET; }
  return h;
};
const forward = (env: Env, body: unknown) => fetch(env.ORIGIN, { method: 'POST', headers: originHeaders(env), body: JSON.stringify(body) })
  .then(u => new Response(u.body, { status: u.status, headers: { 'content-type': 'application/json' } }));

/** The one place samples leave the request path: fire-and-forget into the rollup object; a missing binding records nothing (said on /ops/summary). */
const record = (env: Env, ctx: ExecutionContext, samples: Sample[]): void => {
  if (!env.OPS || samples.length === 0) return;
  ctx.waitUntil(env.OPS.get(env.OPS.idFromName('ops')).fetch('https://ops/record', { method: 'POST', body: JSON.stringify(samples) }).catch(() => undefined));
};
const sampleOf = (rec: TokenRecord | null, calls: Rpc[] | null, patch: Partial<Sample>): Sample => {
  const methods = calls?.map((c) => c?.method).filter((m): m is string => typeof m === 'string') ?? [];
  const reads = methods.filter((m) => !isWrite(m)).length, writes = methods.length - reads;
  return {
    minute: Math.floor(Date.now() / 60_000), app: rec?.app ?? '(unknown token)', estate: rec?.estate ?? null, kind: rec?.kind ?? 'application',
    method: methods.length === 1 ? methods[0]! : methods.length ? 'batch' : '(none)', kind2: writes && reads ? 'mixed' : writes ? 'write' : 'read', outcome: 'forwarded', ...patch,
  };
};

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // CORS: browser apps call this RPC directly for read-only eth_call. Auth is the ?k= URL token,
    // never a cookie, so reflecting the Origin is safe — a stolen response is read-only and the token
    // already gates it.
    const origin = req.headers.get('Origin') || '*';
    const cors: Record<string, string> = {
      'access-control-allow-origin': origin,
      'vary': 'Origin',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '86400',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);

    // Spec 436 §6.2 — the ops summary, under the town's ops token (a steward session is /admin/chain, W6).
    if (req.method === 'GET' && url.pathname === '/ops/summary') {
      const tok = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
      if (!env.TOWN_OPS_TOKEN || tok !== env.TOWN_OPS_TOKEN) return Response.json({ error: 'the ops summary is read with the town ops token' }, { status: 401, headers: cors });
      if (!env.OPS) return Response.json({ error: 'no ops rollup is bound on this deployment' }, { status: 503, headers: cors });
      const window = url.searchParams.get('window') ?? '24h';
      const ms = window === '30d' ? 30 * 86_400_000 : window === '7d' ? 7 * 86_400_000 : 86_400_000;
      const to = Date.now(), from = to - ms;
      // Limits per app come from the token rows: list the KV prefix (cheap at this scale) so utilisation can be drawn.
      const limits: Record<string, { readRps: number; writeRps: number }> = {};
      try { const list = await env.TOKENS.list({ prefix: 't:' }); for (const k of list.keys) { const r = await env.TOKENS.get(k.name, 'json') as TokenRecord | null; if (r) limits[r.app] = { readRps: r.readRps, writeRps: r.writeRps }; } } catch { /* limits stay empty; the summary says nothing about them */ }
      const q = new URLSearchParams({ from: String(from), to: String(to), limits: JSON.stringify(limits), generation: env.CHAIN_GENERATION ?? '' });
      for (const k of ['estate', 'app'] as const) { const v = url.searchParams.get(k); if (v) q.set(k, v); }
      const res = await env.OPS.get(env.OPS.idFromName('ops')).fetch(`https://ops/summary?${q}`);
      return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors } });
    }
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/healthz')) return Response.json({ ok: true, service: 'chain-gateway', ops: !!env.OPS }, { headers: cors });

    let rec: TokenRecord | null = null;
    let calls: Rpc[] | null = null;
    const run = async (): Promise<Response> => {
      if (req.method !== 'POST') return new Response('POST JSON-RPC only', { status: 405 });
      if (!env.ORIGIN) return err(null, -32603, 'gateway misconfigured: ORIGIN unset', 500);
      // Auth: Bearer header (header-capable clients) OR ?k=<token> in the URL (header-less clients —
      // a viem RPC client in the browser, forge). A token baked into a browser bundle is issued with
      // writeRps 0, so it can only read.
      const bearer = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
        || url.searchParams.get('k') || '';
      if (!bearer) { record(env, ctx, [sampleOf(null, null, { outcome: 'denied', denied: 'badToken' })]); return err(null, -32001, 'missing app token', 401); }
      rec = await env.TOKENS.get(`t:${await sha256(bearer)}`, 'json') as TokenRecord | null;
      if (!rec) { record(env, ctx, [sampleOf(null, null, { outcome: 'denied', denied: 'badToken' })]); return err(null, -32001, 'unknown or revoked app token', 401); }
      let body: Rpc | Rpc[]; try { body = await req.json(); } catch { record(env, ctx, [sampleOf(rec, null, { outcome: 'denied', denied: 'batchShape' })]); return err(null, -32700, 'parse error'); }
      calls = Array.isArray(body) ? body : [body];
      const gasCapInjected = injectEstimateGasCap(calls, env.ESTIMATE_GAS_CAP);
      if (calls.length === 0 || calls.length > 50) { record(env, ctx, [sampleOf(rec, calls, { outcome: 'denied', denied: 'batchShape' })]); return err(null, -32600, 'empty or oversized batch'); }
      for (const c of calls) if (typeof c?.method !== 'string' || !isAllowed(c.method)) { record(env, ctx, [sampleOf(rec, calls, { outcome: 'denied', denied: 'disallowedMethod' })]); return err(c?.id ?? null, -32601, `method not permitted: ${c?.method}`, 403); }
      const reads = calls.filter(c => !isWrite(c.method)).length, writes = calls.length - reads;
      const rl = env.RATE.get(env.RATE.idFromName(rec.app));
      const ok = await rl.fetch('https://rl/take', { method: 'POST', body: JSON.stringify({ reads, writes, readRps: rec.readRps, writeRps: rec.writeRps }) }).then(r => r.json() as Promise<{ ok: boolean; denied?: string; retryAfter?: number }>);
      if (!ok.ok && ok.denied) { record(env, ctx, [sampleOf(rec, calls, { outcome: 'denied', denied: 'rateLimited' })]); return err(calls[0]?.id ?? null, -32003, `this app token may not send ${ok.denied === 'writes' ? 'transactions' : 'reads'}`, 403); }
      if (!ok.ok) { record(env, ctx, [sampleOf(rec, calls, { outcome: 'denied', denied: 'rateLimited' })]); return err(calls[0]?.id ?? null, -32005, `rate limited (retry ~${ok.retryAfter}s)`, 429); }
      if (!Array.isArray(body)) {
        const ttl = CACHE_TTL_S(body.method, body.params ?? []);
        if (ttl > 0) {
          const key = new Request(`https://cache/${body.method}/${await sha256(JSON.stringify(body.params ?? []))}`);
          const hit = await caches.default.match(key);
          if (hit) { record(env, ctx, [sampleOf(rec, calls, { outcome: 'cacheHit', gasCapInjected })]); const j = await hit.json() as { result?: unknown }; return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: j.result }), { headers: { 'content-type': 'application/json', 'x-cache': 'HIT' } }); }
          const t0 = Date.now();
          const res = await forward(env, body); const j = await res.clone().json() as { error?: unknown; result?: unknown };
          record(env, ctx, [sampleOf(rec, calls, { outcome: res.ok && !j.error ? 'forwarded' : 'upstreamError', upstreamMs: Date.now() - t0, gasCapInjected })]);
          // Never cache an error OR a null/absent result — a pending tx's receipt/getBlock returns
          // null, and caching it would mask the real value for the whole TTL (starves receipt polls).
          if (!j.error && j.result != null) ctx.waitUntil(caches.default.put(key, new Response(await res.clone().text(), { headers: { 'cache-control': `max-age=${ttl}` } })));
          const h = new Headers(res.headers); h.set('x-cache', 'MISS'); return new Response(res.body, { status: res.status, headers: h });
        }
      }
      const t0 = Date.now();
      const res = await forward(env, body);
      // The chain's head, read off any eth_blockNumber that passes — the Pulse's block rate without a poller of its own.
      if (!Array.isArray(body) && body.method === 'eth_blockNumber' && env.OPS) {
        const j = await res.clone().json().catch(() => null) as { result?: unknown } | null;
        const head = typeof j?.result === 'string' && /^0x[0-9a-fA-F]+$/.test(j.result) ? Number.parseInt(j.result, 16) : null;
        if (head !== null) ctx.waitUntil(env.OPS.get(env.OPS.idFromName('ops')).fetch('https://ops/head', { method: 'POST', body: JSON.stringify({ head }) }).catch(() => undefined));
      }
      record(env, ctx, [sampleOf(rec, calls, { outcome: res.ok ? 'forwarded' : 'upstreamError', upstreamMs: Date.now() - t0, gasCapInjected })]);
      return res;
    };

    const res = await run();
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    return new Response(res.body, { status: res.status, headers: h });
  },
};
