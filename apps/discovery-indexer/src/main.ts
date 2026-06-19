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
  chainId: Number(process.env.CHAIN_ID ?? 84532),
  nameRegistry: (process.env.NAME_REGISTRY ?? '0x15F7ed064A230C011b0244A14fD9653f011d609B') as Address,
  resolver: (process.env.RESOLVER ?? '0x7d777d2d0bbc1806B9Cc779121C27fbaAaFDb60b') as Address,
  registry: (process.env.REGISTRY ?? '0xe320947b18D3C71710DCB75D4bf200147ded18Df') as Address,
  profileResolver: (process.env.PROFILE_RESOLVER ?? '0xc448EB159B2a35F07f6E1814CC8d125244d7384B') as Address,
  relationship: (process.env.RELATIONSHIP ?? '0xE6B8F6C7F1c9857013dA356DF08D0384334A9607') as Address,
  attestationRegistry: (process.env.ATTESTATION_REGISTRY ?? '0xaE3861fd299c74D96F6FCA25f19c7ACf8b9020ed') as Address,
  tlds: (process.env.TLDS ?? 'impact,agent').split(',').map((s) => s.trim()).filter(Boolean),
  discoveryRegistryId: process.env.DISCOVERY_REGISTRY_ID ?? 'urn:ap:registry:impact-agents',
  maxDepth: Number(process.env.MAX_DEPTH ?? 3),
  concurrency: Number(process.env.CONCURRENCY ?? 8),
  attestLookback: Number(process.env.ATTEST_LOOKBACK ?? 300000),
  attestChunk: Number(process.env.ATTEST_CHUNK ?? 9000),
};

const store = storeFromEnv();
console.log(`[agent-indexer] chain ${cfg.chainId} · TLDs [${cfg.tlds.join(', ')}] · store: ${store.describe()}`);
console.log(`[agent-indexer] projectors: ${PROJECTORS.map((p) => p.kind).join(', ')}`);

const t0 = Date.now();
const { count, registered, nodes } = await new DiscoveryIndexer(cfg, store).run();
const ms = Date.now() - t0;

console.log(`\n[agent-indexer] projected ${count} named Smart Agents (${registered} with a registry entry) in ${ms} ms`);
const coverage: Record<string, number> = {};
for (const n of nodes) for (const f of n.facets) if (f.present) coverage[f.kind] = (coverage[f.kind] ?? 0) + 1;
console.log('[agent-indexer] facet coverage:', coverage);
console.log('\n[agent-indexer] sample:');
for (const n of nodes.slice(0, 12)) {
  const facets = n.facets.filter((f) => f.present).map((f) => f.kind).join('+');
  console.log(`  ${(n.name ?? '(unnamed)').padEnd(24)} ${n.smartAgent}  [${facets}]`);
}
