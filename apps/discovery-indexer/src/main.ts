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

// Base Sepolia deployment (agenticprimitives deployments-base-sepolia.json). Override via env.
const cfg: IndexerConfig = {
  rpcUrl: process.env.RPC_URL ?? 'https://sepolia.base.org',
  // Log scans get their own RPC (public Base allows a 2000-block eth_getLogs range vs Alchemy free-tier 10).
  logsRpcUrl: process.env.LOGS_RPC_URL ?? 'https://sepolia.base.org',
  chainId: Number(process.env.CHAIN_ID ?? 84532),
  nameRegistry: (process.env.NAME_REGISTRY ?? '0x2632E06d0df65568200778389e13118e02EbfBB3') as Address,
  resolver: (process.env.RESOLVER ?? '0x5fE5076c9FF0c4A48F3F2e3e2F83F926696FD357') as Address,
  nameResolver: (process.env.NAME_RESOLVER ?? '0x3bed1594E1aB813C55d288edaBeA8c4aa9B651eF') as Address,
  registry: (process.env.REGISTRY ?? '0x43e9f271c0e0bc8505a1f99c4f0cb6d63165efb3') as Address,
  profileResolver: (process.env.PROFILE_RESOLVER ?? '0x6A6669E4fCf19e0A002e7dA236F0C120e215B0A2') as Address,
  relationship: (process.env.RELATIONSHIP ?? '0x1010D6aC73458fa8A72a2DEDc138224E84CF4157') as Address,
  attestationRegistry: (process.env.ATTESTATION_REGISTRY ?? '0x3286E8a9DA830820f32d427c719728d9aBCD13DD') as Address,
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
