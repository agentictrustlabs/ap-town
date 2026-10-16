// The pieces every page uses. Words here are deliberate (spec 430): a chip says a state, a signal says one fact,
// and nothing on any page says or implies that a name gives anyone authority.
import { useState, type FormEvent, type ReactNode } from 'react';
import { IsoScene, TownMap, type PlaceKind, type TownSceneV1 } from '@ap-town/town-scene';
import { getJson, type Loaded } from './api';
import type { NameIdentity, Banner, EstateRef, SearchView, Signal, Stamp } from './api-types';
import { Link, addressHref, nameHref, rootHref, useRoute } from './router';
import { glyphScene } from './scenes';

export const short = (a: string): string => `${a.slice(0, 6)}…${a.slice(-4)}`;

const CHIP: Record<string, { text: string; tone: string }> = {
  registered: { text: 'Registered', tone: 'ok' }, available: { text: 'Available', tone: 'free' }, expired: { text: 'Expired', tone: 'warn' },
  invalid: { text: 'Not a name', tone: 'bad' }, 'not-claimable': { text: 'Not claimable', tone: 'muted' }, mismatch: { text: 'Type mismatch', tone: 'warn' },
  legacy: { text: 'Legacy root', tone: 'muted' }, persona: { text: 'A name of yours', tone: 'ok' },
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

/** The town with a camera: drag, wheel, pinch, double-press; fit and step buttons. For the big pictures. */
export function Map({ scene, legend, height }: { scene: TownSceneV1; legend?: string; height?: number }): ReactNode {
  const { go } = useRoute();
  return <figure className="scene"><TownMap scene={scene} onNavigate={go} height={height ?? 520} />{legend && <figcaption>{legend}</figcaption>}</figure>;
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

/**
 * Where a change happens: at the owner's Home, signed by the owner's own account. The link carries what the visitor
 * was looking at (`claim` = the label and ending to claim, `name` = the name to change) and the way back here, so the
 * Home can fill the form in and send them back when it lands (spec 430 N2). One estate → one button; several → the
 * visitor picks theirs. This service never signs and never holds a session.
 */
export function AtYourHome({ estates, verb, claim, name }: { estates: EstateRef[]; verb: string; claim?: { label: string; tld: string }; name?: string }): ReactNode {
  const back = typeof window === 'undefined' ? '' : window.location.href;
  const href = (e: EstateRef): string => {
    const u = new URL(e.naming);
    if (claim) { if (claim.label) u.searchParams.set('claim', claim.label); u.searchParams.set('tld', claim.tld); }
    if (name) u.searchParams.set('name', name);
    if (back) u.searchParams.set('return', back);
    return u.toString();
  };
  return (
    <div className="home-cta">
      <p>{verb} happens at your own Home, signed by your own account. This service only reads.{claim?.label ? ` Your Home will have ${claim.label}.${claim.tld} filled in and bring you back here when it lands.` : ''}</p>
      <div className="home-cta-row">
        {estates.map((e) => <a key={e.id} className="button" href={href(e)} rel="noreferrer">{estates.length > 1 ? `Open ${e.id}` : 'Open your Home'} →</a>)}
      </div>
    </div>
  );
}

export function Stamped({ s }: { s: Stamp }): ReactNode {
  if (s.rootedAt) return <p className="stamp">Names are rooted on {s.rootedAt.town}: read from the root chain {s.rootedAt.chainId} at block {s.rootedAt.block.toLocaleString()}, and this chain {s.chainId} at block {s.block.toLocaleString()}. Nothing sits between this page and either chain.</p>;
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

/** THE AGENT BEHIND THE NAME, FIRST. A name is a projection of an agent's identity: one agent, one canonical id (its home
 *  account), one account per chain, one name. The root chain is where the NAME lives; where the AGENT lives is the home
 *  account, and the two are different addresses whenever the agent's Home is on another chain. This block makes that
 *  unmissable, because the root chain's address is the one everybody will want to call canonical. */
export function IdentityBlock({ identity: id }: { identity: NameIdentity | null | undefined }): ReactNode {
  if (!id || !id.here) return null;
  const chainWord = (a: { chainId: number; town: string | null }) => `eip155:${a.chainId}${a.town ? ` · the ${a.town} town` : ''}`;
  const roleWord = (r: string) => (r === 'home' ? 'home — the canonical id' : r === 'satellite' ? 'satellite — holds the name on this chain' : 'role not declared');
  return (
    <section className="identity" aria-labelledby="identity-h">
      <h2 id="identity-h">The agent behind this name</h2>
      <dl className="facts facts-wide">
        <dt>Agent (canonical id)</dt>
        <dd>
          {id.canonical
            ? <><span className="mono break">{id.canonical}</span> <Copy value={id.canonical} label="canonical id" /><br /><span className="quiet">The account this name is a name of. Its Home and custody live on {chainWord({ chainId: id.canonicalChainId!, town: id.canonicalTown })}.</span></>
            : <><strong>Not declared.</strong> <span className="quiet">The name lists no home account (<span className="mono">atl:nativeId</span>). The address below is the agent's account on this chain, and nothing on chain says it is the agent's home.</span></>}
        </dd>
        <dt>On this chain</dt>
        <dd>
          <span className="mono break">{id.here.account}</span> <Copy value={id.here.account} label="account on this chain" /><br />
          <span className="quiet">{id.here.role === 'home' ? 'This is the agent’s home account: the canonical id, on this chain.' : id.here.role === 'satellite' ? `The agent’s account here. It holds the name on this chain (${chainWord(id.here)}) — a satellite, not the canonical id.` : `The agent’s account on ${chainWord(id.here)}; whether it is the home account is not written.`}</span>
        </dd>
        {id.estate && <>
          <dt>Estate and Home</dt>
          <dd>{id.estate.home ? <a href={id.estate.home} rel="noreferrer">{id.estate.home.replace(/^https?:\/\//, '')}</a> : '—'}{id.estate.id ? <> · the <strong>{id.estate.id}</strong> estate</> : null}{id.estate.town ? <> · the {id.estate.town} town</> : null}{id.estate.name ? <span className="quiet"> · {id.estate.name}</span> : null}<br /><span className="quiet">{id.estate.how === 'declared' ? 'Declared by the agent itself (atl:estate).' : 'Placed by the agent’s own endpoint against the towns’ manifests — an inference, and said so.'}</span></dd>
        </>}
        {id.accounts.length > 1 && <>
          <dt>Accounts by chain</dt>
          <dd>
            <ul className="plain">
              {id.accounts.map((a) => <li key={a.account}><span className="mono break">{a.account}</span> <span className="quiet">· {chainWord(a)} · {roleWord(a.role)}{a.here ? ' · this chain' : ''}</span></li>)}
            </ul>
            <span className="quiet">One account per chain, listed on the name (atl:accounts). A grant lives on one chain, so an act is always signed by the account on the chain it runs on; the canonical id says who, the chain’s account says who signed here.</span>
          </dd>
        </>}
      </dl>
      <p className="public-note">A name is a projection of the agent’s identity, not the identity. The root chain is where the name lives; the home account is where the agent lives.</p>
    </section>
  );
}
