// THE INFRA AND PERFORMANCE TABS — spec 437 §6. Every tile shows its `asOf` and lag class (I2); a derived cost wears the
// badge, a billed one its own (I2); an unreadable source is a banner and the total says `incomplete` (I3); the Unattributed
// bucket is a list, never hidden (I4); the two halves of performance sit side by side (I5); cost per completed run shows
// both components (I6). Status is public; amounts and metrics are the operator's (`detail`) — withheld, said so.
import { useState, type ReactNode } from 'react';
import { Chip, Empty, Link, SectionHead, Stat, Sparkline, LagBadge, BasisBadge, fmtInt, fmtUsd, fmtMs, fmtAgo, fmtBytes, fmtPct } from '@ap-town/town-ui';
import type { TownData } from '../types';
import type { PerfViewV1 } from '../../worker/pulse-perf';

/** The estate's performance block — Ring 0's `EstatePerformanceV1` (`@agenticprimitives/orchestration`), as the heartbeat carries it. */
interface Q { p50: number | null; p95: number | null; p99?: number | null; count: number }
export interface EstatePerf {
  type: 'ap.estate-performance.v1'; window: string; runs: { total: number; byOutcome: Record<string, number> }; runDurationMs: Q;
  stepDuration: Array<{ capability: string; risk: string | null; quantiles: Q; histogram: { count: number } }>;
  modelLatencyMs: Array<{ provider: string; profile: string | null; quantiles: Q; failed: number }>;
  parkedWaitMs: Q; vaultCallsPerRun: Q; doRequestsPerRun: Q; verdicts: Array<{ verdict: string; afterApproval: boolean; count: number }>; failureClasses: Array<{ failureClass: string; count: number }>; firstTokenMs: Q | null;
}
type InfraRow = PerfViewV1['infrastructure'][number];
/** The portal holds no provider credential: the town MCP collects, and when it cannot be asked the view says so. */
export type PerfView = PerfViewV1 & { unavailable?: string };
type ChainLatest = { latency?: { upstreamP50Ms?: number; upstreamP95Ms?: number }; totals?: { requests?: number } } | null;

const PLATFORM_LABEL: Record<string, string> = { cloudflare: 'Cloudflare', vercel: 'Vercel', azure: 'Azure', graphdb: 'GraphDB', 'chain-node': 'Chain node' };
const accountLabel = (t: TownData, platform: string, account: string): string => {
  const a = t.accounts;
  if (platform === 'cloudflare') return a?.cloudflare?.find((x) => x.id === account)?.label ?? account.slice(0, 8);
  if (platform === 'vercel') return a?.vercel?.label ?? account;
  if (platform === 'azure') return a?.azure?.label ?? (account || 'subscription');
  if (platform === 'graphdb') return a?.graphdb?.label ?? account.replace(/^https?:\/\//, '');
  return account;
};
// An owner is a LINK to the thing that owns it: a cost row of $143 means nothing until you can go and see what
// bastion, database and registry it pays for. Only an estate and a service have a page; the town itself does not.
const ownerChip = (o: InfraRow['owner']): ReactNode => {
  if (!o) return <Chip tone="warn">unattributed</Chip>;
  const chip = <Chip tone={o.kind === 'estate' ? 'ok' : o.kind === 'service' ? 'free' : 'muted'}>{o.kind} · {o.id}</Chip>;
  return o.kind === 'service' || o.kind === 'estate' ? <Link href={`/${o.kind}/${o.id}`}>{chip}</Link> : chip;
};
const statusChip = (r: InfraRow): ReactNode => { const s = r.latest; if (!s || !s.ok) return <Chip tone="bad">unreadable</Chip>; return <Chip tone={s.status === 'up' ? 'ok' : s.status === 'degraded' ? 'warn' : s.status === 'down' ? 'bad' : 'muted'}>{s.status}</Chip>; };
const q = (x: Q | null | undefined): string => (!x || !x.count ? '—' : `${fmtMs(x.p50)} · p95 ${fmtMs(x.p95)}`);
const sumQ = (xs: Q[]): number => xs.reduce((n, x) => n + x.count, 0);

/** The few metrics that say what a resource of this kind did; everything else is on the row's `metrics`. */
function keyMetrics(r: InfraRow): ReactNode {
  const m = r.latest?.metrics ?? {};
  const has = (k: string) => m[k] !== undefined && m[k] !== null;
  const parts: string[] = [];
  if (has('requests')) parts.push(`${fmtInt(m.requests!)} req`);
  if (has('errors') && has('requests') && m.requests) parts.push(`${fmtPct(m.errors! / m.requests!)} err`);
  if (has('cpuP50Ms')) parts.push(`cpu ${fmtMs(m.cpuP50Ms)} / p99 ${fmtMs(m.cpuP99Ms)}`);
  if (has('wallP99Ms')) parts.push(`wall p99 ${fmtMs(m.wallP99Ms)}`);
  if (has('rowsRead')) parts.push(`${fmtInt(m.rowsRead!)} rows read · ${fmtInt(m.rowsWritten ?? 0)} written`);
  if (has('queryBatchTimeMs')) parts.push(`query ${fmtMs(m.queryBatchTimeMs)} total`);
  if (has('storageBytes')) parts.push(fmtBytes(m.storageBytes));
  if (has('reads') && r.kind === 'kv') parts.push(`${fmtInt(m.reads!)} reads · ${fmtInt(m.writes ?? 0)} writes`);
  if (has('operations')) parts.push(`${fmtInt(m.operations!)} ops`);
  if (has('tokensIn')) parts.push(`${fmtInt(m.tokensIn!)} in · ${fmtInt(m.tokensOut ?? 0)} out`);
  if (has('deployAgeMs')) parts.push(`deployed ${fmtAgo(new Date(Date.now() - m.deployAgeMs!).toISOString())}${has('buildMs') ? ` · built in ${fmtMs(m.buildMs)}` : ''}`);
  if (has('cpuPercent')) parts.push(`cpu ${m.cpuPercent!.toFixed(0)}%${has('memoryAvailableBytes') ? ` · ${fmtBytes(m.memoryAvailableBytes)} free` : ''}`);
  if (has('heapUsedBytes')) parts.push(`heap ${fmtBytes(m.heapUsedBytes)} / ${fmtBytes(m.heapMaxBytes)}${has('threadCount') ? ` · ${m.threadCount} threads` : ''}`);
  if (has('statementsTotal')) parts.push(`${fmtInt(m.statementsTotal!)} statements`);
  if (has('available') && !parts.length) parts.push(m.available ? 'available' : 'unavailable');
  return parts.length ? <span>{parts.join(' · ')}</span> : <span className="quiet">—</span>;
}

export function Sources({ t, perf }: { t: TownData; perf: PerfView }): ReactNode {
  if (perf.unavailable) return <div className="banner banner-warn" role="alert"><strong>The town's own MCP could not be asked.</strong> {perf.unavailable} Infrastructure, cost and performance are collected by that MCP — the only thing in the town that holds a platform credential — so this page shows nothing rather than guessing.</div>;
  if (!perf.sources.length) return <div className="banner banner-warn"><strong>No infrastructure samples yet.</strong> The status pass runs every five minutes, metrics hourly, cost daily. A source with no token is shown as not configured, never as zero.</div>;
  return (
    <p className="sources">{perf.sources.map((s) => <span key={`${s.platform}|${s.account}`} className="source"><Chip tone={s.ok ? 'ok' : 'bad'}>{PLATFORM_LABEL[s.platform] ?? s.platform} · {accountLabel(t, s.platform, s.account)}</Chip> <LagBadge lag={s.lagClass} /> <span className="quiet">{s.ok ? `as of ${fmtAgo(s.asOf)}` : (s.error ?? 'unreadable')}</span></span>)}</p>
  );
}

/** How many of an account's resources are listed before the rest are asked for. */
const SHOW = 12;

export function InfraTab({ t, perf }: { t: TownData; perf: PerfView }): ReactNode {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = new Map<string, InfraRow[]>();
  for (const r of perf.infrastructure) { const k = `${r.platform}|${r.account}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const unattributedBy = new Map<string, number>();
  for (const u of perf.unattributed) { const k = `${u.platform}|${u.account}`; unattributedBy.set(k, (unattributedBy.get(k) ?? 0) + 1); }
  const costTotal = (days: PerfViewV1['cost'][number]['days']) => days.reduce((n, d) => n + d.amountMicroUsd, 0);
  return (
    <section>
      <SectionHead eyebrow="What the town runs on" title="Infrastructure" />
      <p className="lede">The platforms the town runs on — each account read with its own read-only token, each number labelled with how current it can be. Status is public; metrics and cost are the operator's.</p>
      <Sources t={t} perf={perf} />
      <p className="quiet">Collected by the town's own MCP (<span className="mono">faithchain-town-mcp</span>), which holds the read credentials and has no hostname of its own. This page asks it; it never holds a credential and never reaches a provider.</p>
      {!perf.detail && <div className="banner"><strong>Metrics and cost are withheld on the public read.</strong> An operator pastes the town ops token (top right) to see them; nothing here is zeroed to look complete.</div>}
      {!perf.complete && <div className="banner banner-warn"><strong>Incomplete.</strong> At least one source could not be read or a cost day is partial — totals on this page are partial, never smaller.</div>}
      <div className="cards">
        {[...groups.entries()].map(([k, rows]) => {
          const [platform, account] = k.split('|') as [string, string];
          const live = rows.filter((r) => r.latest?.ok);
          return (
            <article key={k} className="card card-wide">
              <span className="card-head"><span><span className="card-title">{PLATFORM_LABEL[platform] ?? platform}</span><br /><span className="card-sub mono">{accountLabel(t, platform, account)}</span></span><Chip tone={live.length === rows.length ? 'ok' : live.length ? 'warn' : 'bad'}>{live.length} / {rows.length} readable</Chip></span>
              <table className="table table-tight">
                <thead><tr><th scope="col">Resource</th><th scope="col">Kind</th><th scope="col">Owner</th><th scope="col">Status</th><th scope="col">As of</th>{perf.detail && <th scope="col">Last reading</th>}</tr></thead>
                <tbody>{(expanded.has(k) ? rows : rows.slice(0, SHOW)).map((r) => <tr key={`${r.resource}|${r.kind}|${r.latest?.lagClass ?? ''}`}><th scope="row" className="mono">{r.resource}</th><td>{r.kind}</td><td>{ownerChip(r.owner)}</td><td>{statusChip(r)}{r.latest && !r.latest.ok && <span className="quiet"> {r.latest.error}</span>}</td><td><span className="quiet">{fmtAgo(r.latest?.asOf)}</span> <LagBadge lag={r.latest?.lagClass} /></td>{perf.detail && <td>{keyMetrics(r)}{r.series.length > 1 && (r.series[0]?.metrics.requests !== undefined || r.series[0]?.metrics.cpuPercent !== undefined) && <> <Sparkline points={r.series.map((x) => x.metrics.requests ?? x.metrics.cpuPercent ?? null)} label="over the window" /></>}</td>}</tr>)}</tbody>
              </table>
              {rows.length > SHOW && (
                <p className="quiet">
                  <button type="button" className="linkish" onClick={() => setExpanded((e) => { const n = new Set(e); if (n.has(k)) n.delete(k); else n.add(k); return n; })}>
                    {expanded.has(k) ? `Show the first ${SHOW}` : `Show all ${rows.length}`}
                  </button>
                  {!expanded.has(k) && ` · ${rows.length - SHOW} more not shown`}
                </p>
              )}
            </article>
          );
        })}
      </div>
      <SectionHead eyebrow="What it costs" title="Cost over the window" />
      {!perf.detail ? <p className="quiet">Cost is the operator's read.</p> : perf.cost.length === 0 ? <p className="quiet">No cost rows yet — the cost pass runs daily at 06:30 UTC (Vercel and Azure billed for the last seven days; Cloudflare derived from yesterday's meters).</p> : (
        <table className="table">
          <thead><tr><th scope="col">Platform · account</th><th scope="col">Owner</th><th scope="col">Basis</th><th scope="col" className="num">Total</th><th scope="col" className="num">Days</th><th scope="col">As of</th><th scope="col">Complete</th></tr></thead>
          <tbody>{perf.cost.map((c, i) => <tr key={i}><th scope="row">{PLATFORM_LABEL[c.platform] ?? c.platform} <span className="quiet mono">{accountLabel(t, c.platform, c.account)}</span></th><td>{ownerChip(c.owner)}</td><td><BasisBadge basis={c.basis} /></td><td>{fmtUsd(costTotal(c.days))}</td><td>{c.days.length} / {perf.days.length}{c.days.length ? <> <Sparkline points={perf.days.map((d) => c.days.find((x) => x.day === d)?.amountMicroUsd ?? null)} label="per day" /></> : null}</td><td className="quiet">{fmtAgo(c.days[c.days.length - 1]?.asOf)} <LagBadge lag={c.basis === 'derived' ? 'hourly' : 'daily-restated'} /></td><td>{c.days.every((d) => d.complete) ? <Chip tone="ok">complete</Chip> : <Chip tone="warn">partial</Chip>}</td></tr>)}</tbody>
        </table>
      )}
      <SectionHead eyebrow="Owned by nobody in the manifest" title="Unattributed" />
      {perf.unattributed.length === 0 ? <p className="quiet">Every readable resource is listed under an estate or a service in <span className="mono">town.yaml</span>.</p> : (
        <>
          <p className="lede">Resources the platforms report that <span className="mono">town.yaml</span> lists under nobody — the inventory-drift detector. They are shown, never hidden; list each under its owner's <span className="mono">workers:</span> / <span className="mono">vercelProjects:</span> / <span className="mono">azureResources:</span>.</p>
          {/* Ninety-odd of these as one line each buried the rest of the page. The count and where they are is the
              finding; the names are what you need only once you go to fix it, so they are one press away. */}
          <div className="stats stats-tight">
            {[...unattributedBy.entries()].map(([k, n]) => { const [pl, acct] = k.split('|') as [string, string]; return <Stat key={k} label={PLATFORM_LABEL[pl] ?? pl} value={n} sub={accountLabel(t, pl, acct)} tone="warn" />; })}
          </div>
          <details className="more">
            <summary>Name all {perf.unattributed.length}</summary>
            <ul className="namelist">{perf.unattributed.map((u) => <li key={`${u.platform}|${u.account}|${u.kind}|${u.resource}`}><span className="mono">{u.resource}</span> <span className="quiet">{u.kind} · {PLATFORM_LABEL[u.platform] ?? u.platform}</span></li>)}</ul>
          </details>
        </>
      )}
    </section>
  );
}

export function PerformanceTab({ t, perf, chain }: { t: TownData; perf: PerfView; chain: ChainLatest }): ReactNode {
  const [estate, setEstate] = useState(t.estates[0]?.id ?? '');
  const prov = (perf.provenance[estate] ?? null) as EstatePerf | null;
  const cpr = perf.costPerCompletedRun[estate];
  const workers = perf.infrastructure.filter((r) => r.kind === 'worker' && r.latest?.ok).sort((a, b) => (b.latest?.metrics.requests ?? 0) - (a.latest?.metrics.requests ?? 0)).slice(0, 8);
  const d1 = perf.infrastructure.filter((r) => r.kind === 'd1' && r.latest?.ok && r.latest.metrics.queryBatchTimeMs !== undefined);
  const vms = perf.infrastructure.filter((r) => r.kind === 'vm' && r.latest?.ok && r.latest.metrics.cpuPercent !== undefined);
  return (
    <section>
      <SectionHead eyebrow="The run half and the infrastructure half" title="Performance">
        Two halves, side by side: what the infrastructure took (Worker CPU and wall time, D1 query time, chain
        upstream, the VM) and what the runs took (ask and run duration, each step, each model call, the wait for a
        signature) — the second as each estate reports it, aggregate only.
      </SectionHead>
      {t.estates.length > 1 && <p className="window-picker" role="group" aria-label="Estate">{t.estates.map((e) => <button key={e.id} type="button" className={`button button-quiet${e.id === estate ? ' is-on' : ''}`} aria-pressed={e.id === estate} onClick={() => setEstate(e.id)}>{e.id}</button>)}</p>}
      <section className="stats">
        <Stat
          label="Cost per completed run"
          value={cpr?.microUsd !== null && cpr?.microUsd !== undefined ? fmtUsd(cpr.microUsd) : null}
          absent={perf.detail ? 'nothing to divide yet' : 'the operator’s to see'}
          sub={cpr ? (perf.detail ? `${fmtUsd(cpr.inferenceMicroUsd)} inference + ${cpr.infraMicroUsd === null ? 'infra not attributed' : `${fmtUsd(cpr.infraMicroUsd)} infra (${cpr.infraBasis})`} ÷ ${fmtInt(cpr.completedRuns)} runs${cpr.complete ? '' : ' · incomplete'}` : `${fmtInt(cpr.completedRuns)} completed runs`) : 'no heartbeat'}
          tone={cpr && !cpr.complete ? 'warn' : undefined}
        />
        <Stat label="Runs in the block" value={prov ? fmtInt(prov.runs.total) : null} absent="no block yet" sub={prov ? Object.entries(prov.runs.byOutcome).map(([k, v]) => `${v} ${k}`).join(' · ') : 'the estate has not reported one'} />
        <Stat label="Run duration" value={prov ? fmtMs(prov.runDurationMs.p50) : null} absent="no block yet" sub={prov ? `p95 ${fmtMs(prov.runDurationMs.p95)} · ${prov.runDurationMs.count} runs` : undefined} />
        <Stat label="Waiting for a signature" value={prov && prov.parkedWaitMs.count ? fmtMs(prov.parkedWaitMs.p50) : null} absent={prov ? 'nothing parked' : 'no block yet'} sub={prov && prov.parkedWaitMs.count ? `p95 ${fmtMs(prov.parkedWaitMs.p95)}` : undefined} />
        <Stat label="Vault calls / run" value={prov && prov.vaultCallsPerRun.count ? String(prov.vaultCallsPerRun.p50) : null} absent="no block yet" sub={prov && prov.vaultCallsPerRun.count ? `p95 ${prov.vaultCallsPerRun.p95}` : undefined} />
        <Stat label="DO requests / run" value={prov && prov.doRequestsPerRun.count ? String(prov.doRequestsPerRun.p50) : null} absent="no block yet" sub={prov && prov.doRequestsPerRun.count ? `p95 ${prov.doRequestsPerRun.p95}` : undefined} />
        <Stat label="First token" value={prov?.firstTokenMs ? fmtMs(prov.firstTokenMs.p50) : null} absent={prov ? 'not streamed' : 'no block yet'} sub={prov?.firstTokenMs ? `p95 ${fmtMs(prov.firstTokenMs.p95)}` : undefined} />
      </section>
      {cpr && <p className="quiet">Lag: {cpr.lag.map((l) => <LagBadge key={l} lag={l} />)} — the heartbeat is sampled every five minutes; billed cost restates for up to 72 h.</p>}

      <SectionHead eyebrow="The infrastructure half" title="Infrastructure latency" />
      {!perf.detail ? (
        <Empty title="These are the operator's read.">
          What the infrastructure took is shown to whoever holds the town's ops token. Status and the estate's own
          aggregate counts are public and are on this page already.
        </Empty>
      ) : (
        <div className="cards">
          <article className="card card-wide">
            <span className="card-head"><span className="card-title">Workers</span><span className="quiet">top by requests, last reading</span></span>
            {workers.length === 0 ? <p className="quiet">No Worker readings yet (hourly).</p> : <table className="table table-tight"><thead><tr><th scope="col">Script</th><th scope="col" className="num">Requests</th><th scope="col" className="num">Errors</th><th scope="col" className="num">CPU p50 / p99</th><th scope="col" className="num">Wall p50 / p99</th></tr></thead><tbody>{workers.map((w) => { const m = w.latest!.metrics; return <tr key={w.resource}><th scope="row" className="mono">{w.resource}</th><td className="num">{fmtInt(m.requests ?? 0)}</td><td className="num">{m.requests ? fmtPct((m.errors ?? 0) / m.requests) : '—'}</td><td className="num">{fmtMs(m.cpuP50Ms)} / {fmtMs(m.cpuP99Ms)}</td><td className="num">{fmtMs(m.wallP50Ms)} / {fmtMs(m.wallP99Ms)}</td></tr>; })}</tbody></table>}
          </article>
          <article className="card">
            <span className="card-head"><span className="card-title">Chain upstream</span></span>
            <div className="stats stats-tight"><Stat label="p50" value={fmtMs(chain?.latency?.upstreamP50Ms)} /><Stat label="p95" value={fmtMs(chain?.latency?.upstreamP95Ms)} sub={chain?.totals?.requests !== undefined ? `${fmtInt(chain.totals.requests)} requests` : 'gateway not sampled'} /></div>
          </article>
          <article className="card">
            <span className="card-head"><span className="card-title">D1</span></span>
            {d1.length === 0 ? <p className="quiet">No D1 readings yet.</p> : <ul className="plain">{d1.map((r) => <li key={r.resource}><span className="mono">{r.resource.slice(0, 8)}…</span> query {fmtMs(r.latest!.metrics.queryBatchTimeMs)} total · {fmtInt(r.latest!.metrics.readQueries ?? 0)} reads</li>)}</ul>}
          </article>
          <article className="card">
            <span className="card-head"><span className="card-title">Chain node VM</span></span>
            {vms.length === 0 ? <p className="quiet">No VM readings (Azure not configured or no VM listed).</p> : <ul className="plain">{vms.map((r) => <li key={r.resource}><span className="mono">{r.resource}</span> cpu {r.latest!.metrics.cpuPercent!.toFixed(0)}% (max {r.latest!.metrics.cpuMaxPercent?.toFixed(0) ?? '—'}%) · {fmtBytes(r.latest!.metrics.memoryAvailableBytes)} free <LagBadge lag={r.latest!.lagClass} /></li>)}</ul>}
          </article>
        </div>
      )}

      <SectionHead eyebrow="The run half" title={`Run latency — ${estate}`} />
      {!prov ? <p className="quiet">This estate has not reported a performance block yet. Its runtime rolls the block up from its operator index (runs indexed since the column shipped); until then the Estates tab's ask p95 is the one latency it reports.</p> : (
        <div className="cards">
          <article className="card card-wide">
            <span className="card-head"><span className="card-title">Step duration by capability</span><span className="quiet">{sumQ(prov.stepDuration.map((s) => s.quantiles))} steps</span></span>
            {prov.stepDuration.length === 0 ? <p className="quiet">No steps in the window.</p> : <table className="table table-tight"><thead><tr><th scope="col">Capability</th><th scope="col">Risk</th><th scope="col" className="num">Steps</th><th scope="col" className="num">p50</th><th scope="col" className="num">p95</th></tr></thead><tbody>{prov.stepDuration.map((s) => <tr key={`${s.capability}|${s.risk}`}><th scope="row" className="mono">{s.capability}</th><td>{s.risk ?? '—'}</td><td className="num">{fmtInt(s.quantiles.count)}</td><td className="num">{fmtMs(s.quantiles.p50)}</td><td className="num">{fmtMs(s.quantiles.p95)}</td></tr>)}</tbody></table>}
          </article>
          <article className="card card-wide">
            <span className="card-head"><span className="card-title">Model latency by provider · profile</span></span>
            {prov.modelLatencyMs.length === 0 ? <p className="quiet">No model calls in the window.</p> : <table className="table table-tight"><thead><tr><th scope="col">Provider</th><th scope="col">Profile</th><th scope="col" className="num">Calls</th><th scope="col" className="num">p50</th><th scope="col" className="num">p95</th><th scope="col" className="num">Failed</th></tr></thead><tbody>{prov.modelLatencyMs.map((m) => <tr key={`${m.provider}|${m.profile}`}><th scope="row">{m.provider}</th><td className="mono">{m.profile ?? '—'}</td><td className="num">{fmtInt(m.quantiles.count)}</td><td className="num">{fmtMs(m.quantiles.p50)}</td><td className="num">{fmtMs(m.quantiles.p95)}</td><td>{m.failed ? <Chip tone="warn">{m.failed}</Chip> : '0'}</td></tr>)}</tbody></table>}
          </article>
          <article className="card">
            <span className="card-head"><span className="card-title">Authority verdicts</span></span>
            {prov.verdicts.length === 0 ? <p className="quiet">No verdicts in the window.</p> : <ul className="plain">{prov.verdicts.map((v) => <li key={`${v.verdict}|${v.afterApproval}`}><Chip tone={v.verdict === 'allow' ? 'ok' : 'warn'}>{v.verdict}</Chip> {fmtInt(v.count)}{v.afterApproval ? ' after an approval' : ''}</li>)}</ul>}
          </article>
          <article className="card">
            <span className="card-head"><span className="card-title">Failure classes</span></span>
            {prov.failureClasses.length === 0 ? <p className="quiet">No failures in the window.</p> : <ul className="plain">{prov.failureClasses.map((f) => <li key={f.failureClass}><span className="mono">{f.failureClass}</span> {fmtInt(f.count)}</li>)}</ul>}
          </article>
        </div>
      )}
      <p className="quiet">Spec 437 I5: the run half is computed at the estate from its own records and reported as quantiles — never a run ref, never a name. {q(prov?.runDurationMs)}</p>
    </section>
  );
}
