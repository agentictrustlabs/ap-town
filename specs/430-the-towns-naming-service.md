# Spec 430 — The town's naming service

**Status:** N1 + N2 live 2026-10-05 at `names.faithnet.io` (§7.1, §7.2). **Owner's brief (2026-10-05):** "The naming app should borrow a lot from ENS v2 with
regards to the UX and integration pieces. Look closely at what they do. There is a lot of power in our Agent Naming
Service and I want a robust UX. It might even borrow from our town 3D UX concepts with people and places (orgs,
workspace, services, …)."
**Builds on:** spec 429 §6.1 (the naming service is a town service that reads, and never holds a key that can claim),
ADR-0061 / spec 346 (typed naming), specs 215 / 220 / 222 / 280 (naming, bootstrap, reverse strings, connection
bootstrap), ADR-0056 / spec 338 (naming ≠ listing ≠ resolution ≠ inbound), ADR-0012 / ADR-0013 (no log scans in a read
path; one mechanism), ADR-0010 (the Smart Agent address is the identity; a name is a facet).

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| D1 | **One public app for names on the chain**: `apps/naming` at `names.faithnet.io`. Search, a page per name, a page per address, a page per root, and an integration guide. Everything it shows is read from the chain at request time; it stores nothing. |
| D2 | **It reads; the owner's Home writes.** A claim, a record change, a primary-name change and a renewal are signed by the owner's own account in their estate's Home. The naming app prepares the hand-off and never holds a key (429 D2). |
| D3 | **A name is a typed address card, not an asset.** No price, no rent, no market, no transfer-for-sale framing. The page never renders "owns the name" as "controls the agent", and it says in words that a name gives nobody authority. |
| D4 | **The suffix is the type, and the chain decides.** `.me` is a person, `.org` an organization, `.svc` a service. The agent's own on-chain type record is the authority; a name whose suffix disagrees is shown as **mismatched** and is not offered as that agent's name. There is no free suffix picker at claim: the suffix follows from what the agent is. |
| D5 | **Four separate signals on every name, never a score:** *named* · *typed* · *listed* (in the registry) · *reachable* (publishes an endpoint). A fifth line says what the town cannot answer: *authorized* is the caller's own delegation. |
| D6 | **People and places.** Names are drawn as a town: a street per root, a building per name, a shape per type (a house for a person, a hall for an organization, an office with a flag for a team, a workshop for a service, …), and an organization's scoped names (`vault.svc@richcanvas.org`) standing on its own lot. Same renderer as the town portal (`packages/town-scene`, lifted from the field town). The picture is navigation, never decoration: every building is a link. |
| D7 | **One display rule for every integrator**: show a name for an address only when the address's primary name resolves back to that address. The chain already enforces it in one view call (`reverseResolveString`); the app, the API and the kit all use that call and nothing else. |

---

## 1. What ENS v2 does, and what we take

State of ENS v2 on 2026-10-05, from primary sources: not on mainnet; Namechain (its L2) was cancelled and v2 deploys on
L1; the new Manager app and Explorer are in public beta on Sepolia since 2026-08-12 (source: `ensdomains/apps-monorepo`,
`docs.ens.domains/ensv2/*`, the ENS blog). The architecture moved from one registry to a registry per name, from
burn-once fuses to revocable roles (Enhanced Access Control), and to a resolver per account.

### 1.1 Borrowed

| ENS pattern | What it is there | Here |
| --- | --- | --- |
| **One search box, name or address** | Status chips: Available, Registered, Invalid, Not Supported, Too Short | The same box. Chips: *Available* · *Registered* · *Invalid* (with the rule broken) · *Reserved* · *Too short* · *Not a suffix in this town* · *Type mismatch*. A bare label (`alice`) is answered across every root, grouped by what each root names. |
| **Verified display** | "If forward and reverse do not match, display the address" | D7. One view call; the address page shows the mismatch and why. |
| **Who can do what, in words** | Every role has a plain sentence; a Can / Cannot list per name | A "Who can do what" tab generated from chain state (§3.3): the owner, the subregistry, the agent itself, and "nobody, through this name". |
| **Mismatch banners with the fix** | "You are the owner but not the manager" | "This name points at an agent that presents another name", "This agent has not declared the type its suffix names", "The label is claimed but the name is expired" — each with where the owner fixes it. |
| **"Your details are public"** | Confirmation before a record write | A standing line on every records view: everything here is public and readable by anyone. |
| **Honest freshness** | "Data may be out of date, last updated …" | Every page states the block it was read at. There is no index between the page and the chain, so it is exact. |
| **Everyday app vs explorer** | Manager for people, Explorer for power users | One app, two depths: the profile first, and a Details tab with the node, resolver, subregistry, expiry and raw records. |
| **Name page tabs** | Profile · Records · Ownership · Subnames · Permissions · More | Profile · Records · Who can do what · Names under it · Details. |
| **Address page** | Names held, primary, reverse | The agent's page: its presented name, every name it holds per root, its declared type. |
| **Decoded history per name** | Timeline of events | Wave N4, from the town's public graph (never a log scan in this app — ADR-0012). |
| **Integration rules** | "Treat any dotted string as a name; don't hardcode resolvers; don't cache token ids" | §6: the kit, the read API, the display rule, the DNS form. |
| **Expiry panel** | Registered · expires · parent expires | Shown only when a name has an expiry. A claim through a root's open subregistry never expires, and the page says so. |
| **Delegated subname issuing** | Per-name registries, registrar roles | We have it already as **subregistries** (a contract an owner hands child-issuing to) and **scoped names**. The app shows who issues under a name. |

### 1.2 Not copied, and why

| ENS | Why not here |
| --- | --- |
| Pricing, premium decay, commit–reveal, the 60-second wait | No market on this chain. A claim is one user operation. |
| Names as tradable tokens | A name is a facet of an agent (ADR-0010). Nothing here frames a name as property to sell. |
| A free choice of suffix | The suffix names the type (D4). Offering `.org` to a person would be offering a false statement. |
| "Fix primary name → point the address record at your wallet" | Here the target is the Smart Agent, never the credential that signs for it. Pointing a name at a passkey or an EOA would name a key, not an identity. |
| Resolver-wide roles and a "master key" resource | Our write rule is one sentence per contract (§3.3). We do not import an ambiguity we do not have. |
| Avatars, per-chain coin addresses | Not in the record set. The card (`cardUri`) and `nativeId` (CAIP-10) are what an agent publishes. |

---

## 2. What the naming service can already do (and the app must show)

From `@agenticprimitives/agent-naming` and the naming contracts (`AgentNameRegistry`, `AgentNameUniversalResolver`,
`AgentNameAttributeResolver`, `AgentProfileResolver`, `PermissionlessSubregistry`):

| Capability | Read / write | Who | In the app |
| --- | --- | --- | --- |
| Resolve a name to an agent | read | anyone | search, the name page |
| An agent's presented (primary) name, round-trip checked on chain | read | anyone | the address page, D7 |
| Records: address, display name, endpoints, card, native id, connection kind | read | anyone | Records tab |
| The agent's declared type and service role | read | anyone | the type check (D4) |
| Roots and what each names; names under a name | read | anyone | root pages, "Names under it", the town picture |
| Availability and the forced-unique label (`alice`, `alice2`, …) | read | anyone | search |
| Expiry and renewal | read / write | the owner | Details; renewal at the owner's Home |
| Claim under a root's open subregistry (one per agent per root, never released) | write | the agent | hand-off to the owner's Home (N2) |
| Set or clear the presented name | write | the agent, for itself | hand-off (N2) |
| Write records | write | the name's owner | hand-off (N2) |
| Hand child-issuing to a subregistry | write | the name's owner | shown now; managed in N3 |
| Scoped names in a context (`x.t@c.u`), contextual issuance | types only today | the context | N3 (needs Ring 0 work, §8) |
| DNS form (`label-type.zone`) | pure function | — | search accepts an agent's host; a name page shows the host its records publish |

**Not in the contracts, so not in the app:** fees, per-name roles or operators, releasing a claimed label, wildcard
resolution, avatars, nested contexts.

---

## 3. The app

### 3.1 Search

One box on every page. It accepts a name (`nathan.me`), a scoped name (`vault.svc@richcanvas.org`), a bare label
(`nathan`), an address, or an agent's DNS host. Answers:

- **A name** → its status chip, and the name page.
- **A bare label** → one row per root in this town: what the root names (a person, an organization, a service …), and
  whether `label.root` is registered or free. Free rows say who could claim it: "an organization's agent, from its
  Home". No row is a claim button for the visitor, because the app does not know what the visitor is.
- **An address** → the address page.
- **Not valid** → the rule broken, in words: characters allowed, length, a reserved word, a person label that reads as
  a type (`bob-svc.me`), a suffix this town does not have.

### 3.2 The name page

Header: the name, its type in words, the status chip, the agent's address, and the four signals (D5).

- **Profile.** Display name, what kind of agent, where its Home or endpoint is, its card. The lot in the town picture:
  its building, and any names standing on it.
- **Records.** Every record set, with the predicate, in a table. A standing line: public, readable by anyone.
- **Who can do what** (§3.3).
- **Names under it.** Children, each with its owner and type. For an organization, its type-nodes (`svc.`, `team.`)
  and the scoped names under them, shown in display form (`vault.svc@richcanvas.org`).
- **Details.** Node, parent, resolver, subregistry, registered / expiry, on-chain name, the host its records publish,
  the block read at.

Banners, when they apply: type mismatch · type undeclared · points at an agent presenting another name · expired ·
legacy root (never type-checked) · no address record (resolves to the owner).

### 3.3 Who can do what

Generated from what the contracts check, which is always the caller's address:

| Who | Can | Cannot |
| --- | --- | --- |
| **The name's owner** (an agent; its own custody policy stands behind every call) | change the records · change the resolver · hand child-issuing to a subregistry · register names under it · renew · transfer the name | declare another agent's type · make itself anyone's presented name |
| **The subregistry**, when one is set | register names under this name, by its own rule (a root's open subregistry: one claim per agent, three characters or more, never expires) | touch this name's records, owner or resolver |
| **The agent the name points at** | present this name as its own (and only if the name points back at it) · declare its own type | be given a type by anyone else |
| **The root's initializer** | create a root | — |
| **Anyone holding this name** | — | **act for the agent.** A name is an address card. Authority is a delegation the agent signs, checked on chain. |

### 3.4 The address page

The agent's presented name (verified), its declared type and service role, and every name it holds, root by root
(the open subregistry records one claim per agent per root). If it presents no name, the page says so and shows the
address; if it holds names it does not present, they are listed as held, not as "its name".

### 3.5 Root pages and the town of names

`/root/me`, `/root/org`, … : what the root names, who issues under it (its subregistry and the rule), how many names,
and the names, paged. Legacy roots (`impact`, `agent`) are labelled as untyped.

**The picture (D6).** The home page draws the town's roots as streets and squares; a root page draws its street; a
name page draws its lot.

| Type | Root | Drawn as |
| --- | --- | --- |
| person | `.me` | a house, a figure at the door |
| organization | `.org` | a hall with a dome |
| team | `.team` | an office flying a flag |
| church | `.church` | a hall with a spire |
| circle | `.circle` | a small round hall |
| household | `.household` | a wide house, two figures |
| service | `.svc` | a workshop with a slab roof |
| workspace | `.workspace` | a low studio, flat roof |
| treasury | `.treasury` | a vault: square, heavy, gold trim |
| registry | `.registry` | a tall narrow hall |
| legacy | `.impact`, `.agent` | a plain grey block |

Lit windows mean the name resolves and its type agrees; dark windows mean a banner applies. A scoped name stands on
its context's lot. Buildings are links, with a text list under the picture that carries the same information for a
reader who cannot use the picture.

### 3.6 Claiming and managing (the hand-off)

The app never asks a visitor to connect a wallet. "Claim" and every "change this" button name where it happens:
**at your Home**. With one estate in the town the link goes there (`<home>/naming`); with several, the visitor picks
their Home from the town's estates. N2 makes the hand-off carry the label and return to the name page afterwards.

---

## 4. The read API

Public, read-only, cached for seconds, `access-control-allow-origin: *`. Every answer carries `block` (the block read
at) and `town`.

| Route | Answers |
| --- | --- |
| `GET /api/town` | chain, estates (with each Home), roots: type, class, subregistry, name count |
| `GET /api/search?q=` | what `q` is (name · label · address · host · invalid) and the rows of §3.1 |
| `GET /api/name/<name>` | everything on the name page: status, agent, owner, records, type check, signals, children, details, banners, capabilities (§3.3) |
| `GET /api/address/<0x…>` | presented name (verified), declared type, names held per root |
| `GET /api/root/<tld>?page=` | the root and its names, paged |
| `GET /api/display/<0x…>` | **the display rule** in one call: `{ name \| null }` — the name to show for this address, or nothing |

Chain reads go through the town's gateway with this Worker's own read-only token (429 §5). Reads are `eth_call` only,
batched; there is no log scan anywhere (ADR-0012). A read that cannot be made is an error with its reason, never a
guess or a second path (ADR-0013).

## 5. Where it runs

`apps/naming`: a Worker (`faithchain-naming`, `names.faithnet.io`) that serves the API and the built app. Addresses
come from `@agenticprimitives/contracts/deployments/<chain.deployment>`; the roots, estates and Homes from the town
manifest. A second town on another chain is another `[env]` with another `TOWN`.

## 6. The integration kit

What a wallet, a Home or a relying app needs, in the order they need it (the "Integrate" page says the same):

1. **Show a name**: `GET /api/display/<address>` or `AgentNamingClient.reverseResolve(address)` — one view call,
   round-trip checked on chain. Show the address when it returns nothing. Never show a name you resolved forward only.
2. **Accept a name**: treat any dotted string, and `x@y`, as a possible name; parse with `parseAgentName`; resolve with
   `resolveTyped` so a mismatched suffix fails closed.
3. **Say what it is**: the suffix names the type only when `checkTypedName` agrees. Label by type, never by suffix
   alone.
4. **Reach it**: the name's records carry the endpoint and the card; the DNS form is `dnsHostForHandle`.
5. **Do not**: cache a resolution as if it were authority, treat a listing or a name as a permission, scan logs for
   names, or hardcode a resolver address (read it from the deployment).

N5 packages (1)–(3) as a small drop-in: an `<agent-name>` element and a name-or-address input.

## 7. Waves

| Wave | What | Done when |
| --- | --- | --- |
| **N1** | The read service and the app: search, name / address / root pages, who-can-do-what, the four signals, the town of names (`packages/town-scene` v0), the integration page, the hand-off link | Live at `names.faithnet.io`; a name, a bare label, an address and an invalid input each answer correctly against faithchain; `check:town` and conformance of the API tests green |
| **N2** | The hand-off carries intent: Home `/naming` accepts a label and a return address; "present this name", "change records", "renew" deep-link per action (ap-home PR) | A person claims `label.me` starting from the naming app and lands back on the name page |
| **N3** | Scoped names and contextual issuance: an organization's lot, issuing `x.t@c.u`, the subregistry manager | An organization issues and lists a scoped service name from its Home, visible here (needs §8) |
| **N4** | History per name and per agent, and expiry reminders, from the town's public graph | The name page shows registered / changed / presented events with their transactions |
| **N5** | The integration kit as a package and elements; ap-home and the portal adopt it | Home shows names through the kit, with no local display logic |

### 7.1 N1 as built (2026-10-05)

- `apps/naming`: Worker `faithchain-naming` at `names.faithnet.io` — the API of §4 and the app of §3. Reads go through
  the town's gateway with the app token `naming-faithnet` (an `RPC_URL` secret), forty calls to a request (the gateway
  refuses a batch over fifty). Answers are cached at the edge for 15–60 seconds; a public rate limit sits in front.
- The fourth signal, *listed*, is one question to the registry Worker over a service binding (`/agent?key=`). When the
  registry cannot be asked the signal says so; it is never guessed.
- `packages/town-scene` v0: the field town's projection, three-face buildings, roofs, windows, figures and labels,
  with the game taken out, plus the people-and-places shape table and a street layout. No camera yet (it fits the
  scene to its box); the camera and levels of detail come with the portal (429 R3).
- Faithchain today: 12 roots, 292 names. Verified live: a name (`nathan.me`: named, typed, listed, reachable), a bare
  label across every root, an agent's host, an address with a held-but-not-presented legacy name, a free name, a
  scoped name under an unregistered context, a legacy name, and four kinds of invalid input.
- Not in N1: a name's DNS form is read from its records rather than
  computed, because one estate zone hosts every type and the package's per-organization rule does not describe it.

### 7.2 N2 as built (2026-10-05)

The hand-off carries intent. "Open your Home" on a free name goes to `<home>/naming?claim=<label>&tld=<tld>&return=<this
page>`; on a registered name, `?name=<name>&return=…`; on a root page, `?tld=<tld>&return=…`. The Home (ap-home PR #7)
fills the label into its claim form (the nameless claim, or claim-and-present on `ChangeNameCard`), explains in a note
why the claim is signed there, and when it lands offers the way back to the name's page — the return address is
honoured only for the town's naming origin (`TOWN_NAMING_ORIGIN`). The same on a persona's naming page. Per-action deep
links (present this name, change records, renew) land on the naming page with the name named; the page's own cards
do the rest.

## 8. Ring 0 backlog this exposes

Found while mapping the surface; each is a package change in `agenticprimitives`, not app code here:

1. `client.registerSubname` with `initialRecords` writes records to the *universal* resolver, which has no setters.
2. No builders for `renew`, `unsetAttribute`, or the bool / uint / array setters.
3. No client method to transfer a name's owner (the builder exists).
4. Contextual issuance has types and checks but no writer (vault record + on-chain anchor).
5. `grammar.ts`'s header lists six suffixes; the constants have ten.
6. No batch read for a node list's labels (the app batches `label(node)` calls itself).
7. `AgentNamingClient` builds its own transport and cannot take one, so its reads cannot be batched or shared with
   a caller's client.
8. `dnsHostForHandle` gives an organization the zone apex; a shared estate zone (`<label>-org.<zone>`) needs
   `hostForName`, and nothing says which applies to a given deployment.

## Reference: smart-agent patterns to port

smart-agent (branch `003-intent-marketplace-proposal`) resolves `.agent` names inside its one web app, with name
management as settings screens beside the agent's other controls, and no public name explorer. Ported: the on-chain
round-trip check as the only display rule, and name writes as the agent's own custody-gated calls. Deliberately
different: a public, keyless naming service separate from every Home (so that names on the chain are legible to a
stranger and to a second estate equally), and typed suffixes with the chain's type record as the authority, which
smart-agent does not have.
