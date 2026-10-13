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
  /**
   * Addresses recorded on the chain AHEAD of the pinned `@agenticprimitives/contracts` release that will carry them —
   * the same keys as the deployment document (`pricedSubregistries`, `namingFeeTreasury`, …). Merged over the
   * package's document; removed from here once the pin catches up. A bridge, never a second source of truth.
   */
  deploymentOverlay?: Record<string, unknown>;
}

/**
 * AN MCP SERVER THE TOWN OR AN ESTATE RUNS — declared, never inferred (spec 435 §5).
 *
 * The town knows its MCP servers the way it knows its Workers: because this file says so. The tempting
 * shortcut is to read them off the Worker names (`demo-mcp-faithnet`, `imb-home-mcp`, `skills-mcp`) and
 * three of them do end in `-mcp`, which is exactly why it is tempting and exactly why it is wrong: a name
 * is not a declaration, the vault's MCP at faithnet is called `demo-mcp`, and a census built from a
 * spelling convention reports whatever the convention last happened to be.
 *
 * `exposure` is the honest answer to "can I speak MCP to this?" and is NOT a permission — ADR-0057: MCP is
 * a PRIVATE capability interface behind an admitted runtime, absent from every Agent Card. Whether a caller
 * may use a tool is decided inside, against the chain, every time.
 *
 * WHAT IS NOT HERE. No tool list and no trust level. Those come from a server's own SIGNED tool manifest
 * (spec 435 §5 `McpToolManifestV1`, W1) read from the registry, so that a reader checks the server rather
 * than this file: a tool list in a manifest is a claim by whoever edited the manifest, which is the one
 * thing an anti-rug-pull control must not be.
 */
export interface TownMcpServer {
  /** Short id, unique within its town or estate (`vault`, `home`, `infra`). */
  id: string;
  /** What it serves, in a sentence a reader who does not know this deployment can follow. */
  description: string;
  /**
   * `binding` — no hostname at all: only a Worker the manifest binds can reach it.
   * `authenticated` — it has a door, and the door admits only an authenticated principal.
   * `open` — it has a door that answers an anonymous MCP client (a read-only interop surface).
   */
  exposure: 'binding' | 'authenticated' | 'open';
  /** The door, when it has one. Absent for `binding`, and absence is the point rather than a gap. */
  url?: string;
  /** The Worker that serves it, kept exactly as deployed. */
  worker?: string;
  /** The agent whose own MCP this is (`atl:mcpEndpoint` on its name record), when it belongs to one. */
  agentName?: string;
  /** An unauthenticated GET answering 2xx when it is up. Absent = its health is not observable from outside. */
  probe?: string;
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
  /**
   * THE ESTATE'S NAME ON THIS CHAIN — `<label>.estate`, the agent that IS this estate (spec 429 D2).
   * An agent says which estate is its own by carrying this name in `atl:estate`, and that estate agent
   * carries the Home's URL in `atl:homepage`: the name is stable, the URL moves. The manifest records it
   * only so a reader can put the town's `id` on a name the CHAIN gave — never to decide the estate.
   */
  estateName?: string;
  /**
   * THE ESTATE'S NAMING GATE — the key whose signature authorizes a priced registration from this
   * estate's Home (`PricedSubregistry.claim(t, gateSig)`; one gate per Home, allowed by the town on
   * every priced root and revocable alone). It is what makes "which estate is this name's?" a question
   * the CHAIN answers: recover the ticket's signer from the registering transaction and it is this
   * address. The allowance itself is public (`GateSet`), so a reader can check the claim without
   * trusting this file — the manifest only says whose gate it is.
   *
   * Absent = this estate has no gate of its own (its names carry no estate signal, and the naming
   * service answers `estate: null` for them rather than guessing one).
   */
  namingGate?: string;
  /**
   * The key-custody service this estate's keys live in. `tenant: null` with `backend` says, in the
   * manifest itself, that this estate has NO tenant and what it uses instead — so a Pulse reader is not
   * told an estate has hardware-rooted custody because a name was easier to write than a gap.
   */
  kms?: { tenant: string | null; backend?: string };
  /**
   * THE ESTATE'S PROJECTION ON NEUTRAL GROUND — spec 439 F1 / spec 410 §4. The estate commits to its live
   * set in an `EstateProjectionRegistry` so a counterparty in ANOTHER estate can prove one leaf against a
   * root it reads itself. Nothing here is authority: a presentation is evidence (ADR-0056), and the
   * receiving estate still decides under its own mandate, per step.
   *
   * WHY THE MANIFEST CARRIES IT AT ALL. `register(estateId, signer)` is first-come-wins — public ground
   * cannot verify who governs an estate on another chain, so it cannot refuse a squatter. A verifier that
   * trusts `signerOf` alone trusts whoever registered first. This row is a PUBLIC, REVIEWED declaration to
   * cross-check it against, and `declaredOnChain` says plainly whether the stronger check exists yet: when
   * the estate agent writes `atl:projectionSigner` itself (spec 439 F2.5), a verifier reads the estate's own
   * chain and this row stops being load-bearing.
   *
   * `estateId` is `keccak256("eip155:<chainId>:<governance>")` and is PERMANENT, which is why `governance`
   * is the estate agent's Smart Agent address and never a key (ADR-0010). An estate without one is absent
   * here rather than registered against a provisional address.
   */
  projection?: {
    /** The registry on neutral ground, and the chain it is on (not necessarily this town's). */
    registry: string;
    registryChainId: number;
    /** The address the id was derived from — the estate agent's SA. */
    governance: string;
    estateId: string;
    /** The key that anchors this estate's roots there. Public by construction; rotatable by itself. */
    signer: string;
    /** Has the estate declared this signer on its own chain (`atl:projectionSigner`)? */
    declaredOnChain: boolean;
  };
  /** Spec 437 I4 — the platform resources this estate owns, for the Pulse's attribution (never authority). */
  workers?: string[];
  pagesProjects?: string[];
  vercelProjects?: string[];
  azureResources?: string[];
  /** Azure RESOURCE GROUPS this owner claims, for the cost rows — which name a group, not a resource.
   *  Declaring a group claims EVERY resource billed inside it, including ones listed nowhere else
   *  (a bastion, a database, a registry, the disks). Declare one only where that is true. */
  azureResourceGroups?: string[];
  /** The MCP servers this estate runs (spec 435 §5). Absent = it declares none, which is a fact about this
   *  file: an estate's agents may still each serve their own, and those live on the chain, not here. */
  mcpServers?: TownMcpServer[];
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
  /** Spec 437 I4 — the platform resources this service owns beyond its `worker`, for the Pulse's attribution. */
  workers?: string[];
  pagesProjects?: string[];
  vercelProjects?: string[];
  azureResources?: string[];
  /** Azure resource groups this service claims — see `TownEstate.azureResourceGroups`. */
  azureResourceGroups?: string[];
  /** Set when this service's OWN interface is MCP — the town-shared half of the §5 catalog. Its id,
   *  description, worker and probe are the service row's already; this adds only what is MCP-specific. A
   *  service that merely talks to an MCP server does not carry this. */
  mcp?: { exposure: TownMcpServer['exposure']; url?: string };
  /** MCP servers this service RUNS BESIDE its own interface — the skills registry's tools Worker is one:
   *  the service is a website, and an MCP server sits behind a binding next to it. Separate from `mcp`
   *  because "this service speaks MCP" and "this service runs an MCP server" are different claims and a
   *  reader deciding what to call needs to know which. */
  mcpServers?: TownMcpServer[];
}

export interface TownManifest {
  town: string;
  /** `live` towns carry production estates; `demo` towns exist for demonstrations. */
  status: 'live' | 'demo';
  chain: TownChain;
  estates: TownEstate[];
  services: TownService[];
  /** Spec 437 I4 — the accounts the town's resources live in (ids and labels; never a token). */
  accounts?: import('./pulse-types').TownAccountsV1;
  /**
   * WHO MAY READ THE OPERATOR VIEW, by Smart Agent — the town's amounts and per-resource metrics (spec 437 I7).
   *
   * A list, declared here, because the alternative was one shared bearer token that everybody who may look has
   * to hold: a secret cannot be attributed to a person, cannot be revoked for one of them, and ends up in a
   * shell history. A person signed in at their own Home presents an `id_token` instead, this town verifies it
   * against that Home's published keys, and the subject is looked up here.
   *
   * It grants NOTHING (429 D2). It unlocks a read of aggregate numbers this deployment already holds — no
   * Home, no person's record, no act. Empty or absent means nobody: the ops token is then the only way in,
   * which is the safe reading of silence.
   */
  /**
   * WHAT THE TOWN RUNS ON THAT NOTHING METERS — spec 437 I4, the other half of attribution.
   *
   * The Pulse measures four platforms because four platforms have APIs that answer. The rest of the bill is
   * real and invisible: source hosting, a package registry, eight domains, a key service, a graph database.
   * A cost page that shows only what is easy to read teaches its reader that the easy part is the whole, so
   * the unmetered things are DECLARED here and shown beside the measured ones, labelled as declared.
   *
   * NO AMOUNTS LIVE HERE. This file is public; money is the operator's read and comes from the providers.
   */
  vendors?: Array<{
    id: string;
    /** What it is, in a few words. */
    what: string;
    /** How it is paid for: `plan` (a subscription), `usage`, `per-unit` (domains, keys), or `free`. */
    billing: 'plan' | 'usage' | 'per-unit' | 'free';
    /** Where to look at the actual bill. */
    where?: string;
    /** Anything a reader needs in order not to misread the row. */
    note?: string;
    /** Set when the Pulse measures this one, so the page can point at the figure instead of repeating it. */
    metered?: 'cloudflare' | 'vercel' | 'azure' | 'graphdb';
  }>;
  operators?: Array<{
    /** The person's Smart Agent, as their Home's `id_token` asserts it (`sub`, CAIP-10). */
    sa: string;
    /** What to call them on the page when they are reading. */
    label: string;
    /** Why they are listed — for whoever reads this file in a year. */
    note?: string;
  }>;
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
