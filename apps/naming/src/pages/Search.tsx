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
          <p className="lede">One row per ending{s.rootedAt ? `, read from the root (${s.rootedAt.town})` : ' in this town'}. The ending says what kind of agent the name would belong to, so the same label can be a person’s name and an organization’s.</p>
        </section>
        <section>
          <ul className="rows">
            {s.rows.map((r) => (
              <li key={r.name} className="row">
                <Glyph kind={r.kind} lit={r.status === 'registered' || !!r.claimedElsewhere} />
                <span className="row-main">
                  <Link href={nameHref(r.name)} className="row-name">{r.name}</Link>
                  <span className="row-sub">{r.claimedElsewhere ? `claimed on ${r.claimedElsewhere.town} (eip155:${r.claimedElsewhere.chainId}) — not on the root` : r.names ? `${r.status === 'registered' ? 'names' : 'would name'} ${r.names}` : 'legacy root, untyped'}{!r.claimedElsewhere && r.status !== 'registered' && r.by ? ` · ${r.by}` : ''}</span>
                </span>
                {(r.agent ?? r.claimedElsewhere?.agent) && <Addr address={(r.agent ?? r.claimedElsewhere?.agent)!} />}
                {r.status !== 'registered' && !r.claimedElsewhere && r.coins !== null && <span className="price-pill">{r.coins} SHQ</span>}
                <Chip kind={r.claimedElsewhere ? 'registered' : r.status} />
              </li>
            ))}
          </ul>
        </section>
        <Stamped s={s} />
      </>
    )}</Loading>
  );
}
