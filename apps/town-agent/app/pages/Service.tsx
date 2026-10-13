import { useState, type ReactNode } from 'react';
import { Chip, Empty, LagBadge, Link, SectionHead, fmtUsd, fmtAgo } from '@ap-town/town-ui';
import { lit, shapeOf } from '../scenes';
import type { TownData } from '../types';
import { Glyph, Health } from '../ui';
import { readToken, usePulse } from '../pulse/use-pulse';

const repoUrl = (repo: string): string => (repo === 'ap-town' ? 'https://github.com/agentictrustlabs/ap-town' : `https://github.com/${repo}`);

/** WHAT THIS SERVICE RUNS ON, AND WHAT IT COSTS — the other end of the Pulse's owner link (spec 437 I4).
 *
 *  A cost row on the Infra tab says "service · kms — $143.52"; from here the same figure is reached from the
 *  thing that spends it, with the resources it is made of beside it. The amounts are the operator's read, as
 *  everywhere: without the token the resources and their status still show and the money says who may see it,
 *  which is a different sentence from zero. */
function RunsOn({ id }: { id: string }): ReactNode {
  const [token] = useState<string | null>(readToken);
  const pulse = usePulse('7d', token);
  if (pulse.state !== 'ready') return null;
  const perf = pulse.data.performance;
  const mine = perf.infrastructure.filter((r) => r.owner?.kind === 'service' && r.owner.id === id);
  const cost = perf.cost.filter((c) => c.owner?.kind === 'service' && c.owner.id === id);
  if (!mine.length && !cost.length) return null;
  const total = cost.reduce((n, c) => n + c.days.reduce((m, d) => m + d.amountMicroUsd, 0), 0);
  const partial = cost.some((c) => c.days.some((d) => !d.complete)) || mine.some((r) => !r.latest?.ok);
  return (
    <section>
      <SectionHead eyebrow="What it runs on" title="Infrastructure and cost">
        The platform resources <span className="mono">town.yaml</span> declares as this service&rsquo;s, as the town&rsquo;s
        own MCP last read them. Amounts are billed by the provider and restate for up to 72 h.{' '}
        <Link href="/operations/infra">All of the town&rsquo;s infrastructure →</Link>
      </SectionHead>
      {cost.length > 0 && (
        <p className="lede">
          {perf.detail ? <><strong>{fmtUsd(total)}</strong> over the last 7 days</> : <>Cost over the last 7 days is the operator&rsquo;s read</>}
          {partial && <> · <Chip tone="warn">partial</Chip> at least one day or one resource could not be read, so this is never a smaller total</>}
        </p>
      )}
      {mine.length > 0 && (
        <table className="table table-tight">
          <thead><tr><th scope="col">Resource</th><th scope="col">Kind</th><th scope="col">Status</th><th scope="col">As of</th></tr></thead>
          <tbody>{mine.map((r) => (
            <tr key={`${r.platform}|${r.resource}|${r.latest?.lagClass ?? ''}`}>
              <th scope="row" className="mono">{r.resource}</th>
              <td>{r.kind}</td>
              <td>{r.latest?.ok ? <Chip tone={r.latest.status === 'up' ? 'ok' : r.latest.status === 'degraded' ? 'warn' : 'muted'}>{r.latest.status}</Chip> : <Chip tone="bad">unreadable</Chip>}</td>
              <td className="quiet">{fmtAgo(r.latest?.asOf)} <LagBadge lag={r.latest?.lagClass} /></td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </section>
  );
}

export function Service({ t, id }: { t: TownData; id: string }): ReactNode {
  const s = t.services.find((x) => x.id === id);
  if (!s) return (
    <section className="hero">
      <h1>No such service</h1>
      <Empty title={`“${id}” is not listed in the ${t.town} town.`}>
        The town only shows what its manifest declares, so a service it has never been told about and one that does
        not exist read the same from here. <Link href="/operations">See what is listed →</Link>
      </Empty>
    </section>
  );
  return (
    <>
      <section className="title">
        <Glyph kind={shapeOf(s)} on={lit(s)} size={72} />
        <div>
          <h1>{s.id} <Chip tone={s.kind === 'commons' ? 'ok' : 'free'}>{s.kind}</Chip></h1>
          <p className="lede">{s.description}</p>
        </div>
      </section>
      <section aria-label="Signals">
        <SectionHead eyebrow="Four questions, kept apart" title="Signals">
          Whether it is listed, whether it answers, whether it speaks the protocol, and whether it may act for you.
          The first three are facts the town can check; the last is never one of them.
        </SectionHead>
        <div className="signals">
          <div className="signal signal-yes"><span className="signal-head">● Listed</span><span className="signal-detail">In the town manifest, deployed from {s.repo}.</span></div>
          <div className={`signal signal-${s.signals.healthy === 'down' ? 'warn' : s.signals.healthy === 'unobserved' ? 'unknown' : 'yes'}`}><span className="signal-head">{s.signals.healthy === 'down' ? '▲' : s.signals.healthy === 'unobserved' ? '?' : '●'} Healthy</span><span className="signal-detail"><Health s={s} />{s.signals.healthDetail ? ` — ${s.signals.healthDetail}` : ''}</span></div>
          <div className="signal signal-unknown"><span className="signal-head">? Compatible</span><span className="signal-detail">{s.signals.compatibleDetail}</span></div>
          <div className="signal signal-none"><span className="signal-head">— Authorized</span><span className="signal-detail">{s.authorized}</span></div>
        </div>
      </section>
      <section>
        <SectionHead eyebrow="Where it is and who built it" title="Where to find it" />
        <dl className="kv kv-facts">
          {s.hosts.length > 0 && <><dt>Hosts</dt><dd>{s.hosts.map((h) => <span key={h}><a href={`https://${h}`} rel="noreferrer" className="mono">{h}</a> </span>)}</dd></>}
          {s.agentName && <><dt>Agent name</dt><dd className="mono">{s.agentName}</dd></>}
          {s.card && <><dt>Agent card</dt><dd><a href={s.card} rel="noreferrer" className="mono break">{s.card}</a></dd></>}
          <dt>Repository</dt><dd><a href={repoUrl(s.repo)} rel="noreferrer">{s.repo}</a></dd>
          <dt>Serves</dt><dd>{s.estates.join(', ')}</dd>
        </dl>
      </section>
      <RunsOn id={s.id} />
    </>
  );
}
