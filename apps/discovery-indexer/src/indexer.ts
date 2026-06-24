// The discovery indexer core.
//
// Population = the agent-naming service: walk `childLabelhashes` under each configured TLD parent
// (storage views, no log scan) to enumerate EVERY named Smart Agent, recursing into sub-names. For each
// SA, run ALL registered facet projectors and merge their ontology-shaped, SHACL-tagged facets into one
// A-box node keyed by the SA. Everything on-chain that relates to an agent flows through this one pipeline
// into the A-box → discovery API → UI. Attestations are pre-scanned ONCE (a single Attested-log sweep,
// grouped by subject) so per-agent projection stays read-only views.

import { createPublicClient, http, keccak256, toBytes, encodePacked, type Address, type Hex, type PublicClient } from 'viem';
import { NAME_REGISTRY_ABI, RESOLVER_ABI, REGISTRY_ABI, ATTESTATION_ABI, CUSTODY_EVENTS_ABI, NAMING_EVENTS_ABI, REGISTRY_EVENTS_ABI, NAME_ATTR_RESOLVER_ABI } from './abi.js';
import type { AboxStore, AgentNode } from './store.js';
import { AGENT_KIND_PRED, agentKindClass } from './ontology.js';
import { PROJECTORS, type ProjectCtx, type AttestationHit } from './projectors.js';
import { custodyToken } from './custody.js';

export interface IndexerConfig {
  /** RPC for state reads (readContract enumeration, eth_getCode) — a reliable endpoint (e.g. Alchemy). */
  rpcUrl: string;
  /** RPC for `eth_getLogs` scans (attestations, custody, watcher). Public Base allows a 2000-block range
   *  vs Alchemy free-tier's 10 — so log scans get their own RPC + ~2000-block windows. Defaults to rpcUrl. */
  logsRpcUrl: string;
  chainId: number;
  nameRegistry: Address;
  resolver: Address;
  /** AgentNameResolver attribute store (spec 280) — node-keyed a2aEndpoint/mcpEndpoint live here, NOT on the
   *  profileResolver. Distinct from `resolver` (the universal resolver used for resolveName). */
  nameResolver: Address;
  registry: Address;
  profileResolver: Address;
  relationship: Address;
  attestationRegistry: Address;
  tlds: string[];
  discoveryRegistryId: string;
  maxDepth: number;
  concurrency: number;
  /** Bounded attestation log scan: how many blocks back from head, and the chunk size. */
  attestLookback: number;
  attestChunk: number;
  /** Custody-membership log scan (ADR-0040). Per agent we binary-search its deploy block (eth_getCode) and
   *  scan custody events over [deployBlock, deployBlock + custodyWindow] — `initialize` emits the initial
   *  set at deploy, so a small window also catches near-deploy recovery/multi-credential changes. Chunked
   *  with `attestChunk`. Widen `custodyWindow` if an agent rotated credentials long after deploy. */
  custodyWindow: number;
}

const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const ROOT = `0x${'00'.repeat(32)}` as Hex;
const labelhash = (l: string): Hex => keccak256(toBytes(l));
function namehash(name: string): Hex {
  let node: Hex = ROOT;
  for (const l of name.split('.').reverse()) node = keccak256(encodePacked(['bytes32', 'bytes32'], [node, labelhash(l)]));
  return node;
}
const ATTESTED_EVENT = ATTESTATION_ABI[0];

async function pool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]!); }
  }));
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Retry the SAME call with exponential backoff — the discovery RPC intermittently rejects bursty reads
 *  ("JSON is not a valid request object" = rate limit), so bounded same-call retries (ADR-0013-compatible)
 *  keep the custody scan complete instead of silently dropping chunks. Throws after `tries`. */
async function retry<R>(fn: () => Promise<R>, tries = 3): Promise<R> {
  let last: unknown;
  for (let t = 0; t < tries; t++) {
    try { return await fn(); } catch (e) { last = e; await sleep(150 * 2 ** t); }
  }
  throw last;
}

export class DiscoveryIndexer {
  private client: PublicClient;
  /** Dedicated client for eth_getLogs (bigger range cap than the reads RPC). */
  private logsClient: PublicClient;
  constructor(private cfg: IndexerConfig, private store: AboxStore) {
    this.client = createPublicClient({ transport: http(cfg.rpcUrl) });
    this.logsClient = createPublicClient({ transport: http(cfg.logsRpcUrl || cfg.rpcUrl) });
  }

  /** One bounded, chunked Attested-log sweep → subject(lowercased) → attestations (+ validity). */
  private async prefetchAttestations(latest: bigint): Promise<Map<string, AttestationHit[]>> {
    const map = new Map<string, AttestationHit[]>();
    const from = latest > BigInt(this.cfg.attestLookback) ? latest - BigInt(this.cfg.attestLookback) : 0n;
    const step = BigInt(this.cfg.attestChunk);
    const uids = new Set<string>();
    const raw: { subject: Address; issuer: Address; credentialType: Hex; uid: Hex }[] = [];
    for (let start = from; start <= latest; start += step + 1n) {
      const end = start + step > latest ? latest : start + step;
      try {
        const logs = await this.logsClient.getLogs({ address: this.cfg.attestationRegistry, event: ATTESTED_EVENT, fromBlock: start, toBlock: end });
        for (const l of logs) {
          const a = l.args as { subject?: Address; issuer?: Address; credentialType?: Hex; uid?: Hex };
          if (a.subject && a.uid) { raw.push({ subject: a.subject, issuer: a.issuer!, credentialType: a.credentialType!, uid: a.uid }); uids.add(a.uid); }
        }
      } catch { /* RPC range/limit — skip the chunk, keep going (best-effort recent window) */ }
    }
    const validity = new Map<string, boolean>();
    await pool([...uids], this.cfg.concurrency, async (uid) => {
      validity.set(uid, (await this.client.readContract({ address: this.cfg.attestationRegistry, abi: ATTESTATION_ABI, functionName: 'isValid', args: [uid as Hex] }).catch(() => false)) as boolean);
    });
    for (const r of raw) {
      const key = r.subject.toLowerCase();
      (map.get(key) ?? map.set(key, []).get(key)!).push({ uid: r.uid, credentialType: r.credentialType, issuer: r.issuer, valid: validity.get(r.uid) ?? false });
    }
    return map;
  }

  /** Binary-search an agent's deploy block via eth_getCode (no log scan, no range limit). null if undeployed. */
  private async deployBlock(sa: Address, latest: bigint): Promise<bigint | null> {
    const has = async (b: bigint) => { const c = await retry(() => this.client.getCode({ address: sa, blockNumber: b })); return !!c && c !== '0x'; };
    if (!(await has(latest).catch(() => false))) return null;
    let lo = 0n, hi = latest;
    while (lo < hi) { const mid = (lo + hi) / 2n; if (await has(mid)) hi = mid; else lo = mid + 1n; }
    return lo;
  }

  /** Reconstruct CURRENT custody membership for the enumerated agents from their event logs (ADR-0040:
   *  custodian sets are public on-chain). This endpoint rejects `address` arrays and is flaky on wide
   *  ranges, so we go per-agent (singular address), bound to [deployBlock, deployBlock + custodyWindow]
   *  (initialize emits the initial set at deploy), and loop the four events SINGULARLY. Tokens cover EOA
   *  custodians, the passkey-PIA, AND the passkey credentialIdDigest — so a wallet viewer (EOA), a passkey
   *  viewer (digest), or a PIA all resolve. */
  private async scanCustody(latest: bigint, agents: Address[]): Promise<string[]> {
    const tokens = new Set<string>();
    // `initialize` emits the initial custody set AT the deploy block, so we bisect that block (eth_getCode
    // is NOT range-limited) and scan a tiny [deploy, deploy + custodyWindow] window for the events. getLogs
    // is chunked so the block SPAN ≤ LOG_CHUNK to respect the logs RPC's eth_getLogs range cap (public Base
    // = 2000; with a 10-block free-tier RPC, lower it via the constant below).
    const LOG_CHUNK = 1999n;
    const window = BigInt(Math.max(0, this.cfg.custodyWindow));
    let dropped = 0;
    await pool(agents, Math.min(2, this.cfg.concurrency), async (sa) => {
      const dep = await this.deployBlock(sa, latest).catch(() => null);
      if (dep === null) return;
      const end = dep + window > latest ? latest : dep + window;
      const creds = new Set<string>();
      for (const ev of CUSTODY_EVENTS_ABI) {
        const remove = ev.name === 'CustodianRemoved' || ev.name === 'PasskeyRemoved';
        for (let start = dep; start <= end; start += LOG_CHUNK + 1n) {
          const to = start + LOG_CHUNK > end ? end : start + LOG_CHUNK;
          try {
            const logs = await retry(() => this.logsClient.getLogs({ address: sa, event: ev, fromBlock: start, toBlock: to }));
            for (const l of logs) {
              const a = l.args as { owner?: Address; credentialIdDigest?: Hex };
              const cred = (a.owner ?? a.credentialIdDigest)?.toLowerCase();
              if (cred) remove ? creds.delete(cred) : creds.add(cred);
            }
          } catch { dropped++; /* exhausted retries — surfaced below, never silent (ADR-0040) */ }
        }
      }
      for (const cred of creds) tokens.add(custodyToken(cred, sa));
    });
    if (dropped) console.warn(`[agent-indexer] WARNING: ${dropped} custody log chunk(s) failed after retries — custody coverage may be incomplete; re-run.`);
    return [...tokens];
  }

  private async childNodes(parentNode: Hex): Promise<Hex[]> {
    const lhs = (await this.client.readContract({ address: this.cfg.nameRegistry, abi: NAME_REGISTRY_ABI, functionName: 'childLabelhashes', args: [parentNode] }).catch(() => [] as readonly Hex[])) as readonly Hex[];
    return pool([...lhs], this.cfg.concurrency, (lh) => this.client.readContract({ address: this.cfg.nameRegistry, abi: NAME_REGISTRY_ABI, functionName: 'childNode', args: [parentNode, lh] }) as Promise<Hex>);
  }

  private async projectAgent(sa: Address, name: string | null, node: Hex, block: number, attestations: Map<string, AttestationHit[]>): Promise<AgentNode> {
    const ctx: ProjectCtx = { client: this.client, chainId: this.cfg.chainId, sa, name, node, resolver: this.cfg.resolver, nameResolver: this.cfg.nameResolver, registry: this.cfg.registry, profileResolver: this.cfg.profileResolver, relationship: this.cfg.relationship, discoveryRegistryId: this.cfg.discoveryRegistryId, attestations };
    const facets = await Promise.all(PROJECTORS.map((p) => p.project(ctx).catch((e) => ({ kind: p.kind, present: false, shapeIri: null, conforms: false, data: {}, pending: `error: ${String((e as Error)?.message ?? e)}` }))));
    // Agent-kind subclass from on-chain agentKind (node-keyed on the AgentNameResolver). Null = not declared
    // on-chain → typed only ap:Agent (never inferred from the name; ADR-0040).
    const agentKind = (await this.client.readContract({ address: this.cfg.nameResolver, abi: NAME_ATTR_RESOLVER_ABI, functionName: 'getBytes32', args: [node, AGENT_KIND_PRED] }).catch(() => null)) as Hex | null;
    return { chainId: this.cfg.chainId, smartAgent: sa, name, node, kindClass: agentKindClass(agentKind), facets, provenance: { source: 'agent-naming:childLabelhashes', block, indexedAt: new Date().toISOString() } };
  }

  private async collect(parentNode: Hex, depth: number, block: number, attestations: Map<string, AttestationHit[]>, acc: Map<string, AgentNode>): Promise<void> {
    const nodes = await this.childNodes(parentNode);
    await pool(nodes, this.cfg.concurrency, async (node) => {
      const sa = (await this.client.readContract({ address: this.cfg.resolver, abi: RESOLVER_ABI, functionName: 'resolveName', args: [node] }).catch(() => ZERO_ADDR)) as Address;
      if (sa && sa !== ZERO_ADDR && !acc.has(sa.toLowerCase())) {
        const name = ((await this.client.readContract({ address: this.cfg.resolver, abi: RESOLVER_ABI, functionName: 'reverseResolveString', args: [sa] }).catch(() => '')) as string) || null;
        acc.set(sa.toLowerCase(), await this.projectAgent(sa, name, node, block, attestations));
      }
      if (depth < this.cfg.maxDepth) await this.collect(node, depth + 1, block, attestations, acc);
    });
  }

  /** Current chain head. */
  async head(): Promise<bigint> { return this.client.getBlockNumber(); }

  /** Event-driven watcher (chain → KB). Scan [from, to] for the events that signal an agent needs
   *  (re)projection — PrimaryNameSet (a SA got a name), the AgentRegistryBase lifecycle events (registration
   *  changed), and the custody events (recovery / new deploy) — and return the DISTINCT affected SAs. getLogs
   *  is windowed at SPAN ≤ 9 (free-tier eth_getLogs cap); the watcher only ever scans the small tail of new
   *  blocks per tick, so that's 1–few windows. Naming/registry filter by contract address; custody is
   *  topic-only (the emitter is the SA). Caller hands the SAs to projectAgents (which skips unnamed). */
  async scanEvents(from: bigint, to: bigint): Promise<Address[]> {
    if (to < from) return [];
    const SPAN = 1999n; // logs RPC range cap (public Base = 2000)
    const sas = new Set<string>();
    const windows = async (fn: (s: bigint, e: bigint) => Promise<void>) => {
      for (let s = from; s <= to; s += SPAN + 1n) { const e = s + SPAN > to ? to : s + SPAN; await fn(s, e); }
    };
    // 1) PrimaryNameSet → agent (the SA) directly.
    await windows(async (s, e) => {
      const logs = await retry(() => this.logsClient.getLogs({ address: this.cfg.nameRegistry, event: NAMING_EVENTS_ABI[0], fromBlock: s, toBlock: e })).catch(() => []);
      for (const l of logs) { const a = (l.args as { agent?: Address }).agent; if (a) sas.add(a.toLowerCase()); }
    });
    // 2) Registry lifecycle. Registered carries subjectAgent; others resolve it via getEntry.
    for (const ev of REGISTRY_EVENTS_ABI) {
      await windows(async (s, e) => {
        const logs = await retry(() => this.logsClient.getLogs({ address: this.cfg.registry, event: ev, fromBlock: s, toBlock: e })).catch(() => []);
        for (const l of logs) {
          const a = l.args as { subjectAgent?: Address; registryId?: Hex; entryId?: Hex };
          if (a.subjectAgent) { sas.add(a.subjectAgent.toLowerCase()); continue; }
          if (a.registryId && a.entryId) {
            const entry = (await this.client.readContract({ address: this.cfg.registry, abi: REGISTRY_ABI, functionName: 'getEntry', args: [a.registryId, a.entryId] }).catch(() => null)) as { subjectAgent: Address } | null;
            if (entry?.subjectAgent && entry.subjectAgent !== ZERO_ADDR) sas.add(entry.subjectAgent.toLowerCase());
          }
        }
      });
    }
    // 3) Custody (recovery / new deploy) — topic-only; the emitter address IS the SA.
    for (const ev of CUSTODY_EVENTS_ABI) {
      await windows(async (s, e) => {
        const logs = await retry(() => this.logsClient.getLogs({ event: ev, fromBlock: s, toBlock: e })).catch(() => []);
        for (const l of logs) { const sa = (l.address as Address)?.toLowerCase(); if (sa) sas.add(sa); }
      });
    }
    return [...sas] as Address[];
  }

  /** Targeted projection (the on-create / auto-index trigger): project EXACTLY these named SAs into the
   *  store incrementally, skipping the full TLD enumeration. Only agents that reverse-resolve to a name
   *  reach the public KB (ADR-0040 — junk/unnamed SAs are ignored). Custody tokens are INSERTED, not
   *  full-rebuilt, so one agent's projection never disturbs the rest. Idempotent (per-subject upsert). */
  async projectAgents(sas: Address[]): Promise<{ projected: string[]; custodyTokens: number }> {
    const latest = await this.client.getBlockNumber();
    const block = Number(latest);
    const nodes: AgentNode[] = [];
    for (const sa of sas) {
      const name = ((await this.client.readContract({ address: this.cfg.resolver, abi: RESOLVER_ABI, functionName: 'reverseResolveString', args: [sa] }).catch(() => '')) as string) || null;
      if (!name) continue; // not a named agent → not in the public discovery KB
      nodes.push(await this.projectAgent(sa, name, namehash(name), block, new Map()));
    }
    if (!nodes.length) return { projected: [], custodyTokens: 0 };
    const tokens = await this.scanCustody(latest, nodes.map((n) => n.smartAgent as Address));
    await this.store.upsert(nodes);
    await this.store.addCustodyTokens(tokens);
    await this.store.flush();
    return { projected: nodes.map((n) => n.name as string), custodyTokens: tokens.length };
  }

  async run(): Promise<{ count: number; registered: number; custodyTokens: number; nodes: AgentNode[] }> {
    const latest = await this.client.getBlockNumber();
    const attestations = await this.prefetchAttestations(latest);
    const acc = new Map<string, AgentNode>();
    for (const tld of this.cfg.tlds) await this.collect(namehash(tld), 1, Number(latest), attestations, acc);
    const nodes = [...acc.values()];
    const custodyTokens = await this.scanCustody(latest, nodes.map((n) => n.smartAgent as Address));
    await this.store.upsert(nodes);
    await this.store.setCustodyTokens(custodyTokens);
    await this.store.flush();
    return { count: nodes.length, registered: nodes.filter((n) => n.facets.some((f) => f.kind === 'registry' && f.present)).length, custodyTokens: custodyTokens.length, nodes };
  }
}
