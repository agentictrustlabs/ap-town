// agent-indexer CLI — backfill every named Smart Agent into the discovery A-box.
//
//   GRAPHDB_URL=… npx tsx src/main.ts        # → SPARQL/GraphDB (agentkg.io) if set, else JSON-LD file
//   RPC_URL=… TLDS=impact,agent npx tsx src/main.ts

import { readFileSync, existsSync } from 'node:fs';
import { DiscoveryIndexer, type IndexerConfig } from './indexer.js';
import { storeFromEnv } from './store.js';
import { PROJECTORS } from './projectors.js';
import type { Address } from 'viem';

// Minimal .env loader (no dependency): fill .env (gitignored), run `pnpm index`. Never overwrites an
// already-set env var, so CI/shell env wins.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]!] === undefined) {
      process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  }
}

// Base Sepolia deployment — these MUST track packages/contracts/deployments-base-sepolia.json. They had
// drifted to a PREVIOUS deployment (nameRegistry 0x2632…, resolver 0x5fE5…, nameResolver 0x3bed…,
// registry 0x43e9…, profileResolver 0x6A66…, relationship 0x1010…, attestationRegistry 0x3286…), so a
// batch run without a fully-populated .env indexed dead contracts. Override via env.

/** `REGISTRY` parsing: unset → the Base Sepolia default; the EMPTY STRING → `null` (no AgentRegistryBase on this chain —
 *  wrangler binds `VAR = ""` as "" not undefined, so an env that has no registry says so explicitly instead of
 *  inheriting another chain's address). */
function registryFromEnv(v: string | undefined, fallback: string): Address | null {
  if (v === undefined) return fallback as Address;
  const t = v.trim();
  return t === '' ? null : (t as Address);
}

const cfg: IndexerConfig = {
  rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
  // Log scans get their own RPC (public Base allows a 2000-block eth_getLogs range vs Alchemy free-tier 10).
  logsRpcUrl: process.env.LOGS_RPC_URL ?? 'https://sepolia.base.org',
  chainId: Number(process.env.CHAIN_ID ?? 84532),
  nameRegistry: (process.env.NAME_REGISTRY ?? '0x6629Cca40B008C0984a1Ca266Ca10A344420cac3') as Address,
  resolver: (process.env.RESOLVER ?? '0xB890060dE1B3Fd2C78e1f0859da3883743eAD452') as Address,
  nameResolver: (process.env.NAME_RESOLVER ?? '0xA15B0703716DC8634B74F97723618f74Af3AaA73') as Address,
  registry: registryFromEnv(process.env.REGISTRY, '0xB18534CA9c679968132ca2a43E454f5fA341030D'),
  profileResolver: (process.env.PROFILE_RESOLVER ?? '0xfcd37F8dca26ead889922b22C169c21370bd352a') as Address,
  relationship: (process.env.RELATIONSHIP ?? '0x0AF2455e3f76594E81d9042aD5FE22A5A35dc57f') as Address,
  attestationRegistry: (process.env.ATTESTATION_REGISTRY ?? '0xD57f2e52395b9C99fAE8Abf823578faFe038f5B7') as Address,
  tlds: (process.env.TLDS ?? 'impact,agent').split(',').map((s) => s.trim()).filter(Boolean),
  discoveryRegistryId: process.env.DISCOVERY_REGISTRY_ID ?? 'urn:ap:registry:impact-agents',
  maxDepth: Number(process.env.MAX_DEPTH ?? 3),
  concurrency: Number(process.env.CONCURRENCY ?? 8),
  attestLookback: Number(process.env.ATTEST_LOOKBACK ?? 300000),
  attestChunk: Number(process.env.ATTEST_CHUNK ?? 1999), // logs RPC range cap (public Base = 2000)
  custodyWindow: Number(process.env.CUSTODY_WINDOW ?? 9),
};

const store = storeFromEnv();
console.log(`[agent-indexer] chain ${cfg.chainId} · TLDs [${cfg.tlds.join(', ')}] · store: ${store.describe()}`);
console.log(`[agent-indexer] projectors: ${PROJECTORS.map((p) => p.kind).join(', ')}`);

const t0 = Date.now();
const { count, registered, custodyTokens, nodes } = await new DiscoveryIndexer(cfg, store).run();
const ms = Date.now() - t0;

console.log(`\n[agent-indexer] projected ${count} named Smart Agents (${registered} with a registry entry, ${custodyTokens} custody tokens) in ${ms} ms`);
const coverage: Record<string, number> = {};
for (const n of nodes) for (const f of n.facets) if (f.present) coverage[f.kind] = (coverage[f.kind] ?? 0) + 1;
console.log('[agent-indexer] facet coverage:', coverage);
console.log('\n[agent-indexer] sample:');
for (const n of nodes.slice(0, 12)) {
  const facets = n.facets.filter((f) => f.present).map((f) => f.kind).join('+');
  console.log(`  ${(n.name ?? '(unnamed)').padEnd(24)} ${n.smartAgent}  [${facets}]`);
}
