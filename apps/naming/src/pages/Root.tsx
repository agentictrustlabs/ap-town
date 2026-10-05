import type { ReactNode } from 'react';
import { useApi } from '../api';
import type { RootPage } from '../api-types';
import { Link, nameHref, rootHref, useRoute } from '../router';
import { rootScene } from '../scenes';
import { Addr, AtYourHome, Chip, Glyph, Loading, Scene, Stamped } from '../ui';

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
        {p.names.length > 0 && <section><Scene scene={rootScene(p)} legend={`The .${p.root.tld} street. Each building is one registered name; hover or tab to one to read it, press to open it.`} /></section>}
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
        {p.root.open && <section><h2>Claim a .{p.root.tld} name</h2><AtYourHome estates={p.estates} verb={`Claiming a .${p.root.tld} name`} /></section>}
        <Stamped s={p} />
      </>
    )}</Loading>
  );
}
