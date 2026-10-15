import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MAP_CSS, SCENE_CSS } from '@ap-town/town-scene';
import { useApi } from './api';
import { Link, Router, useRoute } from './router';
import { SearchBox } from './ui';
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { Root } from './pages/Root';
import { Name } from './pages/Name';
import { AddressPage } from './pages/Address';
import { Integrate } from './pages/Integrate';
import { Connect } from './pages/Connect';
import { Me } from './pages/Me';
import { RegisterPage } from './pages/RegisterPage';
import { SessionProvider, useSession } from './use-session';
import { Glyph, short } from './ui';
import { PLACE_OF_KIND } from './pages/Me';
import { nameHref } from './router';

function Page(): ReactNode {
  const { path, search } = useRoute();
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '') return <Home />;
  if (path === '/search') return <Search />;
  if (path === '/integrate') return <Integrate />;
  if (path === '/connect') return <Connect />;
  if (path === '/me') return <Me />;
  if ((m = path.match(/^\/register\/(.+)$/))) return <RegisterPage key={m[1]} name={decodeURIComponent(m[1]!)} />;
  if ((m = path.match(/^\/name\/(.+)$/))) return <Name key={m[1] + search} name={decodeURIComponent(m[1]!)} />;
  if ((m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})$/))) return <AddressPage key={m[1]} address={m[1]!} />;
  if ((m = path.match(/^\/root\/([a-z0-9-]+)$/))) return <Root key={m[1]} tld={m[1]!} />;
  return <section><h1>Nothing here</h1><p className="lede">That page does not exist. Try the search box.</p></section>;
}

/**
 * THE CONNECTED PERSON IN THE HEADER — the name, and under it the way out.
 *
 * The name was a plain link to /me, so the only way to disconnect was to know that /me existed and to find two
 * small links at the bottom of it (owner, 2026-10-14). Sign-out belongs where the identity is shown. The name is
 * the control now and the menu is where leaving lives — the same shape the town portal uses, down to the shared
 * classes, because a person who uses both should not have to learn two headers.
 *
 * The menu says WHICH Home this session came from: on a town with more than one estate, that is the difference
 * between two people with the same name.
 */
function Who(): ReactNode {
  const { session, leave } = useSession();
  const { go } = useRoute();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    // A menu that outlives a click somewhere else is a menu in the way.
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('keydown', key);
    window.addEventListener('mousedown', away);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('mousedown', away); };
  }, [open]);
  if (!session) return <Link href="/connect" className="button button-quiet">Connect</Link>;
  const name = session.name ?? session.label ?? short(session.address);
  let host = session.estate.home;
  try { host = new URL(session.estate.home).host; } catch { /* show it as given */ }
  return (
    <span className="account" ref={box}>
      <button type="button" className="account-name" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="brand-mark" aria-hidden="true" />
        <span className="who">{name}</span>
        <span className="caret" aria-hidden="true">{open ? '\u25b4' : '\u25be'}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-who">
            <b>{name}</b>
            <small className="mono">{session.address}</small>
            <small>signed in at {host}</small>
          </p>
          <div className="account-sep" />
          <button type="button" className="account-item" role="menuitem" onClick={() => { setOpen(false); go('/me'); }}>Everything of yours</button>
          <a className="account-item" role="menuitem" href={session.estate.home} target="_blank" rel="noreferrer">Open my Home</a>
          <div className="account-sep" />
          {/* TWO WAYS OUT, because they are different and the difference matters. Leaving this site alone keeps
              the Home session alive, so the next Connect walks straight back in with no ceremony — which reads as
              "disconnect did nothing" unless it is said. Signing out at the Home ends it for every app connected
              to it, which is what most people mean. */}
          <button type="button" className="account-item" role="menuitem" onClick={() => { setOpen(false); leave(true); }}>Sign out</button>
          <p className="account-note">Ends the session at {host} too, and at the other apps connected to it.</p>
          <div className="account-sep" />
          <button type="button" className="account-item" role="menuitem" onClick={() => { setOpen(false); leave(); }}>Leave this site only</button>
          <p className="account-note">Forgets you here; your Home still knows you, so connecting again takes one tap.</p>
        </div>
      )}
    </span>
  );
}

/**
 * YOURS — always in view while connected (owner, 2026-10-06): the named agents the person keeps, as one strip under
 * the header on every page; the unnamed ones are counted, not listed. Each leads to its name; the end leads to /me.
 */
function Yours(): ReactNode {
  const { session, agents } = useSession();
  const { path } = useRoute();
  if (!session || path === '/me' || path === '/connect') return null;
  const named = (agents ?? []).filter((a) => a.name);
  const unnamed = (agents ?? []).length - named.length;
  const own = session.name ? [{ agent: session.address, name: session.name, label: null, kind: 'person', relationship: 'own' }] : [];
  const all = [...own, ...named.filter((a) => a.name !== session.name)];
  return (
    <nav className="yours" aria-label="Your named agents">
      <span className="yours-label">Yours</span>
      <ul>
        {all.map((a) => <li key={a.agent}><Link href={nameHref(a.name!)} className="yours-chip"><Glyph kind={PLACE_OF_KIND[a.kind] ?? 'service'} size={18} />{a.name}</Link></li>)}
        {agents === null && <li className="quiet">reading your Home…</li>}
        {agents !== null && all.length === 0 && <li className="quiet">no named agent yet</li>}
        {unnamed > 0 && <li className="quiet">+{unnamed} unnamed</li>}
        <li><Link href="/me" className="yours-chip yours-more">All yours →</Link></li>
      </ul>
    </nav>
  );
}

function Shell(): ReactNode {
  const { path } = useRoute();
  const health = useApi<{ town: string }>('/api/health');
  const town = health.state === 'ready' ? health.data.town : null;
  return (
    <>
      <style>{SCENE_CSS}{MAP_CSS}</style>
      <a className="skip" href="#main">Skip to the page</a>
      <header className="top">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true" />Names{town && <span className="brand-town">the {town} town</span>}</Link>
        <SearchBox />
        <nav aria-label="Sections"><Link href="/">Places</Link><Link href="/integrate">Integrate</Link><a href="https://faithnet.town/town" rel="noreferrer">The town</a><Who /></nav>
      </header>
      <Yours />
      <main id="main"><Page /></main>
      <footer className="foot">
        <p>The town’s naming service. It reads the chain and holds no key. A name is an address card: it resolves, it lists, and it gives nobody authority.</p>
        <p><a href="https://github.com/agentictrustlabs/ap-town" rel="noreferrer">Source</a> · <Link href="/integrate">Integrate</Link></p>
      </footer>
    </>
  );
}

export function App(): ReactNode { return <Router><SessionProvider><Shell /></SessionProvider></Router>; }
