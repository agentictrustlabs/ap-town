import type { ReactNode } from 'react';
import { useApi } from '../api';
import type { TownView } from '../api-types';
import { Link, rootHref } from '../router';
import { Register } from '../register';
import { townScene } from '../scenes';
import { Glyph, Loading, Map, SearchBox, Stamped } from '../ui';

export function Home(): ReactNode {
  const v = useApi<TownView>('/api/town');
  return (
    <>
      <section className="hero">
        <h1>Every name in the town.</h1>
        <p className="lede">A name is an address card for an agent. Its ending says what the agent is: a person, an organization, a service. A name gives nobody authority.</p>
        <SearchBox big />
      </section>
      <Loading v={v}>{(t) => (
        <>
          <section>
            <Map scene={townScene(t)} height={560} legend={`The ${t.town} town’s ${t.total} names. Each street is an ending; each building is a registered name, shaped by what its ending names. Drag to look around, zoom in to read the names, press a street or a building to open it.`} />
          </section>
          <section>
            <h2>The endings</h2>
            <div className="roots">
              {t.roots.map((r) => (
                <Link key={r.tld} href={rootHref(r.tld)} className="root-card">
                  <Glyph kind={r.kind} size={56} />
                  <span className="root-card-body">
                    <span className="root-tld">.{r.tld}</span>
                    <span className="root-names">{r.names ? `names ${r.names}` : 'untyped (legacy)'}</span>
                    <span className="root-count">{r.count} {r.count === 1 ? 'name' : 'names'}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
          <section>
            <h2>Register a name</h2>
            <Register label="" tld="me" />
          </section>
          <section className="three">
            <div><h3>The ending is the type</h3><p>.me is a person, .org an organization, .svc a service. The agent’s own record on the chain decides; a name whose ending disagrees is shown as mismatched.</p></div>
            <div><h3>One presented name, checked on chain</h3><p>An agent chooses the name it presents. It only counts when that name points back at the agent. Otherwise apps show the address.</p></div>
            <div><h3>Bought and changed at a Home</h3><p>This service only reads. A name is bought from the owner’s treasury{t.fees ? ` — the town’s naming treasury holds ${t.fees.coins} ${t.fees.coin} so far` : ''}; a record change is signed by the owner’s own account, at their Home.</p></div>
          </section>
          <Stamped s={t} />
        </>
      )}</Loading>
    </>
  );
}
