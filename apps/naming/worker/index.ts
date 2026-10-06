// The town's naming service (spec 430): a public, keyless Worker that serves the read API under /api/* and the built
// app for everything else. It READS the chain through the town's gateway and asks the town's registry one question
// ("is this agent listed?"); it holds no key, stores nothing, and writes nowhere. A claim or a change is signed by the
// owner's own account at their Home (spec 429 D2).
import { TOWNS, type TownManifest } from '@ap-town/town-model';
import { isAddress } from 'viem';
import type { Address, ApiError } from '../src/api-types';
import { chainFor } from './chain';
import { addressView, displayView, estatesOf, nameView, rootPage, searchView, townView, type Ctx } from './views';

interface Env {
  TOWN: string;
  /** SECRET: the town's chain gateway with this Worker's own read-only app token. */
  RPC_URL: string;
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

function ctxOf(env: Env): Ctx {
  if (!env.RPC_URL?.trim()) throw new Error('RPC_URL is not configured — the naming service reads no unnamed chain');
  const town = townOf(env);
  return {
    town, chain: chainFor(town, env.RPC_URL.trim()),
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
  let m = path.match(/^\/name\/(.+)$/);
  if (m) return json(await nameView(ctx, m[1]!), 200, 20);
  m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})$/);
  if (m) return json(await addressView(ctx, m[1] as Address), 200, 20);
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
    catch (e) { return fail(502, 'chain_read_failed', String((e as Error).message).slice(0, 300)); }
    if (res.status === 200 && res.headers.get('cache-control')?.startsWith('public')) exec.waitUntil(cache.put(key, res.clone()));
    return res;
  },
};
