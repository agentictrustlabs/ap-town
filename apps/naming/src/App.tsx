import type { ReactNode } from 'react';
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

/** The connected person in the header: their name, or their address while nameless, leading to /me; else Connect. */
function Who(): ReactNode {
  const { session } = useSession();
  if (!session) return <Link href="/connect" className="button button-quiet">Connect</Link>;
  return <Link href="/me" className="who"><span className="brand-mark" aria-hidden="true" />{session.name ?? session.label ?? <span className="mono">{short(session.address)}</span>}</Link>;
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
        <nav aria-label="Sections"><Link href="/">Places</Link><Link href="/integrate">Integrate</Link><a href="https://town.faithnet.io/town" rel="noreferrer">The town</a><Who /></nav>
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
