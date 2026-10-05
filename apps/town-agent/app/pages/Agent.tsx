// One agent as the registry knows it: the public facts the indexer projected from the chain, the offerings crawled
// from its card, and the card itself read live from the agent's own host. Public evidence; none of it is authority.
import { useEffect, useState, type ReactNode } from 'react';
import { Link, Loading, useApi } from '@ap-town/town-ui';
import type { AgentDetail, TownData } from '../types';

const local = (iri: string): string => iri.replace(/^.*[#/]/, '');

function LiveCard({ url }: { url: string }): ReactNode {
  const [card, setCard] = useState<{ name?: string; description?: string; skills?: Array<{ id: string; name: string; description?: string }> } | null | 'error'>(null);
  useEffect(() => { let live = true; fetch(url, { headers: { accept: 'application/json' } }).then((r) => r.json() as Promise<Exclude<typeof card, null | 'error'>>).then((c) => { if (live) setCard(c); }).catch(() => { if (live) setCard('error'); }); return () => { live = false; }; }, [url]);
  if (card === null) return <p className="quiet">Reading the card from {new URL(url).host}…</p>;
  if (card === 'error') return <p className="quiet">The card at {new URL(url).host} could not be read from here.</p>;
  return (
    <>
      {card.description && <p>{card.description}</p>}
      {card.skills && card.skills.length > 0 && (
        <ul className="plain">{card.skills.map((s) => <li key={s.id}><strong>{s.name}</strong> <span className="mono quiet">{s.id}</span>{s.description ? ` — ${s.description}` : ''}</li>)}</ul>
      )}
    </>
  );
}

export function AgentPage({ t, id }: { t: TownData; id: string }): ReactNode {
  const v = useApi<AgentDetail>(`/api/agent/${encodeURIComponent(id)}`);
  const naming = t.services.find((s) => s.id === 'naming')?.hosts[0];
  return (
    <Loading v={v} what="Asking the registry">{(d) => {
      if (!d.agent.ok) return <section><h1>{d.key}</h1><p className="lede">The registry knows no agent by that key. <Link href="/find">Find one.</Link></p></section>;
      const triples = d.agent.triples ?? [];
      const types = triples.filter((x) => x.p.endsWith('#type')).map((x) => local(x.o));
      const rows = triples.filter((x) => !x.p.endsWith('#type'));
      const conforms = triples.find((x) => x.p.endsWith('shacl#conforms'))?.o;
      const cardUri = triples.find((x) => local(x.p) === 'cardUri')?.o;
      const address = (d.agent.agent ?? '').split(':').pop() ?? '';
      const offerings = d.offerings?.offerings ?? [];
      return (
        <>
          <section className="title">
            <div>
              <h1>{d.key} {conforms !== undefined && <span className={`chip ${conforms === 'false' ? 'chip-warn' : 'chip-ok'}`}>{conforms === 'false' ? 'shape: does not conform' : 'shape: conforms'}</span>}</h1>
              <p className="lede">{types.filter((x) => x !== 'Agent').join(' · ') || 'An agent'} — as the town's registry knows it. Everything here was read from the chain or from the agent's own public card; none of it says what the agent may do for you.</p>
              {address.startsWith('0x') && naming && <p className="quiet"><a href={`https://${naming}/address/${address}`} rel="noreferrer">Its names and what it presents →</a></p>}
            </div>
          </section>
          <section>
            <h2>Public facts</h2>
            <dl className="kv">
              {rows.map((x, i) => <span key={i} className="contents"><dt>{local(x.p)}</dt><dd className={/^(http|urn:|0x)/.test(x.o) ? 'mono' : ''}>{/^https?:/.test(x.o) ? <a href={x.o} rel="noreferrer">{x.o}</a> : x.o}</dd></span>)}
            </dl>
          </section>
          {offerings.length > 0 && (
            <section>
              <h2>What it offers</h2>
              <p className="quiet">Crawled from its card into the public graph by the indexer, so the registry can rank over it.</p>
              <table className="table"><thead><tr><th scope="col">Offering</th><th scope="col">Effect</th><th scope="col">Exposure</th><th scope="col">Status</th></tr></thead>
                <tbody>{offerings.map((o) => <tr key={o.skillId}><th scope="row">{o.name ?? o.skillId}<span className="record-key mono">{o.skillId}</span></th><td>{o.effect ?? '—'}</td><td>{o.exposure ?? '—'}</td><td>{o.status ?? '—'}</td></tr>)}</tbody>
              </table>
            </section>
          )}
          {cardUri && <section><h2>Its card, live</h2><LiveCard url={cardUri} /></section>}
        </>
      );
    }}</Loading>
  );
}
