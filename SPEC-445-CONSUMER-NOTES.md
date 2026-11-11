# Spec 445 consumer notes — ap-town

Branch `spec-445-ring0-hardening` (worktree `/home/barb/ap-town-spec445`, from `master` 768c33b). Nothing is
committed, pushed or deployed. Source of the changes: the primitives monorepo, branch `spec-445-w0-hardening`.

## 1. Result

**No source change is needed in ap-town for the changes in the brief.** One runbook was edited.

Grepped the worktree (`*.ts`, `*.mts`, `*.mjs`, `*.tsx`, `*.js`, excluding `node_modules`) for:
`commitmentOf`, `verifyAuthorityPresentation`, `makeAuthorityPresentation`, `foreignEstateEvaluator`,
`createPresentationRelease`, `delegationMandateVerifier`, `verifyAuthorityChain`, `assembleAuthorityChain`,
`createX402Rail`, `x402`, `delegationRef`, `withStandardCardFields`, `pushNotifications`, `AcpHost`,
`runtime-member`, `resolveParty`, `check-production-deploy`, `verify-governance-shape`, `createAdmissionEngine`,
`ProofRequestV1`, `estate-projection`.

Hits:

| Call site | Verdict |
| --- | --- |
| `apps/town-agent/worker/index.ts:132` — `capabilities: { streaming: false, pushNotifications: false }` | No change. Neither Worker opts in to push, and after the bump `createStandardA2aServer` no longer delivers push unless the host opts in, so the declared `false` is what is served. |
| `apps/registry/src/index.ts:257` — same | No change, same reason. |
| `apps/discovery-indexer/test/shelf.test.ts:26-73` — `commitmentOf` | A local test option name, unrelated to estate-projection. |

ap-town does not depend on `estate-projection`, `admission`, `payments`, `acp`, `fabric` or `runtime-member`.
It uses `a2a` (`createStandardA2aServer`, `createStandardA2aClient`, `resolveAgentCard`, caller-assertion helpers,
`parseSessionWrappedSignature`, `verifySessionLeafSignatureAt`, `wrapSessionSignature`, `skillSelector`),
`delegation` (`hashDelegation`, `mintDelegationToken`, `buildInvocationProof`, caveat builders) and
`harness/heartbeat` — none of whose signatures changed for these call sites.

## 2. Runbooks

Read `operations/runbooks/new-town.md`, `publish-an-estate.md`, `second-town.md`, `431-priced-names-cutover.md`.

- None describes projecting an estate or presenting across estates (that runbook is ap-federation's
  `docs/runbooks/project-an-estate.md`, updated there). No v2 re-anchor step was added here.
- None tells an operator to pause. `new-town.md` §2 "Hand over governance" is where the guardian and the timelock
  roles are assigned, which is where audit H-3 is decided, so a short paragraph was added there: on the current
  contract generation a pause cannot be lifted when the timelock's only proposers or executors are accounts of the
  paused factory; pointer to `docs/operators/runbooks/pause-and-unpause.md` in the source monorepo (a path in
  backticks, as the neighbouring reference is — that repository is private, so no link). `check:public-links`
  passes.

## 3. Verification

- Baseline at the current pins: `pnpm -r typecheck` and `pnpm -r test` pass.
- Under a temporary root override linking `a2a`, `delegation` and `harness` to the local packages (their `dist/`
  as built at 13:26 on 2026-11-10): `pnpm -r typecheck` passes; `pnpm -r test` passes (all 11 test workspaces).
- Override removed, `package.json` restored with `git checkout`. `pnpm-lock.yaml` is gitignored here and did not
  exist before; the one the installs produced was deleted. `node_modules` reinstalled at the pinned versions.

## 4. Pins

Nothing must bump for spec 445 §3.8 or §3.2 — ap-town calls none of it. To pick up the a2a behaviour changes
(push delivery off unless opted in, H-11) the pins that move are:

| Package | Current pin | Where |
| --- | --- | --- |
| `@agenticprimitives/a2a` | `0.0.0-alpha.33` | root + 4 apps |
| `@agenticprimitives/delegation` | `1.0.0-alpha.36` | 4 places |
| `@agenticprimitives/harness` | `0.0.0-alpha.13` | `apps/town-agent` |

These pins are many releases behind the branch (a2a `.47`, delegation `1.0.0-alpha.45`, harness `.29` locally);
the override run above is the evidence that the jump typechecks and tests green.

## 5. Arrived during this work — reported, not verified

**a2a RUN-9 — a session wire must name its target.** This landed in the primitives working tree after the
packages were built and is not in the build that was linked. A receiving host now refuses a session wire that
carries no `allowedTargets` caveat naming that host's own agent.

- `scripts/mint-gateway-wire.mts:37-40` mints the discovery gateway's session wire with a timestamp caveat and an
  allowed-methods caveat only — **no `allowedTargets`**. Once the agents the gateway calls are on the new a2a, they
  will refuse this wire.
- The gateway calls many agents (each publisher's A2A agent) with one wire. A wire that must name its target is
  either one wire listing every receiving agent, or one wire per receiving agent. That is a design decision, not
  made here.
- `apps/discovery-indexer/src/shelf.ts:157` (`verifySessionLeafSignatureAt`, a signed artifact rather than a
  message at a host) keeps its signature and needs no target.

## 6. Open questions for the owner

1. The gateway's session wire under RUN-9 (above): one wire with every target, or a wire per target.
2. `new-town.md` §2 now states the H-3 constraint. The live towns' manifests do not yet record who holds the
   timelock's proposer and executor roles, or whether the pre-flight passes on faithchain and hopenet. Until that
   is written down, neither town should be paused.

---

# Second pass — 2026-11-10 (afternoon)

Built on the first pass above; nothing in it was reverted. Nothing committed, pushed or deployed; no live gate
run; no `.env` secret read.

## A. `.impact` name root retired

| Where | Change |
| --- | --- |
| `towns/faithchain/town.yaml:63` | `nameRoots`: `impact` removed |
| `towns/base-sepolia/town.yaml:17` | `nameRoots: [impact, agent]` → `[agent]` (line 12, `id: impact`, is the ESTATE id — kept) |
| `packages/town-model/src/towns.generated.ts`, `apps/discovery-indexer/wrangler.toml:75` | regenerated by `pnpm gen:town` |
| `apps/discovery-indexer/src/main.ts:4`, `:49` | CLI default `TLDS` `impact,agent` → `agent` |
| `apps/discovery-indexer/.env.example:2` | `TLDS=impact,agent` → `TLDS=agent` |
| `apps/discovery-indexer/package.json:14` (`index:faithnet`) | `TLDS=impact` → the nine typed roots |
| `apps/discovery-indexer/test/description-tiers.test.ts:44` | fixture `someone.impact` → `someone.me` |
| `apps/discovery-indexer/wrangler.toml:44`, `:70-74`; `README.md:30`; `src/projectors.ts:71` | comments |
| `apps/discovery-mcp/src/index.ts:186` | tool description example `lbsb.impact` → `lbsb.svc` |
| `apps/naming/worker/views.ts:142`, `apps/naming/src/pages/Home.tsx:13` | comments |

**Why the config change is not optional:** the indexer walks `namehash(tld)` for each root in `TLDS`, in sequence.
With the new `agent-naming`, `namehash('impact')` throws `InvalidNameError (unknown_tld)`, so one retired root in
the list aborts the cron's whole walk.

Left in place: `specs/430`, `specs/431` (specs, by the same rule as the monorepo); `.cursor/rules/
service-agent-signing.mdc` (a projection of the pinned devkit rule — a hand edit makes `ap doctor --rules` report
drift; it changes with the devkit pin and `ap doctor --rules --write`); `apps/naming/worker/chain.ts:44,56`
(`permissionlessSubregistry`, the deployment key that is the `.impact` subregistry's address — follows the
contract-manifest decision, not this one).

**Behaviour to know:** `apps/naming` says "a legacy NAME still answers on its own page, because it resolves".
After the pin bump a `.impact` name does not parse, so its page will not resolve it. Not changed; not verified
against a live name.

## B. `npx ap`

`.mcp.json` and `.cursor/mcp.json` are the template's: `node node_modules/@agenticprimitives/devkit/bin/ap.mjs
mcp --root .` (the pinned devkit `0.0.0-alpha.18` has `bin/ap.mjs`). No doc or script said `npx ap`.
`agentic.lock.json` has no `definitions` pins; if one is added the owner pins the committed snapshot with
`pnpm exec ap upgrade --pin-definitions <registry> <key>`.

## E. The gateway's session wire (RUN-9) — one wire per target

| Where | Change |
| --- | --- |
| `scripts/mint-gateway-wire.mts` | `--target 0x<receiving agent> [--days 365]` (the positional `days` is gone). Adds the `allowedTargets` caveat naming that one agent (faithchain enforcer `0x2156…5715`, from Ring 0's manifest), runs `checkSessionWireShape` with that target before writing, and writes `GATEWAY_SESSION_WIRE_<40 hex>` + `GATEWAY_WIRE_REF_<40 hex>`. It leaves the old `GATEWAY_SESSION_WIRE` / `GATEWAY_WIRE_REF` lines alone. |
| `apps/discovery-connector/src/gateway/tools.ts:24`, `:63`, `:120/143/175` | `identityFor(env, handle)` picks the wire for the handle's `anchor` (the registry's `ap:canonicalAgentId`). No wire for that agent, or no address for it, is a refusal that names the agent and the secret. The untargeted `GATEWAY_SESSION_WIRE` is never read. |
| `apps/discovery-connector/test/gateway.test.ts` | Fixture moved to the per-target secret; +1 test: no wire for this target, another target's wire, and the retired wire each refuse, and nothing is sent. |
| `apps/discovery-connector/wrangler.toml:31-35` | Comment. |

**The choice made (the owner has not decided): one wire per target.** A wire stolen from the Worker works at one
agent, and revoking one leaves the rest. **The alternative:** one wire whose `allowedTargets` lists every
receiving agent — one secret and one ceremony, but every new publisher means re-minting and redeploying the same
wire, a stolen wire works everywhere the gateway may call, and the list of every agent the gateway talks to rides
in each request. **A limit of the choice made:** one Worker secret per target; Cloudflare caps variables and
secrets per Worker (64 on the free plan, 128 paid). Past that the wires belong in a store the Worker reads by
target.

**Wires to mint:** one per agent the gateway calls. The repository does not list them — targets come from the
registry at run time. The test fixture and the flow doc name `ligonier.svc`; the owner knows the rest.

`apps/discovery-indexer/src/shelf.ts:157` (`verifySessionLeafSignatureAt`) is unchanged, as the first pass said.

## G. Other changed APIs, grepped

`apps/naming/src/session.ts:114` calls connect-client's `verifyIdToken` on an id_token — the right function.
No use of `verifyAgentSession`, `verifyCredential`, `verifyVerificationReceipt`, `verifyAuditChain`, `recordOf`,
`createX402Rail`, payment mandates, `fetchProfile`, `withStandardCardFields`, `createServiceHost` / `runTurn`,
`AcpHost`, `ap runtime serve`, `hashA2aMessage`, `verifyPublication`, or registry-kit admission.

## Config changes (before → after) — apply to the deployed Workers

| Where | Before | After |
| --- | --- | --- |
| `demo-discovery-indexer` env **faithnet**, var `TLDS` | `me,org,team,svc,workspace,treasury,registry,church,circle,impact` | `me,org,team,svc,workspace,treasury,registry,church,circle` |
| `demo-discovery-indexer` default env (Base Sepolia) | no `TLDS` var; the CLI default was `impact,agent` | CLI default `agent` |
| `towns/faithchain/town.yaml`, `towns/base-sepolia/town.yaml` | `nameRoots` included `impact` | removed |
| gateway Worker (`discovery-connector`, envs faithnet + richcanvas), secret | `GATEWAY_SESSION_WIRE` (one wire, no target) | `GATEWAY_SESSION_WIRE_<agent address, 40 hex, lower case>` — one per receiving agent; then revoke the old wire on chain (`GATEWAY_WIRE_REF`) and delete the old secret |
| `.mcp.json`, `.cursor/mcp.json` | `npx ap mcp --root .` | `node node_modules/@agenticprimitives/devkit/bin/ap.mjs mcp --root .` |

## Possible live `.impact` names (from the repository alone; no chain read)

- **faithchain:** the comment this pass replaced in `apps/discovery-indexer/wrangler.toml` said "36 of 45 indexed
  agents were on a root the cron never visited" and "Legacy `impact` stays — the agents still on it are not less
  real": at the time it was written, 9 of 45 indexed faithnet agents were named under `.impact`. With `impact`
  out of `TLDS` the cron no longer reaches an agent whose only name is there.
- **Base Sepolia:** `apps/discovery-indexer/README.md` recorded "16 `.impact` agents (incl. `lbsb`/`fbsb`)".
- `index:faithnet` walked `TLDS=impact` alone; the demo town's estate named under `[impact, agent]`.

## Verification (offline)

Under a temporary root override linking a2a, delegation, harness, agent-naming, registry-kit, key-custody,
connect-client, connect-auth, agent-profile, agent-account, audit, verifiable-credentials, capability-claims,
content-storage, content-primitives to the local packages (a2a, registry-kit, harness, verifiable-credentials
rebuilt 14:07–14:15):

- `pnpm -r typecheck`: all 13 workspaces pass. `pnpm -r test`: all pass — discovery-connector 14 (was 13),
  discovery-indexer 26, naming 19, town-agent 71, town-mcp 36, town-model 30, registry 25, discovery-mcp 26,
  chain-gateway 18, town-scene 5, inference 4.
- `scripts/mint-gateway-wire.mts` typechecks; its wire construction run offline with a throwaway key:
  `checkSessionWireShape` returns null at the wire's target, "minted for another target" at another agent, and
  "must carry an allowedTargets caveat" for the old shape.
- Override removed; `package.json` restored byte-identical; the lockfile the installs produced deleted (it is
  gitignored and did not exist). At the pins: typecheck, tests, `gen:town --check`, `check:town`, `ap doctor` and
  `ap doctor --rules` pass.

**Not verifiable offline:** the mint ceremony (signs through the Home); a receiving agent accepting the new wire;
the indexer's walk on a chain.

**Live checks to re-run after publish:** this repository has no `live-gates.json`. Run the outside-in trace
(`scripts/trace-ap-gateway.mts` in the monorepo) once a wire is minted for its target, and one indexer cron on
faithnet to see the walk complete.

## Pins to bump

| Package | Pin now | Branch | Why |
| --- | --- | --- | --- |
| `a2a` | `0.0.0-alpha.33` | `.47` | RUN-9 at receivers; the mint script's shape check |
| `agent-naming` | `1.0.0-alpha.36` | `1.0.0-alpha.45` | the retired root |
| `delegation` | `1.0.0-alpha.36` | `1.0.0-alpha.45` | with a2a |
| `devkit` | `0.0.0-alpha.18` | `.33` | the rule projection (`<name>.svc`) |
| `harness` | `.13` | `.29` | first pass |

The `TLDS` change and the per-target wires can ship before the pins move: both are valid on the current packages.

## Open questions (added to the first pass's two)

1. One wire per target (built) or one wire listing every target — replaces first-pass question 1.
2. Which agents does the gateway call today? Each needs a wire before its receiver moves to the new a2a.
3. The `.impact` agents on faithchain and Base Sepolia: renamed under typed roots already, or do they drop out
   of the knowledge base at the next full walk?

# Third pass — 2026-11-10 (naming commit-reveal, ARD ids, model clients, FedCM nonce)

Verified under a temporary root `pnpm.overrides` linking every built local package (`link:` to the monorepo's `packages/*`):
`pnpm -r typecheck` clean (13 workspaces), `pnpm -r test` all pass (discovery-connector 14, registry 25, inference 4,
town-agent 71, naming 19, others unchanged). Overrides removed, `package.json` restored byte-identical, the lockfile the
installs produced deleted (it is gitignored and did not exist before).

## Done

| Item | Change |
| --- | --- |
| Naming commit-reveal | `scripts/provision-naming-service.mts`: per agent, `commit` (with the type declaration) in one transaction, a wait of `SUBREGISTRY_MIN_COMMIT_AGE_SECONDS + 5` s, then the reveal + primary name + records in a second; `chainId` and a fresh `generateClaimSecret()` per claim. `packages/town-model/src/types.ts` comment: rows are `(estateId, signer)`, the estate declares its signer. |
| ARD ids (COR-4) | `apps/registry/test/ard-routes.test.ts`, `apps/discovery-connector/test/{connector,gateway}.test.ts`: identifiers are `urn:air:agenticprimitives.dev:sa:<sa>`, trust identity the SA address. Consumers re-index (the discovery-mcp row keys follow the identifier). |
| Model clients | `apps/inference/src/index.ts`: `createFetchAnthropicClient` / `createFetchOpenAiCompatClient` take `allowedProviders` from a new var `ALLOWED_PROVIDERS` (never defaulted; a provider not listed is not built) and the compat client its `provider` (`gemini` for Gemini's endpoint, else the host name). `/health` shows `allowedProviders`. |
| FedCM nonce | `apps/naming/src/session.ts`: the nonce `connectViaFedcm` returns is passed to `verifyIdToken`. |
| Placeholder delegate | `scripts/bind-context-agent-vaults.mts`: no `0x…01` fallback for `serverKey`; a server that names none is skipped and said. |
| Credential destination | `apps/town-agent/worker/index.ts` (context Ask): the relayed session rides as a header with `card: { url, pinned: false }`, so the client refuses to send it to an endpoint on another origin than the card's (RUNB-9). |

## Blocked / not done, with the reason

- **Card trust for routing by card (`relyOnCard` + `verifyCardSignature` + `resolveHost`)** — `town-agent/worker/index.ts` `publicRecordOf` and the context Ask resolve a card and route to the endpoint it names. Doing it by the book needs a `verifyCardSignature` port bound to the agent's ON-CHAIN card key and a pinned digest or a `resolveHost` (DNS-over-HTTPS on a Worker); Ring 0 ships `verifyA2ACardSignatures` and `verifySmartAgentCardBinding` but no resolver from an agent to its card key, and ap-town has no pinned-digest source. Turning `relyOnCard` on without a verifier would refuse every card and take the Ask down. Owner decision: where does the card key come from (an `atl:` record on the agent, or the signed release the town's own card already uses)?
- **Inference receipt `apix:attests`** — `InferenceReceipt` is now an `apix:ExecutionReceipt` and must name what it attests, but the Ring 0 vault-records binding for `inference.receipt:` maps no field to `apix:attests`, so a field added here would be unbound. Needs a Ring 0 binding (`attests: apix:attests`) first; then `vault-ledger.ts` writes the call it records.
- **Session assertion (`checkSessionRequest` + nonce claim)** — `credentialOf` forwards an `A2A-Session` assertion but `kvPrincipalResolver` returns null for any caller that is not an app key (class (b) is "declared by the contract and not served here yet"). Nothing to verify until that class is built; then it must use `checkSessionRequest` and claim the nonce in the BudgetDO.
- `.impact` renames of live names, as in the first pass (unchanged).

## Owner actions

1. **Var:** `ALLOWED_PROVIDERS = "anthropic,gemini"` added to `apps/inference/wrangler.toml` `[env.faithnet.vars]` (preserves today's two providers; confirm, or narrow it — live tests are Gemini only). No secret changed.
2. Re-run `provision-naming-service.mts` only for an agent not yet named (it is idempotent: an agent already presenting its name is skipped); it now waits ~15 s per agent.
3. Re-index discovery after the registry pin moves: ARD identifiers change for every agent.
4. Pins to bump: `a2a` `.47`, `agent-naming` `1.0.0-alpha.45`, `delegation` `.45`, `registry-kit`, `orchestration-anthropic`, `orchestration-openai-compat`, `model-gateway`, `connect-client`, `harness`, `devkit` — together; the code here needs the new APIs (`allowedProviders`, `chainId`/`secret`, `fedcm.nonce`).
5. Live checks after publish: the outside-in trace once a gateway wire is minted (first pass), one indexer cron on faithnet, and a `/v1/generate` against inference to see `allowedProviders` in `/health`.
