// WHAT THE TOWN COSTS — spec 437 I2/I3/I4/I6, the breakout. The Infra tab answers "is it up"; this one answers
// "where does the money go", and the two rules that shape it are not presentation:
//
//   · A BASIS IS NEVER SUMMED WITH ANOTHER (I2). Billed is what a provider invoiced, effective is what it will
//     charge after credits, derived is a meter times our own `pricing.json`. Adding them makes a number that is
//     true of nothing, so there is no grand total on this page — there are three, each labelled, each with the
//     lag that is its own.
//   · A PARTIAL READ IS PARTIAL (I3). A day that could not be read is missing, not zero, and every total built
//     over one says so. A smaller number is the failure mode to refuse.
//
// Attribution is DECLARED in town.yaml (I4), so a row's owner links to the estate or service that claims it and
// what nothing claims is shown rather than folded away. Amounts are the operator's read, as everywhere.
import type { ReactNode } from 'react';
import { Bar, Chip, Empty, Link, SectionHead, Sparkline, Stat, BasisBadge, LagBadge, fmtUsd } from '@ap-town/town-ui';
import type { TownData } from '../types';
import type { PerfView } from './InfraTabs';

type CostRow = PerfView['cost'][number];
type Basis = CostRow['basis'];
const BASIS_ORDER: Basis[] = ['billed', 'effective', 'derived'];
const BASIS_WORD: Record<Basis, string> = {
  billed: 'what the provider has invoiced',
  effective: 'what it will charge after credits and discounts',
  derived: 'our own meter readings priced by pricing.json',
};
const LAG: Record<Basis, 'hourly' | 'daily-restated'> = { billed: 'daily-restated', effective: 'daily-restated', derived: 'hourly' };
const PLATFORM: Record<string, string> = { cloudflare: 'Cloudflare', vercel: 'Vercel', azure: 'Azure', graphdb: 'GraphDB', 'chain-node': 'Chain node' };

const total = (rows: CostRow[]): number => rows.reduce((n, r) => n + r.days.reduce((m, d) => m + d.amountMicroUsd, 0), 0);
const partial = (rows: CostRow[]): boolean => rows.some((r) => r.days.some((d) => !d.complete));
const ownerKey = (o: CostRow['owner']): string => (o ? `${o.kind}:${o.id}` : 'unattributed');
const ownerCell = (o: CostRow['owner']): ReactNode =>
  o ? <Link href={`/${o.kind}/${o.id}`}><Chip tone={o.kind === 'estate' ? 'ok' : 'free'}>{o.kind} · {o.id}</Chip></Link> : <Chip tone="warn">unattributed</Chip>;
const accountLabel = (t: TownData, platform: string, account: string): string => {
  const a = t.accounts;
  if (platform === 'cloudflare') return a?.cloudflare?.find((x) => x.id === account)?.label ?? account.slice(0, 10);
  if (platform === 'vercel') return a?.vercel?.label ?? account;
  if (platform === 'azure') return a?.azure?.label ?? account.slice(0, 8);
  return account;
};
/** Rows grouped, kept in descending order of what they cost — the question is where the money goes. */
function group<K extends string>(rows: CostRow[], key: (r: CostRow) => K): Array<{ key: K; rows: CostRow[] }> {
  const m = new Map<K, CostRow[]>();
  for (const r of rows) m.set(key(r), [...(m.get(key(r)) ?? []), r]);
  return [...m.entries()].map(([k, rs]) => ({ key: k, rows: rs })).sort((a, b) => total(b.rows) - total(a.rows));
}

export function CostTab({ t, perf, window, onWindow }: { t: TownData; perf: PerfView; window: string; onWindow: (w: '7d') => void }): ReactNode {
  if (perf.unavailable) return <section><h2>Cost</h2><Empty title="The town's MCP could not be asked.">{perf.unavailable}</Empty></section>;
  if (!perf.detail) {
    return (
      <section>
        <SectionHead eyebrow="What the town costs" title="Cost">
          Every amount on this page is the operator&rsquo;s read. Status and what runs where are public and are on
          the <Link href="/operations/infra">Infra</Link> tab; money is not.
        </SectionHead>
        <Empty title="Connect, and the amounts are here.">
          <strong>Connect</strong> in the corner signs you in at your own Home; if this town&rsquo;s manifest lists
          you as one of its operators, the amounts open with no secret to find. A shared token still works for
          scripts — <span className="mono">TOWN_OPS_TOKEN</span> through <strong>Operator</strong> beside the tabs —
          but a person should not have to paste one. Either way it unlocks a READ and grants nothing: the town acts
          for nobody, and no amount here is anybody&rsquo;s Home.
        </Empty>
      </section>
    );
  }
  const rows = perf.cost;
  if (!rows.length) {
    return (
      <section>
        <SectionHead eyebrow="What the town costs" title="Cost" />
        {/* A DAY IS THE SMALLEST UNIT COST HAS. The pass runs once a day over whole days, so a 24h window can be
            structurally empty while the money is perfectly well known — an empty page that is an artefact of the
            window, not a fact about spending, and it should say which. */}
        <Empty title={window === '24h' ? 'Cost is measured by the day, and this window is one.' : 'No cost rows in this window.'}>
          The cost pass runs daily at 06:30 UTC — billed figures from Vercel and Azure for the last seven days,
          derived figures from yesterday&rsquo;s Cloudflare meters. {window === '24h'
            ? <>Nothing is missing; the window is simply shorter than the grain. <button type="button" className="linkish" onClick={() => onWindow('7d')}>Show the last 7 days</button>.</>
            : <>A window this long holding none means no pass has landed yet.</>}
        </Empty>
      </section>
    );
  }
  const byBasis = BASIS_ORDER.map((b) => ({ basis: b, rows: rows.filter((r) => r.basis === b) })).filter((x) => x.rows.length);
  /** How many distinct days a set of rows actually carries — the honest span of a basis total. */
  const daysCovered = (rs: CostRow[]): number => new Set(rs.flatMap((r) => r.days.map((d) => d.day))).size;
  const runningMonth = perf.months.find((m) => m.toDate);
  const monthBilled = runningMonth ? { micro: runningMonth.amountMicroUsd, through: runningMonth.throughDay } : null;
  const days = perf.days;
  const dayTotal = (rs: CostRow[], day: string): number => rs.reduce((n, r) => n + (r.days.find((d) => d.day === day)?.amountMicroUsd ?? 0), 0);

  return (
    <>
      <section>
        <SectionHead eyebrow="What the town costs" title="Cost" id="cost">
          Three numbers, never one: a basis says what a figure IS, and adding two of them makes a total that is true
          of nothing. Billed and effective restate for up to 72 h; derived follows the meters hourly.
        </SectionHead>
        <Worth months={perf.months} rows={rows} days={days} />
        {/* TWO KINDS OF TOTAL ON ONE PAGE, and they must not be mistaken for each other. The provider's MONTH is
            the authoritative figure and the only one that covers the whole month; the basis tiles sum the DAILY
            rows this window holds, and Azure's collector keeps a rolling week of those. Reading $187 billed
            beside "this month $323.85" looks like a contradiction until each says what it counts. */}
        <div className="stats">
          {monthBilled !== null && (
            <Stat label="This month, billed" value={fmtUsd(monthBilled.micro)}
              sub={<>the provider&rsquo;s own month, through {monthBilled.through} <LagBadge lag="daily-restated" /></>} />
          )}
          {byBasis.map(({ basis, rows: rs }) => (
            <Stat key={basis} label={basis} value={fmtUsd(total(rs))}
              sub={<>{BASIS_WORD[basis]} · {daysCovered(rs)} day{daysCovered(rs) === 1 ? '' : 's'} of daily rows <LagBadge lag={LAG[basis]} /></>}
              {...(partial(rs) ? { tone: 'warn' as const } : {})} />
          ))}
        </div>
        {monthBilled !== null && (
          <p className="quiet">The month is the provider&rsquo;s own figure and covers every day of it. The three
          basis totals are the daily rows this window holds — fewer days, and a different question: what the
          tables below are made of.</p>
        )}
        {perf.readAs?.by === 'connection' && (
          <p className="quiet">Read as <strong>{perf.readAs.name ?? perf.readAs.agent}</strong>, whom this town&rsquo;s
          manifest lists as one of its operators — your Home said who you are and the town checked its own list.
          No token was pasted and none was needed.</p>
        )}
        {byBasis.some(({ rows: rs }) => partial(rs)) && (
          <p className="quiet"><Chip tone="warn">partial</Chip> At least one day or one source could not be read. Those
          totals are smaller than the truth, and are marked rather than quietly completed.</p>
        )}
      </section>

      {perf.months.length > 0 && <Months months={perf.months} />}

      <section>
        <SectionHead eyebrow="Who spends it" title="By owner" id="by-owner">
          Attribution is declared in <span className="mono">town.yaml</span>, never inferred — each owner links to
          its own page, where the same figure sits beside the resources it pays for.
        </SectionHead>
        <table className="table">
          <thead><tr><th scope="col">Owner</th>{BASIS_ORDER.map((b) => <th key={b} scope="col" className="num">{b}</th>)}<th scope="col">Platforms</th><th scope="col">Complete</th></tr></thead>
          <tbody>{group(rows, (r) => ownerKey(r.owner)).map(({ key, rows: rs }) => (
            <tr key={key}>
              <th scope="row">{ownerCell(rs[0]!.owner)}</th>
              {BASIS_ORDER.map((b) => { const m = rs.filter((r) => r.basis === b); return <td key={b} className="num">{m.length ? fmtUsd(total(m)) : <span className="quiet">—</span>}</td>; })}
              <td className="quiet">{[...new Set(rs.map((r) => PLATFORM[r.platform] ?? r.platform))].join(', ')}</td>
              <td>{partial(rs) ? <Chip tone="warn">partial</Chip> : <Chip tone="ok">complete</Chip>}</td>
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section>
        <SectionHead eyebrow="Where it is spent" title="By platform and account" id="by-platform">
          One account is read with one read-only token by the town&rsquo;s own MCP. A platform missing from this
          table is one that billed nothing in the window, or one that could not be read — the{' '}
          <Link href="/operations/infra">Infra</Link> tab says which.
        </SectionHead>
        <table className="table">
          <thead><tr><th scope="col">Platform · account</th><th scope="col">Basis</th><th scope="col" className="num">Total</th><th scope="col" className="num">Per day</th><th scope="col">Owners</th></tr></thead>
          <tbody>{group(rows, (r) => `${r.platform}|${r.account}|${r.basis}`).map(({ key, rows: rs }) => {
            const r0 = rs[0]!;
            return (
              <tr key={key}>
                <th scope="row">{PLATFORM[r0.platform] ?? r0.platform} <span className="quiet mono">{accountLabel(t, r0.platform, r0.account)}</span></th>
                <td><BasisBadge basis={r0.basis} /></td>
                <td className="num">{fmtUsd(total(rs))}</td>
                <td className="num"><Sparkline points={days.map((d) => dayTotal(rs, d))} label="per day" /></td>
                <td className="quiet">{[...new Set(rs.map((r) => (r.owner ? r.owner.id : 'unattributed')))].join(', ')}</td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>

      {perf.months.length > 0 && (() => {
        const m = perf.months[perf.months.length - 1]!;
        if (!m.byService.length) return null;
        const t = m.byService.reduce((n, x) => n + x.amountMicroUsd, 0);
        return (
          <section>
            <SectionHead eyebrow="What the money bought" title={`By service · ${m.month}${m.toDate ? ' so far' : ''}`} id="by-service">
              The provider&rsquo;s own naming of what was bought, biggest first. This is the line that answers
              &ldquo;why is this month different&rdquo; — a service that appears, or doubles, is the whole story.
            </SectionHead>
            <table className="table">
              <thead><tr><th scope="col">Service</th><th scope="col" className="num">Cost</th><th scope="col" className="num">Share</th><th scope="col">&nbsp;</th></tr></thead>
              <tbody>{m.byService.map((x) => (
                <tr key={x.key}>
                  <th scope="row">{x.key}</th>
                  <td className="num">{fmtUsd(x.amountMicroUsd)}</td>
                  <td className="num">{t > 0 ? `${((x.amountMicroUsd / t) * 100).toFixed(1)}%` : '—'}</td>
                  <td><Bar ratio={t > 0 ? x.amountMicroUsd / t : 0} /></td>
                </tr>
              ))}</tbody>
            </table>
          </section>
        );
      })()}

      <section>
        <SectionHead eyebrow="Day by day" title="Per day" id="per-day">
          A day is missing, not zero, when its read did not land — the cost pass restates, so a later read of the
          same day supersedes the earlier one.
        </SectionHead>
        <table className="table table-tight">
          <thead><tr><th scope="col">Day</th>{BASIS_ORDER.filter((b) => rows.some((r) => r.basis === b)).map((b) => <th key={b} scope="col" className="num">{b}</th>)}</tr></thead>
          <tbody>{[...days].reverse().map((day) => (
            <tr key={day}>
              <th scope="row" className="mono">{day}</th>
              {BASIS_ORDER.filter((b) => rows.some((r) => r.basis === b)).map((b) => {
                const rs = rows.filter((r) => r.basis === b);
                const has = rs.some((r) => r.days.some((d) => d.day === day));
                return <td key={b} className="num">{has ? fmtUsd(dayTotal(rs, day)) : <span className="quiet" title="not read for this day">—</span>}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </section>

      <section>
        <SectionHead eyebrow="What a run costs" title="Cost per completed run" id="per-run">
          Spec 437 I6 — the inference the estate&rsquo;s receipts record plus the infrastructure attributed to it,
          over the runs it completed. Both components are shown because they move for different reasons.
        </SectionHead>
        {Object.keys(perf.costPerCompletedRun).length === 0 ? <p className="quiet">No estate reported completed runs in this window.</p> : (
          <table className="table table-tight">
            <thead><tr><th scope="col">Estate</th><th scope="col" className="num">Per run</th><th scope="col" className="num">Inference</th><th scope="col" className="num">Infrastructure</th><th scope="col" className="num">Runs</th><th scope="col">Complete</th></tr></thead>
            <tbody>{Object.entries(perf.costPerCompletedRun).map(([id, c]) => (
              <tr key={id}>
                <th scope="row"><Link href={`/estate/${id}`}>{id}</Link></th>
                <td className="num">{c.microUsd === null ? <span className="quiet">not yet</span> : fmtUsd(c.microUsd)}</td>
                <td className="num">{fmtUsd(c.inferenceMicroUsd)}</td>
                <td className="num">{c.infraMicroUsd === null ? <span className="quiet">—</span> : <>{fmtUsd(c.infraMicroUsd)} {c.infraBasis ? <BasisBadge basis={c.infraBasis} /> : null}</>}</td>
                <td className="num">{c.completedRuns}</td>
                <td>{c.complete ? <Chip tone="ok">complete</Chip> : <Chip tone="warn">partial</Chip>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>

      {t.vendors && t.vendors.length > 0 && (
        <section>
          <SectionHead eyebrow="What nothing meters" title="The rest of what we run on" id="vendors">
            Four platforms have APIs that answer, so four platforms are on this page in dollars. The rest of the
            bill is just as real: source hosting and the CI that builds it, a package registry, eight domains, a
            key service, a graph database. They are declared in <span className="mono">town.yaml</span> and shown
            here so that the easy half is not mistaken for the whole — <strong>no amounts</strong>, because these
            are read from the providers&rsquo; own invoices and that is where to read them.
          </SectionHead>
          <table className="table">
            <thead><tr><th scope="col">What</th><th scope="col">Billing</th><th scope="col">Measured here</th><th scope="col">Where the bill is</th></tr></thead>
            <tbody>{t.vendors.map((v) => (
              <tr key={v.id}>
                <th scope="row"><span className="mono">{v.id}</span><br /><span className="quiet">{v.what}</span>{v.note && <><br /><span className="quiet">{v.note}</span></>}</th>
                <td><Chip tone={v.billing === 'free' ? 'ok' : v.billing === 'plan' ? 'free' : 'muted'}>{v.billing}</Chip></td>
                <td>{v.metered ? <Chip tone="ok">on this page</Chip> : <span className="quiet">not metered</span>}</td>
                <td className="quiet mono break">{v.where ?? '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <section>
        <SectionHead eyebrow="Owned by nobody in the manifest" title="Unattributed" id="unattributed">
          Money nothing in <span className="mono">town.yaml</span> claims. It is shown rather than folded into a
          total, because an unclaimed cost is a question about the manifest, not a rounding error.
        </SectionHead>
        {rows.every((r) => r.owner) ? <p className="quiet">Every cost row in this window belongs to a declared estate or service.</p> : (
          <table className="table table-tight">
            <thead><tr><th scope="col">Platform · account</th><th scope="col">Basis</th><th scope="col" className="num">Total</th></tr></thead>
            <tbody>{group(rows.filter((r) => !r.owner), (r) => `${r.platform}|${r.account}|${r.basis}`).map(({ key, rows: rs }) => (
              <tr key={key}><th scope="row">{PLATFORM[rs[0]!.platform] ?? rs[0]!.platform} <span className="quiet mono">{accountLabel(t, rs[0]!.platform, rs[0]!.account)}</span></th><td><BasisBadge basis={rs[0]!.basis} /></td><td className="num">{fmtUsd(total(rs))}</td></tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </>
  );
}

/** A month is only legible against the ones before it, so the history is a table with the change carried in it —
 *  and the running month is NEVER compared as though it were finished (its `toDate` is the whole point). The
 *  split is the provider's own naming of what was bought, which is what answers "why is this month different". */
function Months({ months }: { months: PerfView['months'] }): ReactNode {
  const done = months.filter((m) => !m.toDate);
  const running = months.filter((m) => m.toDate);
  // THE BASELINE MUST NOT DROP THE MONTH THAT MATTERS. An average over "the six before the latest" quietly
  // excluded September — the $770 month this one is actually being compared with — and read as though spending
  // had exploded when it has roughly halved. The window is the last six FINISHED months, the months it covers
  // are named, and the previous month is given on its own because an average over an outlier hides it.
  const recent = done.slice(-6);
  const typical = recent.length ? recent.reduce((n, m) => n + m.amountMicroUsd, 0) / recent.length : null;
  const last = done[done.length - 1];
  const shown = [...months].reverse();
  const prevOf = (i: number): typeof months[number] | undefined => shown[i + 1];
  const top = (m: typeof months[number], n: number): string =>
    m.byService.slice(0, n).map((x) => `${x.key} ${(x.amountMicroUsd / 1e6).toFixed(2)}`).join(' · ') || '—';
  // A SUBSCRIPTION IS NOT A TOWN: the total is everything billed to the account, and this one also pays for work
  // that is not the town's. The claimed part is computed where the manifest is (the worker) and read here.
  const mine = (m: typeof months[number]): number | null => m.claimedMicroUsd;
  return (
    <section>
      <SectionHead eyebrow="The baseline a window cannot give" title="Month by month" id="months">
        Whole months as the provider billed them, newest first. The change is against the month before; the month
        still running carries what it has spent SO FAR and is never compared as though it were finished.
        <strong> The total is the whole subscription</strong> — this one also pays for work that is not the
        town&rsquo;s — so each month also shows the part billed to a scope <span className="mono">town.yaml</span> claims.
      </SectionHead>
      {typical !== null && running.length > 0 && (
        <p className="lede">
          This month through {running[0]!.throughDay}: <strong>{fmtUsd(running[0]!.amountMicroUsd)}</strong>
          {last && <span className="quiet"> · {last.month} finished at {fmtUsd(last.amountMicroUsd)}</span>}
          <span className="quiet"> · the {recent.length} finished month{recent.length === 1 ? '' : 's'} {recent[0]!.month}–{recent[recent.length - 1]!.month} averaged {fmtUsd(Math.round(typical))}</span>
        </p>
      )}
      <table className="table">
        <thead><tr><th scope="col">Month</th><th scope="col" className="num">Total</th><th scope="col" className="num">The town&rsquo;s</th><th scope="col" className="num">Change</th><th scope="col">Mostly</th><th scope="col">Scopes</th></tr></thead>
        <tbody>{shown.map((m, i) => {
          const prev = prevOf(i);
          // A running month against a finished one is not a comparison, so it is not drawn as one.
          const delta = prev && !m.toDate && !prev.toDate && prev.amountMicroUsd > 0 ? (m.amountMicroUsd - prev.amountMicroUsd) / prev.amountMicroUsd : null;
          return (
            <tr key={`${m.platform}|${m.account}|${m.month}`}>
              <th scope="row" className="mono">{m.month}{m.toDate && <> <Chip tone="warn">through {m.throughDay.slice(8)}</Chip></>}</th>
              <td className="num">{m.ok ? fmtUsd(m.amountMicroUsd) : <span className="quiet">unreadable</span>}</td>
              <td className="num">{(() => { const t2 = mine(m); return t2 === null ? <span className="quiet">—</span> : <>{fmtUsd(t2)} <span className="quiet">{m.amountMicroUsd > 0 ? `${Math.round((t2 / m.amountMicroUsd) * 100)}%` : ''}</span></>; })()}</td>
              {/* A change of −0.4% printed as "-0%", which reads as a bug rather than as "the same". */}
              <td className="num">{delta === null ? <span className="quiet">—</span> : <span style={{ color: delta > 0.15 ? 'var(--warn-ink, #92400e)' : undefined }}>{Math.round(delta * 100) === 0 ? '0%' : `${delta > 0 ? '+' : ''}${(delta * 100).toFixed(0)}%`}</span>}</td>
              <td className="quiet">{top(m, 3)}</td>
              <td className="quiet">{m.byScope.slice(0, 3).map((x) => x.key).join(', ') || '—'}</td>
            </tr>
          );
        })}</tbody>
      </table>
      {months.some((m) => m.error) && <p className="quiet"><Chip tone="warn">partial</Chip> {months.find((m) => m.error)!.error}</p>}
      <p className="quiet">Billed figures restate for up to 72 h, so a recent month can still move. Read from the
      provider&rsquo;s own history, not accumulated from this town&rsquo;s daily rows — only a platform that serves
      months appears here.</p>
    </section>
  );
}

/**
 * WHAT IS BIG, AND WHAT CHANGED — the two questions a cost page is actually opened with, answered before the
 * tables that let you check the answer.
 *
 * Everything here is DERIVED FROM THE FIGURES BELOW IT, never a second source: the biggest line is the biggest
 * line in the table, and the comparison is against this account's own finished months. Nothing is a threshold
 * somebody picked — a "25% of the bill" line is a fact about the mix, not a judgment that it is too much, and
 * the page says which it is.
 */
function Worth({ months, rows, days }: { months: PerfView['months']; rows: CostRow[]; days: string[] }): ReactNode {
  const running = months.find((m) => m.toDate);
  const done = months.filter((m) => !m.toDate);
  const recent = done.slice(-6);
  const baseline = recent.length ? recent.reduce((n, m) => n + m.amountMicroUsd, 0) / recent.length : null;

  // The biggest single thing the provider named, in the month that is running.
  const topService = running?.byService[0];
  const monthTotal = running?.amountMicroUsd ?? 0;
  const share = topService && monthTotal > 0 ? topService.amountMicroUsd / monthTotal : null;

  // The biggest owner across every platform in the window, by what it actually spends.
  const byOwner = new Map<string, { label: string; micro: number }>();
  for (const r of rows) {
    const k = ownerKey(r.owner);
    const cur = byOwner.get(k) ?? { label: r.owner ? `${r.owner.kind} · ${r.owner.id}` : 'unattributed', micro: 0 };
    cur.micro += r.days.reduce((n, d) => n + d.amountMicroUsd, 0);
    byOwner.set(k, cur);
  }
  const topOwner = [...byOwner.values()].sort((a, b) => b.micro - a.micro)[0];

  const notes: ReactNode[] = [];
  if (running && baseline !== null && baseline > 0) {
    const pace = running.amountMicroUsd / baseline;
    // Part of a month against a whole one is not a comparison; it is only one once the month is far enough in
    // to say something, and even then it is a PACE, said as a pace.
    const dayOfMonth = Number(running.throughDay.slice(8));
    if (dayOfMonth >= 7) {
      const projected = (running.amountMicroUsd / dayOfMonth) * 30;
      notes.push(
        <li key="pace">
          At {fmtUsd(running.amountMicroUsd)} through the {dayOfMonth}th, this month is on pace for about{' '}
          <strong>{fmtUsd(Math.round(projected))}</strong> against a recent monthly average of {fmtUsd(Math.round(baseline))}
          {projected > baseline * 1.25 ? ' — ahead of it' : projected < baseline * 0.75 ? ' — behind it' : ' — about the same'}.
          A pace is an arithmetic guess about days that have not happened.
        </li>,
      );
      void pace;
    }
  }
  if (topService && share !== null) {
    notes.push(<li key="svc"><strong>{topService.key}</strong> is {fmtUsd(topService.amountMicroUsd)} of the month, {Math.round(share * 100)}% of it. That is the mix, not a verdict.</li>);
  }
  if (topOwner && topOwner.micro > 0) {
    notes.push(<li key="owner">Most of what this window can attribute belongs to <strong>{topOwner.label}</strong> ({fmtUsd(topOwner.micro)}).</li>);
  }
  const unread = rows.filter((r) => r.days.some((d) => !d.complete)).length;
  if (unread) notes.push(<li key="partial">{unread} row{unread === 1 ? ' has a day' : 's have days'} that could not be read, so every total here is smaller than the truth rather than wrong.</li>);
  if (!notes.length) return null;
  void days;
  return (
    <div className="panel" style={{ marginBottom: 'var(--sp-4)' }}>
      <p className="eyebrow" style={{ margin: '0 0 6px' }}>Worth a look</p>
      <ul className="plain" style={{ margin: 0 }}>{notes}</ul>
    </div>
  );
}
