// Find: the discovery explorer, folded into the portal (spec 429 §7.3). The registry ranks; the page shows the
// ranking's reasons and the hard filters that emptied it. Nothing here is a permission.
import { useState, type FormEvent, type ReactNode } from 'react';
import { isPlaceKind } from '@ap-town/town-scene';
import { Empty, Link, Loading, SectionHead, useApi, useRoute } from '@ap-town/town-ui';
import type { Facets, FindResult, TownData } from '../types';
import { Glyph } from '../ui';

/** Asks that actually return something from this town's registry — an empty search box is the worst screen. */
const TRIES = ['scripture', 'a translation service', 'field operations'];

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
        <div className="find-section">
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
          {/* Nobody arrives knowing what this registry holds. These are real asks against this town. */}
          <div className="tries">
            <span>Try:</span>
            {TRIES.map((x) => (
              <button key={x} type="button" className="try" onClick={() => { setText(x); go(`/find?${new URLSearchParams({ q: x })}`); }}>{x}</button>
            ))}
          </div>
        </div>
      </section>
      {/* Before anything is asked, say what there IS to ask about. An empty results area under a search box tells
          you nothing about whether the registry is worth asking. */}
      {!asked && facets.state === 'ready' && facets.data.agentTypes.length > 0 && (
        <section>
          <SectionHead eyebrow="What the registry holds" title="Agents it knows about">
            Every agent here is one the town's registry has a public record of. The kind is a hard filter on a
            search; the count is how many of that kind it knows today.
          </SectionHead>
          <div className="cards cards-tight">
            {[...facets.data.agentTypes].sort((a, b) => b.count - a.count).map((f) => {
              const kind = isPlaceKind(f.value) ? f.value : 'legacy';
              return (
                <button key={f.value} type="button" className="card" onClick={() => { setPickType(f.value); go(`/find?${new URLSearchParams({ type: f.value })}`); }}>
                  <span className="card-head"><Glyph kind={kind} /><span><span className="card-title">{TYPE_WORD[f.value] ?? f.value}</span><br /><span className="card-sub">.{f.value}</span></span></span>
                  <span className="card-foot"><span>{f.count} known</span></span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      {asked && (
        <section>
          <Loading v={v} what="Asking the registry">{(r) => (
            <>
              <SectionHead
                eyebrow="From the town's registry"
                title={`${r.results.length} of ${r.matched ?? r.results.length} matched`}
              >
                Ordered by fit and public evidence — never by trust.{droppedNote ? ` ${droppedNote[0]!.toUpperCase()}${droppedNote.slice(1)}.` : ''}
                {/* WHAT WAS READ, not just what came back. The registry ranks a page of the knowledge base, and
                    the base is bigger than the page — so a list that says only "11 of 11" reads as the whole
                    field when it is a third of it. The words' own narrow read is counted separately, because
                    that is what puts an agent you NAMED in front of you. */}
                {r.page ? <>{' '}<span className="quiet">Read {r.page.returned} agent{r.page.returned === 1 ? '' : 's'} from the knowledge base{r.page.truncated ? ` (it holds more than this page of ${r.page.limit})` : ''}{r.page.named ? `, ${r.page.named} of them found by the words you used` : ''}.</span></> : null}
              </SectionHead>
              {r.results.length === 0 ? (
                <Empty title="Nothing in the registry matches that.">
                  The words only shape the order, but a type you pick is a hard filter — try it with <strong>Any kind</strong>, or
                  with fewer words. A registry that holds nothing for you is an answer, not a failure.
                </Empty>
              ) : (
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
