/**
 * REGISTER (spec 431 §5.1). One button on a free name, on a root, on the home page. Not connected → Connect (the
 * Home's front door; a new person comes back nameless). Connected → the name is for the person themself (their own
 * .me, when they have none yet) or for a NEW agent they will custody — a second person, an organization, a service…
 * — and the Home opens in a popup with the kind, the label and the ending filled in; when the signatures land the
 * popup comes back here, closes, and this page shows the new name. The Home's part is the signatures.
 */
import { useState, type ReactNode } from 'react';
import type { PlaceKind } from '@ap-town/town-scene';
import { Link, nameHref, useRoute } from './router';
import { CHARTER_KINDS, handoffHref, navigateToHomeCeremony, openHomeCeremony } from './session';
import { useSession } from './use-session';
import { Glyph } from './ui';

export const KIND_OF_TLD: Record<string, PlaceKind> = { me: 'person', org: 'org', team: 'team', svc: 'service', church: 'church', circle: 'circle', household: 'household', workspace: 'workspace', treasury: 'treasury', registry: 'registry' };

export function connectHref(then: string): string { return `/connect?then=${encodeURIComponent(then)}`; }

/** Runs one Home ceremony from a button: popup first, full page when blocked; lands on the new name. */
export function useHomeCeremony(): { run: (href: string) => Promise<void>; cancel: () => void; busy: string | null; error: string | null } {
  const { session, refreshAgents } = useSession();
  const { go } = useRoute();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aborter, setAborter] = useState<AbortController | null>(null);
  const run = async (href: string) => {
    if (!session) return;
    const ac = new AbortController();
    setAborter(ac); setError(null); setBusy('Opening your Home…');
    try {
      const r = await openHomeCeremony(session, href, setBusy, ac.signal);
      if (r === 'blocked') { navigateToHomeCeremony(href); return; }
      if (r) { refreshAgents(); go(`${nameHref(r.name)}?just=${Date.now()}`); }
      else setError('Nothing landed from your Home. If you closed its window, nothing was bought; try again when you like.');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(null); setAborter(null); }
  };
  const cancel = () => aborter?.abort();
  return { run, cancel, busy, error };
}

/** The line shown while the Home is open: what to do, and a way out. */
export function Waiting({ busy, cancel }: { busy: string | null; cancel: () => void }): ReactNode {
  if (!busy) return null;
  return <p className="loading waiting" role="status">{busy} <button type="button" className="linkish" onClick={cancel}>Cancel</button></p>;
}

/** A register button for a name (label + ending known) or for an ending (label chosen at the Home). */
export function Register({ label, tld, price }: { label: string; tld: string; price?: { coins: number; coin: string } | null }): ReactNode {
  const { session } = useSession();
  const { path } = useRoute();
  const { run, cancel, busy, error } = useHomeCeremony();
  const [open, setOpen] = useState(false);
  const [words, setWords] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [about, setAbout] = useState('');
  const profile = { ...(displayName ? { displayName } : {}), ...(about ? { about } : {}) };
  const name = label ? `${label}.${tld}` : `a .${tld} name`;
  const cost = price ? ` for ${price.coins} ${price.coin}` : '';
  if (!session) {
    return (
      <div className="home-cta register">
        <p><strong>Register {name}.</strong> Connect first: your Home is where a name is bought and signed. New here? The front door makes you a Home, nameless, and brings you straight back.</p>
        <div className="home-cta-row"><Link href={connectHref(path + window.location.search)} className="button">Connect to register →</Link></div>
      </div>
    );
  }
  const estate = session.estate;
  const own = tld === 'me' && !session.name;
  const kinds = CHARTER_KINDS.filter((k) => k.tld === tld);
  return (
    <div className="home-cta register" aria-busy={!!busy}>
      {own && (
        <>
          <p><strong>Make {name} your own name{cost}.</strong> You are connected as <span className="mono">{session.address.slice(0, 6)}…{session.address.slice(-4)}</span> and present no name yet. Your Home opens with it filled in; two taps there, and this page shows the name as yours.</p>
          <div className="home-cta-row"><button type="button" className="button" disabled={!!busy} onClick={() => void run(handoffHref(estate, { claim: label, tld, ...profile }))}>{`Buy ${name} at your Home →`}</button></div>
          <Waiting busy={busy} cancel={cancel} />
        </>
      )}
      {!own && kinds.length > 0 && (
        <>
          <p><strong>Register {name}{cost} as a new agent you keep.</strong> {session.name ? <>You are connected as <strong>{session.name}</strong>. </> : null}The ending decides what it is: {kinds.map((k) => k.label.toLowerCase()).join(' or ')}. Your Home opens, creates the agent with its own treasury, buys the name, and this page shows it.</p>
          <div className="home-cta-row">
            {kinds.map((k) => <button key={k.kind} type="button" className="button" disabled={!!busy} onClick={() => void run(handoffHref(estate, { charter: k.kind, claim: label, tld, ...profile }))}><Glyph kind={KIND_OF_TLD[tld] ?? 'service'} size={22} /> {`${k.label} named ${label || `….${tld}`} →`}</button>)}
            <Waiting busy={busy} cancel={cancel} />
            {tld === 'me' && session.name && <span className="quiet">Your own name is <Link href={nameHref(session.name)}>{session.name}</Link>; a second .me is a persona — another name of yours with its own agent.</span>}
          </div>
        </>
      )}
      {!own && kinds.length === 0 && (
        <p>A .{tld} name is claimed by the kind of agent it names, from that agent's own Home page. <a href={handoffHref(estate, { claim: label, tld })} rel="noreferrer">Open your Home with it filled in →</a></p>
      )}
      {(own || kinds.length > 0) && label && (
        <p className="quiet">
          {words ? null : <button type="button" className="linkish" onClick={() => setWords(true)}>Add a few words first (what it is called, a line about it)</button>}
        </p>
      )}
      {words && (
        <div className="words">
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="what people call it (public)" aria-label="Display name" maxLength={80} />
          <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="a line about it (public)" aria-label="About" maxLength={280} />
          <span className="quiet">Written as the name's records in the same ceremony. Optional; changeable later.</span>
        </div>
      )}
      {error && <p className="search-problem" role="alert">{error}</p>}
      {!label && kinds.length > 0 && !open && <p className="quiet"><button type="button" className="linkish" onClick={() => setOpen(true)}>Other kinds of agent</button></p>}
      {open && <KindPicker />}
    </div>
  );
}

/** Every kind a connected person may charter, each opening the Home with the ending chosen and the label blank. */
export function KindPicker({ label = '' }: { label?: string }): ReactNode {
  const { session } = useSession();
  const { run, cancel, busy, error } = useHomeCeremony();
  if (!session) return null;
  return (
    <>
      <Waiting busy={busy} cancel={cancel} />
      {error && <p className="search-problem" role="alert">{error}</p>}
      <ul className="kinds" aria-busy={!!busy}>
        {CHARTER_KINDS.map((k) => (
          <li key={k.kind}>
            <button type="button" className="kind" disabled={!!busy} onClick={() => void run(handoffHref(session.estate, { charter: k.kind, ...(label ? { claim: label } : {}), tld: k.tld }))}>
              <Glyph kind={KIND_OF_TLD[k.tld] ?? 'service'} size={40} />
              <span className="kind-body"><span className="kind-label">{k.label} <span className="mono">.{k.tld}</span></span><span className="kind-blurb">{k.blurb}</span></span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
