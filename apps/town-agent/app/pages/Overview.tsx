import type { ReactNode } from 'react';
import { Link } from '@ap-town/town-ui';
import { townScene } from '../scenes';
import type { TownData } from '../types';
import { Glyph, Map, ServiceCard } from '../ui';
import { isPlaceKind } from '@ap-town/town-scene';

export function Overview({ t }: { t: TownData }): ReactNode {
  const commons = t.services.filter((s) => s.kind === 'commons');
  const apps = t.services.filter((s) => s.kind !== 'commons');
  const naming = t.services.find((s) => s.id === 'naming');
  const up = t.services.filter((s) => s.signals.healthy === 'up' || s.signals.healthy === 'self').length;
  const probed = t.services.filter((s) => s.signals.healthy !== 'unobserved').length;
  return (
    <>
      <section className="hero">
        <h1>The {t.town} town.</h1>
        <p className="lede">One chain ({t.chain.id}), the {t.estates.length === 1 ? 'estate' : `${t.estates.length} estates`} on it, and the services they share: names, the registry, the public graph, skills, key custody. Shared by all, owned by none. Nothing in a town grants anything.</p>
      </section>
      <section>
        <Map scene={townScene(t)} height={540} legend={`${t.estates.map((e) => `The ${e.id} estate`).join(', ')} — its Home, its gate and its people — with the commons at the end of the street and the applications beyond. Lit windows: the service answered its probe just now (${up} of ${probed}). Drag to look around and zoom in to read the names; press a building to open it.`} />
      </section>
      <section>
        <h2>Estates</h2>
        <div className="cards">
          {t.estates.map((e) => (
            <div key={e.id} className="card">
              <span className="card-head"><Glyph kind="org" /><span><span className="card-title">{e.id}</span><br /><span className="card-sub">an estate on this chain</span></span></span>
              <dl className="kv">
                <dt>Home</dt><dd><a href={e.home} rel="noreferrer">{new URL(e.home).host}</a></dd>
                <dt>Gate</dt><dd className="mono">{new URL(e.edge).host}</dd>
                <dt>Names under</dt><dd>{e.nameRoots.map((r) => `.${r}`).join(' ')}</dd>
                <dt>Repository</dt><dd><a href={`https://github.com/${e.repo}`} rel="noreferrer">{e.repo}</a></dd>
              </dl>
            </div>
          ))}
        </div>
      </section>
      {t.names && naming && (
        <section>
          <h2>Names</h2>
          <p className="lede">{t.names.total} names on the chain, under {t.names.roots.length} endings. The ending says what the agent is. <a href={`https://${naming.hosts[0]}`} rel="noreferrer">Open the naming service →</a></p>
          <div className="cards">
            {t.names.roots.filter((r) => r.count > 0).map((r) => (
              <a key={r.tld} href={`https://${naming.hosts[0]}/root/${r.tld}`} rel="noreferrer" className="card">
                <span className="card-head"><Glyph kind={isPlaceKind(r.kind) ? r.kind : 'legacy'} /><span><span className="card-title mono">.{r.tld}</span><br /><span className="card-sub">{r.names ? `names ${r.names}` : 'untyped (legacy)'} · {r.count}</span></span></span>
              </a>
            ))}
          </div>
        </section>
      )}
      <section>
        <h2>The commons</h2>
        <p className="quiet">Services every estate on the chain shares. Listed, probed, and never a permission.</p>
        <div className="cards">{commons.map((s) => <ServiceCard key={s.id} s={s} />)}</div>
      </section>
      {apps.length > 0 && (
        <section>
          <h2>Applications</h2>
          <p className="quiet">Things people use on the town's identity and names, deployed from their own repositories.</p>
          <div className="cards">{apps.map((s) => <ServiceCard key={s.id} s={s} />)}</div>
        </section>
      )}
      <section className="three">
        <div><h3>A listing is a fact</h3><p>The registry says an agent exists and what it offers. It never says you may use it.</p></div>
        <div><h3>Resolved from the chain</h3><p>A name, a card, an endpoint: each is read from the chain, not trusted from a directory.</p></div>
        <div><h3>Authority stays home</h3><p>What an agent may do for you is a delegation it signs, checked on chain. <Link href="/operations">How the town is run →</Link></p></div>
      </section>
    </>
  );
}
