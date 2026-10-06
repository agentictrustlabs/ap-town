/**
 * REGISTER (spec 431 §5.1). One button on a free name, on a root, on the home page. Not connected → Connect (the
 * Home's front door; a new person comes back nameless). Connected → the name is for the person themself (their own
 * .me, when they have none yet) or for a NEW agent they will custody — a second person, an organization, a service…
 * — and the hand-off carries the kind, the label and the ending to the Home, whose part is the signatures.
 */
import { useState, type ReactNode } from 'react';
import { Link, useRoute } from './router';
import { CHARTER_KINDS, handoffHref } from './session';
import { useSession } from './use-session';
import { Glyph } from './ui';
import type { PlaceKind } from '@ap-town/town-scene';

const KIND_OF_TLD: Record<string, PlaceKind> = { me: 'person', org: 'org', team: 'team', svc: 'service', church: 'church', circle: 'circle', household: 'household', workspace: 'workspace', treasury: 'treasury', registry: 'registry' };

export function connectHref(then: string): string { return `/connect?then=${encodeURIComponent(then)}`; }

/** A register button for a name (label + ending known) or for an ending (label chosen at the Home). */
export function Register({ label, tld, price }: { label: string; tld: string; price?: { coins: number; coin: string } | null }): ReactNode {
  const { session, estates } = useSession();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
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
  const back = typeof window === 'undefined' ? undefined : window.location.href;
  return (
    <div className="home-cta register">
      {own && (
        <>
          <p><strong>Make {name} your own name{cost}.</strong> You are connected as <span className="mono">{session.address.slice(0, 6)}…{session.address.slice(-4)}</span> and present no name yet. Your Home will have it filled in; two taps there, and the name points at you.</p>
          <div className="home-cta-row"><a className="button" href={handoffHref(estate, { claim: label, tld, ...(back ? { return: back } : {}) })} rel="noreferrer">Buy {name} at your Home →</a></div>
        </>
      )}
      {!own && kinds.length > 0 && (
        <>
          <p><strong>Register {name}{cost} as a new agent you keep.</strong> {session.name ? <>You are connected as <strong>{session.name}</strong>. </> : null}The ending decides what it is: {kinds.map((k) => k.label.toLowerCase()).join(' or ')}. Your Home creates the agent with its own treasury, buys the name, and brings you back.</p>
          <div className="home-cta-row">
            {kinds.map((k) => <a key={k.kind} className="button" href={handoffHref(estate, { charter: k.kind, claim: label, tld, ...(back ? { return: back } : {}) })} rel="noreferrer"><Glyph kind={KIND_OF_TLD[tld] ?? 'service'} size={22} /> {k.label} named {label || `….${tld}`} →</a>)}
            {tld === 'me' && session.name && <span className="quiet">Your own name is <Link href={`/name/${session.name}`}>{session.name}</Link>; a second .me is a persona — another name of yours with its own agent.</span>}
          </div>
        </>
      )}
      {!own && kinds.length === 0 && (
        <p>A .{tld} name is claimed by the kind of agent it names, from that agent's own Home page. <a href={handoffHref(estate, { claim: label, tld, ...(back ? { return: back } : {}) })} rel="noreferrer">Open your Home with it filled in →</a></p>
      )}
      {!label && kinds.length > 0 && !open && <p className="quiet"><button type="button" className="linkish" onClick={() => setOpen(true)}>Other kinds of agent</button></p>}
      {open && <KindPicker />}
    </div>
  );
}

/** Every kind a connected person may charter, each leading to the Home with the ending chosen and the label blank. */
export function KindPicker({ label = '' }: { label?: string }): ReactNode {
  const { session } = useSession();
  if (!session) return null;
  const back = typeof window === 'undefined' ? undefined : window.location.href;
  return (
    <ul className="kinds">
      {CHARTER_KINDS.map((k) => (
        <li key={k.kind}>
          <a className="kind" href={handoffHref(session.estate, { charter: k.kind, ...(label ? { claim: label } : {}), tld: k.tld, ...(back ? { return: back } : {}) })} rel="noreferrer">
            <Glyph kind={KIND_OF_TLD[k.tld] ?? 'service'} size={40} />
            <span className="kind-body"><span className="kind-label">{k.label} <span className="mono">.{k.tld}</span></span><span className="kind-blurb">{k.blurb}</span></span>
          </a>
        </li>
      ))}
    </ul>
  );
}
