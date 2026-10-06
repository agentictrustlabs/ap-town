import { useState, type FormEvent, type ReactNode } from 'react';
import { useApi } from '../api';
import type { AddressView } from '../api-types';
import { KindPicker } from '../register';
import { Link, addressHref, nameHref, useRoute } from '../router';
import { addressScene } from '../scenes';
import { handoffHref } from '../session';
import { Banners, Chip, Copy, Glyph, Loading, Scene } from '../ui';
import { useSession } from '../use-session';

/**
 * YOU, at the naming service (spec 431 §5.1): the names your agent holds, read from the chain the way anyone could;
 * your own name to set when you have none; and a new agent to register under a name — a second person, an
 * organization, a service. Each action is a hand-off to your Home; this page only reads.
 */
export function Me(): ReactNode {
  const { session, leave } = useSession();
  const { go } = useRoute();
  const v = useApi<AddressView>(session ? `/api/address/${session.address}` : null);
  const [label, setLabel] = useState('');
  if (!session) {
    return (
      <section>
        <h1>Not connected</h1>
        <p className="lede">Connect to see your names and register one.</p>
        <p><Link href="/connect?then=%2Fme" className="button">Connect →</Link></p>
      </section>
    );
  }
  const estate = session.estate;
  const onOwn = (e: FormEvent) => { e.preventDefault(); const l = label.trim().toLowerCase(); if (l) go(nameHref(`${l}.me`)); };
  return (
    <>
      <section className="title">
        <Glyph kind="person" lit={!!session.name} size={72} />
        <div>
          <h1>{session.name ?? 'You, nameless so far'}</h1>
          <p className="title-addr"><span className="mono break">{session.address}</span> <Copy value={session.address} label="address" /></p>
          <p className="lede">{session.name ? `Connected through ${new URL(estate.home).host} as ${session.name}.` : `Connected through ${new URL(estate.home).host}. Your agent presents no name yet — pick one below and your Home will buy it.`}</p>
          <p className="quiet"><button type="button" className="linkish" onClick={() => leave()}>Disconnect here</button> · <button type="button" className="linkish" onClick={() => leave(true)}>Sign out of your Home too</button> · <Link href={addressHref(session.address)}>Public view</Link></p>
        </div>
      </section>
      {!session.name && (
        <section>
          <h2>Your own name</h2>
          <form className="search" onSubmit={onOwn}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="yourname" aria-label="Your name, before .me" pattern="[a-z0-9][a-z0-9-]{2,}" />
            <span className="search-suffix mono">.me</span>
            <button type="submit" className="button">Check and buy →</button>
          </form>
          <p className="quiet">Three letters or more; shorter costs more; nothing costs 50. Or <a href={handoffHref(estate, { tld: 'me' })} rel="noreferrer">pick it at your Home</a>.</p>
        </section>
      )}
      <Loading v={v}>{(a) => (
        <>
          <Banners banners={a.banners} />
          <section>
            <h2>Names your agent holds</h2>
            {a.held.length === 0 ? <p className="quiet">None yet under any open ending in this town.</p> : (
              <>
                <Scene small scene={addressScene(a)} legend="One building per name your agent holds. The lit one is the name it presents." />
                <ul className="rows">
                  {a.held.map((h) => (
                    <li key={h.name} className="row">
                      <Glyph kind={h.kind} lit={h.presented} />
                      <span className="row-main"><Link href={nameHref(h.name)} className="row-name">{h.name}</Link><span className="row-sub">{h.presented ? 'the name you present' : 'held, not presented'}</span></span>
                      {h.presented && <Chip kind="registered" />}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}</Loading>
      <section>
        <h2>Register a new agent under a name</h2>
        <p>An agent you keep, with its own treasury, named at creation: a second person (another name of yours), an organization, a team, a service, a church, a circle, a household. Your Home creates it, buys the name, and brings you back. The ending is the kind; the label is yours to choose there.</p>
        <KindPicker />
      </section>
    </>
  );
}
