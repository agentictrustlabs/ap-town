/**
 * FIND A NAME UNDER ONE ENDING (owner, 2026-10-06: the ENS app's search — type it, see Available, Register — at the top
 * of each type's page). The service answers availability and the price as it answers any name; the Register button
 * is the same ceremony as everywhere (Connect first; then the Home in a popup; then the name page shows it).
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { getJson } from './api';
import type { NameView } from './api-types';
import { Link, nameHref, registerHref, useRoute } from './router';
import { KIND_OF_TLD } from './register';
import { Chip, Glyph } from './ui';

const clean = (s: string): string => s.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 63);

export function FindName({ tld, names }: { tld: string; names: string | null }): ReactNode {
  const { search, go } = useRoute();
  // Back from Connect with the label still in hand (`?find=`).
  const [q, setQ] = useState(() => new URLSearchParams(search).get('find') ?? '');
  const label = clean(q);
  const [v, setV] = useState<{ state: 'idle' } | { state: 'checking' } | { state: 'ready'; data: NameView } | { state: 'error'; detail: string }>({ state: 'idle' });
  useEffect(() => {
    if (label.length < 3) { setV({ state: 'idle' }); return; }
    let live = true;
    setV({ state: 'checking' });
    const t = window.setTimeout(async () => {
      const r = await getJson<NameView>(`/api/name/${encodeURIComponent(`${label}.${tld}`)}`);
      if (!live) return;
      setV(r.ok ? { state: 'ready', data: r.data } : { state: 'error', detail: r.error.detail ?? r.error.error });
    }, 300);
    return () => { live = false; window.clearTimeout(t); };
  }, [label, tld]);
  const name = `${label}.${tld}`;
  // Register leads to the step page (430 N6: the ENS register screen), connected or not.
  const register = () => go(registerHref(name));
  const onSubmit = (e: FormEvent) => { e.preventDefault(); if (v.state === 'ready' && v.data.status === 'available') register(); else if (label.length >= 3) go(nameHref(name)); };
  const ready = v.state === 'ready' ? v.data : null;
  return (
    <div className="find">
      <form className="search search-big" onSubmit={onSubmit} role="search">
        <label className="sr" htmlFor="find-q">A .{tld} name to look for</label>
        <input id="find-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`yourname`} autoComplete="off" autoCapitalize="none" spellCheck={false} />
        <span className="search-suffix mono">.{tld}</span>
        <button type="submit" className="button" disabled={label.length < 3}>{ready?.status === 'available' ? 'Register' : 'Look up'}</button>
      </form>
      {label.length > 0 && label.length < 3 && <p className="quiet">Three characters or more.</p>}
      {v.state === 'checking' && <p className="loading" role="status">Checking {name}…</p>}
      {v.state === 'error' && <p className="search-problem" role="alert">{v.detail}</p>}
      {ready && (
        <div className="find-row">
          <Glyph kind={KIND_OF_TLD[tld] ?? 'service'} lit={ready.status === 'registered'} />
          <span className="row-main">
            <Link href={nameHref(name)} className="row-name">{name}</Link>
            <span className="row-sub">
              {ready.status === 'available' && ready.price ? `${ready.price.coins} ${ready.price.coin}${ready.price.protectedBy ? ` · ${ready.price.protectedBy} exists — a verified email there is needed` : ''}` : ready.status === 'available' ? `free to claim${names ? `, by ${names}` : ''}` : ready.status === 'registered' ? `held${ready.agent ? ` by ${ready.agent.slice(0, 6)}…${ready.agent.slice(-4)}` : ''}` : ready.invalid?.detail ?? ready.status}
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
