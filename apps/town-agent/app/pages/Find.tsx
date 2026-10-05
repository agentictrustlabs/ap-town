import { useState, type FormEvent, type ReactNode } from 'react';
import { Loading, useApi, useRoute } from '@ap-town/town-ui';
import type { FindResult, TownData } from '../types';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

export function Find({ t }: { t: TownData }): ReactNode {
  const { search, go } = useRoute();
  const q = new URLSearchParams(search).get('q') ?? '';
  const [text, setText] = useState(q);
  const v = useApi<FindResult>(q ? `/api/find?q=${encodeURIComponent(q)}` : null);
  const naming = t.services.find((s) => s.id === 'naming')?.hosts[0];
  const submit = (e: FormEvent) => { e.preventDefault(); if (text.trim()) go(`/find?q=${encodeURIComponent(text.trim())}`); };
  return (
    <>
      <section className="hero">
        <h1>Find a service.</h1>
        <p className="lede">Ask the town's registry for what you need — a topic, a capability, a kind of agent. Relevance orders the answers; it is not trust, and a listing is not a permission.</p>
        <form className="search search-big" onSubmit={submit} role="search">
          <label className="sr" htmlFor="find">What you need</label>
          <input id="find" value={text} onChange={(e) => setText(e.target.value)} placeholder="a translation service · scripture · field operations" autoComplete="off" />
          <button type="submit" className="button">Find</button>
        </form>
      </section>
      {q && (
        <section>
          <Loading v={v} what="Asking the registry">{(r) => r.results.length === 0 ? <p className="quiet">Nothing in the registry matches “{r.query}”.</p> : (
            <div className="rows">
              {r.results.map((x, i) => {
                // ARD §5.3 results: identifier, displayName, url (the card), tags; the town adds the agent's address and type.
                const title = str(x.displayName) ?? str(x.identifier) ?? `result ${i + 1}`;
                const agent = str(x['ap:canonicalAgentId']);
                const type = str(x['ap:agentType']);
                const card = str(x.url);
                const tags = Array.isArray(x.tags) ? (x.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
                const host = card ? new URL(card).host : null;
                return (
                  <div key={(agent ?? title) + i} className="result">
                    <div className="result-head"><span className="result-name">{title}</span>{type && <span className="quiet">{type}</span>}{tags.slice(0, 4).map((t) => <span key={t} className="chip chip-muted">{t}</span>)}</div>
                    <div className="result-links">
                      {agent && naming && <a href={`https://${naming}/address/${agent}`} rel="noreferrer">its names</a>}
                      {card && <a href={card} rel="noreferrer">its card{host ? ` · ${host}` : ''}</a>}
                      {agent && <span className="mono quiet">{agent.slice(0, 10)}…</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}</Loading>
        </section>
      )}
    </>
  );
}
