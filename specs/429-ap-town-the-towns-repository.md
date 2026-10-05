# Spec 429 — ap-town: the services a chain's estates share

**Status:** Draft, 2026-10-05. Release R0 (inventory and charter). Nothing has moved yet.
**Owner's brief (2026-10-05):** ap-home is for the Home and the estate. ap-town is for central services that rely on a
single chain and can have many estates running on it. Bring the service applications into ap-town, except skills.
Skills is an external central service that is part of the town. The UX leverages the town model built for the field
game in `~/pokernight`.
**Builds on:** ADR-0063 / spec 399 (Ring 0 is packages and contracts; products live in their own repos), ADR-0040 (the
public KB holds only chain-derivable facts), ADR-0041 / ADR-0056 (a listing, a resolution and a projection authorize
nothing), ADR-0061 / spec 346 (typed naming), spec 347 §8.5 (ARD + ACP as registry-hosted projections), spec 279
(registry kit), spec 413 (retrieval over the public tier), spec 426 (executor invoke), spec 410 §4 (federation, the next
scale up).

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| D1 | **A town is one chain.** ap-town deploys the services that every estate on that chain shares: naming, the registry, the public graph and discovery, chain access, and the town's own portal and operations. It never deploys a Home, a vault, an edge or a runtime. Those are estate pieces, and they stay in ap-home. |
| D2 | **Nothing in the town grants.** A name resolves to an address, the registry lists, the graph holds what the chain can prove, and the portal shows. Every one of those is evidence. Authority stays in the estate: an owner's signature, a delegation, a vault that re-verifies. |
| D3 | **Moves IN:** the five ap-discovery apps (ap-discovery is then archived) and `ap-home/apps/rpc-gateway`. **Built NEW:** `naming`, `town-agent`, `town-web` (the portal), `packages/town-model`, `packages/town-scene`. |
| D4 | **Referenced, not moved:** skills (`~/skills`), the KMS (`~/faithkms`), Game Night (`~/pokernight`), the field and engagement apps (`~/engage`), and the estates themselves (`ap-home`, `ap-demos`). Each is a row in the town manifest, with its own repo, deployer and health. |
| D5 | **No Worker renames during the move.** Worker names, hostnames, DO class names and service-binding names are kept exactly as they are. The repo is new; the deployments are the same deployments. Renames come later, if ever, through their own PR. |
| D6 | **The town is described by a manifest, not by code.** `towns/<chain>/town.yaml` lists the chain, the estates and the services; `town.lock.json` pins what is deployed. The portal, the town agent, the indexer's crawl list and the checks are all generated from that one file. |
| D7 | **Four separate signals per service, never merged into a score:** *listed* (it is in the manifest), *healthy* (its probe answers), *compatible* (its pins satisfy the town's contract generation and package floors), *authorized* (always a question for the caller's own delegation, never answered by the town). |
| D8 | **The Town view is the pokernight isometric renderer, lifted out of the game.** It is SVG isometric (2.5D), not WebGL. The drawing (`FieldTown.tsx`) only depends on a scene type, so it moves into `packages/town-scene`; a town-specific builder turns the manifest plus live events into that scene. |

---

## 1. Scales and the line between estate and town

| Scale | Repo | Holds | Chain scope |
| --- | --- | --- | --- |
| Substrate | `agenticprimitives` | packages, contracts, devkit | any |
| Estate | `ap-home` (Faithnet), `ap-demos` (impact) | Home, agent runtime, vault, edge, Home MCP | one chain |
| **Town** | **`ap-town`** | naming, registry, public graph and discovery, chain access, portal, operations | **one chain, many estates** |
| Federation | `ap-federation` (later) | public ground between towns on different chains | many chains |

**The test for "is this a town service?"** It answers the same thing to every estate on the chain, and it holds no
person's or organization's private records. If wiping it costs a rebuild from the chain, it can be town. If it holds
someone's records, it belongs to an estate (ADR-0055).

**Faithnet is an estate.** Today it is the only live estate in the faithchain town (faithnet-b is retired). The town is
designed for more than one from day one: every list in the manifest is a list of estates, even when it has one entry.

---

## 2. Inventory: exactly what is brought in

### 2.1 Moves into ap-town (existing, live)

| From | Dir today | → ap-town dir | Worker (faithnet env), kept | Host, kept | What it is |
| --- | --- | --- | --- | --- | --- |
| ap-discovery | `apps/demo-discovery-indexer` | `apps/discovery-indexer` | `demo-discovery-indexer-faithnet` | (cron + `POST /project`) | **The only writer** of the public graph (GraphDB `smart-agents-faithnet`) and of the retrieval index (Vectorize `ap-public-kb-faithnet`). Crawls the faithchain name roots every minute; consumes `shelf-index-faithnet`. |
| ap-discovery | `apps/demo-discovery-mcp` | `apps/discovery-mcp` | `demo-discovery-mcp-faithnet` | service binding only | Reader of the graph and the index (`search_agents`, `get_agent`, `/kb/retrieve`). Holds the GraphDB credential. |
| ap-discovery | `apps/demo-discovery-a2a` | `apps/registry` | `demo-discovery-a2a-faithnet` | `discovery-a2a.faithnet.io` | **The registry.** The `discovery.registry` agent: `/.well-known/ard.json`, `POST /search`, `/explore`, `/agents`, ACP `registry/v1/latest/registry.json`. |
| ap-discovery | `apps/demo-discovery-connector` | `apps/discovery-connector` | `demo-discovery-connector-faithnet` (+ `gc-discovery-connector`, richcanvas account) | `discovery-connector.faithnet.io/mcp` | Public read-only MCP for Claude.ai (`find_services`, `get_service`, `list_topics`) over the registry's `/search`. |
| ap-discovery | `apps/demo-discovery` | `apps/discovery-web` | `demo-discovery-web-faithnet` | `discovery.faithnet.io` | The discovery explorer UI. Folded into `town-web` in R3 (§7). |
| ap-home | `apps/rpc-gateway` | `apps/chain-gateway` | `faithchain-rpc-gateway` | `rpc.faithnet.io` | Chain access: per-app tokens (KV `TOKENS`), method allow-list, rate limit DO, gas-cap injection, in front of the Besu node. Chain-scoped by construction, deployed from an estate repo by accident of history. |

The ap-discovery default (non-faithnet) envs serve the Base Sepolia demos (`urn:ap:registry:impact-agents`). They come
with the code as a second, demo town, `towns/base-sepolia/` (§3), so the code is not copied back into ap-demos.

The directories lose their `demo-` prefix; the Workers do not (D5). History is imported, not squashed:
`git filter-repo --to-subdirectory-filter` per source, then merged, so `git log apps/registry` still reaches spec 349's
F4 fix.

### 2.2 Built new in ap-town

| Dir | What | Release |
| --- | --- | --- |
| `packages/town-model` | The `town.yaml` schema, its loader and validator, the four signals (D7), the service description schema (§8), the generators (indexer crawl list, portal catalog, town-agent card). Pure, no I/O. | R1 |
| `packages/town-scene` | The isometric renderer lifted from pokernight (`FieldTown.tsx` + the iso primitives in `fieldTown.ts`: projection, `BLOCK`/`PITCH` lots, hulls, three-face boxes, LOD, the screen-space label layer). Scene in, SVG out; no game types. | R3 |
| `apps/naming` | The public naming service (§6.1). | R2 |
| `apps/town-agent` | The town's own A2A service agent: "what does this town offer, is it healthy, is it compatible with me". Answers from the manifest + probes + the registry. It lists; it never grants. | R2 |
| `apps/town-web` | The Town portal (§7). | R3 |
| `operations/` | Probes, the status page data, the runbooks for the moved Workers, the town's own CI deploy jobs. | R1 |
| `checks/` | `check:town-manifest`, `check:no-estate-binding` (§5), `check:kb-public-only` (ADR-0040, moved from ap-discovery's `no-vector-over-vault`), `check:no-authority-in-town` (§9). | R1 |

### 2.3 Referenced by the manifest, not moved

| Service | Repo | Why it stays out | What the manifest records |
| --- | --- | --- | --- |
| **Skills** (`skills-a2a`, `skills-mcp`, `skills-corpus`, `skills-ontology`, `skills-web` at `skills.faithnet.io`) | `~/skills` | Owner's decision: skills is an external central service, part of the town but deployed from its own repo. | `kind: commons`, `repo: agentictrustlabs/skills`, hosts, card, probe, the registry it operates (playbooks pinned by digest). |
| **KMS** (AKCS, `akcs-pilot.faithnet.io`) | `~/faithkms` | A Rust service on Azure with its own posture and audit; not a Worker. | `kind: commons`, a tenant per estate, the known finding (shared caller token) carried as an open operations item. |
| **Estates** (Faithnet; impact) | `ap-home`; `ap-demos` | They are the residents, not the town. | `estates[]`: name roots, Home, edge, a2a, KMS tenant, contract generation. |
| **Game Night** | `~/pokernight` | An application, not an estate and not a commons service. Its house identity is custodied by a Faithnet persona. | `kind: application`, hosts (`gamenight.`, `games.`, `agents.faithnet.io`), house SA. |
| **Field, Gather27, Coach** | `~/engage` | Applications and agent services of their own domain. | `kind: application` / `agent-service`, the domain pack they bring. |
| `demo-publications`, `demo-resolver` | `ap-demos` | Private resolution is per organization by design (spec 338), not a town registry. | Not listed. |

### 2.4 What does not move

The Home, the agent runtime, the vault, the edge and Home MCP stay in ap-home. The naming *cards* inside the Home
(`ClaimPublicNameCard`, `ChangeNameCard`, `RequiredNameGate`) stay too: they are an owner claiming a name from their own
estate, and they keep working against the same contracts. The naming service in §6.1 is the public face, not a
replacement for them.

---

## 3. The repository

```
ap-town/
  apps/
    discovery-indexer/   discovery-mcp/   registry/   discovery-connector/   discovery-web/  (→ town-web, R3)
    chain-gateway/
    naming/              town-agent/      town-web/
  packages/
    town-model/          town-scene/
  towns/
    faithchain/          town.yaml   town.lock.json   (chain 34348 — live)
    base-sepolia/        town.yaml   town.lock.json   (chain 84532 — demo)
  services/              <service-id>.yaml            (§8: one description per listed service)
  operations/            probes/  runbooks/  status/
  checks/
  specs/                 docs/
  agentic.lock.json      package.json   pnpm-workspace.yaml   DEPLOYER.md   CLAUDE.md   AGENTS.md
```

It is a product repo exactly like ap-home and ap-discovery: generated from the `product-repo` template, on published
`@agenticprimitives/*` packages at exact pins, `ap doctor` in CI, no lockfile committed. Ring 0 gains nothing.

### 3.1 `town.yaml` (sketch)

```yaml
town: faithchain
chain: { id: 34348, generation: "1", rpc: https://rpc.faithnet.io }
contracts: { from: agentic.lock.json }          # one source of addresses
estates:
  - id: faithnet
    repo: agentictrustlabs/ap-home
    home: https://www.faithnet.me
    edge: https://edge.faithnet.io
    a2a:  https://a2a.faithnet.io
    nameRoots: [me, org, team, svc, workspace, treasury, registry, church, circle]
    kms: { tenant: faithnet }
services:
  - { id: registry,  kind: commons, repo: ap-town, worker: demo-discovery-a2a-faithnet, host: discovery-a2a.faithnet.io }
  - { id: skills,    kind: commons, repo: agentictrustlabs/skills, host: skills.faithnet.io }
  - { id: kms,       kind: commons, repo: faithkms, host: akcs-pilot.faithnet.io }
  - { id: gamenight, kind: application, repo: pokernight, host: gamenight.faithnet.io }
  # …
```

`town.lock.json` is written by the deploy job: per service, the deployed commit, the package pins, the card digest.
*Compatible* (D7) is computed from it.

---

## 4. The town on one chain with many estates

Three things make "many estates" real rather than nominal:

1. **The indexer crawls estates from the manifest**, not from a constant. Its name roots and the estates whose cards it
   fetches come from `estates[]`. A second estate is a manifest PR plus a redeploy.
2. **Each estate has its own tenant in the shared services**: its own RPC-gateway token, its own KMS tenant, its own
   registry provenance. A service never confuses one estate's caller with another's.
3. **The portal and the town agent show estates as residents**, each with its Home, edge and name roots, none
   privileged. Faithnet being first is not written anywhere in code.

---

## 5. Cutting the wires from town to estate

The inventory found three places where a central service depends on one estate's Workers. A town service must not
depend on any single estate, or the second estate would be a second-class resident.

| Wire today | Why it exists | Cut |
| --- | --- | --- |
| Indexer service-binds `EDGE` → `demo-edge-faithnet` and `A2A` → `demo-a2a-faithnet` | A Worker cannot fetch a same-account hostname, so card fetches go over service bindings. | Bindings are **generated per estate** from `town.yaml` (`EDGE_FAITHNET`, …) and selected by the card's on-chain endpoint. An estate on another account is fetched over HTTPS. |
| Indexer and `skills-a2a` use `RPC_URL=https://a2a.faithnet.io/rpc` (the estate runtime's read relay) | Historical: the relay predates the gateway. | Both move to `rpc.faithnet.io` with their own gateway tokens. The estate's relay remains, for the estate. |
| `skills-a2a` binds `demo-edge-faithnet` | The same same-account fetch. | The same pattern as the indexer, done in the skills repo (a request from the town, not a move). |

`check:no-estate-binding` fails if an ap-town `wrangler.toml` names an estate Worker other than through the generated
per-estate block.

---

## 6. Naming and registry: separate responsibilities

The pasted design separates five concerns. ap-town holds three of them and never the last two:

| Concern | Answers | Where |
| --- | --- | --- |
| Naming | "which address does this name point at?" | the naming contracts; `apps/naming` reads them |
| Registration | "is this agent listed in this registry?" | registry-kit contracts; `apps/registry` serves listings |
| Discovery | "which agents offer this?" | the graph + `apps/registry` `/search` + the connector |
| Admission | "may this caller reach this agent?" | **the estate's edge** |
| Authorization | "may this caller do this?" | **the caller's delegation, verified by the vault or the contracts** |

### 6.1 `apps/naming`

The public naming service for the town, over the existing `agent-naming` contracts and SDK:

- **Read:** resolve, reverse-resolve (`reverseResolveString`, never a log walk — ADR-0012), availability, a name's
  typed record (`atl:agentType`, the suffix check from ADR-0061), the DNS form (`<label>-<type>.<zone>`).
- **Claim:** a ceremony page an owner reaches from their estate. The service prepares the transaction; the owner's own
  account signs it, through their Home. Naming holds no key that can claim a name for anyone.
- **Roots:** which roots exist on the chain and which `.registry` agent operates each. This is what lets a second
  estate see its own names beside Faithnet's.

### 6.2 `apps/registry`

The ap-discovery a2a app, made explicit as the town's registry: the `discovery.registry` agent, ARD and ACP, search.
R2 adds what "formalize" means:

- the registry's identity is a manifest row and a published card, not a hard-coded `AGENT_NAME`;
- `discovery.faithnet.io/.well-known/ard.json` today returns the SPA's HTML with 200 (the link in `index.html` is the F4
  fix). R2 makes that path redirect, or serve, the registry's document;
- `urn:ap:registry:faithnet-agents` becomes `urn:ap:registry:faithchain` once a second estate is listed. That is a
  breaking identifier, so it is announced and dual-served for one release.

---

## 7. The portal and the Town view

`apps/town-web`, one portal for the town. The areas follow the design: **Overview**, **Find services** (today's
discovery explorer, folded in), **Naming**, **Skills** (a window onto the external skills service), **Games**, **Field
services**, **Operations**. The portal reads public data only: the manifest, the probes, the registry, the graph. It
signs nothing and holds no session for anyone.

### 7.1 The Town view

The 3D view the owner asked for is the pokernight field town. What the inventory found:

- It is **hand-drawn isometric SVG**, not WebGL: `apps/web/src/components/fieldops/FieldTown.tsx` (529 lines) draws a
  `FieldTownScene`; `apps/web/src/lib/fieldTown.ts` (667 lines) builds it, purely and deterministically, from the game's
  event log, and is tested. The choice was deliberate (`docs/FIELD-OPERATIONS.md` §7.1): crisp, pressable, testable,
  and no third WebGL context. PlayCanvas is used only for the card room.
- The drawing is the portable part. It depends only on the scene type and its buildings, people, plates and links.
  The builder is game-bound: Northern Colorado geography, phases, teams.
- The marketing site has the same language: `agenticprimitives-site/packages/diagrams/src/town-scene.tsx` (the
  eight-beat "meet the town" story) and `iso-town.tsx`.

**The plan.**

1. Lift the renderer into `packages/town-scene`: projection, lots, three-face boxes, roofs, pan and zoom, LOD, labels,
   pulses. Generalize `TownKind` to a small open set the scene builder chooses from. No Field Operations types.
2. Write `buildTownScene(manifest, live)` in `town-model`. The mapping:
   - an **estate** is a district: its Home is the civic building, its edge is the gate, and its agents are houses
     whose count comes from the graph;
   - the **commons** sit at the end of the street, one building per service: registry, naming, chain gateway, skills,
     KMS;
   - **applications** are venues on the edge of town;
   - **health** is the lit or dark windows; **compatibility** is the roof colour; **listing** is presence. There is
     never an "authorized" colour (D7);
   - **live events** — a registration, a name claim, a new block, an index pass — are the pulses the field town
     already draws.
3. Day scrubbing works the same way as in the field town: the town at block *N* is rebuilt from the graph's history.
4. pokernight keeps its own copy until `town-scene` is published; then the field town can consume the package. That
   switch is the pokernight developer's to make, and it is not on ap-town's critical path.

If the owner wants true 3D (WebGL), PlayCanvas is already in the family and could render the same scene. That is a
second renderer over the same scene, decided on evidence after R3, not a rewrite.

---

## 8. Onboarding a service into the town

There are three extension types:

| Type | Example | Brings |
| --- | --- | --- |
| **Domain pack** | field-circles skills | skills + ontology terms, published through the skills service |
| **Agent service** | field-a2a, a translation agent | an SA-anchored service agent with a card, listed in the registry |
| **Application** | Game Night, Gather27 | a user-facing app on the town's identity and naming |

**`services/<id>.yaml`** (validated by `town-model`) records: id, type, owner SA, repo, hosts, card URL, probe URL, the
package pins it runs, the contract generation it expects, the domain packs it uses, and the estates it serves.

**Onboarding takes eight steps:**

1. Owner SA exists, and its name is claimed in the town.
2. A service description PR is opened.
3. `check:town-manifest` passes: schema, no hostname conflicts, owner resolves.
4. The card is published and signed (spec 347).
5. The registry lists it: the indexer sees the on-chain record.
6. The probe answers: *healthy*.
7. Its pins meet the town's floors: *compatible*.
8. It appears in the portal and the town agent.

None of those steps gives it permission over anyone. *Authorized* is the caller's own delegation, every time (D7).

---

## 9. Field execution and the EXECUTOR-INVOKE question

The design asks for the EXECUTOR-INVOKE `selfAuthorized` versus substrate-authority conflict to be resolved first. It
has been resolved, in Ring 0 spec 426 (W1–W4 live, 2026-10-03):

- an `invoke` block implies self-acting;
- the invoker takes the session from the run's principal structurally, never from an argument;
- v1 refuses a mandate, an `authoritative` requirement, and a URL as executor;
- `check:invoke-is-self-acting` is its machine owner.

What remains is the **Field Rails** half in pokernight and engage (`docs/FIELD-RAILS.md`, specified, not built). That
is R4, and it is mostly not ap-town work. The town contributes:

- the `executors` map as a manifest projection, so an executor name resolves through the town's registry rather than
  an operator-only constant;
- `check:no-authority-in-town`: no ap-town app may hold a delegation, a session key or a mandate, or call a write
  path on anyone's behalf.

---

## 10. Releases

| Release | What | Gate (done when) |
| --- | --- | --- |
| **R0** | This spec: inventory and charter. | The owner approves §2 and the open questions. |
| **R1** | Foundation. Repo from the template, CI, `town-model` + `towns/faithchain/town.yaml`, checks. Import the 5 discovery apps and the RPC gateway with history. Deploy each from ap-town **to the same Worker names** and verify (ARD document, `/search`, connector `find_services`, indexer cursor advancing, RPC token works). Archive ap-discovery; remove `apps/rpc-gateway` from ap-home in an announced PR. | Every moved Worker deployed from ap-town and verified live; ap-home and ap-discovery own no town Worker. |
| **R1b** | The wires (§5). Generated per-estate bindings; indexer and skills-a2a on `rpc.faithnet.io`. | `check:no-estate-binding` green; the indexer survives the estate relay being unreachable. |
| **R2** | Naming and registry. `apps/naming`, the registry formalized (§6.2), `town-agent` with its card. | A name resolves, reverse-resolves and is claimed through the owner's Home; `town-agent` answers "what is here" with the four signals. |
| **R3** | Estates and the portal. `town-web` with the areas in §7; `town-scene`; discovery-web folded in; Game Night listed as an application. | The Town view renders faithchain from the manifest + graph, with live pulses; `discovery.faithnet.io` serves the portal's Find area. |
| **R4** | Shared field execution. Field Rails on spec 426 (pokernight / engage); executors resolved through the town. | One season day applied through the character's own agent with a receipt, the executor found through the town. |
| **R5** | Domain augmentation, in priority order: **P0** Field Records, Field Knowledge; **P1** Planning, Coordination, Evidence Review; **P2** Translation, Funding, Safeguarding. Each is onboarded per §8. | Each listed service is healthy and compatible in the portal. |

NANDA integration comes after R5, in a sibling repo.

## 11. Backlog

| ID | Item | Release |
| --- | --- | --- |
| TOWN-001 | Create the repo (local + GitHub), template, CI, doctor | R1 |
| TOWN-002 | `town-model`: manifest schema, loader, four signals, generators | R1 |
| TOWN-003 | Import discovery ×5 with history; deploy from ap-town; archive ap-discovery | R1 |
| TOWN-004 | Import `rpc-gateway` → `chain-gateway`; remove from ap-home | R1 |
| TOWN-005 | Per-estate bindings; indexer + skills-a2a off the estate relay | R1b |
| TOWN-006 | `apps/naming` | R2 |
| TOWN-007 | Registry formalized; `discovery.faithnet.io` ARD path; registry URN plan | R2 |
| TOWN-008 | `town-agent` + card | R2 |
| TOWN-009 | `packages/town-scene` lifted from pokernight | R3 |
| TOWN-010 | `town-web` portal; `buildTownScene` | R3 |
| TOWN-011 | Service onboarding: `services/*.yaml`, `check:town-manifest`; list skills, KMS, Game Night, field | R3 |
| TOWN-012 | Executors resolved through the town for Field Rails | R4 |

## 12. Open questions for the owner

1. **GitHub visibility.** ap-home is public, ap-discovery is private. Recommendation: **public**, like ap-home. The town
   serves only public data, and the site already describes it.
2. **The town's domain.** The town's hosts live under `faithnet.io`, which is the estate's name. Recommendation: keep
   every host in R1–R3 (D5), and decide a town domain (e.g. `faithchain.org`, not yet on Cloudflare) before a second
   estate joins.
3. **The Base Sepolia demo town.** Recommendation: carry it as `towns/base-sepolia` because the code is the same. The
   alternative is to drop its envs and let the impact demos lose discovery.
4. **The town agent's name.** A suffix names a derived type (ADR-0061). It operates the town's service listing, so
   `.registry` fits: `faithchain.registry`, beside `discovery.registry`. Or fold it into `discovery.registry`.
5. **True 3D.** The SVG isometric view in R3 first, with a WebGL renderer over the same scene only if the evidence asks
   for it (§7.1).

## Reference: smart-agent patterns to port

smart-agent (branch `003-intent-marketplace-proposal`) runs discovery, naming and the agent runtime as one app
deployment over one chain, with no separate notion of a town: the shared services and the resident agents live
together. The divergence here is deliberate. Separating the town from the estate is what lets a second estate join
the same chain as an equal, and the property this spec protects (D2) is easier to keep when the town has no estate code
in it at all. What is ported is smart-agent's indexer-as-sole-writer and the read-only discovery tier, both of which
the discovery apps already carry.
