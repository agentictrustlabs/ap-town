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

interface Env {
  GRAPHDB_URL: string;
  GRAPHDB_USER?: string;
  GRAPHDB_PASSWORD?: string;
  RPC_URL?: string;
  CHAIN_ID?: string;
  NAME_REGISTRY?: string;
  RESOLVER?: string;
  REGISTRY?: string;
  PROFILE_RESOLVER?: string;
  RELATIONSHIP?: string;
  ATTESTATION_REGISTRY?: string;
  DISCOVERY_REGISTRY_ID?: string;
}

const AGENTS_MAX = 20;

function cfg(env: Env): IndexerConfig {
  return {
    rpcUrl: env.RPC_URL ?? 'https://sepolia.base.org',
    chainId: Number(env.CHAIN_ID ?? 84532),
    nameRegistry: (env.NAME_REGISTRY ?? '0x15F7ed064A230C011b0244A14fD9653f011d609B') as Address,
    resolver: (env.RESOLVER ?? '0x7d777d2d0bbc1806B9Cc779121C27fbaAaFDb60b') as Address,
    registry: (env.REGISTRY ?? '0xe320947b18D3C71710DCB75D4bf200147ded18Df') as Address,
    profileResolver: (env.PROFILE_RESOLVER ?? '0xc448EB159B2a35F07f6E1814CC8d125244d7384B') as Address,
    relationship: (env.RELATIONSHIP ?? '0xE6B8F6C7F1c9857013dA356DF08D0384334A9607') as Address,
    attestationRegistry: (env.ATTESTATION_REGISTRY ?? '0xaE3861fd299c74D96F6FCA25f19c7ACf8b9020ed') as Address,
    discoveryRegistryId: env.DISCOVERY_REGISTRY_ID ?? 'urn:ap:registry:impact-agents',
    tlds: [], maxDepth: 0, concurrency: 2, attestLookback: 0, attestChunk: 9, custodyWindow: 9,
  };
}

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());
app.get('/health', (c) => c.json({ ok: true, service: 'demo-discovery-indexer' }));

app.post('/project', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { agents?: unknown };
  const agents = Array.isArray(body.agents) ? body.agents.filter((x): x is string => typeof x === 'string').slice(0, AGENTS_MAX) : [];
  if (!agents.length) return c.json({ ok: false, error: 'agents[] required' }, 400);
  const store = new SparqlGraphStore(c.env.GRAPHDB_URL, { user: c.env.GRAPHDB_USER, password: c.env.GRAPHDB_PASSWORD });
  try {
    const r = await new DiscoveryIndexer(cfg(c.env), store).projectAgents(agents as Address[]);
    return c.json({ ok: true, ...r });
  } catch (e) {
    return c.json({ ok: false, error: String((e as Error).message) }, 502);
  }
});

app.get('/', (c) => c.json({ service: 'demo-discovery-indexer', project: 'POST /project {agents:[sa,…]}' }));

export default app;
