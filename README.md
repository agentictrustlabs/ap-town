# ap-town

**The services a chain's estates share.** A town is one chain, every estate on it, and the services they all use:
the registry and the public graph, naming, chain access, inference, the town's own MCP, and the portal that shows the
town. Nothing in a town grants anything — a name resolves, a registry lists, the graph holds what the chain can prove —
so an estate's authority stays in the estate. See [spec 429](specs/429-ap-town-the-towns-repository.md) and the four
scales on [agenticprimitives.dev](https://agenticprimitives.dev/architecture/scales).

| Scale | Repository |
| --- | --- |
| Substrate | [`agentic-primitives`](https://github.com/agentictrustlabs/agentic-primitives) — the published packages, contracts and Developer Kit (source monorepo is private) |
| Estate | [`ap-home`](https://github.com/agentictrustlabs/ap-home) — the Home, the agent runtime, the vault; one estate per deployment |
| **Town** | **`ap-town`** — this repository |
| Federation | [`ap-federation`](https://github.com/agentictrustlabs/ap-federation) — live: neutral ground, the doors between towns, the issuers' rows, the personal-agent client |

## Two towns

Each town is described in one file, `towns/<chain>/town.yaml`; every app, check and generator reads it.

| Town | Chain | Estates | Names |
| --- | --- | --- | --- |
| **faithnet.town** — [`towns/faithchain`](towns/faithchain/town.yaml) | faithchain, `eip155:34348` | Faithnet (`www.faithnet.me`) | the root of every typed name; priced roots, the Sheqel, the domain rule |
| **hopenet.town** — [`towns/hopenet`](towns/hopenet/town.yaml) | hopechain, `eip155:34349`, contract generation 3 | impact-agent (`www.impact-agent.me`) | rooted at faithchain (`chain.namesRootedAt`); a local table for the names its bootstrap needs |
| Base Sepolia — [`towns/base-sepolia`](towns/base-sepolia/town.yaml) | public testnet | demo | demo |

The two live towns share one operator's infrastructure (the same VM, tunnel, accounts and GraphDB instance) and nothing
else: each has its own chain, contracts, Workers and public graph, because the public tier is per chain. Across the two,
nothing is trusted: an estate on one town proves its roots on neutral ground, and a door on the other admits on a leaf
proved against the root it reads from the chain ([ap-federation](https://github.com/agentictrustlabs/ap-federation)).

## What a town can do

- **Names.** Every typed name on the chain, what it points at, who can change it, and where the agent's home account is.
  Paid names on the priced roots, claimed with a ticket a Home's gate signs ([spec 431](specs/431-paid-names-sheqel-treasuries-and-the-domain-rule.md)).
- **A registry and a public graph.** The `discovery.registry` agent's ARD document, ACP registry and search; a graph that
  holds only what anybody could reproduce from the chain, written by one indexer and read by one MCP.
- **Chain access.** A gateway in front of the chain's RPC: per-app tokens, a method allow-list, rate limits. The only way in.
- **Inference.** The town's model gateway (`inference.svc`): one contract, OpenAI-compatible doors, a budget per principal.
- **The portal and the town's own agent.** What the town offers and whether each service answers; one page per estate
  (`/api/estate/:id`, the `town.estate` skill); the MCP census — every MCP server an estate declares, probed; the Pulse.
- **A private MCP** for the town's operator (`apps/town-mcp`), reachable only by service binding.

## Services

Rows come from the manifests. A host in the table is a custom domain the manifest declares; "binding" means the
service has no hostname and is reached only by another Worker.

| Service | Where | faithnet.town | hopenet.town |
| --- | --- | --- | --- |
| **Names** | `apps/naming` | [`names.faithnet.io`](https://names.faithnet.io) — the root, for every town | [`names.hopenet.town`](https://names.hopenet.town) — the local table |
| **The portal** and the town's agent | `apps/town-agent` | [`faithnet.town`](https://faithnet.town) · `town.faithnet.io` | [`hopenet.town`](https://hopenet.town) |
| Registry (`discovery.registry`: ARD, ACP, search) | `apps/registry` | `discovery-a2a.faithnet.io` | `discovery-a2a.hopenet.town` |
| Public graph reader | `apps/discovery-mcp` | binding | binding |
| Public graph writer (the only one) | `apps/discovery-indexer` | cron | cron |
| Connector for external assistants | `apps/discovery-connector` | `discovery-connector.faithnet.io` | `discovery-connector.hopenet.town` |
| The registry's documents at their well-known paths | `apps/discovery-web` | `discovery.faithnet.io` | `discovery.hopenet.town` |
| Chain access | `apps/chain-gateway` | `rpc.faithnet.io` | `rpc.hopenet.town` |
| Inference (`inference.svc`) | `apps/inference` | `inference.faithnet.io` | — |
| The town's private MCP | `apps/town-mcp` | binding | binding |
| Skills | the skills corpus (private repo) | [`skills.faithnet.io`](https://skills.faithnet.io) | — |
| Key custody (the federation's key service) | `faithkms` | `akcs-pilot.faithnet.io` | the same service; one tenant per estate |
| Game Night | `pokernight` | `gamenight.faithnet.io` | — |

To add an estate to a town — the row, the lanes, the gateway token, the KMS tenant, the naming gate, the heartbeat —
follow [`operations/runbooks/publish-an-estate.md`](operations/runbooks/publish-an-estate.md) (build 4 of
[five](https://github.com/agentictrustlabs/agentic-primitives/blob/main/docs/builds.md)). A town of your own, on a chain
of your own, is [`operations/runbooks/new-town.md`](operations/runbooks/new-town.md); a second town on the same
operator's infrastructure is [`operations/runbooks/second-town.md`](operations/runbooks/second-town.md). Do either only
if you need your own chain; an estate in an existing town is a day's work instead of a quarter's.

## Naming rules

The rules every town's naming service enforces ([spec 430](specs/430-the-towns-naming-service.md), the resolver in
`apps/naming/worker`):

- **The suffix names the derived agent type.** `.me` a person, `.org` an organization, `.team`, `.church`, `.circle`,
  `.svc` a service, `.treasury`, `.registry`, `.workspace`. The on-chain `atl:agentType` record on the agent is the
  authority; a name whose suffix disagrees with the record is shown as a mismatch, never trusted. Offering `.org` to a
  person would be offering a false statement, so the suffix is never a free choice.
- **A label is forced-unique.** `alice`, then `alice2`: the registry gives one label to one agent, and the service shows
  availability as the chain answers it.
- **One name per person across the federation.** A person claims one label on the root, and it names her account on
  every chain she lives on (`atl:accounts`).
- **One namespace, one root.** Typed names are rooted on faithchain. A town rooted elsewhere answers "does this name
  exist, is it free" from the root town and shows its own table only as "on this chain"; the root marks a name that is
  claimed on another chain as claimed elsewhere instead of listing it for sale. The local typed roots on hopechain are
  closed to claims (`pnpm naming:close-local-roots`), so a parallel `.me` cannot grow there.
- **A name is a projection of an agent, never the identity.** A resolver row's CAIP-10 is the agent's account on that
  chain. A root-chain address is never promoted to the agent's canonical id by default: the page says "not the agent's
  home account" when the name points at a satellite, and "which account is the agent's home is not declared" until the
  holder declares it, which she does once from her Home's naming page.
- **The domain rule.** A label that is somebody's `.com` or `.org` is handed only to a verified email there.
- **Still owed (U3).** A name a Home claims on a rooted town is carried to the root through the estate's gate. Until
  then `rich-impact.me` stays free on the root, and the pages say so instead of selling it.

## Layout

| Path | What |
| --- | --- |
| `apps/*` | the town's deployables, each with its own `wrangler.toml` and an `[env.<town>]` per town |
| `packages/town-model` | the manifest schema, validator, the four signals, the generators |
| `packages/town-scene` | the town, drawn: the isometric SVG renderer and the people-and-places shapes |
| `packages/town-ui` | what the town's web apps share: router, fetch hook, base styles |
| `towns/<chain>/` | one town per chain: `town.yaml` |
| `checks/` | `check:town`, `check:no-estate-binding`, `check:no-vector-over-vault`, `probe:town`, `gen:town` |
| `operations/runbooks/` | a new town, a second town, publishing an estate, the priced-names cutover |
| `specs/` | the charter (429), the naming service (430), paid names (431), the model gateway, governance, the four contexts and the Pulse (434–437) |

## Commands

```
pnpm install
pnpm check            # typecheck · tests · the town checks · ap doctor · public links
pnpm gen:town         # write what towns/*/town.yaml decides into the apps (lanes, crawl roots, agent names)
pnpm probe:town       # every listed service's health, now
pnpm doctor:rules     # drift between projected rules and the pinned source
```

Every `@agenticprimitives/*` dependency is an exact published version (`agentic.lock.json`).
