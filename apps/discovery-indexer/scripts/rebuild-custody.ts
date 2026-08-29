/**
 * rebuild-custody.ts — rebuild the KB's custody-membership graph (`urn:ap:custody`, ADR-0040) for every agent
 * ALREADY in the knowledge base, without re-projecting facets. Use after a run whose custody scan was
 * incomplete (the indexer now refuses to replace the graph in that case) or when the graph was blanked.
 *
 *   GRAPHDB_URL=…/repositories/<repo>/statements GRAPHDB_USER=… GRAPHDB_PASSWORD=… \
 *   RPC_URL=<ARCHIVE-capable RPC: historical eth_getCode> LOGS_RPC_URL=<2000-block getLogs RPC> CHAIN_ID=… \
 *     pnpm exec tsx scripts/rebuild-custody.ts
 *
 * Reads the agent list from the KB (SPARQL), runs the same per-agent custody scan the full index uses, and
 * REPLACES the graph only when the scan is complete (every deploy block located, every log chunk read).
 * NOTE: base-sepolia-rpc.publicnode.com does NOT serve historical eth_getCode — every deploy-block bisection
 * fails there and the scan yields 0 tokens; sepolia.base.org / drpc / tenderly do.
 */
import { createPublicClient, http, type Address } from 'viem';
import { DiscoveryIndexer, type IndexerConfig } from '../src/indexer.js';
import { SparqlGraphStore } from '../src/store.js';

const env = process.env;
const statements = env.GRAPHDB_URL!;
if (!statements) throw new Error('GRAPHDB_URL required');
const queryUrl = statements.replace(/\/statements$/, '');
const auth = env.GRAPHDB_USER ? 'Basic ' + Buffer.from(`${env.GRAPHDB_USER}:${env.GRAPHDB_PASSWORD ?? ''}`).toString('base64') : undefined;

const cfg: IndexerConfig = {
  rpcUrl: env.RPC_URL ?? 'https://sepolia.base.org',
  logsRpcUrl: env.LOGS_RPC_URL ?? env.RPC_URL ?? 'https://sepolia.base.org',
  chainId: Number(env.CHAIN_ID ?? 84532),
  nameRegistry: (env.NAME_REGISTRY ?? '0x6629Cca40B008C0984a1Ca266Ca10A344420cac3') as Address,
  resolver: (env.RESOLVER ?? '0xB890060dE1B3Fd2C78e1f0859da3883743eAD452') as Address,
  nameResolver: (env.NAME_RESOLVER ?? '0xA15B0703716DC8634B74F97723618f74Af3AaA73') as Address,
  registry: null,
  profileResolver: (env.PROFILE_RESOLVER ?? '0xfcd37F8dca26ead889922b22C169c21370bd352a') as Address,
  relationship: (env.RELATIONSHIP ?? '0x0AF2455e3f76594E81d9042aD5FE22A5A35dc57f') as Address,
  attestationRegistry: (env.ATTESTATION_REGISTRY ?? '0xD57f2e52395b9C99fAE8Abf823578faFe038f5B7') as Address,
  tlds: [], discoveryRegistryId: env.DISCOVERY_REGISTRY_ID ?? 'urn:ap:registry:impact-agents',
  maxDepth: 0, concurrency: Number(env.CONCURRENCY ?? 2), attestLookback: 0, attestChunk: 1999,
  custodyWindow: Number(env.CUSTODY_WINDOW ?? 9),
};

const res = await fetch(queryUrl, { method: 'POST', headers: { 'content-type': 'application/sparql-query', accept: 'application/sparql-results+json', ...(auth ? { authorization: auth } : {}) },
  body: 'PREFIX ap: <https://agenticprimitives.dev/ns/core#> SELECT DISTINCT ?sa WHERE { ?a ap:smartAgent ?sa }' });
if (!res.ok) throw new Error(`KB query ${res.status}`);
const sas = ((await res.json()) as { results: { bindings: { sa: { value: string } }[] } }).results.bindings.map((b) => b.sa.value as Address);
console.log(`[rebuild-custody] ${sas.length} agents in the KB · rpc ${cfg.rpcUrl}`);

const store = new SparqlGraphStore(statements, { user: env.GRAPHDB_USER, password: env.GRAPHDB_PASSWORD });
const indexer = new DiscoveryIndexer(cfg, store);
const latest = await createPublicClient({ transport: http(cfg.rpcUrl) }).getBlockNumber();
const t0 = Date.now();
const tokens = (await (indexer as unknown as { scanCustody(l: bigint, a: Address[]): Promise<string[]> }).scanCustody(latest, sas)) as string[];
const complete = (indexer as unknown as { lastCustodyScanComplete: boolean }).lastCustodyScanComplete;
console.log(`[rebuild-custody] ${tokens.length} tokens · complete=${complete} · ${Date.now() - t0} ms`);
// ALLOW_PARTIAL=1: write an incomplete scan anyway — only sensible when the graph is currently EMPTY or worse
// than this result (a partial custody graph beats a blank one); the warning above says what is missing.
if ((!complete || (sas.length > 0 && tokens.length === 0)) && env.ALLOW_PARTIAL !== '1') {
  console.error('[rebuild-custody] scan incomplete — NOT writing (existing graph preserved). Use an archive-capable RPC, or ALLOW_PARTIAL=1 when the graph is empty.');
  process.exit(2);
}
if (!complete) console.warn('[rebuild-custody] ALLOW_PARTIAL=1 — writing an INCOMPLETE custody graph; re-run without it once the RPC cooperates.');
await store.setCustodyTokens(tokens);
await store.flush();
console.log('[rebuild-custody] custody graph replaced');
