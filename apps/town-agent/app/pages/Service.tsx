import type { ReactNode } from 'react';
import { Chip, Link } from '@ap-town/town-ui';
import { lit, shapeOf } from '../scenes';
import type { TownData } from '../types';
import { Glyph, Health } from '../ui';

const repoUrl = (repo: string): string => (repo === 'ap-town' ? 'https://github.com/agentictrustlabs/ap-town' : `https://github.com/${repo}`);

export function Service({ t, id }: { t: TownData; id: string }): ReactNode {
  const s = t.services.find((x) => x.id === id);
  if (!s) return <section><h1>No such service</h1><p className="lede">“{id}” is not listed in the {t.town} town. <Link href="/operations">See what is.</Link></p></section>;
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
        <div className="signals">
          <div className="signal signal-yes"><span className="signal-head">● Listed</span><span className="signal-detail">In the town manifest, deployed from {s.repo}.</span></div>
          <div className={`signal signal-${s.signals.healthy === 'down' ? 'warn' : s.signals.healthy === 'unobserved' ? 'unknown' : 'yes'}`}><span className="signal-head">{s.signals.healthy === 'down' ? '▲' : s.signals.healthy === 'unobserved' ? '?' : '●'} Healthy</span><span className="signal-detail"><Health s={s} />{s.signals.healthDetail ? ` — ${s.signals.healthDetail}` : ''}</span></div>
          <div className="signal signal-unknown"><span className="signal-head">? Compatible</span><span className="signal-detail">{s.signals.compatibleDetail}</span></div>
          <div className="signal signal-none"><span className="signal-head">— Authorized</span><span className="signal-detail">{s.authorized}</span></div>
        </div>
      </section>
      <section>
        <dl className="kv">
          {s.hosts.length > 0 && <><dt>Hosts</dt><dd>{s.hosts.map((h) => <span key={h}><a href={`https://${h}`} rel="noreferrer" className="mono">{h}</a> </span>)}</dd></>}
          {s.agentName && <><dt>Agent name</dt><dd className="mono">{s.agentName}</dd></>}
          {s.card && <><dt>Agent card</dt><dd><a href={s.card} rel="noreferrer" className="mono break">{s.card}</a></dd></>}
          <dt>Repository</dt><dd><a href={repoUrl(s.repo)} rel="noreferrer">{s.repo}</a></dd>
          <dt>Serves</dt><dd>{s.estates.join(', ')}</dd>
        </dl>
      </section>
    </>
  );
}
