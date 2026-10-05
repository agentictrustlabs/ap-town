// Find: the discovery explorer, folded into the portal (spec 429 §7.3). The registry ranks; the page shows the
// ranking's reasons and the hard filters that emptied it. Nothing here is a permission.
import { useState, type FormEvent, type ReactNode } from 'react';
import { isPlaceKind } from '@ap-town/town-scene';
import { Link, Loading, useApi, useRoute } from '@ap-town/town-ui';
import type { Facets, FindResult, TownData } from '../types';
import { Glyph } from '../ui';

const TYPE_WORD: Record<string, string> = { person: 'people', org: 'organizations', service: 'services', team: 'teams', workspace: 'workspaces', treasury: 'treasuries', registry: 'registries', church: 'churches', circle: 'circles', household: 'households' };

export function Find({ t }: { t: TownData }): ReactNode {
  const { search, go } = useRoute();
  const params = new URLSearchParams(search);
  const q = params.get('q') ?? '';
  const type = params.get('type') ?? '';
  const registered = params.get('registered') === '1';
  const [text, setText] = useState(q);
  const [pickType, setPickType] = useState(type);
  const [onlyRegistered, setOnlyRegistered] = useState(registered);
  const asked = !!(q || type || registered);
  const v = useApi<FindResult>(asked ? `/api/find?${new URLSearchParams({ ...(q ? { q } : {}), ...(type ? { type } : {}), ...(registered ? { registered: '1' } : {}) })}` : null);
  const facets = useApi<Facets>('/api/facets');
  const naming = t.services.find((s) => s.id === 'naming')?.hosts[0];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = new URLSearchParams();
    if (text.trim()) p.set('q', text.trim());
    if (pickType) p.set('type', pickType);
    if (onlyRegistered) p.set('registered', '1');
    go(`/find${p.toString() ? `?${p}` : ''}`);
  };
  const dropped = v.state === 'ready' ? v.data.droppedBy ?? {} : {};
  const droppedNote = [
    (dropped.requireAgentType ?? 0) + (dropped.requireKind ?? 0) ? `${(dropped.requireAgentType ?? 0) + (dropped.requireKind ?? 0)} left out by the type filter` : null,
    dropped.requireRegistered ? `${dropped.requireRegistered} not in the registry` : null,
  ].filter(Boolean).join(' · ');
  return (
    <>
      <section className="hero">
        <h1>Find an agent.</h1>
        <p className="lede">Say what you need. The town's registry ranks the agents it knows by fit and by public evidence — a type you pick is a hard filter; words only shape the order. Relevance is not trust, and a listing is not a permission.</p>
        <form className="search search-big find" onSubmit={submit} role="search">
          <label className="sr" htmlFor="find">What you need</label>
          <input id="find" value={text} onChange={(e) => setText(e.target.value)} placeholder="a translation service · scripture · field operations" autoComplete="off" />
          <select aria-label="Kind of agent" value={pickType} onChange={(e) => setPickType(e.target.value)}>
            <option value="">Any kind</option>
            {facets.state === 'ready' && facets.data.agentTypes.map((f) => <option key={f.value} value={f.value}>{TYPE_WORD[f.value] ?? f.value} · {f.count}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={onlyRegistered} onChange={(e) => setOnlyRegistered(e.target.checked)} /> in the registry only</label>
          <button type="submit" className="button">Find</button>
        </form>
      </section>
      {asked && (
        <section>
          <Loading v={v} what="Asking the registry">{(r) => (
            <>
              <p className="quiet">{r.results.length} of {r.matched ?? r.results.length} matched{droppedNote ? ` · ${droppedNote}` : ''}.</p>
              {r.results.length === 0 ? <p className="quiet">Nothing in the registry matches.</p> : (
                <div className="rows">
                  {r.results.map((x) => {
                    const kind = x.agentType && isPlaceKind(x.agentType) ? x.agentType : 'legacy';
                    return (
                      <div key={x.smartAgent} className="result">
                        <div className="result-head">
                          <Glyph kind={kind} />
                          <Link href={`/agent/${x.name ?? x.smartAgent}`} className="result-name">{x.name ?? x.smartAgent}</Link>
                          {x.agentType && <span className="quiet">{x.agentType}</span>}
                          {x.registered && <span className="chip chip-ok">in the registry</span>}
                          <span className="chip chip-muted" title="fit + public evidence, for ordering only">fit {Math.round(x.score * 100)}</span>
                        </div>
                        {x.offerings && x.offerings.length > 0 && <p className="card-sub">Offers: {x.offerings.map((o) => o.name ?? o.skillId).filter(Boolean).slice(0, 6).join(' · ')}</p>}
                        <ul className="why">{x.why.slice(0, 3).map((w) => <li key={w}>{w}</li>)}</ul>
                        <div className="result-links">
                          <Link href={`/agent/${x.name ?? x.smartAgent}`}>its public facts</Link>
                          {naming && <a href={`https://${naming}/address/${x.smartAgent}`} rel="noreferrer">its names</a>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}</Loading>
        </section>
      )}
    </>
  );
}
