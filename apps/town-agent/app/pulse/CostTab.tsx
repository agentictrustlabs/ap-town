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
import { Chip, Empty, Link, SectionHead, Sparkline, Stat, BasisBadge, LagBadge, fmtUsd } from '@ap-town/town-ui';
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
        <Empty title="Paste the town ops token to see the amounts.">
          The token is at the top right. It unlocks a READ and grants nothing — the town acts for nobody.
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
  const days = perf.days;
  const dayTotal = (rs: CostRow[], day: string): number => rs.reduce((n, r) => n + (r.days.find((d) => d.day === day)?.amountMicroUsd ?? 0), 0);

  return (
    <>
      <section>
        <SectionHead eyebrow="What the town costs" title="Cost" id="cost">
          Three numbers, never one: a basis says what a figure IS, and adding two of them makes a total that is true
          of nothing. Billed and effective restate for up to 72 h; derived follows the meters hourly.
        </SectionHead>
        <div className="stats">
          {byBasis.map(({ basis, rows: rs }) => (
            <Stat key={basis} label={basis} value={fmtUsd(total(rs))}
              sub={<>{BASIS_WORD[basis]} <LagBadge lag={LAG[basis]} /></>}
              {...(partial(rs) ? { tone: 'warn' as const } : {})} />
          ))}
          <Stat label="Window" value={`${days.length} day${days.length === 1 ? '' : 's'}`} sub={`${days[0] ?? '—'} → ${days[days.length - 1] ?? '—'}`} />
        </div>
        {byBasis.some(({ rows: rs }) => partial(rs)) && (
          <p className="quiet"><Chip tone="warn">partial</Chip> At least one day or one source could not be read. Those
          totals are smaller than the truth, and are marked rather than quietly completed.</p>
        )}
      </section>

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
