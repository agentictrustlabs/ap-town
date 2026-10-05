import type { ReactNode } from 'react';
import { useApi } from '../api';
import type { SearchView } from '../api-types';
import { Link, nameHref, useRoute } from '../router';
import { Addr, Chip, Glyph, Loading, Stamped } from '../ui';

export function Search(): ReactNode {
  const { search } = useRoute();
  const q = new URLSearchParams(search).get('q') ?? '';
  const v = useApi<SearchView>(q ? `/api/search?q=${encodeURIComponent(q)}` : null);
  return (
    <Loading v={v}>{(s) => s.kind !== 'label' ? (
      <section><h1>“{q}”</h1><p className="lede">{s.kind === 'invalid' ? s.detail : 'Use the box above to open it.'}</p></section>
    ) : (
      <>
        <section>
          <h1>“{s.label}”</h1>
          <p className="lede">One row per ending in this town. The ending says what kind of agent the name would belong to, so the same label can be a person’s name and an organization’s.</p>
        </section>
        <section>
          <ul className="rows">
            {s.rows.map((r) => (
              <li key={r.name} className="row">
                <Glyph kind={r.kind} lit={r.status === 'registered'} />
                <span className="row-main">
                  <Link href={nameHref(r.name)} className="row-name">{r.name}</Link>
                  <span className="row-sub">{r.names ? `${r.status === 'registered' ? 'names' : 'would name'} ${r.names}` : 'legacy root, untyped'}{r.status !== 'registered' && r.by ? ` · ${r.by}` : ''}</span>
                </span>
                {r.agent && <Addr address={r.agent} />}
                <Chip kind={r.status} />
              </li>
            ))}
          </ul>
        </section>
        <Stamped s={s} />
      </>
    )}</Loading>
  );
}
