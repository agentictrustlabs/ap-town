# ap-town

**The services a chain's estates share.** A town is one chain, every estate on it, and the services they all use:
the registry and the public graph, naming, chain access, and the portal that shows the town. Nothing in a town grants
anything — a name resolves, a registry lists, the graph holds what the chain can prove — so an estate's authority
stays in the estate. See [spec 429](specs/429-ap-town-the-towns-repository.md) and the four scales on
[agenticprimitives.dev](https://agenticprimitives.dev/architecture/scales).

| Scale | Repository |
| --- | --- |
| Substrate | [`agenticprimitives`](https://github.com/agentictrustlabs/agenticprimitives) — packages, contracts, the Developer Kit |
| Estate | [`ap-home`](https://github.com/agentictrustlabs/ap-home) — the Home and Faithnet |
| **Town** | **`ap-town`** — this repository |
| Federation | `ap-federation` — towns on different chains (next) |

## The faithchain town

Described in one file, [`towns/faithchain/town.yaml`](towns/faithchain/town.yaml):

| Service | Where | Host |
| --- | --- | --- |
| **Names** — every name on the chain, what it points at, who can change it | `apps/naming` | [`names.faithnet.io`](https://names.faithnet.io) |
| The town's own agent — what is here and whether it is up | `apps/town-agent` | [`town.faithnet.io`](https://town.faithnet.io/town) |
| Registry (`discovery.registry`, ARD, ACP, search) | `apps/registry` | `discovery-a2a.faithnet.io` |
| Public graph reader | `apps/discovery-mcp` | service binding |
| Public graph writer (the only one) | `apps/discovery-indexer` | cron |
| Connector for external assistants | `apps/discovery-connector` | `discovery-connector.faithnet.io` |
| Discovery explorer | `apps/discovery-web` | `discovery.faithnet.io` |
| Chain access | `apps/chain-gateway` | `rpc.faithnet.io` |
| Skills | [`skills`](https://github.com/agentictrustlabs/skills) | `skills.faithnet.io` |
| Key custody (AKCS) | `faithkms` | `akcs-pilot.faithnet.io` |
| Game Night | `pokernight` | `gamenight.faithnet.io` |

Estates: **Faithnet** ([`ap-home`](https://github.com/agentictrustlabs/ap-home)). The Base Sepolia demo town is in
[`towns/base-sepolia`](towns/base-sepolia/town.yaml).

## Layout

| Path | What |
| --- | --- |
| `apps/*` | the town's deployables, each with its own `wrangler.toml` |
| `packages/town-model` | the manifest schema, validator, the four signals, the generators |
| `packages/town-scene` | the town, drawn: the isometric SVG renderer and the people-and-places shapes |
| `towns/<chain>/` | one town per chain: `town.yaml` |
| `checks/` | `check:town`, `check:no-estate-binding`, `check:no-vector-over-vault` |
| `specs/` | the charter (429) and the naming service (430) |

## Commands

```
pnpm install
pnpm check            # typecheck · tests · the town checks · ap doctor
pnpm gen:town         # write what towns/*/town.yaml decides into the apps (lanes, crawl roots, agent names)
pnpm probe:town       # every listed service's health, now
pnpm doctor:rules     # drift between projected rules and the pinned source
```

Every `@agenticprimitives/*` dependency is an exact published version (`agentic.lock.json`).
