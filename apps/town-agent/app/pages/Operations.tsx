import type { ReactNode } from 'react';
import { Link } from '@ap-town/town-ui';
import type { TownData } from '../types';
import { Health } from '../ui';

export function Operations({ t }: { t: TownData }): ReactNode {
  return (
    <>
      <section className="hero">
        <h1>Operations.</h1>
        <p className="lede">How the {t.town} town is run: one manifest describes it, every service is probed, and nothing here is anybody's Home.</p>
      </section>
      <section>
        <h2>Every listed service</h2>
        <table className="table">
          <thead><tr><th scope="col">Service</th><th scope="col">Kind</th><th scope="col">Health</th><th scope="col">Host</th><th scope="col">Deployed from</th></tr></thead>
          <tbody>
            {t.services.map((s) => (
              <tr key={s.id}>
                <th scope="row"><Link href={`/service/${s.id}`}>{s.id}</Link></th>
                <td>{s.kind}</td>
                <td><Health s={s} /></td>
                <td className="mono">{s.hosts[0] ?? '—'}</td>
                <td>{s.repo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="quiet">Health is one unauthenticated GET per service, made when this page was read. The same probe runs hourly in the repository's CI. A service with no public probe is "not probed", never assumed up.</p>
      </section>
      <section>
        <h2>The chain</h2>
        <dl className="kv">
          <dt>Chain id</dt><dd>{t.chain.id}</dd>
          <dt>Contract generation</dt><dd>{t.chain.generation}</dd>
          <dt>Public RPC</dt><dd className="mono">{t.chain.rpc} <span className="quiet">(per-app tokens; read-only by default)</span></dd>
          <dt>Estates</dt><dd>{t.estates.map((e) => e.id).join(', ')}</dd>
          <dt>The town's agent</dt><dd><a href={t.card} rel="noreferrer" className="mono break">{t.card}</a></dd>
        </dl>
      </section>
      <section>
        <h2>Rules the town keeps</h2>
        <ul className="plain">
          <li>Nothing in the town grants. A resolver returns an address, a registry lists, a graph holds what the chain can prove.</li>
          <li>No estate is privileged. A town service reaches an estate only through a lane the manifest declares; a second estate is a manifest edit.</li>
          <li>The public graph holds only what anyone could rebuild from the chain; the indexer is its only writer.</li>
          <li>Four signals, never a score: listed · healthy · compatible — and "authorized" is the caller's own delegation.</li>
        </ul>
        <p className="quiet">The manifest, the checks and the deploy record: <a href="https://github.com/agentictrustlabs/ap-town" rel="noreferrer">agentictrustlabs/ap-town</a>.</p>
      </section>
    </>
  );
}
