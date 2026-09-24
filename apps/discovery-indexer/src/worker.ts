// demo-discovery-indexer — HTTP trigger for TARGETED projection (the on-create / auto-index path).
//
// The home (demo-sso-next) fires `POST /project {agents:[sa,...]}` right after it deploys+names an agent
// (person, treasury, org) or registers one, so the new agent appears in the discovery KB within seconds
// instead of waiting for the next full `pnpm … index` run. This is the same projection pipeline as the
// batch indexer, scoped to the given SAs and writing INCREMENTALLY (it never disturbs other agents).
//
// ADR-0040: only PUBLIC, on-chain-derivable facts reach the KB, and only for SAs that actually reverse-
// resolve to a name — so the endpoint can be open: a caller can at most make the KB reflect on-chain truth
// for a real named agent (bounded to AGENTS_MAX per call). Holds GraphDB WRITE creds as Worker secrets.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Address } from 'viem';
import { DiscoveryIndexer, type IndexerConfig } from './indexer.js';
import { SparqlGraphStore, type AgentNode } from './store.js';
import { writeAgentPassages, type VectorWriter, type WorkersAi } from './vectors.js';
import { isShelfHint, projectShelfEntry, type ShelfDeps, type ShelfHint, type ShelfOutcome } from './shelf.js';

interface Fetcher { fetch(input: Request | string, init?: RequestInit): Promise<Response> }
interface KV { get(key: string): Promise<string | null>; put(key: string, value: string): Promise<void> }
interface Env {
  GRAPHDB_URL: string;
  GRAPHDB_USER?: string;
  GRAPHDB_PASSWORD?: string;
  RPC_URL?: string;
  LOGS_RPC_URL?: string;
  CHAIN_ID?: string;
  NAME_REGISTRY?: string;
  RESOLVER?: string;
  NAME_RESOLVER?: string;
  REGISTRY?: string;
  PROFILE_RESOLVER?: string;
  RELATIONSHIP?: string;
  ATTESTATION_REGISTRY?: string;
  DISCOVERY_REGISTRY_ID?: string;
  /** Cursor store for the event watcher (last block scanned). */
  INDEXER_STATE?: KV;
  /** Max blocks to scan per cron tick (catch-up bound). */
  WATCH_MAX_BLOCKS?: string;
  /** Bounded Attested-log sweep for the targeted /project path (G1). 0 disables the sweep. */
  ATTEST_LOOKBACK?: string;
  ATTEST_CHUNK?: string;
  // ── Spec 413 — the public tier's passages. All optional: absent ⇒ the A-box projection runs exactly as before and the
  // passage writes report `vectors: 'unbound'`. This Worker holds no vault binding (check:no-vector-over-vault).
  /** Workers AI — embeds passages. */
  AI?: WorkersAi;
  /** The public-tier vector index (Vectorize). The indexer is its only writer. */
  KB_VECTORS?: VectorWriter;
  /** Service binding to the estate's agent Worker: how this Worker reads an owner's public lane (a same-account
   *  hostname is unreachable by plain fetch — CF-1042). */
  A2A?: Fetcher;
  /** The estate's edge Worker (`edge.faithnet.io`), where on-chain `a2aEndpoint`s point. */
  EDGE?: Fetcher;
  /** Which binding serves which host: `edge.faithnet.io=EDGE,*.faithnet.ai=A2A`. A host with no route is external and
   *  fetched over the network. One transport per host — routing, never a retry on another path (ADR-0013). */
  LANE_ROUTES?: string;
  /** The estate's delegation contracts — a release signed under an agent's session leaf is verified against them. */
  DELEGATION_MANAGER?: string;
  UNIVERSAL_SIGNATURE_VALIDATOR?: string;
  TIMESTAMP_ENFORCER?: string;
}


/** `REGISTRY` parsing: unset → the Base Sepolia default; the EMPTY STRING → `null` (no AgentRegistryBase on this chain —
 *  wrangler binds `VAR = ""` as "" not undefined, so an env that has no registry says so explicitly instead of
 *  inheriting another chain's address). */
function registryFromEnv(v: string | undefined, fallback: string): Address | null {
  if (v === undefined) return fallback as Address;
  const t = v.trim();
  return t === '' ? null : (t as Address);
}

const AGENTS_MAX = 20;
const CURSOR_KEY = 'watch:lastBlock';

const store = (env: Env) => new SparqlGraphStore(env.GRAPHDB_URL, { user: env.GRAPHDB_USER, password: env.GRAPHDB_PASSWORD });

/** One watcher tick: scan [cursor+1, …] for naming/registry/custody events → project the affected agents.
 *  Forward-only from the chain head on the very first run (the batch `pnpm index` does any backfill). */
async function watchTick(env: Env): Promise<{ ok: true; from: string; to: string; affected: number; projected: string[] } | { ok: false; error: string }> {
  try {
    const idx = new DiscoveryIndexer(cfg(env), store(env));
    const latest = await idx.head();
    const last = await env.INDEXER_STATE?.get(CURSOR_KEY);
    const from = last ? BigInt(last) + 1n : latest; // first run: watch forward only
    if (from > latest) return { ok: true, from: from.toString(), to: latest.toString(), affected: 0, projected: [] };
    const max = BigInt(env.WATCH_MAX_BLOCKS ?? '20000');
    const to = from + max > latest ? latest : from + max;
    const sas = (await idx.scanEvents(from, to)).slice(0, AGENTS_MAX); // bound per-tick projection work
    const r = sas.length ? await idx.projectAgents(sas) : null;
    const projected = r?.projected ?? [];
    if (r?.nodes.length) await agentPassages(env, r.nodes);
    await env.INDEXER_STATE?.put(CURSOR_KEY, to.toString());
    return { ok: true, from: from.toString(), to: to.toString(), affected: sas.length, projected };
  } catch (e) {
    return { ok: false, error: String((e as Error).message) };
  }
}

function cfg(env: Env): IndexerConfig {
  return {
    rpcUrl: env.RPC_URL ?? 'https://sepolia.base.org',
    logsRpcUrl: env.LOGS_RPC_URL ?? 'https://sepolia.base.org',
    chainId: Number(env.CHAIN_ID ?? 84532),
    // Defaults track packages/contracts/deployments-base-sepolia.json. They were left on a PREVIOUS
    // deployment; the wrangler vars overrode most of them, but NAME_RESOLVER had no var at all, so the
    // node-keyed attribute reads silently hit a near-empty contract.
    nameRegistry: (env.NAME_REGISTRY ?? '0x6629Cca40B008C0984a1Ca266Ca10A344420cac3') as Address,
    resolver: (env.RESOLVER ?? '0xB890060dE1B3Fd2C78e1f0859da3883743eAD452') as Address,
    nameResolver: (env.NAME_RESOLVER ?? '0xA15B0703716DC8634B74F97723618f74Af3AaA73') as Address,
    registry: registryFromEnv(env.REGISTRY, '0xB18534CA9c679968132ca2a43E454f5fA341030D'),
    profileResolver: (env.PROFILE_RESOLVER ?? '0xfcd37F8dca26ead889922b22C169c21370bd352a') as Address,
    relationship: (env.RELATIONSHIP ?? '0x0AF2455e3f76594E81d9042aD5FE22A5A35dc57f') as Address,
    attestationRegistry: (env.ATTESTATION_REGISTRY ?? '0xD57f2e52395b9C99fAE8Abf823578faFe038f5B7') as Address,
    discoveryRegistryId: env.DISCOVERY_REGISTRY_ID ?? 'urn:ap:registry:impact-agents',
    tlds: [], maxDepth: 0, concurrency: 2,
    // G1 — the targeted /project path now runs the same bounded Attested-log sweep as the batch indexer, so
    // an agent's attestations reach the KB within seconds of being written instead of waiting for the next
    // full `pnpm index`. The sweep uses LOGS_RPC_URL (public Base, 2000-block eth_getLogs range), so the
    // default 50k-block lookback is ~25 requests. Set ATTEST_LOOKBACK=0 to disable it — the projector then
    // reports UNKNOWN and the store PRESERVES the batch-indexed attestations rather than wiping them.
    attestLookback: Number(env.ATTEST_LOOKBACK ?? 50000),
    attestChunk: Number(env.ATTEST_CHUNK ?? 1999),
    custodyWindow: 9,
  };
}

/** Spec 413 — restate each projected agent's own public description as a retrieval passage. Never fatal to the
 *  A-box projection it follows: the KB row is written either way, and a passage that failed says so. */
async function agentPassages(env: Env, nodes: AgentNode[]): Promise<number | 'unbound' | { error: string }> {
  if (!env.AI || !env.KB_VECTORS) return 'unbound';
  try { return await writeAgentPassages(env.AI, env.KB_VECTORS, nodes); }
  catch (e) { console.log('[passages]', String((e as Error).message)); return { error: String((e as Error).message) }; }
}

/** The service binding that serves `host` per `LANE_ROUTES` (exact host or `*.suffix`), or null for an external host. */
export function laneBindingFor(env: Pick<Env, 'LANE_ROUTES' | 'A2A' | 'EDGE'>, host: string): Fetcher | null {
  for (const route of (env.LANE_ROUTES ?? '').split(',').map((r) => r.trim()).filter(Boolean)) {
    const [pattern, name] = route.split('=').map((x) => x.trim());
    if (!pattern || !name) continue;
    const hit = pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern;
    if (!hit) continue;
    const b = (env as Record<string, unknown>)[name] as Fetcher | undefined;
    if (!b) throw new Error(`LANE_ROUTES sends ${host} to ${name}, which is not bound`);
    return b;
  }
  return null;
}

function shelfDeps(env: Env): ShelfDeps | null {
  if (!env.AI || !env.KB_VECTORS || !env.INDEXER_STATE) return null;
  const idx = new DiscoveryIndexer(cfg(env), store(env));
  const kv = env.INDEXER_STATE;
  const c = env.DELEGATION_MANAGER && env.UNIVERSAL_SIGNATURE_VALIDATOR && env.TIMESTAMP_ENFORCER
    ? { delegationManager: env.DELEGATION_MANAGER as Address, universalSignatureValidator: env.UNIVERSAL_SIGNATURE_VALIDATOR as Address, timestampEnforcer: env.TIMESTAMP_ENFORCER as Address }
    : null;
  return {
    chainId: Number(env.CHAIN_ID ?? 84532),
    laneRecordsOf: (sa) => idx.laneRecordsOf(sa),
    // ONE transport per deployment: the binding where it is configured, the network where it is not (the Node CLI).
    fetchPublic: (url, init) => { const b = laneBindingFor(env, new URL(url).hostname); return b ? b.fetch(new Request(url, init)) : fetch(url, init); },
    client: idx.chain,
    contracts: c,
    ai: env.AI,
    vectors: env.KB_VECTORS,
    sparqlUpdate: (u) => store(env).update(u),
    previousIds: async (key) => { try { return JSON.parse((await kv.get(key)) ?? '[]') as string[]; } catch { return []; } },
    rememberIds: (key, ids) => kv.put(key, JSON.stringify(ids)),
  };
}

async function shelf(env: Env, hint: ShelfHint): Promise<ShelfOutcome | { status: 'unbound'; reason: string }> {
  const deps = shelfDeps(env);
  if (!deps) return { status: 'unbound', reason: 'no vector index (AI + KB_VECTORS + INDEXER_STATE) on this indexer' };
  return projectShelfEntry(deps, hint);
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-indexer' }));

app.post('/project', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agents?: unknown };
  const agents = Array.isArray(body.agents) ? body.agents.filter((x): x is string => typeof x === 'string').slice(0, AGENTS_MAX) : [];
  if (!agents.length) return c.json({ ok: false, error: 'agents[] required' }, 400);
  try {
    const { nodes, ...r } = await new DiscoveryIndexer(cfg(c.env), store(c.env)).projectAgents(agents as Address[]);
    return c.json({ ok: true, ...r, passages: await agentPassages(c.env, nodes) });
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 502);
  }
});

// Spec 413 — re-observe ONE shelf document now (what the queue consumer does per hint). Open like /project: a caller can
// at most make the public tier agree with what the owner's own public lane serves and her signature says.
app.post('/shelf', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as unknown;
  if (!isShelfHint(body)) return c.json({ ok: false, error: '{owner: 0x…, entryId} required' }, 400);
  try { return c.json({ ok: true, ...(await shelf(c.env, body)) }); }
  catch (e) { return c.json({ ok: false, error: String((e as Error).message) }, 502); }
});

// Manual watcher trigger (same logic the cron runs) — for testing / forcing a catch-up tick.
app.post('/watch', async (c) => c.json(await watchTick(c.env)));

app.get('/', (c) => c.json({ service: 'demo-discovery-indexer', project: 'POST /project {agents:[sa,…]}', watch: 'POST /watch (also runs on cron)' }));

// fetch + scheduled (cron): the watcher reacts to on-chain naming/registry/custody events every tick.
interface QueueMessage { body: unknown; ack(): void; retry(): void }
export default {
  fetch: app.fetch,
  // Spec 413 — shelf hints from the agent Worker's Library acts (`{owner, entryId}` after a publish or a visibility
  // change). A malformed hint is acked and dropped (retrying it cannot make it well-formed); a transport failure retries.
  async queue(batch: { messages: QueueMessage[] }, env: Env): Promise<void> {
    for (const m of batch.messages) {
      if (!isShelfHint(m.body)) { console.log('[shelf] dropped a malformed hint'); m.ack(); continue; }
      try {
        const r = await shelf(env, m.body);
        console.log('[shelf]', JSON.stringify(r));
        if (r.status === 'skipped' && /could not be reached/.test(r.reason)) m.retry(); else m.ack();
      } catch (e) {
        console.log('[shelf] failed', String((e as Error).message));
        m.retry();
      }
    }
  },
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(watchTick(env).then((r) => console.log('[watch]', JSON.stringify(r))));
  },
};
