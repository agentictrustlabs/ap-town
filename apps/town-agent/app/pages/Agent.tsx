// One agent as the registry knows it: the public facts the indexer projected from the chain, the offerings crawled
// from its card, and the card itself read live from the agent's own host. Public evidence; none of it is authority.
import { useEffect, useState, type ReactNode } from 'react';
import { Empty, Link, Loading, SectionHead, useApi } from '@ap-town/town-ui';
import type { AgentDetail, TownData } from '../types';

const local = (iri: string): string => iri.replace(/^.*[#/]/, '');

/** HOW TO REACH IT. Pulled out of the flat fact list because "where do I send an A2A message" is the question
 *  people actually arrive with, and it was a row among thirteen. Still public, still not a permission: an
 *  endpoint says where an agent listens, never that you may use it. */
const REACH_KEYS = ['a2aEndpoint', 'cardUri', 'cardHash', 'serviceUrl', 'siteUrl'] as const;

/** `mcpEndpoint` is deliberately NOT in `REACH_KEYS`: it has its own section, because "which MCP servers does
 *  this agent have" is a question people arrive with and the honest answer has two halves — the door it serves
 *  (on chain, here) and the servers it was equipped with (in its owner's vault, not here, and never guessed). */
const MCP_KEY = 'mcpEndpoint';

/** THE PUBLIC GRAPH. Who this agent is connected to, as the chain shows it. Separate signals, never a score:
 *  a registry lists, it does not rank trust (ADR-0038 / spec 429 D2), and an edge count is a shape of the
 *  graph, not a measure of whether anyone should rely on this agent. */
const GRAPH_KEYS = ['hasRelationship', 'relatedAgent', 'edgeCount', 'activeEdgeCount', 'edgeDirection'] as const;

const REACH_LABEL: Record<string, string> = {
  a2aEndpoint: 'A2A endpoint — where another agent sends it a message',
  cardUri: 'Agent card — what it says about itself, at its own host',
  cardHash: 'Card hash — the digest the chain holds for that card',
  serviceUrl: 'Service URL',
  siteUrl: 'Site',
};

/** The registry stores some facts as a unix second. A reader is owed a date, with the raw value kept beside it. */
const EPOCH_KEYS = new Set(['registeredAt', 'updatedAt', 'createdAt', 'releasedAt']);
function factValue(key: string, raw: string): ReactNode {
  if (EPOCH_KEYS.has(key) && /^\d{9,13}$/.test(raw)) {
    const ms = raw.length > 10 ? Number(raw) : Number(raw) * 1000;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return <>{d.toISOString().slice(0, 16).replace('T', ' ')} UTC <span className="quiet mono">{raw}</span></>;
  }
  if (/^https?:/.test(raw)) return <a href={raw} rel="noreferrer">{raw}</a>;
  return raw;
}

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
      if (!d.agent.ok) return (
        <section className="hero">
          <h1>{d.key}</h1>
          <Empty title="The registry knows no agent by that key.">
            A name it has never seen and a name that does not exist look the same from here. <Link href="/find">Find one →</Link>
          </Empty>
        </section>
      );
      const triples = d.agent.triples ?? [];
      const types = triples.filter((x) => x.p.endsWith('#type')).map((x) => local(x.o));
      const rows = triples.filter((x) => !x.p.endsWith('#type'));
      // The same facts, grouped by the question a reader came with. Nothing is hidden: what is not reach and
      // not graph still shows under Public facts below.
      const isIn = (keys: readonly string[]) => (x: { p: string }) => keys.includes(local(x.p));
      const reach = rows.filter(isIn(REACH_KEYS));
      const graph = rows.filter(isIn(GRAPH_KEYS));
      const rest = rows.filter((x) => !isIn(REACH_KEYS)(x) && !isIn(GRAPH_KEYS)(x) && local(x.p) !== MCP_KEY);
      const conforms = triples.find((x) => x.p.endsWith('shacl#conforms'))?.o;
      const cardUri = triples.find((x) => local(x.p) === 'cardUri')?.o;
      const mcpEndpoint = triples.find((x) => local(x.p) === MCP_KEY)?.o;
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
            <SectionHead eyebrow="From the chain" title="How to reach it">
              Where this agent listens, as its own on-chain records say. An endpoint is an address, never an
              invitation: being able to reach an agent is not being allowed to use it.
            </SectionHead>
            {reach.length > 0 ? (
              <dl className="kv kv-facts">
                {reach.map((x, i) => { const k = local(x.p); return <span key={i} className="contents"><dt>{REACH_LABEL[k] ?? k}</dt><dd className="mono">{factValue(k, x.o)}</dd></span>; })}
              </dl>
            ) : (
              <Empty title="It publishes no endpoint.">
                Nothing on chain says where to reach this agent — no A2A endpoint and no card. That is a fact
                about its records, not a judgement about the agent: an agent is chartered with its endpoints written,
                and one without them cannot be engaged by anybody who only has its name.
              </Empty>
            )}
          </section>
          <section>
            <SectionHead eyebrow="From the chain" title="The tools it serves">
              Whether this agent runs an MCP server of its own, and where. An MCP endpoint is a PRIVATE capability
              interface (ADR-0057): it is absent from every Agent Card by design, and the authorization decision for
              every call is the chain, re-run server-side against the calling principal. A door you can see is not a
              door you may open.
            </SectionHead>
            {mcpEndpoint ? (
              <dl className="kv kv-facts">
                <dt>MCP endpoint</dt><dd className="mono break">{factValue('mcpEndpoint', mcpEndpoint)}</dd>
              </dl>
            ) : (
              <Empty title="Its name record publishes no MCP endpoint.">
                It serves no tools behind a door of its own &mdash; or it serves them somewhere its records do not
                name, which a service reached only by its own estate&rsquo;s Workers has no reason to publish. Either
                way, nothing on chain says where.
              </Empty>
            )}
            <p className="quiet">
              <strong>Which MCP servers this agent USES is not here, and cannot be.</strong> The connectors its owner
              equipped it with are records in her vault, under her own grant (spec 404, ADR-0025) &mdash; the town
              cannot read them and does not guess. Her Home is where that list lives. What this page can show is the
              other direction: the door this agent serves, and the skills its own card advertises below.
              {' '}<Link href="/mcp">Every MCP server in the town &rarr;</Link>
            </p>
          </section>
          <section>
            <SectionHead eyebrow="From the chain" title="Its public graph">
              Who it is connected to, and how many of those connections are live. These are SEPARATE SIGNALS and
              deliberately not a score: the registry lists what the chain shows and leaves the reading to you.
              An edge count is a shape of the graph, never a measure of whether to rely on this agent.
            </SectionHead>
            {graph.length > 0 ? (
              <dl className="kv kv-facts">
                {graph.map((x, i) => {
                  const k = local(x.p);
                  const related = k === 'relatedAgent' && /^0x[0-9a-fA-F]{40}$/.test(x.o);
                  return (
                    <span key={i} className="contents">
                      <dt>{k}</dt>
                      <dd className={/^(http|urn:|0x)/.test(x.o) ? 'mono' : ''}>
                        {related ? <Link href={`/agent/${x.o}`}>{x.o}</Link> : factValue(k, x.o)}
                      </dd>
                    </span>
                  );
                })}
              </dl>
            ) : (
              <Empty title="The chain shows no connections for it.">
                No relationship, no edge. Either nobody has recorded one, or the ones that exist are private — a
                relationship held in somebody&rsquo;s vault is theirs, and the public graph is not told about it
                (ADR-0025). Absence here is not evidence of isolation.
              </Empty>
            )}
          </section>
          <section>
            <SectionHead eyebrow="Read from the chain and its own card" title="Public facts">
              Anyone can reproduce every line of this. None of it is a permission.
            </SectionHead>
            <dl className="kv kv-facts">
              {rest.map((x, i) => { const k = local(x.p); return <span key={i} className="contents"><dt>{k}</dt><dd className={/^(http|urn:|0x)/.test(x.o) ? 'mono' : ''}>{factValue(k, x.o)}</dd></span>; })}
            </dl>
          </section>
          {offerings.length > 0 && (
            <section>
              <SectionHead eyebrow="From its card" title="What it offers">
                Crawled from its card into the public graph by the indexer, so the registry can rank over it.
              </SectionHead>
              <table className="table"><thead><tr><th scope="col">Offering</th><th scope="col">Effect</th><th scope="col">Exposure</th><th scope="col">Status</th></tr></thead>
                <tbody>{offerings.map((o) => <tr key={o.skillId}><th scope="row">{o.name ?? o.skillId}<span className="record-key mono">{o.skillId}</span></th><td>{o.effect ?? '—'}</td><td>{o.exposure ?? '—'}</td><td>{o.status ?? '—'}</td></tr>)}</tbody>
              </table>
            </section>
          )}
          {cardUri && <section><SectionHead eyebrow="Fetched from the agent's own host, now" title="Its card, live" /><div className="panel"><LiveCard url={cardUri} /></div></section>}
        </>
      );
    }}</Loading>
  );
}
