# Spec 436 — Home · Estate · Town · Federation: the four contexts, and the surfaces each one drives

**Status:** DRAFT 2026-10-10 (owner's brief: "capture the difference between home, estate, and town. The Estate is a key
context … a specific entity/organization like RichCanvas would want to create and manage the Home (for identity), the
default estate a2a endpoint apps for person/organization/service that are driven by skill artifacts and a set of estate
MCPs to serve those a2a endpoints. Web apps and other agents in the town will be able to leverage those Estate a2a
endpoints. The estate mcp vaults is where all the self-sovereign data is at. The context of the estate is as much about
data/information as it is about a2a capabilities. The town has common infrastructure and shared services that can
support many estates, applications and fits into a larger multi-town federated ecosystem … it will drive UX of
dashboards, management, etc."). **Owner:** ap-town (this is the frame the portal, the Pulse and the admin lenses are
built on) · ap-home (the estate operator's console). **Builds on:** 429 §1 (the scales), Ring 0
`docs/architecture/estate-architecture.md` (one estate, who lives there, what an estate is not), `scales.md`,
`chains-and-estates.md` (what crosses a chain boundary), 433 §1.1 (birthrights), 354 (archetype-driven behaviour),
404 (MCP connectors), 387 (hosted catalog agents), 323 (the portable Home). **Drives:** 434 (the Pulse and the model
gateway), 435 (standing, the estate picture, the MCP catalog, the admin lens).

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| C1 | **Four contexts, nested, each with one operator, one record of truth and one set of surfaces.** A **Home** is a person's (or organization's) own place; an **estate** is one deployment that an operating entity runs for its residents; a **town** is the estates on one chain plus what they share; a **federation** is towns on many chains joined on public ground. |
| C2 | **The estate is the key context.** It is where identity is issued (the Home), where capability is served (the A2A endpoint apps, one per resident, driven by skill artifacts), where data lives (the vault MCPs and the estate MCPs), and where the chain is enforced on. An estate is as much a **data context** as a capability context: its vaults hold every self-sovereign record of its residents, and nothing above it holds any. |
| C3 | **An operating entity creates and manages an estate.** An organization such as RichCanvas stands up a Home for identity, the default A2A endpoint apps for persons, organizations and services, and the estate MCPs those endpoints serve from; it registers the estate in a town; it hands residents their Homes. The operator runs the buildings; it never holds a resident's keys or reads a resident's vault (ADR-0055, spec 323). |
| C4 | **Capability in an estate is skill artifacts, not code per agent.** The default endpoint app for each agent type runs the harness under a playbook compiled from the skills registry (archetype → definition by digest, spec 354); an estate's own skills and domain packs are published to the town's skills service and assigned, never hand-coded into the runtime (the one-capability-model rule). A service built as its own app embeds the Service Host (433) and is still a resident of the estate. |
| C5 | **Estate A2A endpoints are the estate's public capability; estate MCPs are private behind them.** Web apps and other agents, in this town or another, reach a resident through its A2A endpoint (records-first resolution → admission → the caller's own authority). An estate MCP — the vault MCP, a content catalog, a connector — is a private capability interface an endpoint app calls, absent from every card (ADR-0057). |
| C6 | **The town is shared infrastructure that holds no one's records.** Naming, the registry and public graph, discovery, chain access (the chain gateway), the skills registry, the KMS tenants, the model gateway (434), the portal: each answers the same thing to every estate. The test (429 §1): wiping it costs a rebuild from the chain. A town serves many estates AND many applications, and is one member of a federation. |
| C7 | **Each context has its own dashboard and its own management surface, and they do not reach past their level.** A Home shows one resident; an estate console shows the estate's residents, buildings and usage in aggregate per resident; the town's Pulse shows estates, services and shared-infrastructure usage in aggregate per estate; a federation view shows towns. A lower context is reached by link, under the viewer's own standing, never copied upward. |
| C8 | **Shared infrastructure is metered per estate, per application, per principal — and shown that way.** The chain gateway and the model gateway are the two town services with real metrics; both get a Pulse tab and both attribute usage to the estate and the application whose token or principal made the call. |

---

## 1. The four contexts

```
FEDERATION   towns on many chains · public ground between them (standing proven across a boundary) · no records
  └─ TOWN     one chain · the estates on it · shared services: naming, registry + graph, discovery, chain gateway,
              skills, KMS tenants, model gateway, portal · no records · metered per estate and per application
       └─ ESTATE   one deployment by one operating entity · Home (identity) · endpoint apps per resident (capability,
                   from skill artifacts) · vault MCPs + estate MCPs (data) · edge (admission) · chain access via the
                   town's gateway with the estate's tokens · the residents' self-sovereign records live HERE
            └─ HOME   one resident's own place: sign-in, ceremonies, the Ask, Activities, Security, Library, Playbook ·
                      the only place that person signs · portable to another estate (323)
```

| Context | Operated by | Holds | Exposes | Never holds | Record of truth |
| --- | --- | --- | --- | --- | --- |
| **Home** | the resident (custody) | their keys (as delegates under their custody), their wires, their view | sign-in, the Ask, ceremonies | another resident's anything | the resident's vault records |
| **Estate** | an operating entity (a person or an organization: a church network, a company, a ministry, RichCanvas) | the buildings: Home app, agent runtime, vault, edge, Home MCP, estate MCPs; the residents' encrypted vaults; the estate's app tokens at the town | one A2A endpoint per resident; the Home MCP entrance; the released cards | a resident's keys; a readable copy of a resident's records; another estate's residents | each resident's vault; the estate chain |
| **Town** | the town's steward(s) (the town clerk persona today) | the manifest, the public graph, the registry, the catalogs, the policy records of its own services (inference profiles, chain tokens) | naming, discovery, the portal, the gateways, the skills registry | any resident's private record; any key for anyone; a delegation or mandate (429 D2) | the chain; the town services' own vaults (their receipts and policies) |
| **Federation** | the towns, by agreement | public ground: the bridges that let standing in one town be proven to an edge in another | cross-town resolution and standing | everything a town never holds | each chain |

What crosses between contexts, and as what, is the question `chains-and-estates.md` answers for chains and this spec
answers for estates and towns: **evidence crosses, authority does not.** A town reads an estate's heartbeat (counts),
an attestation (a signed public statement), a card (released by the agent); it never reads a vault and it never signs.

---

## 2. The estate, in full (C2–C5)

An estate is one deployment of the substrate run by one operating entity for a set of residents. Three things make it
the key context, and each one is a column of the estate console (§5.2).

### 2.1 Identity — the Home

The Home is where a resident is born (charter), signs (passkey, SIWE, hardware), recovers (trustees), and delegates
(wires, mandates). The operator deploys and runs the Home app; the resident owns the identity (the Smart Agent
address) and the custody of it. The operator can add a resident and can remove the estate's hosting of one; it cannot
act as one. A resident's Home is portable: the records, the grants and the name go with them to another estate (323).

### 2.2 Capability — the endpoint apps, driven by skill artifacts

Every resident has an A2A endpoint (`atl:a2aEndpoint`). For most residents it is served by the estate's **agent
runtime**: one default endpoint app per agent type, which is not a separate program but the same harness under a
different playbook —

| Agent type | Default playbook (from the skills registry) | What the endpoint does |
| --- | --- | --- |
| person (`.me`) | `person-steward` + the role packs the person's memberships offer | asks, acts under the person's standing, parks for signature |
| organization (`.org`, `.team`, `.church`, `.circle`) | `org-steward` (+ domain packs) | the organization's own agent: members, roles, workspaces, its treasury's payments under its approvers |
| service (`.svc`, `.registry`, `.treasury`, `.workspace`) | the archetype its name record names (`content-catalog`, `people-group-catalog`, `inference-steward` …) | a hosted service: its tools bound by its name record (`atl:mcpEndpoint`) or by an `invoke` block |

The operator's capability work is therefore: **publish** the estate's skills and domain packs to the town's skills
service (SKILL.md contracts, archetypes, role packs), **assign** the defaults per agent type, and **host** the services
whose endpoint is the runtime. A service that needs its own code (a corpus resolver, a graph) is built as its own app
with the Service Host embedded (433) and is listed as a resident like any other. There is no third way: a resident
whose endpoint answers from a Worker's memory is the incident 433 was written for.

### 2.3 Data — the vault MCPs and the estate MCPs

**The vault MCP** holds every resident's records: per-record encrypted, per-record delegation scope, written through the
owner's agent, read by grant or the public lane (the vault-is-the-record rule). It is the estate's data context in the
strict sense — if it were wiped the loss would be a bereavement, which is why nothing above the estate holds a copy
and why the operator holds no key to it.

**Estate MCPs** are the private capability interfaces the endpoint apps call: a content catalog published by a
ministry (`ligonier.svc`'s `atl:mcpEndpoint`), a people-group graph, a connector a person attached (`connector.mcp:`
under her mandate, 404), the estate's own tooling. Each is published as a signed `mcp` surface with a tool manifest
(435 §5) so the town's catalog can list it and a holder can pin it; each is reached only through an endpoint app, never
by a stranger directly (ADR-0057).

So an estate's data context is three layers: the residents' records (vaults), the estate's published knowledge (catalogs
and graphs behind MCPs), and the public facts it puts on the chain and in the town's graph (names, cards, attestations,
released shelf works). The estate console shows all three as counts and health; only the resident sees their own.

### 2.4 The boundary — edge and chain access

The edge admits every inbound A2A message (transport → application identity → canonical resolution → admission) and is
the one door for other agents and web apps. Chain access goes through the **town's chain gateway** with the estate's
app tokens — one token per estate application (the runtime, the Home, the vault, a browser app), each with its read
and write rates and the method allow-list — so the town can meter and the estate can see its own usage (§6).

### 2.5 Who may use an estate's endpoints

Anyone who can resolve the resident and pass admission, with their own authority: a web app in the town (an OIDC client
of the Home and an A2A caller), a service agent in another estate, a person's Claude through the Home MCP, an agent in
another town once the federation bridge exists. The estate publishes; the caller brings the mandate. Being listed in
the town, being in the same estate, being a web app the operator wrote — none of these is authority (429 D7).

---

## 3. The operating entity, and the example

"RichCanvas" is an organization that wants to run an estate. What it does, in the order the buildings are deployed:

1. **Chain and town.** Pick the town (the chain) the estate will stand in — faithchain today — and claim the operator's
   own organization name there (`richcanvas.org`), under a person's custody (the person–org rule).
2. **Deploy the buildings** from `ap-home` on published packages: RPC token at the town's chain gateway → vault →
   runtime → edge → Home MCP → Home. Each a Worker or a Vercel app on the operator's accounts; `agentic.lock.json`
   pins; `ap doctor` clean.
3. **Register the estate in the town:** a row in `towns/faithchain/town.yaml` (`estates:` — home, edge, a2a, agent
   zone, name roots, lanes, KMS tenant) by PR; the indexer starts crawling its roots; the portal draws its district.
4. **Publish the estate's skills** to the town's skills service: archetypes, SKILL.md contracts, role packs, domain
   packs, under the operator's domain organization.
5. **Set the defaults:** which playbook each agent type is born with; which estate MCPs the hosted services are bound
   to by their name records; which connectors are offered as bundles.
6. **Charter residents:** people (by invitation into a Home), organizations (chartered under a person), services
   (chartered under an organization, with all four birthrights — storage, door, playbook, harness).
7. **Register the estate's clients** with the town's gateways: chain tokens per application, an inference app key per
   principal (434).
8. **Run it:** the estate console (§5.2) for health, usage, coverage and the birthright checklist; the town's Pulse for
   how the estate looks from outside.

What RichCanvas never does: hold a resident's custody, read a resident's vault, grant anything through the town, or
write a line of per-agent code for a capability a skill artifact should carry.

---

## 4. The town, in full (C6)

The town is everything the estates on one chain share, and nothing any of them owns:

| Shared service | What it answers for every estate | Metered? |
| --- | --- | --- |
| naming (`names.faithnet.io`) | every name on the chain, what it points at, who may change it | counts (names per root, per estate) |
| registry + public graph + discovery | who exists, what they offer, how to reach them — chain-derivable facts only (ADR-0040) | crawl health, index freshness, search volume |
| chain gateway (`rpc.faithnet.io`) | tokenised JSON-RPC in front of the chain: allow-list, gas cap, rate limits, cache | **yes — per app token, per estate (§6)** |
| model gateway (`inference.faithnet.io`, 434) | profiles, budgets, receipts in front of the providers | **yes — per principal, per profile, per estate** |
| skills registry | SKILL.md contracts, archetypes, role packs, pinned by digest | publishes per domain org, assignments per estate |
| KMS tenants | the delegate keys services sign with | per tenant |
| the portal and the town agent | the map, Find, the Pulse, the admin lenses, the A2A skills | — |

A town supports many **applications** as well as many estates: Game Night, Gather27, the Bible Explorer are listed
applications that use estate endpoints and the Home's OIDC without being estates. And a town is one member of a
**federation**: towns on other chains, joined on public ground so that an estate in one can prove standing to an edge in
another (`chains-and-estates.md` §3–4). The federation holds no records and no services of its own beyond the bridges.

---

## 5. The surfaces each context drives (C7)

### 5.1 Home — the resident's dashboard (exists)

Today / Work / Activities / Library / Playbook / Security, the Ask, the bell. One resident, their own records, their
own runs, their own grants. Nothing in this spec changes the Home's shape; it names the Home as the floor the other
surfaces link down to.

### 5.2 Estate — the operator's console (new; ap-home)

`www.<estate>/estate` grows from today's page into the operator's console, signed in as the operating entity's steward
(the organization's standing, derived at Home). Four columns, matching §2:

| Column | Shows | Source |
| --- | --- | --- |
| **Residents** | agents by type; chartered this week; birthright checklist per agent (storage · door · playbook · harness) with the private legs (vault key bound, grant current, playbook assigned, connectors pinned); standing disclosed or not (435) | the estate's registry read + `/harness/ops` estate scope + the stewardship records the steward may read |
| **Capability** | playbook coverage (which agent types run which archetype at which digest; residents on a stale digest); hosted services and self-hosted services (433) and whether each left a run in the last day; role packs offered per organization | `archetype.assignment` digests (never the definitions), the skills registry's current digests, the OPS index |
| **Data** | vault health (records per agent as counts, writes/reads per day, throttles, orphaned bodies); estate MCPs with their manifest digest, probe and the number of residents bound to each; public facts published (cards released, shelf works, attestations) | the vault's own ops endpoint (counts only), the MCP manifests, the chain |
| **Usage** | runs by state over 30 days; p95 ask latency; inference spend by principal and profile (434 receipts, this estate's clients); chain gateway usage by this estate's tokens (§6); DO and vault calls | `/harness/ops`, `inference.svc /v1/ops/summary?estate=`, `chain-gateway /ops/summary?estate=` |

Management from the console, each an act under the steward's standing (parked for signature where the capability
says so): charter a service with its birthrights; assign or recompose a default playbook; register an estate MCP (its
name record and manifest); issue or revoke a chain token or an inference client; export the **estate manifest** (435
§6); publish the estate's heartbeat token to the town. The console reads private legs by the steward's own standing at
its own Home; it is the one surface that may, because the estate is the resident's data context and the operator is
its steward — and even so it reads counts and digests, never bodies.

### 5.3 Town — the Pulse and the admin lenses (434 §10, 435 §6, extended here)

The Pulse's tabs become the shared infrastructure, one per service that is metered, plus the aggregate views:

| Tab | Route | What |
| --- | --- | --- |
| Town | `/operations` (kept) | services up/down, chain head, generation, naming counts, rules |
| Estates | `/operations/estates` | one card per estate: `EstateHeartbeatV1` + its chain and inference usage from the two gateways' per-estate slices |
| Homes | `/operations/homes` | run mix, capabilities asked (counts), failure classes, per estate |
| Inference | `/operations/inference` | 434's panel |
| **Chain** | `/operations/chain` | §6 |
| Applications | `/operations/apps` | the listed applications (Game Night, Gather27, the Explorer…) with their probes and their usage of the gateways under their own tokens and app keys |
| **Infra** | `/operations/infra` | spec 437: the platforms the town runs on — status, cost (derived / billed, labelled), storage, deploys, the Unattributed bucket |
| **Performance** | `/operations/performance` | spec 437: infrastructure latency over provenance latency, per estate; cost per completed run |

Admin lenses: `/admin/inference` (434 §11), `/admin/chain` (§6.3), `/estate/:id/admin` (435 §6, the steward's view of
an estate from the town side — a lens on the estate console, never a second console).

### 5.5 The Town Ask — context agents whose vaults are the record (added 2026-10-10)

**The observation (owner):** "include an ask feature in town to retrieve any information about performance, spend,
status … create faith-town and faith-estate workspace agents custodied by demo admin, with A2A agents on the
workspace-agent harness and vaults that hold information about the estate and town; then the ask can get past data
stored in those vaults, and skills in the harness support estate and town questions."

This closes the one gap §5.3 left open: the Pulse's history lives in `HeartbeatDO`, a serving plane. The record of
how a town or an estate has been doing belongs where every other record lives — in a vault, owned by an agent, read
by grant or by its public lane, written through the owner's agent (the vault-is-the-record rule). So each context
gets an agent:

| Context agent | Typed name | Custodian | Holds (vault) | Answers |
| --- | --- | --- | --- | --- |
| the town's | `faith-town.workspace` | demo-admin (the persona that custodies the registry's unclaimed domains) | `pulse.day:<date>` (the day's rollup: services up/down, chain summary, inference summary, every estate's heartbeat), `pulse.sample:<at>` (optional, the raw five-minute sample, 30 days), `town.manifest:<digest>` (the manifest as deployed), `chain.policy-change:` / `inference.policy-change:` mirrors by reference | "how is the town doing today / this week", "what did inference cost this month", "which services were down yesterday", "when did the block rate last drop" |
| the estate's | `faith-estate.workspace` | demo-admin | `pulse.day:<date>` for the estate (its heartbeat series: agents, homes, runs, spend, latency), `estate.manifest:<digest>` (the manifest export of 435 §6), `estate.checklist:<date>` (the standing checklist across residents, counts) | "how many runs failed this week and why", "how many people joined this month", "what is parked for signature right now", "is any resident missing a birthright" |

Both are **workspace agents** (`.workspace`: the coordinator SA of a context, spec 344 / ADR-0061) chartered under
demo-admin's organization at the faithnet Home, because a town context agent is still a resident of some estate — the
town holds no vault and no key (C6), so its memory is kept by an agent that lives in an estate, under a custodian the
town's steward controls. A second estate charters its own `<estate>.workspace`; the town's stays one.

**The sampler writes the record, not only the cache.** The five-minute cron (434 §10.3) keeps filling `HeartbeatDO`
for the live tabs; once a day (and on demand) it ALSO writes `pulse.day:<date>` into `faith-town.workspace`'s vault —
and the estate's slice into `faith-estate.workspace`'s — through the vault's native door as the agent itself, under a
scoped grant and a DEL-001 leaf to the town-agent Worker's own key (the shape `inference.svc` writes its receipts
with). A wiped `HeartbeatDO` is then a rebuild from the vault; the vault is the record.

**The skills are the questions.** A `town-steward` archetype (skills registry, `agentic-trust` context) carries
`town.pulse.read` ("how is the town doing", over `pulse.day:*`), `town.spend.read` ("what did inference / chain cost",
over the inference and chain summaries inside the rollups), `town.status.read` ("which services were down when"),
`town.estates.read` ("how is each estate doing"); an `estate-steward` archetype carries `estate.pulse.read`,
`estate.runs.read`, `estate.residents.read` (counts and the checklist). Every skill is a READ over the agent's own
vault records, compiled into the harness the usual way (spec 354) and answered by the vault-question machinery
(spec 356): a question compiles to a selector over `pulse.day:*` evaluated in the store, never a decrypted copy in an
engine. The record keys are bound to T-box classes (`apinf:EstateHeartbeat` for the estate's rollup; a `apinf:TownPulse`
for the town's — added with the keys) so the Ask knows what a `pulse.day` IS.

**The Ask door.** The portal's Pulse gains an Ask box. A visitor's question goes to `faith-town.workspace`'s A2A door
(hosted by the estate runtime, like every workspace agent) as a stranger: the standard surface answers from the agent's
public lane — the town's rollups are public by construction (the same numbers the Pulse draws) — on the
`subject-answer` artifact, with the records it read cited. A steward signed in through Home asks the same agent under
their standing and reaches the private legs too (the estate's checklist with names stays at the estate's agent, read
by its steward). The town agent's own A2A skills (`town.describe`, `town.service`) stay as they are; the new questions
are the workspace agent's, because they are answered from records, not probes.

**Waves (T1–T4, after the Pulse's W5):** T1 charter the two workspace agents under demo-admin (ap-home PR #34's
persona, deployed) with all four birthrights; T2 the sampler's daily vault write (grant + leaf ceremony, the record
bindings in Ring 0's `vault-records.ts`); T3 the `town-steward` / `estate-steward` archetypes and skills published
and assigned; T4 the Ask box on the Pulse, the public lane answering, the steward's signed-in path.

### 5.4 Federation (later, named)

A map of towns; standing proven across a boundary; nothing else until `ap-federation` exists.

---

## 6. The chain gateway in the Pulse (C8)

`apps/chain-gateway` is the town's other metered service: token auth → method allow-list → gas-cap injection → per-app
rate limit (reads and writes separately, a `RateLimiter` Durable Object) → a read cache with per-method TTLs → the
chain's own node. Every call already passes through a point that knows the app, the method, the kind (read/write), the
outcome and the cost in time. Nothing records it. This section gives it the same shape as the model gateway.

### 6.1 The token record gains an estate

`TOKENS` rows (`t:<sha256(token)>` → `{ app, readRps, writeRps }`) gain `estate` and `kind` (`estate-app` | `town-service`
| `application`) so usage attributes to the context that made the call. Issuing a token is a steward act recorded as
`chain.token:<id>` in the chain gateway's own vault (the service's record, like 434's `inference.client:`), the KV row
its cache.

### 6.2 `ChainGatewayOpsSummaryV1` and `GET /ops/summary`

Rollups in the `RateLimiter` DO's SQL (it already sees every take), or a sibling `ChainOpsDO`, rebuildable from the
per-minute counters it keeps; served at `GET /ops/summary?window=24h|7d|30d&estate=&app=` under the town ops token or a
steward session. The type lives in `packages/town-model` (only the town reads it).

```ts
interface ChainGatewayOpsSummaryV1 {
  window: { from: string; to: string };
  totals: { requests: number; reads: number; writes: number; denied: { rateLimited: number; disallowedMethod: number; badToken: number };
            cacheHits: number; cacheMisses: number; upstreamErrors: number; gasCapInjected: number };
  latency: { upstreamP50Ms: number; upstreamP95Ms: number; servedP95Ms: number };
  byToken: Array<{ app: string; estate?: string; kind: string; requests: number; reads: number; writes: number; denied: number; p95Ms: number;
                   limits: { readRps: number; writeRps: number }; utilisation: { read: number; write: number } }>;
  byMethod: Array<{ method: string; count: number; cacheHitRate: number; p95Ms: number }>;   // top N
  chain: { head: number; blockRateS: number; generation: string; nodeHealthy: boolean };
}
```

### 6.3 The panels and the lens

**Pulse → Chain:** requests over time (reads vs writes), denials by reason, cache hit rate, upstream latency and errors,
block head and rate; **by estate** and **by application** (the token's `estate` / `kind`), each with rate-limit
utilisation drawn against its limit; top methods. **Estate console → Usage** shows the same for that estate's tokens.
**`/admin/chain`** (town steward): tokens with their limits and utilisation, issue / rotate / revoke as acts with a
`chain.policy-change:` record, the method allow-list and gas cap in force with their change log, the node's health.

### 6.4 Gates (folded into 434's W5/W6)

The `RateLimiter` DO keeps per-minute counters; a wiped DO loses history, never a token (the token records are the
gateway's vault); `GET /ops/summary` answers for the faithnet estate's tokens; the Chain tab draws 30 days; a revoked
token's next call is denied and its row shows it.

---

## 7. How this changes the two companion specs

- **434:** the Pulse gains the Chain and Applications tabs (§5.3) and the per-estate slice on every gateway summary
  (`?estate=`); the inference client record gains `estate` and `kind` like the chain token; `EstateHeartbeatV1` is one of
  the estate console's sources, not only the town's.
- **435:** the estate picture is the public face of §5.2's Residents column; the admin lens at the town is a lens on
  the estate console, and the estate manifest export is produced by the console.
- **ap-home:** `/estate` becomes the operator's console (§5.2); a wave of its own (E1 residents + checklist · E2
  capability coverage · E3 data health · E4 usage from the two gateways · E5 the management acts), gated like the
  others: every number has a source endpoint named, every act parks like any other.

---

## 8. Hosts and zones: telling the town from the estate (added 2026-10-10)

**The observation (owner):** "our current faithnet.me / faithnet.ai / faithnet.io hosts blend estate and town. It
really focuses on estate, but the graph, faithchain, the KMS and naming also use faithnet." True, and it is the one
place the four contexts are not yet legible. Today, by what each host actually serves:

| Host | Serves | Context | Where it should sit |
| --- | --- | --- | --- |
| `www.faithnet.me`, `faithnet.me` | the Home | estate | estate zone |
| `*.faithnet.ai` | every resident's A2A endpoint (the agent zone) | estate | estate zone |
| `edge.faithnet.io`, `a2a.faithnet.io`, `mcp.faithnet.io`, `home-mcp.faithnet.io` | edge, runtime, vault MCP, Home MCP | estate | estate zone |
| `<label>.faithnet.io` (alice, bob, accelerate-team, …), `scripture.faithnet.io`, `explorer.faithnet.io`, `field-a2a.faithnet.io` | per-agent hosts from before the agent zone; self-hosted services; applications | estate / application | estate zone (agents), the application's own zone (apps) |
| `names.faithnet.io` | the town's naming service | **town** | town zone |
| `town.faithnet.io` | the portal and the town agent | **town** | town zone |
| `discovery.faithnet.io`, `discovery-a2a.faithnet.io`, `discovery-connector.faithnet.io` | the registry, the graph, discovery | **town** | town zone |
| `rpc.faithnet.io` → `faithchain-rpc.agentkg.io` | the chain gateway → the node | **town** (the node: the chain's operator) | town zone (node: the chain's zone) |
| `skills.faithnet.io` | the skills registry | **town** | town zone |
| `akcs-pilot.faithnet.io` | the KMS (one tenant per estate) | **town** | town zone |
| `inference.faithnet.io` (434, planned) | the model gateway | **town** | town zone — provision it there from day one |
| `graphdb.agentkg.io` | the graph store behind discovery | town (infrastructure) | the chain operator's zone, as now |
| `gamenight.faithnet.io`, `games.`, `agents.`, `poker.` | applications | application | the application's own zone |

**The rule.** A zone names the context that operates what it serves. The **estate** is a brand (`faithnet`), so its
Home, its agents and its buildings carry it: `www.<estate>.me` (Home), `*.<estate>.ai` (agents), `<building>.<estate>.io`
(edge, runtime, vault, Home MCP). The **town** is a chain, so its services carry the chain's name, not any estate's:
`names.`, `town.`, `discovery.`, `rpc.`, `skills.`, `kms.`, `inference.` under a zone named for `faithchain`. An
**application** carries its own. A second estate on faithchain then reads as `www.<theirs>.me` beside the same
`names.<faithchain zone>` — and nobody has to be told which is which.

**The move, under 429 D5 (no Worker renames, ever).** Hostnames are aliases on Workers that keep their names:

1. Acquire a zone for the town (named for the chain) and a CNAME-free custom domain per town service on it; the
   manifest's `hosts:` lists both the new host and the `faithnet.io` one.
2. Move references repo by repo — ap-home's `DEMO_EDGE_URL`-class vars, `town.yaml` probes, the skills service's
   `A2A_BASE`, the indexer's crawl list, the Home's `SKILLS_REGISTRY_ORIGIN`, cards and `atl:` records that name a town
   host (the registry's own card, `discovery.registry`) — each a PR with the old host still answering.
3. When `pnpm check:town` finds no reference to the old town host outside the manifest, the `faithnet.io` town hosts
   become redirects for pages and stay as aliases for APIs for a year; then they leave the manifest.
4. The node and the graph store stay where the chain's operator runs them (`agentkg.io`); the gateway in front of them
   is what estates and applications are given.

Nothing in this is a cut-over: every step is additive, and a reference that is missed keeps working on the old host.

## 9. The second estate (added 2026-10-10)

"Another estate … where they want to manage identity and estate-oriented custody, authority and storage." Exactly what
an estate is for, and the split between what the new estate BRINGS and what it SHARES is the test that §1's table is
right:

| | The second estate brings (its own) | It shares with the town (the chain's) |
| --- | --- | --- |
| **Identity** | its Home (the app, its OIDC issuer, its session cookie, its deployment epoch); its brand zones (`<theirs>.me`, `<theirs>.ai`, `<theirs>.io`); its roster | the chain's `AgentAccountFactory` (every resident is a Smart Agent on the same chain); the naming registry and its roots (a name is unique chain-wide; the estate's `nameRoots` say which roots it serves) |
| **Custody** | its residents' custody ceremonies at ITS Home (passkeys, SIWE, hardware, trustees, recovery); its KMS tenant (`kms: { tenant: <theirs> }`) for the delegate keys its services sign with | the `CustodyPolicy` module code and the validator on chain; the KMS service itself |
| **Authority** | every delegation its residents issue (session wires, mandates, grants) — minted at its Home, verified by its edge and runtime | the `DelegationManager` and the enforcers on chain (the same contracts verify every estate's wires); revocation is chain state |
| **Storage** | its vault (its own D1, its own vault id, its own envelope keys under its KMS tenant); its runtime's Durable Objects; its KV | nothing — a town holds no record (C6) |
| **Capability** | its default playbooks per agent type, its hosted services, its estate MCPs | the skills registry (it publishes there under its domain organization), the model gateway (its own app keys), the chain gateway (its own tokens) |
| **Public face** | its released cards, its attestations, its `TownStanding`s (435) | the registry, the graph, discovery, the portal's district for it |
| **Accounts** | its Cloudflare account(s) and Vercel project; Worker names of its own (`<app>-<estate>`, never reusing faithnet's); secrets | the town's accounts for the town's Workers |

What the operating entity does is §3's recipe. What the town does for it: a row in `estates:` (home, edge, a2a, agent
zone, name roots, lanes, KMS tenant), the indexer crawling its roots, a district on the map, tokens at the two gateways,
a heartbeat token so its counts reach the Pulse. What the town must NOT be asked for: a key, a vault, a delegation, a
session — if a step in standing up the estate needs one of those from the town, the step is wrong (429 D2).

**The checks that keep it honest** (ap-town `pnpm check`): `check:no-estate-binding` — a town Worker binds only town
Workers or a lane the manifest declares, so the second estate is a manifest edit; `check:town-manifest` — hosts do not
collide, every estate has its own agent zone and KMS tenant; and, new with this spec, `check:zone-context` — a town
service's host is under the town zone and an estate's buildings under its own, with the migration allow-list of §8
step 3 until it empties.

## 10. Not in v1 (named)

Multi-estate towns with more than one live estate (the design is ready; faithnet is one card; §9 is the checklist for
the second) · the town zone move of §8 as a scheduled program (named here, run as its own PRs) · the federation view ·
an estate switching towns · a resident's view of their own gateway usage inside their Home (counts are the estate's;
a person's own receipts are already in their provenance) · alerting on any panel.

---

## Reference: smart-agent patterns to port

- **Per-app tokens with separate read and write budgets** is already the chain gateway's shape, ported from smart-agent's
  `RateLimit` caveat defaults (`windowSeconds`, `maxCalls`) and the session `scope` lists; this spec adds the attribution
  (`estate`, `kind`) and the rollup, not a new control.
- **The operating entity as an organization that charters, never custodies** — smart-agent's org accounts deploy and
  fund agents without holding the agents' keys; the estate operator is the same role at deployment scale.
- **Deliberate divergence:** smart-agent has one deployment and one tenant model; the four contexts here exist because
  the owner's product is many estates on one chain and many towns on many chains, with records that stay with their
  owner at every scale.
