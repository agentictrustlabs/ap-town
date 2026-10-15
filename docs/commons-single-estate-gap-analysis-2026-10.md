# The commons are single-estate — gap analysis against spec 429 §5 (2026-10-11)

**Companion to** [spec 429 §5](../specs/429-ap-town-the-towns-repository.md) ("Cutting the wires from town to
estate") and [spec 436](../specs/436-home-estate-town-federation-the-four-contexts.md) (the four contexts).
**Method:** every claim below was read from the DEPLOYED service or the committed config on 2026-10-11, not from
a spec; each row says which. Occasioned by the first real test of §5 — impact-agent, the second estate on faithchain,
nine days old.

## 0. The verdict

Spec 429 §5 states the rule: *"A town service must not depend on any single estate, or the second estate would be
a second-class resident."* §5.1 records it as built for the two wires inside this repository — lanes generated,
the chain read through the town's gateway. It is enforced here by `check:no-estate-binding`.

**It is not enforced, and not held, in the commons deployed from other repositories.** `check:no-estate-binding`
and `gen:town` both walk `ROOT/apps` only, so a commons service in another repo is outside the only mechanism that
keeps the rule. §5's inventory asked the skills repo for two cuts ("a request from the town, not a move"); one
landed (the edge lane, 724242a), and the inventory itself missed the class that actually broke a person: the
**browser-facing and session-facing** configuration of a commons service. The skills commons is a faithnet
service in all but name, and the second estate met it as a second-class resident on the first day it tried.

## 1. What a person on the second estate saw

An Impact (impact-agent) person opened Settings → Behaviour → Playbook and was offered **one** archetype, Bookkeeper,
with "No archetype assigned — the agent runs the bare harness", and "Your roles could not be read just now".
Three links, none of them an error anybody could see:

1. The Home builds the archetype list from two sources (`ap-home/apps/home/src/lib/skills-registry.ts`): its
   app-config catalog, and the live skills registry read **in the browser**. The catalog
   (`archetype-catalog.ts`) holds five entries, of which exactly one — `bookkeeper` — lists `person` in
   `applicableAgentTypes`. Every other thing a person can be lives only in the registry.
2. `skills-a2a-production` echoed `access-control-allow-origin: https://www.faithnet.me` for faithnet's Home and
   **no ACAO header at all** for `https://imb-home.vercel.app` (curl, both origins, 2026-10-11). The browser
   dropped the response.
3. That read is deliberately fail-soft — "an unreachable registry leaves the app-config catalog standing" — so a
   blocked origin and an empty registry are the same outcome, and the page says nothing is wrong. The roles line
   is downstream of the same cause: roles are read by asking the person's own agent for `person.roles.list`, a
   tool the archetype supplies, and `person-steward` carries it (78 tools; definition validated 2026-10-11).

The registry had the answer the whole time: `agentic-trust` publishes 10 archetypes including `person-steward`
(kind `person`) and `person-steward-runtime`, `faith` 2, `gc` 1 (`gap-steward`, kind `person`).

## 2. The inventory — every single-estate binding in the commons

From the committed config and source of `agentictrustlabs/skills`, 2026-10-11. "Breaks" = what a second estate's
person meets.

| Where | Value | Breaks |
| --- | --- | --- |
| `skills-a2a` `[env.production.vars].ALLOWED_ORIGINS` | a hand-written list of five faithnet hosts | every browser read from another Home — §1. **Patched by hand 2026-10-11** (imb-home appended, deployed `49cf654c`); the next estate repeats it |
| `skills-a2a` `SESSION_ISS_DOMAIN` | `faithnet.me` — one domain, not a set | every session-gated route refuses another Home's id_token. Role packs and library writes, not just reads |
| `skills-a2a` `SESSION_AUDS` | `skills-app,skills-corpus,faithchain,faithsms` | an estate's own client ids are not audiences here |
| `skills-a2a` `HOME_URL` · `HOME_CHANNELS_URL` · `HOME_MANAGE_URL` | `https://www.faithnet.me…` | a write meant for the person's Home is aimed at faithnet's; `storage-off-reason.ts` defaults to it in code |
| `skills-a2a` `A2A_BASE_DOMAIN` | `faithnet.ai` | impact-agent has no `agentZone` at all (town.yaml), so any per-agent host derived from a zone is wrong, not merely different |
| `skills-a2a` `AKCS_TENANT_ID` | `faithnet` | a tenant is an estate boundary (ADR; impact-agent's is `imb`) |
| `skills-a2a` `LANE_ROUTES` | `demo-edge-faithnet…=LANE_FAITHNET_1` | copied from the manifest by hand and stale: impact-agent's two declared lanes are absent, so a zoneless estate's agents are unreachable from here |
| `skills-a2a` top-level `[vars].RPC_URL` | `https://a2a.faithnet.io/rpc` | the wire §5 asked to cut. Production overrides it with a SECRET and no var, so it is correct live — but one promoted line from reverting R1b |
| `skills-corpus` `SESSION_ISS_DOMAIN` | `faithnet.me` | same as above |
| `skills-corpus` `src/index.ts:85` | `ORIGIN='https://www.faithnet.me'`, with `CLIENT_ID` and `DELEGATE` beside it | an estate's Home origin and delegate in **code**, not config |
| `skill-web` `src/runner/links.ts:12`, `proposals.ts:7,10`, `api.ts:731`, `SkillAssessmentCard.tsx:17` | `HOME`, `EDGE_A2A`, `APP_ORIGIN`, `HOME_MESSAGES`, `CONNECT_ORIGIN`, `LAB` | every link out of the app goes to faithnet |
| `skill-web` Landing / IdentityChip / PackageComposer / RouteFrame | "Sign in with faithnet.me", "Manage on faithnet.me", `<label>.faithnet.me` | the estate is in the COPY; a second estate's person is told to sign in somewhere else |

**A secret shadowing a stale var is the sharp edge here.** It is how impact-agent's KMS backend reverted the same day
(`A2A_KMS_BACKEND` declared `local-aes` in the committed toml, adopted as `agentic-kms` live; the next deploy
re-asserted the file and every interactions call threw). `skills-a2a`'s `RPC_URL` is one line away from the same
failure. Whatever a service runs on must be *declared* where the deploy reads it.

## 3. What is already clean — so the work is not overstated

| Service | Why it is estate-agnostic |
| --- | --- |
| `naming`, `inference`, `town-agent` | CORS `*`; public reads; estates come from the manifest at request time (`estatesOf`) |
| `registry` (discovery-a2a) | `hono/cors()` default `*` |
| `chain-gateway` | reflects the request Origin; authorization is the `?k=` app token, never a cookie |
| `discovery-indexer` | lanes and crawl roots generated; its code names no estate (§5.1) |

The town's own services pass. Every failure is in a commons deployed from a repository this one cannot reach.

## 4. The decision: how estate facts reach a repo the town does not own

`gen:town` rewrites marked lines in `apps/*/wrangler.toml` **in this repository**. Three transports can carry the
same facts across a repo boundary; they differ in what happens when the fact changes.

| Transport | How a new estate lands | Cost | Verdict |
| --- | --- | --- | --- |
| **A. Runtime read** — the service fetches the town's estate list (`names.faithnet.io/api/health` already serves it keylessly) and allows those origins | automatically, at the next cache expiry | an allowlist that depends on a network read; a town outage narrows or widens trust depending on which way it fails, and ADR-0013 forbids the fallback that would paper over it | no — authorization-shaped config must not be a live fetch |
| **B. Published package** — `town-model` is published; each commons repo pins it and derives its origins at build time from the bundled manifest | a package release, then a redeploy per consumer | one release per manifest change; exact pins, which is the doctrine this estate already runs on | **yes** |
| **C. Generated into sibling repos** — `gen:town` writes marked lines into other repos' tomls | a `gen:town` run with every repo checked out | needs every consumer present to be correct; CI in one repo cannot verify another | no — the generator stops being runnable in CI |

Recommendation: **B**, with the manifest's derived facts exported as functions, not strings — the consumer asks
`estateOrigins(town)` and `issuerDomains(town)` rather than parsing a comma list whose format drifts. The existing
`towns.generated.ts` is already the artifact; it needs a publishable package boundary and nothing more.

## 5. What `gen:town` and `town-model` should emit

Pure derivations of the manifest, each one a function in `packages/town-model/src/generate.ts` beside `crawlRoots`
and `laneBindings`, each with the one-line reason it exists:

- `estateOrigins(town)` — every estate's `home` as an origin, in manifest order. The CORS allowlist of any commons
  that a Home's browser calls.
- `issuerDomains(town)` — the host of each estate's `home`. What `SESSION_ISS_DOMAIN` becomes once it is a set.
- `homeOf(town, estateId)` — the Home a write belongs to, so `HOME_CHANNELS_URL` stops being a constant and
  becomes a lookup on the estate the session came from.
- `agentZoneOf(town, estateId)` — `string | null`. **Null is the answer** for a zoneless estate, never faithnet's
  zone by default; a caller that needs a per-agent host must take the edge-by-name route instead.
- `lanesFor(town)` — already exists as `laneBindings`; the gap is only that a cross-repo consumer copies its
  output by hand.

For consumers in this repository nothing changes: the same markers (`# town:lanes`, `# town:roots`, `# town:agent`)
gain `# town:origins`, and `gen:town --check` keeps CI honest.

These are the facts a COMMONS needs in order to serve two estates, and they are not the whole of the estate row:
the signal that answers *"which estate is this name's?"* is being added to the same row separately, as the estate's
naming-gate address (in flight at the time of writing — the gate signs a priced registration, so the estate is
recoverable from the chain rather than asserted here). One manifest, two readers, no overlap.

## 6. The consumer work, staged by what it unblocks

1. **Public reads** (done by hand tonight; one line, no code). An estate's person sees the registry's archetypes.
   This is the whole of §1.
2. **Sessions.** `SESSION_ISS_DOMAIN` → the issuer set from `issuerDomains`; `SESSION_AUDS` → the union of the
   estates' client ids. Unblocks every session-gated route: role packs, library writes, the ceremonies.
3. **The Home per person.** `HOME_URL`/`HOME_CHANNELS_URL`/`HOME_MANAGE_URL` resolved from the estate the verified
   session names, with no default. A write for an Impact person lands in an Impact Home.
4. **Zone assumptions.** `A2A_BASE_DOMAIN` → `agentZoneOf`, and every derived-host path made to handle `null`.
5. **The copy.** `skill-web`'s links and strings take the signed-in person's Home rather than a constant; "Sign in
   with faithnet.me" becomes the brand of the Home that is signing them in (`ap-home` already does this —
   `NEXT_PUBLIC_BRAND_NAME`, defaulting to "Impact").

Stages 2–5 are a multi-estate refactor of the skills apps, not a config change. Sizing it honestly matters more
than starting it: today a commons service has one issuer, one Home and one zone baked through its session layer,
its writes and its words.

## 7. Keeping it cut

- `check:no-estate-binding` cannot see another repo. What CAN be checked from here is the **observable** claim: a
  probe that asks each listed commons host for `OPTIONS`/`GET` with each estate's Home as `Origin` and fails when
  one estate is answered and another is not. That belongs beside the Pulse's probes — a commons that answers only
  one estate is a town fact, and the Pulse is where town facts are said out loud.
- Each commons repo runs its own lint: no literal estate host in `src/`, no estate host in a `vars` block that the
  town model could derive. The town publishes the rule; the repo enforces it, the way `ap-home` projects Ring 0's
  rules and `ap doctor --rules` fails on drift.
- The fail-soft that hid this is itself a finding, and it is in `ap-home`: `skills-registry.ts` returns `[]` for
  both "could not read" and "nothing offered", and the page renders them identically. A read that failed should
  say so — the same correction as the 409 that rendered as "turn on storage" on 2026-10-11.

## 8. What changed tonight, and what it leaves

`skills-a2a` `[env.production.vars].ALLOWED_ORIGINS` gained `https://imb-home.vercel.app`, deployed as
`skills-a2a-production` version `49cf654c` (the repo tree was clean and the five commits undeployed since
2026-10-08 touch `apps/skill-web` only, so the deploy carried that line and no unreviewed code). Verified: the
header comes back for imb-home; `person-steward` resolves with `applicableAgentTypes: ["person"]` and
`person.roles.list` among its tools.

That is stage 1 of five, done the way §2 says the next estate will repeat — by hand. Stage 1 is also the only
stage a hand edit can finish.
