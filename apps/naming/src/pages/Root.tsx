import type { ReactNode } from 'react';
import { useApi } from '../api';
import type { RootPage } from '../api-types';
import { Link, nameHref, rootHref, useRoute } from '../router';
import { Register } from '../register';
import { rootScene } from '../scenes';
import { Addr, Chip, Glyph, Loading, Map, Stamped } from '../ui';

export function Root({ tld }: { tld: string }): ReactNode {
  const { search } = useRoute();
  const page = Number(new URLSearchParams(search).get('page') ?? '1') || 1;
  const v = useApi<RootPage>(`/api/root/${tld}?page=${page}`);
  return (
    <Loading v={v}>{(p) => (
      <>
        <section className="title">
          <Glyph kind={p.root.kind} size={72} />
          <div>
            <h1>.{p.root.tld} {p.root.legacy && <Chip kind="legacy" />}</h1>
            <p className="lede">{p.root.names ? `A name ending in .${p.root.tld} names ${p.root.names}.` : `.${p.root.tld} is an untyped root from before typed names. The ending says nothing about what the agent is.`} {p.root.count} {p.root.count === 1 ? 'name' : 'names'} so far.</p>
            <p className="quiet">{p.root.issuing}</p>
          </div>
        </section>
        {p.names.length > 0 && <section><Map scene={rootScene(p)} height={460} legend={`The .${p.root.tld} street. Each building is one registered name; zoom in to read them, press one to open it.`} /></section>}
        <section>
          <h2>Names{p.pages > 1 ? ` · page ${p.page} of ${p.pages}` : ''}</h2>
          {p.names.length === 0 ? <p className="quiet">No names here yet.</p> : (
            <ul className="rows rows-grid">
              {p.names.map((n) => (
                <li key={n.name} className="row">
                  <Glyph kind={n.kind} />
                  <span className="row-main"><Link href={nameHref(n.name)} className="row-name">{n.name}</Link></span>
                  <span className="row-owner"><span className="quiet">owner</span> <Addr address={n.owner} /></span>
                </li>
              ))}
            </ul>
          )}
          {p.pages > 1 && (
            <nav className="pager" aria-label="Pages">
              {p.page > 1 && <Link href={`${rootHref(p.root.tld)}?page=${p.page - 1}`} className="button button-quiet">← Earlier</Link>}
              {p.page < p.pages && <Link href={`${rootHref(p.root.tld)}?page=${p.page + 1}`} className="button button-quiet">Later →</Link>}
            </nav>
          )}
        </section>
        {p.root.priced && (
          <section>
            <h2>Buy a .{p.root.tld} name</h2>
            <table className="table price-table"><thead><tr><th scope="col">Letters</th><th scope="col">Price</th></tr></thead><tbody>
              {[['3', 4], ['4', 3], ['5', 2], ['6–7', 1.5], ['8 and up', 1]].map(([len, m]) => <tr key={String(len)}><td>{len}</td><td>{Math.min(49, Math.floor((p.root.baseCoins ?? 0) * Number(m)))} SHQ</td></tr>)}
            </tbody></table>
            <Register label="" tld={p.root.tld} />
          </section>
        )}
        {!p.root.priced && p.root.open && <section><h2>Claim a .{p.root.tld} name</h2><Register label="" tld={p.root.tld} /></section>}
        <Stamped s={p} />
      </>
    )}</Loading>
  );
}
