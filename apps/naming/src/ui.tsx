// The pieces every page uses. Words here are deliberate (spec 430): a chip says a state, a signal says one fact,
// and nothing on any page says or implies that a name gives anyone authority.
import { useState, type FormEvent, type ReactNode } from 'react';
import { IsoScene, type PlaceKind, type TownSceneV1 } from '@ap-town/town-scene';
import { getJson, type Loaded } from './api';
import type { Banner, EstateRef, SearchView, Signal, Stamp } from './api-types';
import { Link, addressHref, nameHref, rootHref, useRoute } from './router';
import { glyphScene } from './scenes';

export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

const CHIP: Record<string, { text: string; tone: string }> = {
  registered: { text: 'Registered', tone: 'ok' }, available: { text: 'Available', tone: 'free' }, expired: { text: 'Expired', tone: 'warn' },
  invalid: { text: 'Not a name', tone: 'bad' }, 'not-claimable': { text: 'Not claimable', tone: 'muted' }, mismatch: { text: 'Type mismatch', tone: 'warn' },
  legacy: { text: 'Legacy root', tone: 'muted' },
};
export function Chip({ kind }: { kind: keyof typeof CHIP | string }): ReactNode {
  const c = CHIP[kind] ?? { text: kind, tone: 'muted' };
  return <span className={`chip chip-${c.tone}`}>{c.text}</span>;
}

export function Glyph({ kind, lit = true, size = 44 }: { kind: PlaceKind; lit?: boolean; size?: number }): ReactNode {
  return <span className="glyph" style={{ width: size, height: size }} aria-hidden="true"><IsoScene scene={glyphScene(kind, lit)} bare /></span>;
}

export function Scene({ scene, selected, legend, small }: { scene: TownSceneV1; selected?: string; legend?: string; small?: boolean }): ReactNode {
  const { go } = useRoute();
  return (
    <figure className={small ? 'scene scene-small' : 'scene'}>
      <IsoScene scene={scene} onNavigate={go} {...(selected ? { selected } : {})} />
      {legend && <figcaption>{legend}</figcaption>}
    </figure>
  );
}

export function Copy({ value, label }: { value: string; label?: string }): ReactNode {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="copy" title="Copy" aria-label={`Copy ${label ?? value}`}
      onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

export function Addr({ address, name, full }: { address: string; name?: string | null; full?: boolean }): ReactNode {
  return (
    <span className="addr">
      {name ? <Link href={nameHref(name)} className="addr-name">{name}</Link> : null}
      <Link href={addressHref(address)} className="mono" title={address}>{full ? address : short(address)}</Link>
      <Copy value={address} label="address" />
    </span>
  );
}

const SIGNAL_ICON: Record<Signal['state'], string> = { yes: '●', no: '○', warn: '▲', unknown: '?' };
export function Signals({ signals }: { signals: { named: Signal; typed: Signal; listed: Signal; reachable: Signal } }): ReactNode {
  const rows: Array<[string, Signal]> = [['Named', signals.named], ['Typed', signals.typed], ['Listed', signals.listed], ['Reachable', signals.reachable]];
  return (
    <div className="signals" role="list" aria-label="Four separate facts about this name">
      {rows.map(([k, s]) => (
        <div key={k} role="listitem" className={`signal signal-${s.state}`}>
          <span className="signal-head"><span aria-hidden="true">{SIGNAL_ICON[s.state]}</span> {k}<span className="sr"> — {s.state}</span></span>
          <span className="signal-detail">{s.detail}</span>
        </div>
      ))}
      <div role="listitem" className="signal signal-none">
        <span className="signal-head"><span aria-hidden="true">—</span> Authorized</span>
        <span className="signal-detail">Not something a name can say. Whether you may ask this agent to act is decided by a delegation it signs, checked on chain.</span>
      </div>
    </div>
  );
}

export function Banners({ banners }: { banners: Banner[] }): ReactNode {
  if (!banners.length) return null;
  return <div className="banners">{banners.map((b) => <div key={b.title} className={`banner banner-${b.tone}`} role={b.tone === 'warn' ? 'alert' : 'note'}><strong>{b.title}.</strong> {b.body}</div>)}</div>;
}

/** Where a change happens: at the owner's Home. One estate → one button; several → the visitor picks theirs. */
export function AtYourHome({ estates, verb }: { estates: EstateRef[]; verb: string }): ReactNode {
  return (
    <div className="home-cta">
      <p>{verb} happens at your own Home, signed by your own account. This service only reads.</p>
      <div className="home-cta-row">
        {estates.map((e) => <a key={e.id} className="button" href={e.naming} rel="noreferrer">{estates.length > 1 ? `Open ${e.id}` : 'Open your Home'} →</a>)}
      </div>
    </div>
  );
}

export function Stamped({ s }: { s: Stamp }): ReactNode {
  return <p className="stamp">Read from chain {s.chainId} at block {s.block.toLocaleString()}. Nothing sits between this page and the chain.</p>;
}

export function Loading<T>({ v, children }: { v: Loaded<T>; children: (data: T) => ReactNode }): ReactNode {
  if (v.state === 'loading') return <p className="loading" role="status">Reading the chain…</p>;
  if (v.state === 'error') {
    return (
      <div className="banner banner-warn" role="alert">
        <strong>This could not be read.</strong> {v.error.detail ?? v.error.error}{v.status === 502 ? ' The chain did not answer; nothing is shown rather than something stale.' : ''}
      </div>
    );
  }
  return <>{children(v.data)}</>;
}

/** One box: a name, a bare label, an address, or an agent's host. It asks the service what the text is, then goes there. */
export function SearchBox({ initial = '', big = false }: { initial?: string; big?: boolean }): ReactNode {
  const { go } = useRoute();
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true); setProblem(null);
    const r = await getJson<SearchView>(`/api/search?q=${encodeURIComponent(text)}`);
    setBusy(false);
    if (!r.ok) { setProblem(r.error.detail ?? 'The chain could not be read just now.'); return; }
    const v = r.data;
    if (v.kind === 'name') go(nameHref(v.name));
    else if (v.kind === 'address') go(addressHref(v.address));
    else if (v.kind === 'root') go(rootHref(v.tld));
    else if (v.kind === 'label') go(`/search?q=${encodeURIComponent(v.label)}`);
    else setProblem(v.detail);
  };
  return (
    <form className={big ? 'search search-big' : 'search'} onSubmit={(e) => void submit(e)} role="search">
      <label className="sr" htmlFor={big ? 'q-big' : 'q'}>A name, a label or an address</label>
      <input id={big ? 'q-big' : 'q'} value={q} onChange={(e) => { setQ(e.target.value); setProblem(null); }} placeholder="nathan.me · a label · 0x…" autoComplete="off" autoCapitalize="none" spellCheck={false} aria-invalid={!!problem} aria-describedby={problem ? 'q-problem' : undefined} />
      <button type="submit" className="button" disabled={busy} aria-busy={busy}>{busy ? 'Looking…' : 'Look up'}</button>
      {problem && <p id="q-problem" className="search-problem" role="alert">{problem}</p>}
    </form>
  );
}

export function Tabs({ tabs, active, onPick }: { tabs: Array<{ id: string; label: string; count?: number }>; active: string; onPick: (id: string) => void }): ReactNode {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === active} className={t.id === active ? 'tab tab-on' : 'tab'} onClick={() => onPick(t.id)}>
          {t.label}{typeof t.count === 'number' ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
