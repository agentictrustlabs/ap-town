# Spec 437 — The Pulse: infrastructure, cost and performance

**Status:** DRAFT 2026-10-10 (owner's brief: "add infrastructure performance, costs, status, etc to the estate/town data,
ask and dashboard"; the owner's assessment is the body of this spec). **Owner:** ap-town (collectors, the store, the
tabs) · Ring 0 (the performance block on the heartbeat, the rollup) · ap-home (fills the block). **Adds to:** 434 (the
Pulse: §10.2 sources 5–7, §10.4 two more tabs), 436 (§5.3 tab rows; §5.5 the Town Ask reads these records too),
435 (nothing — this spec reads, it never decides). **Supersedes** nothing: the Pulse's existing kinds (service · chain
· inference · estate) stay as they are.

---

## 0. Ground truth (checked 2026-10-10)

- Specs 434/435/436 live in this repository and are being implemented: `apps/inference` (BudgetDO), `apps/town-agent/
  worker/pulse.ts` (`PulseKind = service | chain | inference | estate`, `HeartbeatDO`, cron `*/5`, `GET
  /api/pulse?window=`), `apps/chain-gateway` `GET /ops/summary`.
- Nothing in the estate reads Cloudflare, Vercel or Azure APIs today (`pnpm probe:town` is the only health check; no
  `[observability]`, no status page).
- **Footprint:** two Cloudflare accounts (`5da2…` faithnet/town, `0a1f…` richcanvas); ~60 Workers across ap-home,
  ap-town, verifiable-content-demo, skills, engage, pokernight, ap-build, ap-demos, uupg; Pages projects (skills-web,
  demo-bible-web, agenticprimitives-demo-*); Vercel team `team_5pDH…` with faithnet-home (www.faithnet.me),
  agenticprimitives-dev, scripture-validator; Azure `rg-faithnet` eastus2 VM `Standard_D4s_v5` running Besu (chain 34348)
  behind a Cloudflare Tunnel (`faithchain-rpc.agentkg.io`); faithkms Bicep prepared, not applied; GraphDB at
  `graphdb.agentkg.io` (Ontotext, not Azure); GCP KMS project churchcore2; D1/KV/Queues/Vectorize/Workers AI/Containers
  in use; no R2, no Analytics Engine.
- **APIs and their freshness:**
  - *Cloudflare GraphQL Analytics* (`POST api.cloudflare.com/client/v4/graphql`, per `accountTag`):
    `workersInvocationsAdaptive` (requests, errors, subrequests, cpuTime p50/p99, wallTime),
    `durableObjectsInvocationsAdaptiveGroups` / `durableObjectsPeriodicGroups` / `durableObjectsStorageGroups`,
    `d1AnalyticsAdaptiveGroups` (rows read/written, `queryBatchTimeMs`, `databaseSizeBytes`), `kvOperationsAdaptiveGroups`,
    `queueConsumerMetricsAdaptiveGroups`, `aiInferenceAdaptiveGroups`, `pagesFunctionsInvocationsAdaptiveGroups`. Minutes of
    lag. **No live billing API:** cost is DERIVED from meters × published unit prices.
  - *Vercel*: `GET /v7/deployments?projectId=&target=production&limit=1` (readyState, createdAt) live; `GET
    /v1/billing/charges?teamId=&from=&to=` FOCUS v1.3 JSONL, 1-day granularity (billed cost by SKU/project).
  - *Azure*: Monitor Metrics (Percentage CPU, Available Memory Bytes, disk/net) and Resource Health
    `availabilityStatuses` are live; Cost Management `POST {scope}/providers/Microsoft.CostManagement/query` refreshes
    every 4 h with 8–72 h usage lag and RESTATES past days — read daily, 7-day rolling window, labelled "as of".
  - *Our own*: `RunMetricsV1` (`packages/orchestration/src/metrics.ts`: runs by outcome, authority verdicts, step-duration
    histogram by capability × risk, model calls by provider, vault calls by step), `ModelCallV1.startMs/endMs`,
    `RunBillV1`, `InferenceOpsSummaryV1` latency p50/p95, `ChainGatewayOpsSummaryV1` upstream p50/p95 — per run or per
    gateway, not yet aggregated per estate.

---

## 1. The shape

```
SOURCES                                         apps/town-agent                              Pulse tabs
Cloudflare GraphQL × 2 accounts ─┐              worker/infra/*.ts   collectors (pure; fetch injected)
Vercel deployments + billing ────┤──────────►   pricing.json        unit prices + asOf         ─►  /operations/infra
Azure Monitor · Health · Cost ───┤              attribution         worker/project/resource →      /operations/performance
GraphDB monitor + repo sizes ────┘                                  town · estate · application    Estates cards: cost + perf tiles
ap-home GET /ops/heartbeat (+ performance block) ──┐
inference /v1/ops/summary ─────────────────────────┼──►  HeartbeatDO: service · chain · inference · estate · infra · cost · perf
chain-gateway /ops/summary ────────────────────────┘           │
                                                               └──►  /api/pulse → infra, cost, performance views
```

---

## 2. Decisions

| # | Decision |
| --- | --- |
| I1 | **Three cadences, one store.** Status every 5 min (the existing cron: Vercel `readyState`, Azure Resource Health, GraphDB health, Worker error spikes over the last 15 min). Metrics hourly (`7 * * * *`: Cloudflare analytics for the previous full hour per account, Azure Monitor VM metrics, D1/DO storage). Cost daily (`30 6 * * *`: Vercel charges and Azure cost for a rolling 7-day window — a later sample SUPERSEDES an earlier one for the same day; Cloudflare cost derived from the day's meters). `HeartbeatDO` keeps 30 days for infra/perf, 400 days for cost (one row per source per day). |
| I2 | **"Real time" is labelled per source, never implied.** Every tile shows `asOf` and the source's lag class (`live` · `~5 min` · `hourly` · `daily, restated up to 72 h`). Cloudflare cost is marked **derived** (meter × price; `pricing.json` carries its own `asOf`); Vercel and Azure cost are **billed**. The two are never summed without the label. |
| I3 | **A partial read is partial, never a smaller total.** Each collector returns `ok: false` + `error` per source/account exactly as `pulse.ts` does today; the tab shows "Cloudflare account richcanvas: unreadable since 09:00", and totals carry `complete: boolean`. No silent fallback to a cached number (ADR-0013); the last good sample is shown AS the last good sample. |
| I4 | **Attribution is declared, not guessed.** `town.yaml` gains `accounts:` (Cloudflare account ids with labels, the Vercel team, Azure subscription/resource groups, GraphDB) and each `estates[]` / `services[]` entry lists its `workers:`, `pagesProjects:`, `vercelProjects:`, `azureResources:`. A Worker listed nowhere lands in an **Unattributed** bucket that is SHOWN, never hidden — the inventory-drift detector. Spec 436 §9's `<app>-<estate>` naming rule is a lint on that list, not the attribution. |
| I5 | **Performance has two halves and they sit side by side.** *Infrastructure:* Worker CPU p50/p99 and wall time, error rate, subrequests; DO wall time; D1 `queryBatchTimeMs`; chain upstream p50/p95; Azure VM CPU/memory/disk; Vercel deploy age and build state. *Provenance:* per estate from `EstateHeartbeatV1.performance` (an additive block in `@agenticprimitives/harness/heartbeat`): run duration p50/p95, step-duration histogram by capability × risk (top N), model latency p50/p95 by provider and profile, parked-wait p50/p95 (received → approval), vault calls and DO requests per run p50/p95, authority verdict counts, failure classes, first-token latency for streamed answers. Computed in ap-home from the OPS index with `metricsOf` over the window — aggregate only, no names, no run refs. |
| I6 | **Cost meets provenance in one number.** "Cost per completed run" per estate = inference micro-USD (receipts) + the estate's attributed infra cost for the window ÷ completed runs; shown WITH both components and their lag labels. Provider-billed LLM spend (Anthropic admin usage/cost API, Google billing export) is a later source used to RECONCILE receipts, never to replace them. |
| I7 | **Secrets stay on the town Worker; estates may add theirs.** The town agent holds read-only tokens for the town's accounts (`CLOUDFLARE_ACCOUNTS` JSON with an analytics token per account; `VERCEL_TOKEN` + `VERCEL_TEAM_ID`; an Azure service principal `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET` / `AZURE_SUBSCRIPTION_ID` with Reader + Cost Management Reader; `GRAPHDB_MONITOR_TOKEN`). A second estate on its own accounts shows cost only if its operator shares a read token (an `estate-accounts` record on the town agent) — otherwise **"not shared"**, never zero. |
| I8 | **The Pulse reads; nothing here acts.** No kill switches, no scaling, no deploys from these tabs; the admin lenses stay the ones specs 434 and 436 name. |

---

## 3. The records

All in `packages/town-model` (the town reads them; an estate produces only the performance block, which is Ring 0's):

```ts
type LagClass = 'live' | '5min' | 'hourly' | 'daily-restated';
interface InfraSampleV1 { type: 'ap.infra-sample.v1'; platform: 'cloudflare' | 'vercel' | 'azure' | 'graphdb' | 'chain-node'; account: string; resource: string;
  kind: 'worker' | 'durable-object' | 'd1' | 'kv' | 'queue' | 'workers-ai' | 'pages' | 'deployment' | 'vm' | 'repository' | 'node';
  at: string; asOf: string; lagClass: LagClass; status: 'up' | 'degraded' | 'down' | 'unknown';
  metrics: Record<string, number | null>;          // requests · errors · subrequests · cpuP50Ms · cpuP99Ms · wallP50Ms … named per platform (§4)
  ok: boolean; error?: string }
interface CostSampleV1 { type: 'ap.cost-sample.v1'; platform: InfraSampleV1['platform']; account: string; day: string; resource: string; sku?: string;
  amountMicroUsd: number; basis: 'derived' | 'billed'; asOf: string; complete: boolean; ok: boolean; error?: string }
interface PricingV1 { asOf: string; source: string; meters: Record<string, { unit: string; microUsdPerUnit: number; includedPerMonth?: number }> }
interface AttributionV1 { accounts: { cloudflare: Array<{ id: string; label: string }>; vercel?: { teamId: string }; azure?: { subscriptionId: string; resourceGroups: string[] }; graphdb?: { url: string } };
  owners: Array<{ owner: { kind: 'town' | 'estate' | 'application' | 'service'; id: string }; workers?: string[]; pagesProjects?: string[]; vercelProjects?: string[]; azureResources?: string[] }> }
interface PerfReadV1 { window: { from: string; to: string }; infrastructure: {…per platform rows…}; provenance: Record<estate, EstatePerformanceV1 | null>; costPerCompletedRun: Record<estate, { microUsd: number | null; inferenceMicroUsd: number; infraMicroUsd: number | null; completedRuns: number; complete: boolean; lag: LagClass[] }> }
```

Ring 0, additive, one alpha: `EstateHeartbeatV1.performance?: EstatePerformanceV1` in `packages/harness/src/heartbeat.ts`
(quantile pairs; `HistogramPointV1` reused from orchestration; provider/profile slices), accepted by
`validateEstateHeartbeat`; `@agenticprimitives/orchestration` exports a pure `rollupMetrics(records: RunMetricsV1[],
…)` → `EstatePerformanceV1` beside `metricsOf`. Unit tests on fixtures.

---

## 4. The collectors (`apps/town-agent/worker/infra/`)

All pure functions taking `fetchImpl` and returning samples; fixture tests per platform including a partial-failure case.

- `cloudflare.ts` — one GraphQL request per account per hour covering Workers, DO, D1, KV, Queues, Workers AI, Pages
  Functions for the previous hour; a daily storage query (D1 size, DO stored bytes, KV storage); `deriveCost(meters,
  pricing)` → `CostSampleV1[]` with `basis: 'derived'`.
- `vercel.ts` — the latest production deployment per listed project (5 min: readyState, createdAt → deploy age); the
  billing/charges JSONL stream for the rolling 7 days (daily), grouped by project and SKU, `basis: 'billed'`.
- `azure.ts` — client-credentials token; Resource Health per listed resource (5 min); Monitor metrics for the VM
  (hourly: CPU, available memory, disk, network); Cost Management query at subscription scope grouped by resource group,
  daily granularity, rolling 7 days (daily), with QPU back-off on 429 and `complete: false` when any scope fails.
- `graphdb.ts` — `/rest/monitor/infrastructure` + repository sizes (hourly); health (5 min).

Secrets are wired in `wrangler.toml` comments and `scripts/set-cloudflare-secrets.sh`; every collector's output names
its `asOf` and lag class (I2) and its own `ok`/`error` (I3).

---

## 5. Sampler, store, API

`pulse.ts` gains kinds `infra`, `cost`, `perf`; `wrangler.toml` carries three cron expressions dispatched by
`event.cron`; `HeartbeatDO` keeps retention per kind (30 d / 30 d / 400 d); `readPulse` gains `infra`, `cost` and
`performance` views with the attribution joins and `complete` flags; `GET /api/pulse?window=24h|7d|30d|90d`.

ap-home `apps/agent-runtime`: `GET /ops/heartbeat` fills `performance` from the OPS index via `rollupMetrics`; first-token
latency is recorded on the stream path if it is not already on the trace.

The Town Ask (436 §5.5) reads the same records: the day's rollup written into the context agents' vaults gains the
infra, cost and performance views, so "what did the town cost last week" is a vault read with the lag labels intact.

---

## 6. The tabs

- **`/operations/infra`** — platform cards (Cloudflare per account, Vercel, Azure, GraphDB, the chain node) with status,
  24h/7d/30d cost (derived/billed badges, `asOf`), top Workers by requests · errors · CPU, storage by D1/DO/KV, deploy
  state and age per Vercel project, VM CPU/memory, unreadable-source banners, the **Unattributed** bucket.
- **`/operations/performance`** — the infrastructure latency row (Worker CPU/wall by script, D1 query time, chain
  upstream, VM) over the provenance latency row (ask p95, run duration, step duration by capability, model latency by
  provider/profile, parked wait, vault calls per run); per-estate selector; window picker; the **cost per completed run**
  tile with its two components.
- **Estates cards** (the existing tab) gain cost-this-window and p95 tiles; `town-ui` gains the lag badge and the
  derived/billed badge; `town-scene` unchanged.
- Operator gating as 434 §10: public — infra STATUS; gated — cost and performance detail.

---

## 7. Waves and gates

| Wave | What | Gate |
| --- | --- | --- |
| **P0** | this spec; 434 §10.2/§10.4 and 436 §5.3 amended; `town-model` records (§3) + `accounts:` / `workers:` / `vercelProjects:` / `azureResources:` on the manifest schema (`pnpm check:town` lists unattributed Workers as a WARNING list); Ring 0 `EstatePerformanceV1` + `rollupMetrics` | types round-trip; fixtures |
| **P1** | the four collectors with fixture tests incl. a partial-failure case; secrets wiring | each collector's partial-failure fixture yields `ok:false` + `error`, never zeros |
| **P2** | sampler kinds, three crons, retention per kind, `readPulse` views, `/api/pulse` windows; ap-home fills the performance block | 30 days of infra samples and 400 days of cost rows survive a deploy; a wiped DO refills from the next passes and (436 §5.5) from the context agents' vaults |
| **P3** | the two tabs; the Estates tiles; the badges | `/operations/performance` draws 7 days for faithnet |
| **P4** | the day-level gates below | — |

**Gates (P4):** a day with a Cloudflare account token revoked shows the account as unreadable and the total as
incomplete; Vercel cost for yesterday matches `vercel usage --since` for the same day; Azure day-N cost restates when
re-sampled on day N+2 and the tab shows the later value with its `asOf`; the Unattributed bucket is empty for faithchain
after `town.yaml` is filled; `EstatePerformanceV1` round-trips through `validateEstateHeartbeat`.

---

## 8. Later (named)

Provider-billed LLM spend (Anthropic admin usage/cost, Google billing export) as a reconciliation source; GCP KMS and
npm costs; Cloudflare Logpush or Workers Analytics Engine for per-request traces; OTel export of `RunMetricsV1` (spec 390
W4); alerts (a sample crossing a threshold posts to the town steward's inbox); the faithkms Azure pilot once applied.

---

## 9. Risks and open points

- Cloudflare unit prices drift; `pricing.json` carries `asOf` and the tab says "derived" — a stale price mis-states
  spend, never authority.
- Azure cost will disagree with the portal for the last 2–3 days by design; the restatement rule and the label are the
  fix, not a reconciliation job.
- GraphQL quotas: one request per account per hour per dataset family is far under limits; the daily storage query is
  the only wide one.
- The Azure service principal and the Vercel token are read-only but account-wide; they live only on the town-agent
  Worker (I7).

---

## Reference: smart-agent patterns to port

- **Meter × published price, labelled as an estimate** — smart-agent's gas estimation (`eth_estimateGas` bounds in the
  relayer) shows a number it names as an estimate and never bills from it; the derived Cloudflare cost is the same
  posture, with `asOf` on the price table.
- **A partial read is a partial read** — the relayer's bundler status reads report each leg (sent · included · failed)
  rather than a merged "probably fine"; I3 keeps that per source and per account.
- **Deliberate divergence:** smart-agent has one deployment on one chain with one operator's accounts; the town has
  two Cloudflare accounts, a Vercel team and an Azure subscription across operators, which is why attribution is
  declared in the manifest (I4) and a second estate's cost is "not shared" rather than guessed (I7).
