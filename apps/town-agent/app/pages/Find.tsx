// Find: the discovery explorer, folded into the portal (spec 429 §7.3). The registry ranks; the page shows the
// ranking's reasons and the hard filters that emptied it. Nothing here is a permission.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { isPlaceKind } from '@ap-town/town-scene';
import { Empty, Link, Loading, SectionHead, getJson, useApi, useRoute } from '@ap-town/town-ui';
import type { Facets, FindHit, FindResult, TownData } from '../types';
import { Glyph } from '../ui';
import { groupFindResults, sharedWhy } from './find-group';

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
        <p className="lede">Type a name, part of a name, or what you need. A name you typed is shown first, as a name; agents that fit your words follow, in the registry&rsquo;s order. A kind you pick is a hard filter; words only shape the order. Relevance is not trust, and a listing is not a permission.</p>
        <div className="find-section">
          <form className="search search-big find" onSubmit={submit} role="search">
            <label className="sr" htmlFor="find">What you need</label>
            <input id="find" value={text} onChange={(e) => setText(e.target.value)} placeholder="a name, part of one, or what you need" autoComplete="off" />
            <select aria-label="Kind of agent" value={pickType} onChange={(e) => setPickType(e.target.value)}>
              <option value="">Any kind</option>
              {/* The KIND, not the ending. Printing `.{value}` here invented endings nobody can type — the facet is an
                  agent type, so it read "people · .person" when a person's name ends in `.me`, and `.service` and
                  `.registry` are not endings at all. One kind control on the page, and it says only what it knows. */}
              {facets.state === 'ready' && facets.data.agentTypes.map((f) => <option key={f.value} value={f.value}>{TYPE_WORD[f.value] ?? f.value} · {f.count}</option>)}
            </select>
            <label className="check"><input type="checkbox" checked={onlyRegistered} onChange={(e) => setOnlyRegistered(e.target.checked)} /> Registry entries only</label>
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
          <Loading v={v} what="Asking the registry">{(r) => <Answers r={r} q={q} naming={naming} droppedNote={droppedNote} /* one answer, four kinds of row */ />}</Loading>
        </section>
      )}
    </>
  );
}

/** The kinds a person may charter, which is the registrable set and nothing wider: a treasury is named when the
 *  agent that holds it is created, and a legacy root cannot be bought. Kept in step with the naming app's
 *  CHARTER_KINDS — the two should become one list in the kit (noted for the IA). */
const REGISTRABLE: ReadonlyArray<{ tld: string; kind: string; label: string; names: string }> = [
  // `kind` is the glyph's vocabulary, which is not the ending's: `.me` draws a PERSON and `.svc` a SERVICE, and
  // passing the ending through drew the fallback box for both.
  { tld: 'me', kind: 'person', label: 'A person', names: 'a person' },
  { tld: 'org', kind: 'org', label: 'An organization', names: 'an organization' },
  { tld: 'team', kind: 'team', label: 'A team', names: 'a team' },
  { tld: 'svc', kind: 'service', label: 'A service', names: 'a service' },
  { tld: 'church', kind: 'church', label: 'A church', names: 'a church' },
  { tld: 'circle', kind: 'circle', label: 'A circle', names: 'a circle' },
  { tld: 'household', kind: 'household', label: 'A household', names: 'a household' },
];

/** One compact row: a name, what it is, and where to read its public facts. No score, no chip, no verdict. */
function NameRow({ h }: { h: FindHit }): ReactNode {
  const kind = h.agentType && isPlaceKind(h.agentType) ? h.agentType : 'legacy';
  const end = (h.name ?? '').split('.').pop() ?? '';
  return (
    <div className="row">
      <Glyph kind={kind} />
      <span className="row-main">
        <Link href={`/agent/${h.name ?? h.smartAgent}`} className="row-name">{h.name ?? h.smartAgent}</Link>
        <span className="row-sub">{[h.agentType || null, end ? `.${end}` : null, h.registered ? 'registry entry' : null].filter(Boolean).join(' · ')}</span>
      </span>
    </div>
  );
}

/**
 * THE ANSWER, IN THE ORDER THE QUESTIONS WERE ASKED. The name you typed, then names like it, then agents whose
 * words fit, then what the registry read on the way. Nothing is re-scored or re-ordered inside a group, and the
 * rows below the floor are collapsed rather than dropped — they are part of the registry's answer.
 */
function Answers({ r, q, naming, droppedNote }: { r: FindResult; q: string; naming: string | undefined; droppedNote: string }): ReactNode {
  const g = groupFindResults(q, r.results, r.named);
  const shared = sharedWhy(g.fit);
  const counts = [
    g.exact.length + g.like.length ? `${g.exact.length + g.like.length} name${g.exact.length + g.like.length === 1 ? '' : 's'}` : null,
    g.fit.length ? `${g.fit.length} agent${g.fit.length === 1 ? '' : 's'} that fit your words` : null,
  ].filter(Boolean).join(', ');
  const nothing = !g.exact.length && !g.like.length && !g.fit.length;
  return (
    <>
      <SectionHead eyebrow="From the town's registry" title={counts || 'Nothing matched'}>
        Names first, then agents that fit your words, in the registry&rsquo;s order. The order is not trust.
        {droppedNote ? ` ${droppedNote[0]!.toUpperCase()}${droppedNote.slice(1)}.` : ''}
      </SectionHead>

      {g.exact.length > 0 && (
        <div className="find-section">
          <SectionHead eyebrow="The name you typed" title={g.exact.length === 1 ? (g.exact[0]!.name ?? 'That name') : `${g.exact.length} agents under that label`} />
          <div className="rows">{g.exact.map((h) => <NameRow key={h.smartAgent} h={h} />)}</div>
        </div>
      )}

      {g.like.length > 0 && (
        <div className="find-section">
          <SectionHead eyebrow="Named like that" title={`Names with "${q}" in them`} />
          <div className="rows">{g.like.slice(0, 6).map((h) => <NameRow key={h.smartAgent} h={h} />)}</div>
          {g.like.length > 6 && (
            <details className="more"><summary>{g.like.length - 6} more names</summary>
              <div className="rows">{g.like.slice(6).map((h) => <NameRow key={h.smartAgent} h={h} />)}</div>
            </details>
          )}
        </div>
      )}

      {/* NOT IN THE REGISTRY, AND FREE: the one place the page may invite a registration, and only when the
          NAMING service says the name is free — "the registry has no record of it" and "nobody holds it" are
          different sentences, and only the second one is an invitation. */}
      {g.asName && g.exact.length === 0 && <RegisterCard label={g.asName.label} tld={g.asName.tld} naming={naming} others={g.like.length} />}

      {g.fit.length > 0 && (
        <div className="find-section">
          <SectionHead eyebrow="Ranked on your words" title="Agents that fit your words" />
          {shared.length > 0 && <p className="quiet">On all of these: {shared.join(' · ')}</p>}
          <div className="rows">
            {g.fit.map((x) => {
              const kind = x.agentType && isPlaceKind(x.agentType) ? x.agentType : 'legacy';
              const why = (x.why ?? []).filter((w) => !shared.includes(w)).slice(0, 2);
              return (
                <div key={x.smartAgent} className="result">
                  <div className="result-head">
                    <Glyph kind={kind} />
                    <Link href={`/agent/${x.name ?? x.smartAgent}`} className="result-name">{x.name ?? x.smartAgent}</Link>
                    {x.agentType && <span className="quiet">{x.agentType}</span>}
                    {x.registered && <span className="chip chip-muted">registry entry</span>}
                  </div>
                  {x.offerings && x.offerings.length > 0 && <p className="card-sub">Offers: {x.offerings.map((o) => o.name ?? o.skillId).filter(Boolean).slice(0, 6).join(' · ')}</p>}
                  {why.length > 0 && <ul className="why">{why.map((w) => <li key={w}>{w}</li>)}</ul>}
                  <div className="result-links">
                    <Link href={`/agent/${x.name ?? x.smartAgent}`}>its public facts</Link>
                    {naming && <a href={`https://${naming}/address/${x.smartAgent}`} rel="noreferrer">its names</a>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {nothing && !g.asName && (
        <Empty title="Nothing in the registry points to those words.">
          Try fewer words, or <strong>Any kind</strong> — a kind you pick is a hard filter. A registry that holds
          nothing for you is an answer, not a failure.{g.rest.length ? ' What it read on the way is below.' : ''}
        </Empty>
      )}

      {/* KEPT, NOT CUT. "The registry read these and none of them points at your words" is true and is part of
          its answer; showing them in line is what made every search look like a wall. */}
      {g.rest.length > 0 && (
        <details className="more">
          <summary>{g.rest.length} more the registry read — nothing in them points to your words</summary>
          <div className="rows">{g.rest.map((h) => <NameRow key={h.smartAgent} h={h} />)}</div>
        </details>
      )}

      {r.page && (
        <p className="quiet">
          The registry read {r.page.returned} agent{r.page.returned === 1 ? '' : 's'} from the knowledge base
          {r.page.truncated ? ', which holds more than one page' : ''}
          {r.named?.length ? `, and ${r.named.length} found by the name you typed` : ''}.
        </p>
      )}
    </>
  );
}

/**
 * NOT IN THE REGISTRY — and, if the naming service says so, free.
 *
 * The page could not say this before: a word nothing matched still came back as a hundred ranked agents, so
 * "nothing is named that" was never a state the page could reach (measured 2026-10-14). Now it is, and it is the
 * natural place to offer the thing the person was probably after.
 *
 * WHOSE FACT IS WHICH. The registry's list says only that it has no record. Whether a NAME is free is the naming
 * service's fact, asked of it (`/api/name-check`, a thin proxy over its public read). The two sentences are kept
 * apart, because inviting someone to register a name somebody already holds is a lie the registry's silence
 * cannot justify.
 *
 * THE KIND IS NEVER GUESSED. The ending IS the kind of agent (ADR-0061), so a default would be an identity-class
 * mistake made on the person's behalf. They pick it here; everything after it — the price, the words, Connect,
 * the signatures — happens at their own Home through the naming service. This button is a plain link: the town
 * holds no key and registers nothing (D2).
 */
function RegisterCard({ label, tld, naming, others }: { label: string; tld: string | null; naming: string | undefined; others: number }): ReactNode {
  const [pick, setPick] = useState<string | null>(tld && REGISTRABLE.some((k) => k.tld === tld) ? tld : null);
  const [check, setCheck] = useState<{ state: 'idle' } | { state: 'checking' } | { state: 'ready'; status: string; price: { coins: number; coin: string } | null; names: string | null; detail: string | null } | { state: 'error' }>({ state: 'idle' });
  const name = pick ? `${label}.${pick}` : null;
  useEffect(() => {
    if (!name) { setCheck({ state: 'idle' }); return; }
    let live = true; setCheck({ state: 'checking' });
    // THE SAME DOOR AS EVERY OTHER READ. A bare `fetch` here missed the session header the kit puts on every
    // request, so the portal's own sign-in gate refused it and the card said the naming service was unreachable
    // when it was answering perfectly — `getJson` is how this app asks for anything.
    void getJson<{ status?: string; price?: { coins: number; coin: string } | null; names?: string | null; invalid?: { detail?: string } | null }>(`/api/name-check?name=${encodeURIComponent(name)}`)
      .then((res) => {
        if (!live) return;
        setCheck(res.ok && res.data.status ? { state: 'ready', status: res.data.status, price: res.data.price ?? null, names: res.data.names ?? null, detail: res.data.invalid?.detail ?? null } : { state: 'error' });
      });
    return () => { live = false; };
  }, [name]);
  if (label.length < 3) return <p className="quiet">Names are three characters or more.</p>;
  const free = check.state === 'ready' && check.status === 'available';
  return (
    <div className="find-section">
      {/* "Nothing is named nath yet" is false when twenty-one names contain it; the card has to say which of the
          two it means, or it is wrong in the common case. */}
      <SectionHead eyebrow="Not in the registry" title={tld ? `${label}.${tld} is not in the registry.` : others > 0 ? `Nothing is named exactly "${label}".` : `Nothing is named "${label}" yet.`}>
        A name&rsquo;s ending is the kind of agent it names. Pick the kind, then register it at the naming service
        — it opens your own Home, which is where the signing happens.
      </SectionHead>
      <div className="cards cards-tight" role="radiogroup" aria-label="Kind of agent the name is for">
        {REGISTRABLE.map((k) => (
          <button key={k.tld} type="button" role="radio" aria-checked={pick === k.tld} className={pick === k.tld ? 'card card-on' : 'card'} onClick={() => setPick(k.tld)}>
            <span className="card-head">
              <Glyph kind={isPlaceKind(k.kind) ? k.kind : 'service'} />
              <span><span className="card-title">{pick === k.tld ? '✓ ' : ''}{k.label}</span><br /><span className="card-sub">.{k.tld}</span></span>
            </span>
            <span className="card-foot"><span>names {k.names}</span></span>
          </button>
        ))}
      </div>
      {tld && pick === tld && <p className="quiet">Kind taken from the ending you typed.</p>}
      <p className="quiet" role="status">
        {!name ? 'Pick a kind to see whether that name is free.'
          : check.state === 'checking' ? `Checking ${name}…`
          : check.state === 'error' ? 'The naming service could not be asked just now. You can still open its register page — it checks the name itself.'
          : check.state === 'ready' && check.status === 'available' ? `${name} — free to claim${check.names ? `, by ${check.names}` : ''}${check.price ? ` · ${check.price.coins} ${check.price.coin}` : ''}`
          : check.state === 'ready' && check.status === 'registered' ? `${name} is held. The registry has no record of its agent yet.`
          : check.state === 'ready' ? (check.detail ?? `${name} cannot be used.`)
          : ''}
      </p>
      {naming && name && (free || check.state === 'error') && (
        <p><a className="button" href={`https://${naming}/register/${encodeURIComponent(name)}`} rel="noreferrer">Register {name} &rarr;</a></p>
      )}
      {naming && name && check.state === 'ready' && check.status === 'registered' && (
        <p><a href={`https://${naming}/name/${encodeURIComponent(name)}`} rel="noreferrer">See {name} &rarr;</a></p>
      )}
    </div>
  );
}
