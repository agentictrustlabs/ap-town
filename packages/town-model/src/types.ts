// The town manifest — one file per town (towns/<chain>/town.yaml), the single description every town app, check and
// generator reads (spec 429 D6). A town is ONE chain and the estates and services on it (D1).
//
// Nothing here is authority (D2). A manifest row says a service is LISTED; it never says anybody may use it.

/** The three extension types a service can be (spec 429 §8), plus the town's own commons. */
export type ServiceKind = 'commons' | 'domain-pack' | 'agent-service' | 'application';

export interface TownChain {
  id: number;
  /** The deployed contract generation every estate and service is expected to run against (CONTRACTS_GENERATION). */
  generation: string;
  /** The chain's public RPC as the town serves it (the chain gateway). */
  rpc: string;
  /** The chain's deployment in `@agenticprimitives/contracts/deployments` (e.g. `faithchain`) — the ONE source of
   *  contract addresses for the town's services. Never copied into the manifest. */
  deployment: string;
  /** The app coin names are bought with on this chain (spec 431), when any. */
  coin?: { address: string; symbol: string; decimals: number };
}

/** An estate is a resident of the town: a Home, its edge and runtime, on this chain. It is never deployed from here. */
export interface TownEstate {
  id: string;
  repo: string;
  home: string;
  edge: string;
  a2a: string;
  /**
   * How a town Worker reaches this estate's PUBLIC lane. A Worker cannot fetch a hostname on its own Cloudflare account,
   * so a same-account estate host is reached through a service binding to the Worker that serves it. Pattern → Worker.
   * An estate on another account is fetched over HTTPS and lists nothing here.
   */
  lanes?: Record<string, string>;
  /** The DNS zone this estate serves agent hosts under (`<label>.<zone>`, `<label>-<type>.<zone>` — spec 346 §5). */
  agentZone?: string;
  /** The name roots this estate names agents under; the indexer crawls the union over every estate. */
  nameRoots: string[];
  kms?: { tenant: string };
}

export interface TownService {
  id: string;
  /** The service's own agent name, when it is an agent (e.g. `discovery.registry`). Generated into its config. */
  agentName?: string;
  kind: ServiceKind;
  /** The repository that deploys it: `ap-town` for the town's own apps, `<owner>/<repo>` otherwise. */
  repo: string;
  /** ap-town app directory, for services this repository deploys. */
  app?: string;
  /** Cloudflare Worker name, when it is one. Kept exactly as deployed (spec 429 D5). */
  worker?: string;
  hosts: string[];
  /** An unauthenticated GET that answers 2xx when the service is up. Absent = health is not observable. */
  probe?: string;
  /** Published card, when the service is an agent. */
  card?: string;
  /** Estate ids this service serves; absent = every estate in the town. */
  estates?: string[];
  description: string;
}

export interface TownManifest {
  town: string;
  /** `live` towns carry production estates; `demo` towns exist for demonstrations. */
  status: 'live' | 'demo';
  chain: TownChain;
  estates: TownEstate[];
  services: TownService[];
}

/**
 * The four signals a town reports about a service — four answers, never one score (spec 429 D7).
 * `authorized` is deliberately NOT a field: whether a caller may use a service is a question for that caller's own
 * delegation, verified by the vault or the contracts. The town cannot answer it, so it does not pretend to.
 */
export interface ServiceSignals {
  listed: true;
  healthy: 'up' | 'down' | 'unobserved';
  compatible: 'yes' | 'no' | 'unknown';
}

export const AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL =
  'Whether you may use this service is decided by your own delegation, checked by the service against the chain. The town lists; it does not grant.';
