// The town's naming service (spec 430): a public, keyless Worker that serves the read API under /api/* and the built
// app for everything else. It READS the chain through the town's gateway and asks the town's registry one question
// ("is this agent listed?"); it holds no key, stores nothing, and writes nowhere. A claim or a change is signed by the
// owner's own account at their Home (spec 429 D2).
import { TOWNS, type TownManifest } from '@ap-town/town-model';
import { isAddress } from 'viem';
import type { Address, ApiError } from '../src/api-types';
import { chainFor } from './chain';
import { addressView, coinsView, displayManyView, displayView, estatesOf, nameView, rootPage, searchView, townView, type Ctx, namesLike } from './views';

interface Env {
  TOWN: string;
  /** SECRET: the town's chain gateway with this Worker's own read-only app token. */
  RPC_URL: string;
  /** The town's chain gateway as a SERVICE BINDING. Same account, so reaching it by hostname hangs under
   *  concurrency; absent, the reads still go over the public hostname and the old behaviour stands. */
  CHAIN?: { fetch(req: Request): Promise<Response> };
  ASSETS: { fetch(req: Request): Promise<Response> };
  /** The town's registry Worker — asked only whether an agent is listed. */
  REGISTRY?: { fetch(req: Request): Promise<Response> };
  LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, OPTIONS', 'access-control-allow-headers': 'content-type' };
const json = (body: unknown, status = 200, maxAge = 0): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store', ...CORS } });
const fail = (status: number, error: string, detail?: string): Response => json({ error, ...(detail ? { detail } : {}) } satisfies ApiError, status);

function townOf(env: Env): TownManifest {
  const t = TOWNS[env.TOWN];
  if (!t) throw new Error(`TOWN "${env.TOWN}" is not a town this build knows`);
  return t;
}

/**
 * ONE BATCH PER REQUEST, AND THE REASON IS NOT OPTIONAL.
 *
 * The client batches forty calls into one HTTP request, and it keeps its batch schedulers in a MODULE-SCOPED map
 * keyed by the RPC url (`createBatchScheduler`, `id: url`). Every request in an isolate therefore shares one
 * scheduler — so a second request can join a batch whose fetch was issued inside the FIRST request's I/O context,
 * and in this runtime that promise can never settle for it. The symptom is not an error: the runtime cancels the
 * request with "your Worker's code had hung and would never generate a response" and the reader gets a 500.
 *
 * Measured 2026-10-14, before the fix: six simultaneous reads of /api/name left four cancelled; eight of /api/town
 * left six. /api/health, which reads no chain, answered every one. The batch owner survived; whoever joined it did
 * not.
 *
 * A nonce in the url gives each request its own scheduler id, so a batch is never shared across requests. It costs
 * one query parameter the gateway ignores, and it keeps the batching — which is what makes 301 label reads eight
 * HTTP calls instead of 301.
 */
function rpcUrlForThisRequest(env: Env): string {
  const base = env.RPC_URL.trim();
  return `${base}${base.includes('?') ? '&' : '?'}b=${crypto.randomUUID()}`;
}

function ctxOf(env: Env): Ctx {
  if (!env.RPC_URL?.trim()) throw new Error('RPC_URL is not configured — the naming service reads no unnamed chain');
  const town = townOf(env);
  return {
    town, chain: chainFor(town, rpcUrlForThisRequest(env), env.CHAIN ? (url, init) => env.CHAIN!.fetch(new Request(url, init)) : undefined),
    // One question to the registry. An answer it cannot give is `null` ("could not be asked"), never a guess.
    async listed(agent: Address) {
      if (!env.REGISTRY) return null;
      try {
        const r = await env.REGISTRY.fetch(new Request(`https://registry/agent?key=${agent}`, { headers: { accept: 'application/json' } }));
        if (!r.ok) return null;
        const b = (await r.json()) as { ok?: boolean; error?: string };
        return b.ok === true ? true : b.error === 'not found' ? false : null;
      } catch { return null; }
    },
  };
}

/** Route → [seconds to cache, handler]. Names change rarely; a listing can lag a block or two without harm. */
async function api(url: URL, env: Env): Promise<Response> {
  const path = decodeURIComponent(url.pathname.replace(/^\/api/, '')).replace(/\/+$/, '') || '/';
  // Keyless and chain-free: the estates (each one's Home) so the page knows where connect and every hand-off go.
  if (path === '/health') return json({ ok: true, service: 'naming', town: env.TOWN, estates: estatesOf(townOf(env)) }, 200, 300);
  const ctx = ctxOf(env);
  if (path === '/town') return json(await townView(ctx), 200, 60);
  if (path === '/search') return json(await searchView(ctx, url.searchParams.get('q') ?? ''), 200, 15);
  // Names that CONTAIN what was typed — a different question from "is this one free", and the one that makes a
  // partial name find anything (spec 430; owner, 2026-10-14).
  if (path === '/names-like') {
    const t = (url.searchParams.get('tld') ?? '').trim().toLowerCase();
    return json(await namesLike(ctx, url.searchParams.get('q') ?? '', /^[a-z0-9-]{1,63}$/.test(t) ? t : null), 200, 60);
  }
  let m = path.match(/^\/name\/(.+)$/);
  if (m) {
    // A name mid-ceremony (claimed, not yet presented) has met readers that throw on empty answers; say what failed,
    // as JSON, rather than let the platform's error page stand in — the page retries a fresh read.
    try { return json(await nameView(ctx, m[1]!), 200, 20); }
    catch (e) { console.error('nameView', m[1], e instanceof Error ? e.stack ?? e.message : String(e)); return fail(502, 'read_failed', `The chain read failed: ${clean(e)}`); }
  }
  m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})$/);
  if (m) return json(await addressView(ctx, m[1] as Address), 200, 20);
  if (path === '/display') {
    const list = (url.searchParams.get('a') ?? '').split(',').map((x) => x.trim()).filter((x) => isAddress(x)) as Address[];
    if (!list.length) return fail(400, 'not_an_address', 'Pass ?a=0x…,0x… (up to 50 addresses).');
    return json(await displayManyView(ctx, list), 200, 10);
  }
  m = path.match(/^\/coins\/(0x[0-9a-fA-F]{40})$/);
  if (m) return json(await coinsView(ctx, m[1] as Address), 200, 5);
  m = path.match(/^\/display\/(0x[0-9a-fA-F]{40})$/);
  if (m) return json(await displayView(ctx, m[1] as Address), 200, 30);
  m = path.match(/^\/(address|display)\/(.+)$/);
  if (m && !isAddress(m[2]!)) return fail(400, 'not_an_address', 'An address is 0x and forty hex characters.');
  m = path.match(/^\/root\/([a-z0-9-]+)$/);
  if (m) {
    const page = await rootPage(ctx, m[1]!, Number(url.searchParams.get('page') ?? '1'));
    return page ? json(page, 200, 45) : fail(404, 'no_such_root', `This town has no .${m[1]} root.`);
  }
  return fail(404, 'not_found');
}

/** An upstream failure, said in one line. A gateway that fails serves an HTML page, and the client puts that
 *  page's text in the error message — which the app then rendered where a name's price should be. */
function clean(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
}

export default {
  async fetch(req: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'GET') return fail(405, 'read_only', 'The naming service only reads. A claim or a change is signed at the owner’s Home.');

    // Answers are public and identical for every caller, so they are cached at the edge by URL.
    const cache = (caches as unknown as { default: Cache }).default;
    const key = new Request(url.toString(), { method: 'GET' });
    const hit = await cache.match(key);
    if (hit) return hit;

    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get('cf-connecting-ip') ?? 'anon' });
      if (!success) return fail(429, 'slow_down', 'Too many requests from this address; try again in a minute.');
    }
    let res: Response;
    try { res = await api(url, env); }
    catch (e) { return fail(502, 'chain_read_failed', clean(e)); }
    if (res.status === 200 && res.headers.get('cache-control')?.startsWith('public')) exec.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
