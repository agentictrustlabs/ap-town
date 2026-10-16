/**
 * FIND A NAME UNDER ONE ENDING (owner, 2026-10-06: the ENS app's search — type it, see Available, Register — at the top
 * of each type's page). The service answers availability and the price as it answers any name; the Register button
 * is the same ceremony as everywhere (Connect first; then the Home in a popup; then the name page shows it).
 *
 * WITH `choices`, THE ENDING IS PART OF THE SEARCH. A root page asks about one ending and fixes it. The front page
 * asks about all of them, and fixing it to `.me` there made the only box on the page able to answer one question
 * out of seven: someone looking for an organization had to read a paragraph, find the endings grid and start again
 * (owner, 2026-10-14). The ending is a control beside the word, not a different page.
 *
 * It stays the ENDING, never a separate "type" field: the ending IS the kind of agent (ADR-0061), and offering
 * both would invite them to disagree.
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getJson } from './api';
import type { NameView } from './api-types';
import type { PlaceKind } from '@ap-town/town-scene';
import { Link, nameHref, registerHref, rootHref, useRoute } from './router';
import { KIND_OF_TLD } from './register';
import { Chip, Glyph } from './ui';

const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);

/** One root's answer about a label, as `/api/search` gives it. */
interface LabelRow { name: string; tld: string; names: string | null; kind: PlaceKind; status: 'registered' | 'available' | 'expired'; agent: string | null; by: string; coins: number | null; claimedElsewhere?: { town: string; chainId: number; agent: string | null } | null }

/** The endings a person may charter from here — the same seven the Home's ceremony knows (CHARTER_KINDS). */
const CHARTERABLE = ['me', 'org', 'team', 'svc', 'church', 'circle', 'household'];

export function FindName({ tld, names, choices }: { tld: string; names: string | null; choices?: ReadonlyArray<{ tld: string; label: string; names: string | null }> }): ReactNode {
  const { search, go } = useRoute();
  // Back from Connect with the label still in hand (`?find=`), and with the ending if one was chosen.
  const [q, setQ] = useState(() => new URLSearchParams(search).get('find') ?? '');
  // ANY KIND IS THE DEFAULT. Fixed to `.me`, the box answered about one ending of seven before anybody had said
  // which they wanted — you had to choose a kind in order to ask a question that was not about a kind (owner,
  // 2026-10-14). Empty means every ending: the label is looked up under all of them at once, and picking one
  // narrows BOTH what is checked and what is found.
  const [pick, setPick] = useState(() => {
    const back = new URLSearchParams(search).get('tld');
    return choices && back && choices.some((c) => c.tld === back) ? back : choices ? '' : tld;
  });
  const label = clean(q);
  // The ending in force: the chosen one when this box offers a choice, the page's own otherwise.
  const end = choices ? pick : tld;
  const any = choices ? !pick : false;
  const endNames = choices ? (choices.find((c) => c.tld === end)?.names ?? null) : names;
  const [v, setV] = useState<{ state: 'idle' } | { state: 'checking' } | { state: 'ready'; data: NameView } | { state: 'error'; detail: string }>({ state: 'idle' });
  useEffect(() => {
    if (label.length < 3 || any) { setV({ state: 'idle' }); return; }
    let live = true;
    setV({ state: 'checking' });
    const t = window.setTimeout(async () => {
      const r = await getJson<NameView>(`/api/name/${encodeURIComponent(`${label}.${end}`)}`);
      if (!live) return;
      setV(r.ok ? { state: 'ready', data: r.data } : { state: 'error', detail: r.error.detail ?? r.error.error });
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [label, end, any]);

  // UNDER EVERY ENDING AT ONCE — the service's own label search, which answers this exact question: it returns the
  // label under each root with its status and its price. Only asked in "any kind" mode; with an ending chosen, the
  // single answer above is the answer.
  const [rows, setRows] = useState<LabelRow[] | null>(null);
  useEffect(() => {
    if (!any || label.length < 3) { setRows(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const r = await getJson<{ kind: string; chainId: number; rows?: LabelRow[] }>(`/api/search?q=${encodeURIComponent(label)}`);
      if (!live) return;
      // ONE NAME ACROSS THE FEDERATION: a row free on the root may be held in another chain's table (an estate's Home
      // claims where its agent lives — rich-impact.me on hopechain). The service says so on the row (`claimedElsewhere`).
      setRows(r.ok && r.data.kind === 'label' ? r.data.rows ?? [] : []);
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [label, any]);
  const name = `${label}.${end}`;
  // NAMES THAT ALREADY EXIST — the other half of a search box, and the half this one did not have. Typing `nath`
  // asked only whether `nath.me` was free, so looking for `nathan.me` answered about a name nobody holds (owner,
  // 2026-10-14). This asks the service for the names CONTAINING what was typed, across every ending when the box
  // offers a choice of ending, and within this one on a root page. Two characters is enough: it is a browse aid,
  // and the availability answer beside it is the one anybody acts on.
  const [like, setLike] = useState<{ hits: Array<{ name: string; tld: string; kind: PlaceKind; names: string | null; town?: string }>; total: number } | null>(null);
  useEffect(() => {
    if (label.length < 2) { setLike(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const r = await getJson<{ hits: Array<{ name: string; tld: string; kind: PlaceKind; names: string | null; town?: string }>; total: number }>(`/api/names-like?q=${encodeURIComponent(label)}${end ? `&tld=${encodeURIComponent(end)}` : ''}`);
      if (live) setLike(r.ok ? { hits: r.data.hits, total: r.data.total } : null);
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [label, end]);
  // Register leads to the step page (430 N6: the ENS register screen), connected or not.
  const register = () => go(registerHref(name));
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (label.length < 3) return;
    if (any) { go(`/search?q=${encodeURIComponent(label)}`); return; }
    if (v.state === 'ready' && v.data.status === 'available') register(); else go(nameHref(name));
  };
  const ready = v.state === 'ready' ? v.data : null;
  return (
    <div className="find">
      <form className="search search-big" onSubmit={onSubmit} role="search">
        <label className="sr" htmlFor="find-q">{any ? 'A name to look for, under any ending' : `A .${end} name to look for`}</label>
        <input id="find-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`yourname`} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        {choices ? (
          <>
            <label className="sr" htmlFor="find-tld">The ending, which is the kind of agent</label>
            <select id="find-tld" className="search-suffix search-tld mono" value={end} onChange={(e) => setPick(e.target.value)}>
              <option value="">any kind</option>
              {choices.map((c) => <option key={c.tld} value={c.tld}>.{c.tld}</option>)}
            </select>
          </>
        ) : <span className="search-suffix mono">.{tld}</span>}
        <button type="submit" className="button" disabled={label.length < 3}>{!any && ready?.status === 'available' ? 'Register' : 'Look up'}</button>
      </form>
      {choices && (any
        ? <p className="quiet">Every ending is a kind of agent. Look under all of them, then register under the one you mean — or pick an ending to narrow both.</p>
        : <p className="quiet">{endNames ? `A .${end} name names ${endNames}.` : `A .${end} name.`} <Link href={rootHref(end)}>Every .{end} →</Link></p>)}
      {label.length > 0 && label.length < 3 && <p className="quiet">Three characters or more.</p>}
      {v.state === 'checking' && <p className="loading" role="status">Checking {name}…</p>}
      {v.state === 'error' && <p className="search-problem" role="alert">{v.detail}</p>}
      {/* WHAT ALREADY EXISTS, FIRST. This sat under the availability rows, so "people-groups.svc exists" arrived
          below ten lines of "people-group.me is available" and nobody saw it (owner, 2026-10-14). Someone typing a
          partial name is usually looking for a thing, not pricing a new one — and there are few of these and ten
          of those. When an ending is chosen the row below answers that one name in full, so it is not repeated
          here; with no ending chosen there is nothing above to repeat. */}
      {(() => { const rest = (like?.hits ?? []).filter((h) => h.name !== name); return like && rest.length > 0 && (
        <div className="like">
          <p className="quiet">{(() => { const n = like.total - (like.hits.length - rest.length); const other = like.hits.length !== rest.length ? 'other ' : ''; return n === 1 ? `One ${other}name already contains` : `${n} ${other}names already contain`; })()} &ldquo;{label}&rdquo;{end ? `, ending in .${end}` : ''}:</p>
          <ul className="rows">
            {rest.slice(0, 8).map((h) => (
              <li key={h.name} className="row">
                <Glyph kind={h.kind} lit />
                <span className="row-main">
                  <Link href={nameHref(h.name)} className="row-name">{h.name}</Link>
                  {(h.names || h.town) && <span className="row-sub">{h.names ?? ''}{h.town ? `${h.names ? ' · ' : ''}in ${h.town}’s table, not on the root` : ''}</span>}
                </span>
                <Chip kind="registered" />
              </li>
            ))}
          </ul>
          {like.total - (like.hits.length - rest.length) > 8 && <p className="quiet">and {like.total - (like.hits.length - rest.length) - 8} more.</p>}
        </div>
      ); })()}
      {/* THE LABEL UNDER EVERY ENDING. Register only where a PERSON may charter one: `.workspace`, `.treasury` and
          `.registry` are named when the agent that holds them is created, so a button there would send somebody to
          a ceremony that does not exist. They are still shown, with what they are, because "free but not yours to
          claim" is a fact about the label worth knowing. */}
      {any && rows && rows.length > 0 && (
        <ul className="rows label-rows">
          {/* The ones a person may actually charter first; the sort is stable, so inside each group the service's own
              order is kept. */}
          {[...rows].sort((a, b) => (CHARTERABLE.includes(a.tld) ? 0 : 1) - (CHARTERABLE.includes(b.tld) ? 0 : 1)).map((r) => {
            const far = r.claimedElsewhere ?? null;
            const mine = CHARTERABLE.includes(r.tld) && r.status === 'available' && !far;
            return (
              <li key={r.name} className="row">
                <Glyph kind={r.kind} lit={r.status === 'registered' || !!far} />
                <span className="row-main">
                  <Link href={nameHref(r.name)} className="row-name">{r.name}</Link>
                  <span className="row-sub">{far ? `claimed on ${far.town} (eip155:${far.chainId})${far.agent ? ` by ${far.agent.slice(0, 6)}…${far.agent.slice(-4)}` : ''} — not on the root` : r.status === 'registered' ? `held${r.agent ? ` by ${r.agent.slice(0, 6)}…${r.agent.slice(-4)}` : ''}` : r.by}</span>
                </span>
                <Chip kind={far ? 'registered' : r.status} />
                {mine && <button type="button" className="button" onClick={() => go(registerHref(r.name))}>Register →</button>}
              </li>
            );
          })}
        </ul>
      )}
      {ready && (
        <div className="find-row">
          <Glyph kind={KIND_OF_TLD[end] ?? 'service'} lit={ready.status === 'registered'} />
          <span className="row-main">
            <Link href={nameHref(name)} className="row-name">{name}</Link>
            <span className="row-sub">
              {ready.status === 'available' && ready.price ? `${ready.price.coins} ${ready.price.coin}${ready.price.protectedBy ? ` · ${ready.price.protectedBy} exists — a verified email there is needed` : ''}` : ready.status === 'available' ? `free to claim${endNames ? `, by ${endNames}` : ''}` : ready.status === 'registered' ? `held${ready.agent ? ` by ${ready.agent.slice(0, 6)}…${ready.agent.slice(-4)}` : ''}` : ready.invalid?.detail ?? ready.status}
            </span>
          </span>
          <Chip kind={ready.status} />
          {ready.status === 'available' && (
            <button type="button" className="button" onClick={register}>Register →</button>
          )}
        </div>
      )}
    </div>
  );
}
