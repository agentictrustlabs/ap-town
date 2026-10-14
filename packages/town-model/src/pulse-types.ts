// The Pulse's records for infrastructure, cost and performance — spec 437 §3. Every sample names its source, its
// `asOf` and its LAG CLASS (I2); a failed read is `ok:false` + `error`, never zeros (I3); a cost is `derived` (meter ×
// published price) or `billed`, and the two are never summed without the label (I2). The town reads; nothing here acts.
export type LagClass = 'live' | '5min' | 'hourly' | 'daily-restated';
export type InfraPlatform = 'cloudflare' | 'vercel' | 'azure' | 'graphdb' | 'chain-node';
export type InfraResourceKind = 'worker' | 'durable-object' | 'd1' | 'kv' | 'queue' | 'workers-ai' | 'pages' | 'deployment' | 'vm' | 'repository' | 'node';

export interface InfraSampleV1 {
  type: 'ap.infra-sample.v1';
  platform: InfraPlatform;
  /** The account the resource lives in (a Cloudflare account id, the Vercel team, the Azure subscription, the GraphDB host). */
  account: string;
  resource: string;
  kind: InfraResourceKind;
  /** When the town took the sample; `asOf` is what the SOURCE says the numbers are current to. */
  at: string;
  asOf: string;
  lagClass: LagClass;
  status: 'up' | 'degraded' | 'down' | 'unknown';
  /** Named per platform (spec 437 §4): requests · errors · subrequests · cpuP50Ms · cpuP99Ms · wallP50Ms · wallP99Ms · rowsRead · rowsWritten · queryBatchTimeMs · storageBytes · cpuPercent · memoryAvailableBytes · deployAgeMs … */
  metrics: Record<string, number | null>;
  ok: boolean;
  error?: string;
}

/**
 * A WHOLE MONTH, AS THE PROVIDER BILLED IT — spec 437 I1/I2, the baseline the daily window cannot give.
 *
 * The daily rows answer "what is it costing now"; they are collected over a rolling few days and no window of
 * them can answer "is this month unusual". That question needs the provider's own history, so this is read from
 * the provider at month granularity and kept: one row per (platform, account, month, basis), with the month's
 * total and its split by whatever dimension the provider names things by (`byService`) and by resource group
 * (`byScope`, which is what the manifest attributes).
 *
 * `toDate: true` says the month is NOT OVER — the figure is the month so far, and comparing it with a finished
 * month as though they were the same kind of number is the mistake this flag exists to prevent. A later read of
 * the same month supersedes the earlier one, because billed figures restate.
 */
export interface CostMonthV1 {
  type: 'ap.cost-month.v1';
  platform: InfraPlatform;
  account: string;
  /** `YYYY-MM`. */
  month: string;
  basis: CostSampleV1['basis'];
  amountMicroUsd: number;
  /** The provider's own name for what was bought (Azure `ServiceName`), biggest first. */
  byService: Array<{ key: string; amountMicroUsd: number }>;
  /** The billing scope the manifest attributes — an Azure resource group — biggest first. */
  byScope: Array<{ key: string; amountMicroUsd: number }>;
  /** The month is still running: this is the total SO FAR, never a month to compare with a finished one. */
  toDate: boolean;
  /** The last day the figure covers (`YYYY-MM-DD`). On a running month this is what "so far" MEANS, and it is
   *  shown: a month-to-date through the 12th and one through the 13th are different numbers, and a reader
   *  comparing ours with the provider's console needs to know which they are holding. */
  throughDay: string;
  asOf: string;
  ok: boolean;
  error?: string;
}

export interface CostSampleV1 {
  type: 'ap.cost-sample.v1';
  platform: InfraPlatform;
  account: string;
  /** `YYYY-MM-DD` — one row per source per day; a later sample for the same day SUPERSEDES the earlier (restatement, I1). */
  day: string;
  resource: string;
  sku?: string;
  /** The billing scope the resource was billed under — an Azure resource GROUP. Carried so a per-resource row
   *  can still be attributed when the manifest claims the group rather than the individual resource: of the 21
   *  resources in these groups only the three VMs are declared, and the bastion, the database and the registry
   *  are most of the money. Attribution tries the resource first, then this. */
  scope?: string;
  amountMicroUsd: number;
  /**
   * How the number was arrived at — NEVER summed across bases without the label (I1):
   *   `derived`   our own meter reading × a published price (an estimate we computed);
   *   `billed`    what the provider says it INVOICED for the period;
   *   `effective` what the provider says the period CONSUMED, amortising committed and subscription spend.
   * `billed` and `effective` differ whenever usage falls inside a plan's included allowance: Vercel's FOCUS
   * stream reports `BilledCost: 0` on every row of a Pro team while `EffectiveCost` carries the real figure
   * (2026-10-10: $0.00 billed vs $27.41 effective over seven days). Reporting only the billed half would be
   * true and useless, so both are carried and each is labelled.
   */
  basis: 'derived' | 'billed' | 'effective';
  asOf: string;
  /** False when any scope of the read failed — the total is partial, never smaller (I3). */
  complete: boolean;
  ok: boolean;
  error?: string;
}

export interface PricingV1 {
  asOf: string;
  source: string;
  meters: Record<string, { unit: string; microUsdPerUnit: number; includedPerMonth?: number }>;
}

/** Spec 437 I4 — who owns which platform resources. Declared in `town.yaml`; a resource listed nowhere is UNATTRIBUTED and shown. */
export interface TownAccountsV1 {
  cloudflare?: Array<{ id: string; label: string }>;
  vercel?: { teamId: string; label?: string };
  azure?: { subscriptionId: string; resourceGroups: string[]; label?: string };
  graphdb?: { url: string; label?: string };
}
export interface ResourceOwnershipV1 {
  workers?: string[];
  pagesProjects?: string[];
  vercelProjects?: string[];
  azureResources?: string[];
}
export type AttributedOwner = { kind: 'town' | 'estate' | 'service' | 'application'; id: string };

export interface PerfQuantilesV1 { p50: number | null; p95: number | null; p99?: number | null; count: number }
export interface PerfReadV1 {
  window: { from: string; to: string };
  infrastructure: Array<{ platform: InfraPlatform; account: string; resource: string; kind: InfraResourceKind; owner: AttributedOwner | null; latest: InfraSampleV1 | null; series: Array<{ at: string; metrics: Record<string, number | null> }> }>;
  cost: Array<{ platform: InfraPlatform; account: string; owner: AttributedOwner | null; basis: 'derived' | 'billed' | 'effective'; days: Array<{ day: string; amountMicroUsd: number; asOf: string; complete: boolean }> }>;
  /**
   * WHAT EACH MACHINE COSTS — one row per billed resource over the window, biggest first.
   *
   * The `cost` rows above answer "what does this estate cost", which is the question a budget asks. This answers
   * the question anybody actually asks first — WHICH MACHINE — and, by carrying the cheapest and dearest day of
   * the window beside the mean, whether the amount moves at all. It mostly does not: an allocated VM costs the
   * same idle as it does saturated, so a flat line is the finding, not noise. Operator-only, like every amount.
   */
  costByResource: Array<{
    platform: InfraPlatform; account: string; resource: string;
    /** The billing scope it sat in — an Azure resource group — when that is not the resource itself. */
    scope?: string;
    owner: AttributedOwner | null; basis: 'derived' | 'billed' | 'effective';
    microUsd: number; days: number; perDayMicroUsd: number;
    /** Of those days, how many the provider has finished rating — the ones `perDay` and the spread are taken over.
     *  Fewer than `days` means the window's tail is still arriving, which is why its total reads low. */
    settledDays: number;
    /** The cheapest and dearest SETTLED day in the window: equal-ish ⇒ the cost is allocation, not load. */
    lowDayMicroUsd: number; highDayMicroUsd: number;
    complete: boolean;
  }>;
  /** Spec 437 I1 — whole months as the provider billed them, oldest first: the baseline the window cannot give.
   *  Operator-only like every other amount; empty on a public read. `claimedMicroUsd` is the part of the month
   *  billed to a scope the manifest CLAIMS — the total is the whole account, which pays for more than the town —
   *  and `null` when the provider would not give the scope split, which is different from nothing being claimed. */
  months: Array<CostMonthV1 & { claimedMicroUsd: number | null }>;
  /** Per estate: the provenance half of performance, as the estate reported it (`EstateHeartbeatV1.performance`). */
  provenance: Record<string, unknown | null>;
  /**
   * One estate's cost per completed run (I6). `infraBasis` names WHICH basis the infrastructure half was taken
   * on, because the bases are never added together (I1): one is chosen — billed if the provider actually
   * invoiced anything, else effective, else our own derived estimate — and said out loud. `null` when no
   * infrastructure cost was readable at all.
   */
  costPerCompletedRun: Record<string, { microUsd: number | null; inferenceMicroUsd: number; infraMicroUsd: number | null; infraBasis: 'derived' | 'billed' | 'effective' | null; completedRuns: number; complete: boolean; lag: LagClass[] }>;
  unattributed: Array<{ platform: InfraPlatform; account: string; resource: string; kind: InfraResourceKind }>;
  complete: boolean;
}
