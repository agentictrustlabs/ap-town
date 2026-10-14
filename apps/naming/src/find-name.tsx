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

export function FindName({ tld, names, choices }: { tld: string; names: string | null; choices?: ReadonlyArray<{ tld: string; label: string; names: string | null }> }): ReactNode {
  const { search, go } = useRoute();
  // Back from Connect with the label still in hand (`?find=`), and with the ending if one was chosen.
  const [q, setQ] = useState(() => new URLSearchParams(search).get('find') ?? '');
  const [pick, setPick] = useState(() => {
    const back = new URLSearchParams(search).get('tld');
    return choices && back && choices.some((c) => c.tld === back) ? back : tld;
  });
  const label = clean(q);
  // The ending in force: the chosen one when this box offers a choice, the page's own otherwise.
  const end = choices ? pick : tld;
  const endNames = choices ? (choices.find((c) => c.tld === end)?.names ?? null) : names;
  const [v, setV] = useState<{ state: 'idle' } | { state: 'checking' } | { state: 'ready'; data: NameView } | { state: 'error'; detail: string }>({ state: 'idle' });
  useEffect(() => {
    if (label.length < 3) { setV({ state: 'idle' }); return; }
    let live = true;
    setV({ state: 'checking' });
    const t = window.setTimeout(async () => {
      const r = await getJson<NameView>(`/api/name/${encodeURIComponent(`${label}.${end}`)}`);
      if (!live) return;
      setV(r.ok ? { state: 'ready', data: r.data } : { state: 'error', detail: r.error.detail ?? r.error.error });
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [label, end]);
  const name = `${label}.${end}`;
  // NAMES THAT ALREADY EXIST — the other half of a search box, and the half this one did not have. Typing `nath`
  // asked only whether `nath.me` was free, so looking for `nathan.me` answered about a name nobody holds (owner,
  // 2026-10-14). This asks the service for the names CONTAINING what was typed, across every ending when the box
  // offers a choice of ending, and within this one on a root page. Two characters is enough: it is a browse aid,
  // and the availability answer beside it is the one anybody acts on.
  const [like, setLike] = useState<{ hits: Array<{ name: string; tld: string; kind: PlaceKind }>; total: number } | null>(null);
  useEffect(() => {
    if (label.length < 2) { setLike(null); return; }
    let live = true;
    const t = window.setTimeout(async () => {
      const r = await getJson<{ hits: Array<{ name: string; tld: string; kind: PlaceKind }>; total: number }>(`/api/names-like?q=${encodeURIComponent(label)}${choices ? '' : `&tld=${encodeURIComponent(tld)}`}`);
      if (live) setLike(r.ok ? { hits: r.data.hits, total: r.data.total } : null);
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [label, tld, choices]);
  // Register leads to the step page (430 N6: the ENS register screen), connected or not.
  const register = () => go(registerHref(name));
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (v.state === 'ready' && v.data.status === 'available') register(); else if (label.length >= 3) go(nameHref(name)); };
  const ready = v.state === 'ready' ? v.data : null;
  return (
    <div className="find">
      <form className="search search-big" onSubmit={onSubmit} role="search">
        <label className="sr" htmlFor="find-q">A .{end} name to look for</label>
        <input id="find-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`yourname`} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        {choices ? (
          <>
            <label className="sr" htmlFor="find-tld">The ending, which is the kind of agent</label>
            <select id="find-tld" className="search-suffix search-tld mono" value={end} onChange={(e) => setPick(e.target.value)}>
              {choices.map((c) => <option key={c.tld} value={c.tld}>.{c.tld}</option>)}
            </select>
          </>
        ) : <span className="search-suffix mono">.{tld}</span>}
        <button type="submit" className="button" disabled={label.length < 3}>{ready?.status === 'available' ? 'Register' : 'Look up'}</button>
      </form>
      {choices && <p className="quiet">{endNames ? `A .${end} name names ${endNames}.` : `A .${end} name.`} <Link href={rootHref(end)}>Every .{end} →</Link></p>}
      {label.length > 0 && label.length < 3 && <p className="quiet">Three characters or more.</p>}
      {v.state === 'checking' && <p className="loading" role="status">Checking {name}…</p>}
      {v.state === 'error' && <p className="search-problem" role="alert">{v.detail}</p>}
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
      {/* The name in the row above is not repeated here: it has already been answered, with its price and its
          status, and listing it again as "a name like itself" reads as a second, weaker answer. */}
      {(() => { const rest = (like?.hits ?? []).filter((h) => h.name !== name); return like && rest.length > 0 && (
        <div className="like">
          <p className="quiet">{rest.length === 1 ? 'One other name' : `${like.total - (like.hits.length - rest.length)} other names`} already {rest.length === 1 ? 'contains' : 'contain'} &ldquo;{label}&rdquo;{choices ? '' : `, ending in .${tld}`}:</p>
          <ul className="rows">
            {rest.slice(0, 8).map((h) => (
              <li key={h.name} className="row">
                <Glyph kind={h.kind} />
                <span className="row-main"><Link href={nameHref(h.name)} className="row-name">{h.name}</Link></span>
              </li>
            ))}
          </ul>
          {like.total - (like.hits.length - rest.length) > 8 && <p className="quiet">and {like.total - (like.hits.length - rest.length) - 8} more.</p>}
        </div>
      ); })()}
    </div>
  );
}
