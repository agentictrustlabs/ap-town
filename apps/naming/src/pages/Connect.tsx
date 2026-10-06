import { useEffect, useState, type ReactNode } from 'react';
import type { EstateRef } from '../api-types';
import { Link, useRoute } from '../router';
import type { Persona } from '../session';
import { useSession } from '../use-session';

/**
 * The door (spec 431 §5.1). One estate → one button to its Home; several → the visitor picks theirs. A new person
 * gets a nameless Home at the front door and comes back here, where Register waits. The town's demo roster is
 * offered too, for a visitor who wants to try the flow as one of them.
 */
export function Connect(): ReactNode {
  const { session, estates, busy, error, connect, connectAs, personas } = useSession();
  const { go } = useRoute();
  const then = new URLSearchParams(window.location.search).get('then') ?? '/me';
  const [roster, setRoster] = useState<Record<string, Persona[]>>({});
  useEffect(() => {
    if (session) go(then.startsWith('/') ? then : '/me');
  }, [session, then, go]);
  useEffect(() => {
    let live = true;
    for (const e of estates) void personas(e).then((p) => { if (live && p.length) setRoster((r) => ({ ...r, [e.id]: p })); });
    return () => { live = false; };
  }, [estates, personas]);
  const onConnect = async (e: EstateRef) => {
    const s = await connect(e, then);
    if (s) go(then.startsWith('/') ? then : '/me');
  };
  return (
    <>
      <section className="title">
        <div>
          <h1>Connect</h1>
          <p className="lede">Your Home is where a name is bought and signed. Connecting lets this service show your names and send each purchase to your Home with the form filled in. It reads as you; it signs nothing and keeps no key.</p>
        </div>
      </section>
      {error && <div className="banner banner-warn" role="alert"><strong>Not connected.</strong> {error}</div>}
      {estates.length === 0 && <p className="loading" role="status">Finding the town’s Homes…</p>}
      {estates.map((e) => (
        <section key={e.id} className="connect-estate">
          <h2>{estates.length > 1 ? `The ${e.id} Home` : 'Your Home'} <span className="quiet mono">{new URL(e.home).host}</span></h2>
          <p>Sign in with a passkey, Google, or email. New here? The front door makes you a Home — nameless at first — and brings you straight back to register one.</p>
          <div className="home-cta-row">
            <button type="button" className="button" disabled={!!busy} onClick={() => void onConnect(e)}>{busy ?? 'Connect with your Home →'}</button>
          </div>
          {roster[e.id] && (
            <details className="roster">
              <summary>Or try it as one of the town’s demo people</summary>
              <ul className="rows">
                {roster[e.id]!.map((p) => (
                  <li key={p.handle} className="row">
                    <span className="row-main"><span className="row-name">{p.name}</span><span className="row-sub">{p.blurb || p.handle}</span></span>
                    <button type="button" className="button button-quiet" disabled={!!busy} onClick={() => void connectAs(e, p.handle).then((s) => { if (s) go(then.startsWith('/') ? then : '/me'); })}>Connect as {p.name.split(' ')[0]}</button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ))}
      <p className="quiet">Connecting gives this service a session, never a key: nothing it holds can buy, move, or sign. <Link href="/integrate">How it reads</Link>.</p>
    </>
  );
}
