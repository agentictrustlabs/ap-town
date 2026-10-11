# Runbook — publish an estate into the town

**What this does:** gives an estate that is being stood up (or already runs) its place in this chain's shared
services: a row in the manifest, the lanes the town's Workers reach it on, a token at the chain gateway, a KMS
tenant, its Home's naming gate on the priced roots, and a heartbeat into the Pulse. Rung 3 of
[the operator's ladder](https://github.com/agentictrustlabs/agenticprimitives/blob/master/docs/operators/README.md).
The estate's own half — keys, Workers, Home, demo people — is
[ap-home's new-estate runbook](https://github.com/agentictrustlabs/ap-home/blob/master/docs/runbooks/new-estate.md);
the two interleave, and this one says which of its steps come first.

**The rule the whole runbook keeps (429 D2):** nothing here grants. The town holds an estate's PUBLIC facts and reaches
its public hosts. If a step needs a key, a vault, a delegation or a session from the estate, the step is wrong.
Written from imbnet, the second estate on faithchain (2026-10-11).

## 1. The row (`towns/<chain>/town.yaml` → `estates:`)

```yaml
  - id: <estate>                         # the estate's id everywhere: heartbeat, census, Pulse, districts
    repo: agentictrustlabs/<its repo>
    home: https://<its home>
    edge: https://<its edge>
    a2a:  https://<its runtime>
    agentZone: <zone>                    # omit when it has none — then agents are reached through the edge by name
    lanes:                               # §2
      <host the town must reach>: <worker name>
    nameRoots: [me, org, team, svc, workspace, treasury, registry, church, circle]
    kms: { tenant: <tenant> }            # §4 — its OWN tenant; never another estate's
    workers: [<prefix>-runtime, <prefix>-vault, <prefix>-edge, <prefix>-home-mcp, <prefix>-approval]
    vercelProjects: [<home project>]
```

Then `pnpm check` — `check:town` (hosts do not collide, every estate has its own tenant) and
`check:no-estate-binding` (a town Worker binds only town Workers or a declared lane) must be green — and
`pnpm gen:town`, which writes what the manifest decides into the apps.

## 2. Lanes — when the estate has no zone

A Cloudflare Worker cannot fetch a same-account `workers.dev` host (it gets a 404 page, which reads as "gone"). An
estate on default hosts is therefore reachable from the town's Workers only through a **service binding**, and the
manifest is where that is declared: one `lanes:` entry per host a town Worker must reach (the edge for the public
lane, the runtime for the heartbeat), `pnpm gen:town` writes the binding, `laneBindingFor` (`packages/town-model`)
resolves it at request time. A lane is REACH, never authority.

## 3. Chain access — a token per estate

Each estate holds its own read/write app token for the gateway (`apps/chain-gateway/README.md`): one KV entry
`t:<sha256(token)>` → `{"app":"<estate>","readRps":…,"writeRps":…}`. The estate's bootstrap needs **writes**
(it deploys two service agents); its Workers need reads. The gateway caches reads — a just-written address can read
as undeployed for a beat; the estate retries the same read and never switches mechanism.

## 4. Key custody — a tenant per estate

The KMS (AKCS, `faithkms`) is a town service; a **tenant** in it is a derivation root — MAC keys and the custody seed
derive from it — so a tenant is an ESTATE boundary. A second deployment of an estate or a service within it shares
the estate's tenant (faithnet-b, skills-a2a); a second estate never does. The ceremony (`create-tenant`, one
`bind-caller` per Worker, `mint-token`) is in the estate runbook §4 because the estate chooses the callers; what
the town must insist on: **exact allowlists** (`--audiences` = the MAC audience the Workers send, `--purposes "*"`,
`key-create` for the vault) and **derived protection levels only** (`CVM_WRAPPED,CVM_DERIVED`) — an HSM-direct key
is a billable object, and the couple of HSM roots are the whole spend.

## 5. Names — the Home's gate on the priced roots (spec 431)

A paid name is claimed with a ticket signed by a gate the priced root allows (`gates(address)`), and each Home signs
with its OWN gate key. The gate set is governed by `naming.svc` — the town's agent, custodied by the clerk
(`operations/naming-service.faithchain.json`; the clerk key is the town's, never a deployer key) — so allowing a new
Home's gate is a town act: one execute batch from `naming.svc` calling `setGate(gate, true)` on every priced root,
clerk-signed. The estate runs it (`ap-home scripts/add-naming-gate.mts`, which asks the town's relayer); the town
can revoke one Home's gate without touching another's. Names are chain-wide: the roots, prices and the domain rule
(`<label>.com`/`.org` exists ⇒ verified email there) are the same for every estate.

## 6. The heartbeat and the Pulse (specs 436/437)

The town agent pulls each estate's heartbeat from its runtime (`/estate/heartbeat`, through the lane) with a
per-estate token in `ESTATE_HEARTBEAT_TOKENS` (`scripts/set-pulse-secrets.sh`). The estate must send its own id
(`ESTATE_ID` on its Workers) — **the heartbeat once defaulted to the first estate's id and imbnet answered as
faithnet** — and its census must come from a registry that is its own (`ESTATE_CENSUS_REGISTRY_ORIGIN`), or it
reports the shared registry's 74 persons for an estate with none. Attribution in the Pulse comes from the `workers`
and `vercelProjects` lists in §1; a Worker listed nowhere lands in Unattributed.

## 7. What the town does NOT do for an estate

- It does not mint a session, a delegation or a vault key. The estate's Home does, at its own door.
- It does not hold a record. A town Worker's storage is a cache of chain state and public documents.
- It does not privilege the first estate. Faithnet being first is written nowhere in code; if a default names it,
  that default is a bug (`NEXT_PUBLIC_LOGOUT_RP_APPS` in the Home was one).

## 8. Checklist

| Step | Done when |
| --- | --- |
| row + `pnpm check` + `gen:town` | green; lanes bound in the town Workers' wrangler |
| gateway token | the estate's bootstrap deploys its service agents |
| tenant + callers | `curl <home>/connect/inbox` with a session no longer says `[agentic-kms] …` |
| gate | `gates(<gate>)` is true on every priced root; a person buys and presents a name |
| heartbeat | the Pulse shows the estate under its own id with its own counts |

Record the public facts in `town.yaml`; record nothing else here.
