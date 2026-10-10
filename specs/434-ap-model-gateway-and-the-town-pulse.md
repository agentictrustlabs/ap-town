# Spec 434 — The AP Model Gateway (`inference.svc`) and the Town Pulse

**Status:** DRAFT 2026-10-10 (owner's brief: "put together a spec for the AP Model Gateway that will go into the ap-town
repository … ap-town expanded with a full dashboard … town.faithnet.io/operations has some of that capability — redesign
our whole town approach as needed"). **Owner:** ap-town (the deployed service, the portal) · Ring 0 (two packages, the
ontology terms, the record shapes). **Depends on:** 429 (the town: D1–D8), 388 (budget-routed model selection), 377
(a second model behind the same port), 350 (the harness), 389/390 (provenance, tracing), 406 (the operator view),
372 S3c (the session wire), 426 (executor invoke), 433 §1.1 (service agent birthrights), ADR-0013 (no silent
fallbacks), ADR-0021 (generic packages), ADR-0037/ADR-0063 (packages in Ring 0, Workers in product repos), ADR-0040,
ADR-0041, ADR-0055 (the vault is the record). **Frame:** [spec 436](436-home-estate-town-federation-the-four-contexts.md) (Home · Estate · Town · Federation — the
contexts the Pulse and every lens are built on; the chain gateway's metrics, §6 there). **Companion:** [spec 435](435-town-governance-plane-standing-estate-picture-mcp-catalog.md)
owns *who* and *what* (standing, the estate picture, the MCP catalog, the admin lens); this spec owns models and spend.
**Field comparison:** [docs/town-control-plane-gap-analysis-2026-10.md](../docs/town-control-plane-gap-analysis-2026-10.md)
(Prediction Guard, Microsoft Agent 365 / Entra Agent ID, Okta Agent Gateway, AWS AgentCore Gateway, Kong, Obot, LiteLLM,
Portkey, Cloudflare AI Gateway) — §15 below says what it changed here.

---

## 0. Decisions in one screen

| # | Decision |
| --- | --- |
| G1 | **One inference service for the town.** Every model call an estate or a town service makes goes through `inference.svc`, deployed from this repository as `apps/inference`, on `inference.faithnet.io`. Provider keys live on that Worker and nowhere else. |
| G2 | **One request contract, two doors.** `GenerateRequestV1 → GenerateResponseV1` is the only shape that reaches a provider adapter. A typed TS client (`@agenticprimitives/model-client`) and an OpenAI-compatible HTTP surface (`/v1/chat/completions`, `/v1/models`) both produce it. |
| G3 | **The gateway establishes the principal; a caller's `context.agent` is evidence.** Two caller classes in v1: an app credential → the app's own Service SA; a session-wrapped A2A signature (spec 372 S3c, `0x51`) → the wire's delegator SA. What a caller SAYS it is acting for is recorded as asserted and never used for authority or budget. |
| G4 | **A capability names a profile; a profile orders models; a model has one switch.** `plan`, `compose`, `answer-stream`, `judge`, `selection`, `author`, `evals`, `private-analysis` are profiles. The model catalog is the only place a model is turned on or off; a profile left with no enabled model fails closed. |
| G5 | **Fallback is declared and receipted, never silent.** Only within a profile's ordered list, only on the named failure classes (`rate-limited`, `unavailable`, `timeout`), never on content or policy errors, never widening privacy. Each attempt is its own receipt. Spec 388's "never fallback" becomes "never undeclared fallback". |
| G6 | **Budgets are reserved, then settled.** One `BudgetDO` per principal: `reserve` before dispatch, `settle` after, alarm-swept reconciliation. Receipts are the truth; the DO is rebuildable from them (ADR-0055). |
| G7 | **Receipts are vault records; prompts are not.** `InferenceReceiptV1` lands in `inference.svc`'s vault; its id rides back on `ModelCallV1.receiptRef` into `run.provenance:<runRef>`. No prompt or response text in the ledger by default. |
| G8 | **The town governs model access, never acts (429 D2 kept).** An entitlement says which profiles a principal may call and how much; it is the service's own policy over its own resource, like a priced name. It is not a delegation, holds no key for anyone, and signs nothing on anyone's behalf. Tool authority in the harness is untouched. |
| G9 | **The portal gets an operations center, not a sixth page.** `town.faithnet.io` is re-shaped around what an operator needs to know: **Town** (the map), **Find**, **Pulse** (the live and historical state of town · estates · homes · inference), **Admin** (steward-gated writes with receipts). Today's `/operations` becomes Pulse's first tab and keeps its URL. |
| G10 | **Heartbeats are aggregate, pulled and historical.** An estate reports counts over a token-gated endpoint; the town samples on a cron into `HeartbeatDO` and draws trends. The town never holds a person's data; per-agent drill-down is that agent's Home. |
| G11 | **Operator writes are steward acts with receipts.** The admin signs in through Home (`connect-client`, relying app `town-portal`); the inference Worker checks the signed-in SA is `inference.svc`'s steward by the stewardship record, never an env allowlist; every change writes a `PolicyChangeV1` record beside the new version. |

---

## 1. What exists today, and why it is not enough

Six provider-call shapes across the repositories, none of them accountable to anyone but the Worker that made them:

| Caller | How it calls | Captures |
| --- | --- | --- |
| ap-home `agent-runtime` (the harness) | Ring 0 adapters (`orchestration-anthropic`, `orchestration-openai-compat`) chosen by `llmAllowlist` / `routeProvider` (spec 388), five providers | tokens on `ModelCallV1`; no cost |
| ap-demos `demo-a2a` (frozen twin) | the same | the same |
| `skills-a2a` (`ask.ts callClaude`, `evals-ask.ts`) | raw `fetch` to Anthropic with its own `ANTHROPIC_API_KEY` | nothing |
| `demo-bible-a2a` (`ask.ts`) | `@anthropic-ai/sdk` with its own key | nothing |
| xAI web search, Workers AI Whisper, Workers AI embeddings (discovery, town) | direct | nothing |

Spec 388's budget route is app code in ap-home: `routeProvider`, `SpendWindow`, `ProviderMeterDO` — in-memory, tokens-per-
minute only, estimate-charge rather than reserve-then-reconcile, and invisible to every other caller. Nobody records
cost. No profile exists: every caller names a model. Turning a model off means editing five Workers' configuration.

Ring 0 already holds the right seams: the ports (`Planner`, `AnswerComposer`, `StructuredCallLike`, `TextStreamCall`,
`DecisionModelPort`, `LogprobChoiceLike` in `@agenticprimitives/orchestration`), the record (`ModelCallV1` +
`ModelUsageV1` + `addUsage` in `trace-facts.ts`), the fetch clients with SSE reassembly and `onUsage`
(`createFetchAnthropicClient`, `createFetchOpenAiCompatClient`), and the ontology term (`apexec:ModelInvocation` with
`modelId` / `modelProvider` in `tbox/execution.ttl`). What is missing is the service in front of the providers and the
record of what it did.

The town portal today (`apps/town-agent`, 318 lines of pages): Overview (the map), Find, a page per service and per
agent, and **Operations** — every listed service with its live probe, the chain's id and generation, the town agent, and
the rules the town keeps. It is a snapshot: `GET probe` per `town.yaml` service at request time, the hourly
`pnpm probe:town` printing to CI's stdout, no history, no estate-level numbers, no idea whether the Homes behind the
estate are busy, idle or failing. ap-home exposes `GET /health` and the session-gated `POST /harness/ops` (spec 406,
over `ops-index.ts`: runs by outcome, model calls, tokens, vault and DO calls, stages) — the estate already knows its
own pulse; nothing asks it.

---

## 2. The shape

```
callers                          Ring 0                              ap-town
──────────────────────────────   ────────────────────────────────   ───────────────────────────────────────────────
ap-home agent-runtime ───────►  @agenticprimitives/model-client ──►  apps/inference  (= inference.svc, inference.faithnet.io)
eval scripts, other frameworks   generate · stream · listProfiles      /v1/generate            the contract
                                 orchestration bridges                 /v1/chat/completions    OpenAI-compatible
skills-a2a ───────────────────►  (OpenAI-compatible HTTP) ─────────►   /v1/models              enabled catalog + profiles
demo-bible-a2a ───────────────►                                        /v1/ops/summary         rollups (town-token or steward)
                                                                       /v1/admin/*             steward writes (G11)
                                 @agenticprimitives/model-gateway ◄──  the handler the Worker mounts
                                 contract · profiles · policy          BudgetDO (per principal)  reserve → settle
                                 budget algebra · usage normalizer     KV: client hashes, profiles, catalog (cache)
                                 adapters: anthropic · openai-compat   vault of inference.svc: clients · profiles ·
                                 openai-compat translator              catalog · receipts · policy changes
                                                                              │
                                                                              ├──► Anthropic
                                                                              └──► Gemini (OpenAI-compatible endpoint)

apps/town-agent (town.faithnet.io)                                   ap-home runtime
  /pulse  ◄── HeartbeatDO (cron sampler, 30-day history) ◄── GET /ops/heartbeat (EstateHeartbeatV1, town-token gated)
  /admin/inference ──► inference.svc /v1/admin/* (steward session)   ◄── inference.svc GET /v1/ops/summary
```

**The internal contract.** Nothing else reaches an adapter.

```ts
interface GenerateRequestV1 {
  profile: string;                                  // 'planner-fast' … — never a model name (G4)
  messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string | ContentPart[]; toolCallId?: string }>;
  tools?: ToolDefinitionV1[];                       // JSON-Schema tools, provider-neutral
  maxOutputTokens?: number;                         // clamped to the profile's ceiling
  stream?: boolean;
  context: { purpose: string; runRef?: string; stepRef?: string; agent?: Address /* ASSERTED (G3) */ };
}
interface GenerateResponseV1 {
  content: string; toolCalls: ToolCallV1[]; stopReason: 'end' | 'tool' | 'length' | 'filtered';
  usage: ModelUsageV1;                              // normalized (§7)
  receipt: { id: string; profile: string; profileVersion: string; provider: string; model: string; attempt: number;
             fallbackOf?: string; policyDecision: PolicyDecisionV1; costMicroUsd: number; latencyMs: number;
             reconciliation: 'settled' | 'pending' };
}
```

Streaming returns the same receipt as the final event, after usage is known.

---

## 3. Principal, entitlement, and what the town may decide (G3, G8)

**The principal is whoever the gateway can prove, not whoever the caller names.**

| Caller class | Credential | Principal | v1 |
| --- | --- | --- | --- |
| (a) app | `Authorization: Bearer <appKey>`; `sha256(appKey)` → `inference.client:<sa>` record (KV-cached) | the app's own Service SA | yes — ap-home runtime, skills-a2a, demo-bible-a2a |
| (b) agent | session-wrapped A2A signature (spec 372 S3c, `0x51`): wire `agent SA → caller key`, selector `model.generate`, target `inference.svc`, verified ERC-1271 + revocation on chain | the wire's DELEGATOR SA | declared, verified in `model-gateway`, no live caller yet |

`context.agent` is **asserted**: recorded on the receipt as `assertedAgent`, shown in the Pulse as attribution, used by
nothing that decides. The ap-home runtime is one app principal in v1 with per-agent attribution as evidence; per-agent
wires are the later wave (§13).

**Entitlement is the service's own policy over its own resource.** `ClientEntitlementV1 { principal, estate?, kind: 'estate-app' | 'town-service' | 'application', profiles: string[],
limits: { tokensPerDay, microUsdPerDay, requestsPerMinute, concurrency, maxAttempts } per profile, privacyFloor }`. It
answers "may this principal spend this service's model budget on this profile?" — the same kind of question the naming
service answers about a priced name (spec 431) — and nothing about what the principal may DO with the answer. It is a
record in `inference.svc`'s vault written by its steward (G11), never a delegation, never a key held for anyone. 429 D2
holds: nothing in the town grants; the harness's mandate gates are consulted by the gateway for nothing and skipped by
it for nothing.

**No estate is privileged (429 hard rule).** The ap-home runtime is a client because `towns/faithchain/town.yaml` lists
it under the inference service's `clients:` and a steward wrote its `inference.client:` record — a manifest row and a
record, never a binding or a branch in code. A second estate is a second row.

---

## 4. Profiles and the catalog (G4)

```ts
interface ModelProfileV1 {
  id: string;                                       // 'planner-fast'
  servesCapability: string[];                       // ['plan'] — the words a caller uses
  models: Array<{ provider: 'anthropic' | 'openai-compat'; model: string; endpoint?: string }>;   // ORDERED candidates
  requiredCapabilities: Array<'tools' | 'json' | 'stream' | 'logprobs' | 'vision'>;
  maxOutputTokens: number;
  privacy: 'standard' | 'no-retention';
  fallbackOn: Array<'rate-limited' | 'unavailable' | 'timeout'>;
  timeoutMs: number;
}
interface ModelCatalogEntryV1 { provider: string; model: string; enabled: boolean; capabilities: string[];
  pricing: { inputMicroUsdPerMtok: number; outputMicroUsdPerMtok: number; cachedInputMicroUsdPerMtok?: number };
  contextWindow: number; privacy: 'standard' | 'no-retention'; notes?: string }
```

v1 profiles: `planner-fast`, `composer-default`, `answer-stream`, `judge-thorough`, `selection-structured`,
`private-analysis`, `embeddings-default` (declared, not served in v1). The schemas live in Ring 0; the records live in
`inference.svc`'s vault (`inference.profile:<id>`, `inference.model:<provider>/<model>`), seeded from `profiles.json` and
`models.json` at provision, served from a KV cache (serving plane, rebuildable). A profile's **version** is the digest of
its record; every receipt names the version it ran under.

Rules: a candidate is skipped when its catalog entry is disabled, lacks a required capability, or has weaker privacy
than the profile demands. Disabling a model removes it from every profile at once. A profile with no eligible candidate
answers `policyDecision: profile_unavailable` — it does not borrow from another profile (ADR-0013: empty is an answer).

---

## 5. The budget flow (G6)

```
request ─► establish principal ─► load entitlement + profile ─► policy decision
        ─► BudgetDO.reserve(principal, profile, estimate) ─► reservationId     (atomic; refuses over limit, over concurrency)
        ─► attempt 1 at models[0] ─► (declared failure class? ─► attempt 2 at models[1] …)
        ─► BudgetDO.settle(reservationId, actualUsage, costMicroUsd)
        ─► receipt(s) written; response returned with receipt id
```

- `estimate` = prompt tokens counted locally + the profile's `maxOutputTokens` at the first candidate's price.
- Timeout or lost connection ⇒ the receipt says `reconciliation: pending`, the reservation is held; the DO's alarm sweeps
  pending reservations, reconciles the ones whose provider usage can be read back, and **expires the rest at cost =
  reserved — never zero.**
- Limits are per principal × profile: tokens/day, microUSD/day, requests/minute, concurrency, max attempts. Daily windows
  roll at 00:00 UTC; the DO keeps the current day's counters in SQL and rebuilds from receipts when wiped.
- The budget algebra (`reserve` / `settle` / `expire` over a state snapshot) is a pure function in `model-gateway`, tested
  for the races: two reservations against one remaining budget, settle after expire, settle twice.

Spec 388's `SpendWindow` and `ProviderMeterDO` retire when the harness migrates (W3). Their rule — Groq for what its
budget carries, Haiku for the rest, the decision recorded with its reason — survives as a profile whose first candidate is
the free tier and whose `fallbackOn` names `rate-limited`; the "reason" becomes the receipt's `policyDecision`.

---

## 6. Fallback, declared (G5)

A fallback is a second attempt at the next candidate of the SAME profile, taken only when the first attempt failed with
a class the profile named (`rate-limited` = 429, `unavailable` = 5xx or connection refused, `timeout`). A 4xx on content,
a policy refusal, a malformed tool call or a stop for length is **not** a fallback trigger: the answer is the answer.
A candidate with weaker privacy than the profile is never a fallback target. Every attempt is receipted (`attempt`,
`fallbackOf` = the prior attempt's receipt id); the response carries the attempt that answered. The Pulse shows fallbacks
as a count, by profile and provider — a rising count is the operator's signal to reorder or re-enable.

This is the amendment to spec 388 §0: the forbidden thing was the UNDECLARED try-this-then-that. A declared, bounded,
receipted alternate inside one policy unit is a route, and it is recorded as one.

---

## 7. Usage, cost and the receipt (G7)

Normalization lives in one place (`model-gateway/usage.ts`): Anthropic streaming reports input at `message_start` and
cumulative output at `message_delta`; OpenAI-compatible streams report usage on the last chunk when
`stream_options.include_usage` is set. Both → `ModelUsageV1 { tokensIn, tokensOut, cachedIn?, reasoningOut? }` with the
provider's raw usage object kept on the receipt. Cost = usage × the catalog entry's pricing at call time, in micro-USD.

```ts
interface InferenceReceiptV1 {
  id: string; at: string; principal: Address; assertedAgent?: Address; runRef?: string; stepRef?: string; purpose: string;
  profile: string; profileVersion: string; provider: string; model: string; attempt: number; fallbackOf?: string;
  policyDecision: PolicyDecisionV1;                 // { allowed: true, candidates: [...], skipped: [{model, why}] } | { allowed: false, reason }
  usage: ModelUsageV1; providerUsage?: unknown; costMicroUsd: number; latencyMs: number;
  outcome: 'answered' | 'failed' | 'refused'; failureClass?: string; reconciliation: 'settled' | 'pending' | 'expired';
}
```

Written to `inference.svc`'s vault as `inference.receipt:<id>` by the service's own agent (its interactions grant,
spec 433 §1.1 birthrights — the same precondition that bit `scripture-resolver.svc`: the vault key must be bound at
provision). The id is returned to the caller; the harness puts it on `ModelCallV1.receiptRef` so it lands in
`run.provenance:<runRef>` and the Home's Activities can show "this step cost this much, here". `ModelCallV1` gains
`receiptRef?`, `costMicroUsd?`, `attempt?`, `fallbackOf?`, `profile?` — additive.

**Privacy rule.** No prompt or response text is stored in the ledger. A `private-analysis` profile demands
`no-retention` candidates only and refuses rather than fall back to a retaining model. A future content-inspection
feature (§13) would be a separate, opt-in record kind, never a field on the receipt.

---

## 8. The Ring 0 packages

Placement follows ADR-0037/ADR-0063: pure contracts and algebra in Ring 0, the deployed Worker here.

**`@agenticprimitives/model-gateway`** (no deployed infra, no provider SDK):
request/response/stream event types; `ModelProfileV1`, `ModelCatalogEntryV1`, `ClientEntitlementV1`,
`InferenceReceiptV1`, `PolicyChangeV1`, `InferenceOpsSummaryV1` + validators; ports `PrincipalResolverPort`,
`MeterPort` (`reserve` / `settle`), `ReceiptLedgerPort`, `PolicyStorePort`; the policy engine (profile + catalog +
entitlement → candidates, ceiling, privacy filter, `PolicyDecisionV1`); the budget algebra; the usage normalizer;
adapters `anthropicAdapter(createFetchAnthropicClient(…))` and `openAiCompatAdapter(createFetchOpenAiCompatClient(…))`
over the existing fetch clients; `openai-compat/translate.ts` (chat request ↔ contract, non-stream and SSE);
`createGatewayHandler(ports)` → `(req, caller) => response | stream`. Tests: the attempt/fallback matrix, reservation
races, usage fixtures per provider, translator round-trip, the privacy filter.

**`@agenticprimitives/model-client`:**
`createModelClient({ baseUrl, credential: { appKey } | { signer, wire }, fetchImpl })` → `models.generate`,
`models.stream`, `models.listProfiles`; subpath `model-client/orchestration`: `plannerFromModels`,
`composerFromModels`, `structuredCallFromModels`, `textStreamFromModels`, `logprobChoiceFromModels` implementing the
orchestration ports, so the harness swaps factories, not call sites. Root `check:model-gateway`, `check:model-client`;
`scripts/promoted-symbols.json` rows for `routeProvider` / `SpendWindow` / `ProviderMeterDO` → profile policy (pending
until W3). Published through the release pipeline; consumed here by exact pin.

**Ontology** (`packages/ontology/tbox/inference.ttl`, prefix `apinf:`): `ModelProfile`, `ModelCatalogEntry`
(`enabled`), `InferenceReceipt ⊑ apix:Receipt`, `BudgetReservation`, `ClientEntitlement`, `PolicyChange ⊑
prov:Activity`, `EstateHeartbeat` (an aggregate observation; the comment says it is never per-person); properties
`profileId`, `servesCapability`, `costMicroUsd`, `attempt`, `fallbackOf`, `reconciliationState`, `assertedAgent`
(comment: evidence, never authority). `apexec:ModelInvocation` gains `apexec:receiptRef`. Record keys
`inference.receipt:` · `inference.client:` · `inference.profile:` · `inference.model:` · `inference.policy-change:` bound
in `packages/ontology/src/vault-records.ts`; `pnpm check:ontology-bindings`.

---

## 9. `apps/inference` — the Worker (`inference.svc`)

| Route | Door | Auth | Notes |
| --- | --- | --- | --- |
| `POST /v1/generate` | contract | app key or `0x51` wire | JSON or SSE (`stream: true`) |
| `POST /v1/chat/completions` | OpenAI-compatible | app key | `model` = a profile id; a model name is refused with the profile list |
| `GET /v1/models` | OpenAI-compatible | app key | enabled catalog entries + the caller's profiles |
| `GET /v1/ops/summary?window=` | ops | town token or steward session | `InferenceOpsSummaryV1` from `BudgetDO` rollups |
| `GET /v1/admin/*` · `POST /v1/admin/*` | admin | steward session (G11) | catalog switch, profile edit, client read |
| `GET /healthz` | probe | none | the `town.yaml` probe |

Bindings: `BUDGET` (DO `BudgetDO`, SQL storage, alarm), `CACHE` (KV: `client:<hash>`, `profiles`, `catalog`), secrets
`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `TOWN_OPS_TOKEN`, the vault credentials of `inference.svc` (`VAULT_URL`,
`VAULT_GRANT`, `VAULT_SESSION_LEAF` — the scoped-grant shape of ap-home #46, under the Worker secret limit).
`wrangler.toml` env `faithnet` on `inference.faithnet.io`; `pnpm deploy:faithnet`; a `town.yaml` row:

```yaml
  - id: inference
    kind: commons
    repo: ap-town
    app: apps/inference
    worker: faithchain-inference
    agentName: inference.svc
    hosts: [inference.faithnet.io]
    probe: https://inference.faithnet.io/healthz
    description: The town's model gateway — profiles, budgets and receipts in front of the providers. Governs model access; acts for no one.
    clients: [faithnet-runtime, skills, bible-explorer]     # principals a steward registered; a row lists, the record entitles
```

`scripts/provision-inference-service.mts`, modelled on `provision-naming-service.mts`, completes **all four birthrights**
(spec 433 §1.1): deploy the Worker; claim `inference.svc` under the town clerk's custody with `atl:mcpEndpoint` pointing
at the Worker's hosted ask door; bind the vault key and issue the scoped interactions grant; assign the archetype
(`inference-steward`, a read-only playbook that answers "what did I spend today?"); write `operations/inference-
service.faithchain.json` (addresses only). A leg it cannot finish stops with the message. The Worker mounts no A2A
surface of its own in v1, so no Service Host is embedded; its asks are hosted by the runtime through the name record
(the `ligonier.svc` shape).

---

## 10. The town portal, re-shaped (G9) — the Pulse

### 10.1 Why re-shape rather than add

`/operations` already answers "is each listed service up right now, what chain is this, which rules hold". Adding a
`/pulse` beside it would leave two pages answering two halves of one question. The portal's areas become the four an
operator or a visitor actually comes for:

| Area | Route | Audience | Answers |
| --- | --- | --- | --- |
| **Town** | `/` | anyone | what this town is: the map, estates as districts, commons as buildings, lit by freshness (429 §7) |
| **Find** | `/find`, `/agent/:id`, `/service/:id` | anyone | which agents and services exist, their four signals (429 D7) |
| **Pulse** | `/operations` (kept) → tabs `/operations/town` · `/estates` · `/homes` · `/inference` | anyone reads the public tabs; estate/home/inference tabs need an operator sign-in the steward listed | how the town is doing now and over 30 days |
| **Admin** | `/admin/inference` (first), later `/admin/town` | `inference.svc`'s steward | changing policy, with receipts |

Names and Skills stay as links to those services; a page per service and per agent stays under Find. Nothing public
is removed; `/operations` keeps its URL and grows.

### 10.2 The sources

Three, all pulled by the town, none pushed into it:

1. **Services** — the `probe:` URLs in `town.yaml` (today's signal), sampled instead of fetched on view.
2. **Estates** — ap-home `apps/agent-runtime` `GET /ops/heartbeat`, producing `EstateHeartbeatV1` from the OPS index that
   already serves `POST /harness/ops` at estate scope (spec 406, `ops-index.ts`), gated by a `TOWN_HEARTBEAT_TOKEN`
   secret the town holds. Aggregate only: counts, never names.
   ```ts
   interface EstateHeartbeatV1 {                 // @agenticprimitives/harness/heartbeat (Ring 0: two products need it, 399 §4)
     estate: string; at: string; generation: string; versions: Record<string, string>;
     agents: { person: number; org: number; service: number };     // from the estate's own registry read
     homesActive24h: number;
     runs: { started: number; completed: number; parked: number; failed: number; canceled: number };
     modelCalls: number; tokensIn: number; tokensOut: number; inferenceMicroUsd: number;
     vaultCalls: number; doRequests: number; askLatencyP95Ms: number | null;
     parkedForSignature: number;                                     // the queue a steward would want to see
   }
   ```
3. **Inference** — `inference.svc` `GET /v1/ops/summary` (`InferenceOpsSummaryV1`: requests, tokens, cost, latency
   p50/p95, error rate, fallbacks, budget utilisation, sliced client × profile × provider × model, for a window;
   `?estate=` slices by the client record's estate — spec 436 C8).
4. **Chain** — `apps/chain-gateway` `GET /ops/summary` (`ChainGatewayOpsSummaryV1`, spec 436 §6: requests, reads/writes,
   denials by reason, cache hit rate, upstream latency and errors, block head and rate, by token with its estate and
   kind, top methods). Added 2026-10-10.

### 10.3 The sampler and its store

`apps/town-agent` gains `[triggers] crons = ["*/5 * * * *"]` and a `HeartbeatDO` (SQL: `samples(kind, id, at, payload)`,
30-day retention, alarm prune). Every five minutes it probes services, pulls each estate's heartbeat and the inference
summary, and appends a sample. `GET /api/pulse?window=24h|7d|30d` serves series + latest per kind. `HeartbeatDO` is a
serving plane: wiping it loses trend lines, never a record (receipts and policy changes are in `inference.svc`'s vault;
runs are in each estate). `pnpm probe:town` stays as the external, independent check.

### 10.4 The panels

- **Town** — services up/down timeline (30 days), the chain head and block rate, contract generation, naming counts
  (names claimed per root, from `apps/naming`'s summary), the rules the town keeps (today's content). Public.
- **Estates** — one card per `town.yaml` estate: agents by type, homes active, runs by state with sparklines, parked-for-
  signature queue, p95 ask latency, versions and generation; stale when the last sample is older than two intervals.
  The map on Town lights each district by this freshness.
- **Homes** — the estate's run mix over time (completed / parked / failed), the capabilities most asked (counts only),
  failure classes; a link "open at the estate" that goes to the estate's own operator view (spec 406), because the
  per-agent truth lives there.
- **Inference** — spend and tokens by client, profile, provider and model; fallbacks and their reasons; budget
  utilisation per client × profile with the limit drawn; error rate and latency; the profile version in force and when
  it last changed (joins the change log).
- **Chain** (added 2026-10-10, spec 436 §6) — requests over time (reads vs writes), denials by reason, cache hit rate,
  upstream latency and errors, block head and rate; by estate and by application with rate-limit utilisation against
  the limit; top methods. The companion lens is `/admin/chain`: tokens, limits, issue / rotate / revoke as acts with a
  `chain.policy-change:` record, the allow-list and gas cap in force.
- **Applications** (added 2026-10-10) — the listed applications (Game Night, Gather27, the Explorer…) with their probes
  and their usage of both gateways under their own tokens and app keys.

`town-model` gains `TownPulse` types (`PulseSampleV1`, `PulseSeriesV1`); `town-ui` gains the sparkline, the stat tile and
the window picker; `town-scene` lights estate buildings by heartbeat freshness. Operator sign-in uses
`@agenticprimitives/connect-client` as relying app `town-portal` (the pattern `apps/naming` already runs as `naming-app`);
who may read the gated tabs is the list the town's steward keeps as a record on the town agent — a read entitlement,
not an authority.

---

## 11. Admin — inference policy with receipts (G11)

`/admin/inference`, three views and a log:

1. **Model catalog** — every `inference.model:*` entry: provider, enabled switch, capabilities, pricing, context window,
   last-24h usage from the ops summary. Toggling writes a new record version + `inference.policy-change:<id>` and
   invalidates the KV cache. Before confirming, the page names every profile the change would leave with no eligible
   model (fail-closed warning).
2. **Capability → profile → models** — one row per profile with its `servesCapability` words; a drag-ordered candidate
   list restricted to enabled entries; `maxOutputTokens`, `fallbackOn`, `timeoutMs`, `privacy` editable. Save = a new
   profile version digest + a policy-change receipt.
3. **Clients** — per-client profiles and limits, read-only in v1 (edits in §13).
4. **Change log** — `inference.policy-change:*` newest first: actor SA, record key, before/after digests, reason, time,
   and the receipts that ran under each version (`InferenceReceiptV1.profileVersion`).

```ts
interface PolicyChangeV1 { id: string; at: string; actor: Address; recordKey: string; before?: string; after: string; reason: string }
```

Auth: the Home session from `connect-client`; the inference Worker verifies it the way the Home does and requires
`signedInSa === stewardOf(inference.svc)` from the stewardship record — the check `mayOverseeAgent` makes at Home — never
a role list, never an env allowlist. **Named now, done later:** these writes become harness acts on `inference.svc`
(`inference.set-profile`, `inference.toggle-model`) once it embeds a Service Host (spec 433), so the one-capability-model
rule covers them and the ceremony is the same signature every other act asks for.

---

## 12. Waves and gates

| Wave | Where | What | Gate |
| --- | --- | --- | --- |
| **W0** | ap-town · Ring 0 | this spec; `tbox/inference.ttl` + record bindings; amend 388 §0 (declared fallback) and 377 (adapters sit behind the gateway) | `check:ontology-bindings`; INDEX rows |
| **W1** | Ring 0 | `model-gateway`, `model-client`, `ModelCallV1` fields, `EstateHeartbeatV1`, `InferenceOpsSummaryV1`; publish alpha | package checks green; api-surface + manifests in the same PR |
| **W2** | ap-town | `apps/inference` Worker + `BudgetDO` + KV + vault receipts; `profiles.json`/`models.json`; provision script (four birthrights); `town.yaml` row; register `faithnet-runtime` as the first client | `/healthz` listed; one receipt readable in `inference.svc`'s vault; `pnpm check` green |
| **W3** | ap-home | `selectPlanner` / `selectComposer` / `structuredCallFor` / `textStreamFor` / `logprobChoiceFor` → `model-client/orchestration` bridges with role → profile map; delete `routeProvider`, `SpendWindow`, `ProviderMeterDO`, `llmAllowlist` branches, provider secrets and `ORCHESTRATION_*` model/budget vars; add `INFERENCE_URL`, `INFERENCE_APP_KEY`; `receiptRef` into `run-trace.ts` | the comparison runner (spec 415 A4) arms gateway vs direct on the live Gemini pair with no regression on the panel before `ORCHESTRATION_LLM` goes; Activities and `run.provenance` show `receiptRef` |
| **W4** | skills · verifiable-content-demo | `skills-a2a callClaude` and `demo-bible-a2a ask.ts` onto `/v1/chat/completions` with their own app keys (profiles `author`, `evals`, `answer-stream`) | each Worker loses its provider key; their receipts appear in the Inference panel by client |
| **W5** | ap-home · ap-town | `GET /ops/heartbeat`; `/v1/ops/summary`; chain-gateway `GET /ops/summary` + token `estate`/`kind` (436 §6); the cron sampler + `HeartbeatDO`; Pulse tabs incl. Chain and Applications; `town-model`/`town-ui`/`town-scene` additions; operator sign-in | 30 days of samples survive a deploy; a wiped `HeartbeatDO` refills from the next sample; the map lights by freshness |
| **W6** | ap-town | `/admin/inference`: catalog switch, profile editor, change log, the principal class on every receipt row; `/v1/admin/*` with the stewardship check; profile versions exported into 435's estate manifest | a toggle disables a model across every profile at once and the next receipt cites the new version; a non-steward session is refused |

W1 and W2 can run in parallel with W5's heartbeat sources; W3 waits for W2; W6 waits for W5's sign-in.

---

## 13. Not in v1 (named)

Per-agent wires as caller class (b) in the harness · embeddings and Workers AI behind `embeddings-default` · content
inspection as an opt-in record kind · client entitlement and budget edits in the admin · per-home drill-down from the
Pulse into that agent's Home (a link today) · OpenRouter normalization (no consumer exists) · eval scripts in
`~/skills/scripts` as clients · `/admin/town` (manifest edits with receipts) · a second renderer for the map · Cloudflare AI Gateway as an upstream cache
behind an adapter · spend alerts (the Pulse shows utilisation; alerting is a later wave).

---

## 14. Risks and open points

- Gemini is reached through its OpenAI-compatible endpoint, as today; tool-call fidelity is the existing adapter's.
- The Worker → vault write for `inference.svc` needs the vault key bound and the grant scoped under 5 KB (ap-home #45/#46
  showed both edges); the provision script stops if it cannot do it.
- ap-town deploys are manual; W2 adds a deploy script, not CI. The town has one estate, so the Estates tab shows one
  card until a second estate lists itself.
- A gateway outage stops every caller's model calls at once; the profile's `fallbackOn` covers a provider, not the
  gateway. Mitigation named, not built: a second Worker deployment behind the same host.
- Admin writes bypass the harness in v1 (steward session + stewardship check); §11's "later" closes it.
- Cost needs catalog pricing kept current by hand; a stale price mis-states spend, never authority.

---

## 15. Alignment with the field (added 2026-10-10)

The gap analysis compared this design with the products that sell a "control plane" for agents and models. What it
confirmed, what it changed, and what we keep different:

**Confirmed (no change).** The gateway core is LiteLLM's shape — an OpenAI-format proxy with per-key budgets, rate limits,
retries and fallbacks — and Portkey's "routing as data": our app key is their virtual key, our profile record is their
routing config. The limits table in §5 is at parity with LiteLLM's key budgets (`max_budget` → `microUsdPerDay`,
`rpm_limit` → `requestsPerMinute`, `max_parallel_requests` → `concurrency`, `models` → `profiles`); the one deliberate
coarsening is that tokens roll per day, because that is the window the receipts settle on.

**Adopted from the field.**

| From | Feature | Where it lands here |
| --- | --- | --- |
| Prediction Guard (supply-chain / AIBOM), VeriGuard (AI-BOM) | a bill of materials for what is running | every receipt names its **profile version**; the **estate manifest export** (435 §6) lists the model profile versions in force beside card, playbook and connector digests |
| Prediction Guard runtime controls, Entra "block on risk" | a kill switch | the **model catalog switch** (G4) empties every profile at once; **quarantine** of an agent is 435's (registry `suspended` + wire revocation, two acts from one screen) |
| Okta Agent Gateway's unified trail | "this call ran under credential X" | the Inference panel shows each receipt's **principal class** (app key / session wire) and the asserted agent beside it; tool-call receipts rendered the same way are 435 §10 |
| Portkey's attribution dashboard | spend by feature / user / model | the Inference panel's client × profile × provider × model slices — with the difference that the principal is proved by the gateway and the agent is an asserted field kept separate |
| Cloudflare AI Gateway | an upstream cache in front of a provider | named for later, as a cache behind an adapter, never as the gateway (it has no principal model beyond an account and the receipts would not be ours) |
| AWS AgentCore / Kong | hide denied tools at discovery | not this spec — the harness already narrows the offer (`composeOfferedTools`); 435 §5 makes it visible on the catalog |

**Kept different, on purpose** (the five points of the gap analysis §3): identity is an address, not a tenant record;
receipts live with the owner, not the operator; credentials for tools stay with the holder, not a proxy; authority is a
signature per step, not an attribute at the gate; no score.

**The gap we share with the field and name:** SIEM / OpenTelemetry export. Spec 390's spans exist; no exporter runs in
production. The Pulse links to the gap; it does not pretend.

---

## Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):

- **One policy source feeds both the UI preview and the enforcer.** `packages/sdk/src/permissions/build.ts` computes a
  session's caveats from `TOOL_POLICIES` and previews `rules.rateLimit { windowSeconds, maxCalls }` and
  `scope.maxValueWei` from the same table ("keep them in sync by re-using TOOL_POLICIES"). Ported: the profile and
  entitlement records are the one source the policy engine enforces AND the admin page previews — the fail-closed
  warning in §11 is computed by the same `policyDecision` function the gateway runs.
- **Spend caps and rate limits as modules with a period and a cap** (`SpendCapModule.t.sol`, `RateLimitModule.t.sol`,
  the Phase 3 integration): a window, a cap, a counter that resets. Ported into `BudgetDO`'s per-day and per-minute
  limits — off-chain, because an inference call is not a transaction, but with the same shape (window, cap, counter) and
  the same refusal semantics (over the cap is a refusal before the act, never a clawback after).
- **Receipts as the record, counters as the cache.** smart-agent's registries (`GrantProposalRegistry`,
  `GeoClaimRegistry`) keep the event log as truth and let indexers derive views. Ported as G6/G7: receipts in the vault
  are the truth; `BudgetDO` and `HeartbeatDO` are derived and rebuildable.
- **Deliberate divergence:** smart-agent enforces caps on chain per user operation. Here an inference call never touches
  the chain (no on-chain tx per inference); verification is reads (ERC-1271 for wires), and the caps live in a Durable
  Object. The reason is cost and latency, and the trade is stated: a budget here is operational policy with receipts,
  not a cryptographic guarantee.
