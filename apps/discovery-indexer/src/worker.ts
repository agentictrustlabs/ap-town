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
import { SparqlGraphStore } from './store.js';

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
    const projected = sas.length ? (await idx.projectAgents(sas)).projected : [];
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
    registry: (env.REGISTRY ?? '0xB18534CA9c679968132ca2a43E454f5fA341030D') as Address,
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

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-indexer' }));

app.post('/project', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agents?: unknown };
  const agents = Array.isArray(body.agents) ? body.agents.filter((x): x is string => typeof x === 'string').slice(0, AGENTS_MAX) : [];
  if (!agents.length) return c.json({ ok: false, error: 'agents[] required' }, 400);
  try {
    const r = await new DiscoveryIndexer(cfg(c.env), store(c.env)).projectAgents(agents as Address[]);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 502);
  }
});

// Manual watcher trigger (same logic the cron runs) — for testing / forcing a catch-up tick.
app.post('/watch', async (c) => c.json(await watchTick(c.env)));

app.get('/', (c) => c.json({ service: 'demo-discovery-indexer', project: 'POST /project {agents:[sa,…]}', watch: 'POST /watch (also runs on cron)' }));

// fetch + scheduled (cron): the watcher reacts to on-chain naming/registry/custody events every tick.
export default {
  fetch: app.fetch,
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(watchTick(env).then((r) => console.log('[watch]', JSON.stringify(r))));
  },
};
