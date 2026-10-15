# Runbook — a second town on the operator's existing infrastructure

**What this stands up:** a second chain beside the first, on the same VM, so the federation twin runs across two
TOWNS instead of two estates on one. Written while doing it (hopechain, 34349, 2026-10-14); the steps that bit
are marked **⚠**.

**Why it matters:** every federation gate today proves cross-estate on ONE chain, and `federation.yaml` and the
primer both claim a second chain is "one row in the register and one door, and no verifier code". This is the
work that makes that claim testable — including the places it turns out to be optimistic.

**What is reused, and it is nearly everything:** the Azure VM, the Cloudflare Tunnel on it, the Cloudflare and
Vercel accounts, GraphDB, the AKCS tenant (signing keys are chain-agnostic), and every town service that is not
chain-bound (inference, skills, town-agent, town-mcp, kms — referenced from the new town's manifest, never
redeployed). **New: a chain, its Workers, and the estate that moves onto it.**

**Cost: no new fixed line.** The chain shares the VM, the tunnel and the data disk; the Workers, KV and
Vectorize sit inside included tiers. Watch VM memory, not money (below).

---

## 0. Decisions to take before anything is deployed

| decision | hopechain's answer | why |
| --- | --- | --- |
| a private chain, or a public testnet? | a second private Besu/QBFT chain | a public testnet has no SHQ, no AKCS and metered gas — it would test a different thing |
| which estate moves? | impact-agent (a demo estate: no real users, five demo personas) | the twin needs an estate on each chain, and moving a demo estate costs a vault reset rather than a migration |
| where is neutral ground? | **stays on faithchain** (`EstateProjectionRegistry 0xb4E116F5…`) | the whole value of the twin is that both estates anchor to the SAME registry on a chain neither of them is moving to. `Deploy.s.sol` deploys a registry on the new chain too — **it must never be used** |
| naming | faithchain stays the one universal root | the new chain's naming contracts are its own local table, for the `.estate`/service names the bootstrap needs |
| hostnames | `hopechain-<service>.agentkg.io` | **⚠ ONE subdomain level.** See §2 |

---

## ⚠ 1. Memory is the constraint, not CPU or money

Besu is about 1.5 GB a node. The VM has 16 GB and the first town's five nodes already use ~7 GB. A second town
runs **two validators**, not four: four-validator QBFT tolerates one failure, two tolerates none, and that is the
right trade for a test town and the wrong one for the live chain. Measured after hopechain came up: **6.9 GB free,
no swap.** If it swaps, drop the second town to one validator.

**The hazard this creates is on the LIVE chain, not the new one.** Validators 3 and 4 moved behind a `quorum4`
compose profile so the second town can run two, and compose EXCLUDES a profiled service unless the profile is
asked for. An unset `COMPOSE_PROFILES` would start the live chain with half its validators — which looks fine in
`docker compose ps` and is not. Two guards, and **add the first before the new compose.yml goes near the live
directory**:

```
# on the VM, BEFORE deploying the parameterised compose:
echo 'COMPOSE_PROFILES=quorum4' >> /opt/<live-town>/.env     # compose reads .env automatically
```

`bootstrap.sh` also refuses to run when the variable is unset, and derives `VALIDATOR_COUNT` from that same line
so the genesis and the runtime cannot disagree — four validator keys with two running containers is a chain that
cannot reach quorum.

---

## ⚠ 2. Free DNS means ONE subdomain level

Cloudflare Universal SSL covers `*.zone` and **not** a second level. `rpc.hopechain.agentkg.io` resolves and then
**fails the TLS handshake** — DNS says yes and the connection dies, which reads like a Worker fault and is not.
Advanced Certificate Manager fixes it for about $10 a month, to serve a hostname.

So every town-B host is `<town>-<service>.<zone>`, matching the convention already live on the zone. An estate's
own hosts stay on the ESTATE's zone: a town zone is not an estate zone.

---

## 3. The chain

1. Parameterise the Besu project if it is not already: `PROJECT_PREFIX`, `SUBNET`, `RPC_PORT`/`WS_PORT`,
   `DATA_ROOT`, `COMPOSE_PROFILES` — every default being what the live town runs today.
2. **⚠ The data-disk guard tests the DISK, not the mountpoint.** A second town shares the existing disk at
   `/<disk>/<town>`, which is not itself a mountpoint. The guard compares the device under `DATA_ROOT` with the
   device under `/`, which keeps its intent (never fill the OS disk) and costs no new storage.
3. `/opt/<town>` with its own `.env`, then `bash scripts/bootstrap.sh`.

## 4. The tunnel

**⚠ Find out how the tunnel is managed before touching it.** A *locally managed* tunnel keeps its ingress in
`/etc/cloudflared/config.yml` on the VM; a *remotely managed* one keeps it in the dashboard and shows "No routes"
locally. The two towns' tunnels may differ — ours do.

For a local one: add the new hostname **first** in the ingress list and leave the existing catch-all last, so the
first town is untouched; `cloudflared tunnel ingress validate`; reload. Then the owner adds a **proxied CNAME** to
`<tunnel-uuid>.cfargotunnel.com` — a grey-cloud record does not resolve.

## 5. The contracts

```
DEPLOYER_ADDRESS=0x…  <TOWN>_RPC=https://…  PRIVATE_KEY=…  pnpm deploy:<town>
```

- **⚠ `DEPLOYER_ADDRESS` is not optional off anvil.** It used to fall back to Anvil's deterministic account
  silently, and that address is recorded as the naming registry's IMMUTABLE initializer — so ~18 contracts deploy
  and the failure arrives later as `NotInitializer(<the real key>, 0xf39F…)`, naming the symptom and not the
  cause. It now fails closed; set it to the broadcast key's address.
- **⚠ `foundry.toml fs_permissions` is an exhaustive allowlist.** A new chain adds its three `deployments-*.json`
  paths, or the deploy completes and only the write is refused.
- **⚠ Several addresses will be IDENTICAL to the first chain's** — same deployer, same nonces, fresh chain, so
  CREATE lands them in the same places. An address no longer tells you which chain you are on; pass the chain
  explicitly everywhere.

## 6. The gateway

A second private chain is another `[env.<name>]` in `apps/chain-gateway`, not another repo: its own Worker name,
its own `TOKENS` KV, its own RateLimiter storage. `custom_domain = true` makes wrangler create the DNS itself —
no click. Mint app tokens per consumer (`indexer`, the estate, `projector`, `charter`), read-only except the
charter one. Verify: a valid token reads `eth_chainId`, and **no token and a bad token are both 401**.

---

## ⚠ 7. The estate's move and the town's manifest are ONE wave

The original plan had these as two (services, then the estate). They cannot be:

- `validateTown` requires **`estates: a town has at least one estate`** — and that rule is right, so the manifest
  cannot land before an estate is on the chain;
- the discovery indexer's `TLDS` and `LANE_ROUTES` are **generated** from the manifest (`pnpm gen:town`), so the
  discovery tier cannot be configured before the manifest either.

So the order inside the merged wave is: **estate first, manifest second, discovery tier last.**

Two more things the schema settles: `status` is `live | demo` only, and a `namingGate` is unique across estates —
the moving estate needs a NEW gate address on the new chain, not its old one.

### 7.1 The estate

Everything in the estate's own configuration is derived from five inputs (`estates/<id>.estate.json`), so the
move is a declaration edit plus a redeploy — **except three things that are chain-scoped and will not follow**:

1. its service agents' addresses (CREATE2 over a factory that is at a different address on the new chain);
2. **the harness agent SA's custody**, whose sole custodian is the interactions-session key;
3. **every resident's DEL-001 session leaf**, which names that key as its delegate.

Skipping (2) reverts the whole redemption transaction and reports only "inner userOp reverted"; skipping (3)
leaves the playbook unreadable, visible only as `plannerTrace.playbookUnreadable`. Create the key, rotate the
harness SA's custody onto it, re-issue every leaf — in that order.

### 7.2 The graph

A second town gets its **own** GraphDB repository, cloned from the first town's config. The public tier is per
chain: mixing two chains' facts in one store would make "anybody could reproduce this from the chain" untrue of
either. A fresh repository reports a few dozen triples — those are the ruleset's axioms, not data.

---

### 7.3 The discovery tier (landed 2026-10-15)

Six Workers, each its own `[env.<town>]` beside faithnet's: the discovery MCP and the indexer over the town's own
GraphDB repository and its own Vectorize index (`ap-public-kb-<chain>`, 768/cosine, metadata index `kind`), the
registry, the public connector, the explorer host, and the town's private MCP. The town agent then binds `REGISTRY`
and `INFRA`; `NAMING` stays unbound when the town roots its names elsewhere. What each one needed that a deploy
cannot do: a GraphDB user scoped to the one repository (`POST /rest/security/users/<name>` with the admin header
that already lives in `.env.ops.local` as the monitor token), an `indexer` app token on the town's chain gateway
(`t:<sha256>` in its TOKENS KV; the Worker's `RPC_URL`/`LOGS_RPC_URL` are `https://rpc.<town>/?k=<token>`), a KV
namespace for the indexer's cursor (created AFTER the env exists — `kv namespace create --env` refuses before), and
the shelf-hint queue, which is the ESTATE's (`shelf-index-imb`, produced by the estate's runtime since 2026-10-11
and consumed by nothing until the town's indexer existed). Record the two credentials that cannot be read back in
`.env.ops.local` the moment they are minted.

**Expect the first projection to find nothing.** The batch indexer enumerates NAMED agents on this chain, and the
persona seed (`seed-personas-on-chain.mts`) deploys accounts and names nothing: the estate's people and its two
service agents reverse-resolve to `""` on 34349. The graph is empty because the chain is, which is the only honest
state of a public tier (ADR-0040). Name them with ap-home `scripts/name-personas-on-chain.mts` (each persona claims
`<handle>.me` on the chain's permissionless root BY ITS OWN ACCOUNT — one claim per `msg.sender` — in one batch:
declare type, claim, records, primary). Two traps it met on 2026-10-15: a typed claim batch needs ~1.6M gas against
the account client's 800k default (estimate from the EntryPoint), and **a free-gas chain still charges prefund** —
three claims drained the paymaster's EntryPoint deposit from 1e15 to 4e14 wei and the fourth's `handleOps`
reverted; `depositTo(paymaster)` from the deployer fixed it. Then re-run the projection.

**Use the person's ROOT-CHAIN label, not the handle.** The first pass here named them `maya.me` while faithchain
already had `maya-fernandes.me`, and the owner's rule is one name per person across the federation. Undoing it took
`rename-personas-on-chain.mts` (the root owner registers the long label straight to the account, the account presents
it, the old node is emptied, handed back and EXPIRED with `renew(node, 1)` — the registry's only release primitive, and
the parent's act). Then `link-persona-accounts.mts` writes `atl:accounts` on each person's name on BOTH chains (the
predicate must be active on the new chain first: Ring 0 `AddAccountsPredicate.s.sol`). The result reads the same from
either side: `maya-fernandes.me` on 34348 and on 34349, each naming her account on both.

## 8. What is not done here

The twin itself (the door taking chain per estate, the gates parameterised per estate) and federated naming
across chains. Both are the next wave, and the door is the one place "no verifier code" was optimistic. Also
open: the registry's agent is not a chartered `.registry` SA on this chain (its card says "hopenet registry" and
claims no name), there is no gateway agent for the connector's `invoke_agent`, and the Pulse's day is not recorded
(no context agents here).
