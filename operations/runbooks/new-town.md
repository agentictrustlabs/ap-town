# Runbook — a new town on a new chain

**What this stands up:** a chain's shared services, so that estates can be built on it at all — the contracts, the
name registries, the public graph and registry, chain access, and the portal that shows the town. Rung 4 of the
[five builds](https://github.com/agentictrustlabs/agentic-primitives/blob/main/docs/builds.md); the two runbooks
below it are [publish an estate](publish-an-estate.md) (this repo) and
[new estate](https://github.com/agentictrustlabs/ap-home/blob/master/docs/runbooks/new-estate.md) (`ap-home`).

**Do this only if you need your own chain.** A town is single-chain by definition: every service in it is either a
contract on that chain or a read of that chain's state. If you want your own people, your own names and your own
vault but not your own chain, you want an **estate in an existing town**, which is a day's work instead of a
quarter's. Two towns exist to copy from: `towns/faithchain` (a private Besu network, full services, live) and
`towns/base-sepolia` (a public testnet, `status: demo`, fewer services).

## 0. Decide the chain first

| Decision | Why it is hard to change later |
| --- | --- |
| **Public or private** | a private chain gives you free gas, fast finality and no public verifiability; a public one gives you a chain anyone can check and gas that costs money. The federation design assumes some of each |
| **Chain id** | it is in every CAIP-10 identifier, every deployment record and every signature domain |
| **Gas policy** | free gas (dev-mode paymaster) removes funding from every ceremony. Paid gas means a funded relay per estate and a paymaster policy you maintain |
| **Finality** | every ceremony in this substrate is a transaction someone waits on |
| **Who operates the nodes** | a town whose chain has one operator has one operator |

Record the answers in the manifest (§3) before the first deploy: `town.yaml` is the file every app, check and
generator reads, and a value that only lives in someone's terminal is a value that will disagree with the chain.

## 1. Deploy the substrate contracts

The contracts are the substrate's, not the town's — you deploy the same set every other town runs, from
`@agenticprimitives/contracts`. The Foundry scripts are in that package (`script/Deploy.s.sol`,
`DeployRegistries.s.sol`, `AddTypedRoots.s.sol`, `AddAgentTypeRoots.s.sol`, `DeployPaymaster.s.sol`,
`DeployPaymentEscrow.s.sol`, and the predicate/term scripts that follow them).

The output is one **deployment record** — `deployments-<chain>.json`, published in the contracts package as
`@agenticprimitives/contracts/deployments/<chain>` and addressed by CAIP-2 (`eip155-<id>`). That record is the one
source of addresses for every estate, service and app in the town.

- **Never copy an address from prose**, including this file. Read it from the deployment record.
- **Pin the generation.** `chain.generation` in the manifest says which contract generation the town runs. A fix
  that changes a contract is a new generation, and nothing in the town runs it until the manifest says so.
- **Verify the runtime code**, not the source you think you deployed (`eth_getCode` against the record).

## 2. Hand over governance

A town whose contracts are owned by a deployer key is a demo, and should say `status: demo` in its manifest.
Before it is anything else, run the governance handoff: deploy the long-lived multisig, wire it into the timelock,
rotate the guardian, renounce the timelock admin, and write down who holds what. The substrate's runbook for this
is `docs/runbooks/deploy-governance-handoff.md` in the source monorepo; its acceptance list is what "production"
means for a chain.

## 3. Write the manifest

`towns/<chain>/town.yaml` — copy `towns/base-sepolia/town.yaml` for the small shape or `towns/faithchain/town.yaml`
for the full one.

```yaml
town: <chain>
status: demo            # demo → live only after §2 and a service that answers
chain:
  id: <id>
  generation: "1"
  rpc: https://<the town's gateway>
  deployment: <chain>   # @agenticprimitives/contracts/deployments — the one source of addresses
  coin: { address: "0x…", symbol: "…", decimals: 6 }   # only if names are paid for (§5)
accounts: { … }         # the accounts the town's resources live in — ids and labels, never a credential
estates: []             # §7
services: [ … ]         # §4
```

Then `pnpm check` (`check:town` — hosts do not collide, every estate has its own agent zone and KMS tenant;
`check:no-estate-binding` — a town Worker binds only town Workers or a declared lane) and `pnpm gen:town`, which
writes what the manifest decides into the apps. `pnpm probe:town` reports every listed service's health.

## 4. Stand up the services

Deploy from this repository, in this order — each needs the one before it:

| # | Service | App | What it is |
| --- | --- | --- | --- |
| 1 | **Chain access** | `apps/chain-gateway` | the town's RPC door. Every other service and every estate holds its own app token (`t:<sha256>` in the gateway's `TOKENS` KV) with its own read/write limits. Nothing in the town talks to a node directly |
| 2 | **Naming** | `apps/naming` | the chain's name registries and the service agent that operates them. Typed roots (`.me`, `.org`, `.svc`, …) are added by the contract scripts in §1; this is their front door |
| 3 | **The public graph** | `apps/discovery-indexer` (the only writer) + `apps/discovery-mcp` (the reader) | what the chain can prove, projected for reading. It holds **only** world-readable, on-chain-derivable facts — never per-viewer state, never vault contents, not even hashed |
| 4 | **The registry** | `apps/registry` | the town's registry agent, its ARD document, its ACP registry and search |
| 5 | **The portal + the town agent** | `apps/town-agent` | the town, visible: its estates, its services, its Pulse |
| 6 | **Key custody** | external (AKCS) | a tenant per estate. Not strictly a town service — but an estate without one has no vault, so plan it with the town |

**The rule every one of them keeps: nothing in a town grants.** A resolver returns an address. A registry's
signature binds only the fact that it lists. The graph holds what anyone could rebuild from the chain. *Authorized*
is the caller's own delegation, every time.

## 5. Names, and whether they cost anything

Free names are a `status: demo` decision: they are claimed first-come and there is nothing to stop a script taking
ten thousand. A town that means to last prices them — a coin, a priced subregistry per root, a price curve
(shorter is dearer), and a **domain rule** so a label that is somebody's `.com` or `.org` is not handed to a
stranger. Each Home then signs claim tickets with its own gate key, allowed on the priced roots by the town's
naming agent, revocable per Home. The design and the cutover are
[spec 431](../../specs/431-paid-names-sheqel-treasuries-and-the-domain-rule.md) and
[the priced-names cutover](431-priced-names-cutover.md).

The third choice is to **root the town's names at another town** (`chain.namesRootedAt: <town>`), which is what hopenet
does. The typed namespace stays one namespace with one root: this town's naming service answers "does it exist, is it
free" from the root town and shows this chain's table only as "on this chain". What it implies: the `NAMING` binding on
this town's apps stays unbound (`gen:town` leaves it out); the chain's local typed roots are closed to claims
(`pnpm naming:close-local-roots`, the root owner's act) so a parallel `.me` cannot grow; nothing here sells a name; and
a name a Home claims here is carried to the root through the estate's gate (U3, still owed — until then the root shows
it as free and the pages say so). A town rooted elsewhere keeps its `.estate` and service names in its local table.

## 6. Decide what the town will never do

Write this into the manifest's comments while it is still cheap, because every one of them is a pressure you will
feel later:

- it will not hold a key, a vault, a delegation or a session for an estate;
- it will not score trust — it lists, it resolves, it indexes, and a reader decides;
- it will not privilege the first estate (if a default anywhere names it, that is a bug);
- it will not let a service's own claim about itself become an authorization input.

## 7. The first estate

A town with no estate is a set of services with nobody to serve. Stand one up with
[the new-estate runbook](https://github.com/agentictrustlabs/ap-home/blob/master/docs/runbooks/new-estate.md), and
publish it here with [publish an estate](publish-an-estate.md). Expect the first one to find what the manifest got
wrong — that is what it is for. Then stand up a **second** one, and expect it to find everything that quietly
defaulted to the first estate's values.

## 8. Done when

| Check | Expect |
| --- | --- |
| `pnpm check` | `check:town` and `check:no-estate-binding` green |
| `pnpm probe:town` | every listed service healthy |
| deployment record | `eth_getCode` non-empty for every address the town uses |
| governance | the multisig owns it; no deployer key is an owner (or `status: demo` says so) |
| a name | a person in the first estate buys one and presents it; it resolves to their account |
| the portal | the town shows its estates and services, none privileged |
