import type { ReactNode } from 'react';
import { SCENE_CSS } from '@ap-town/town-scene';
import { useApi } from './api';
import { Link, Router, useRoute } from './router';
import { SearchBox } from './ui';
import { Home } from './pages/Home';
import { Search } from './pages/Search';
import { Root } from './pages/Root';
import { Name } from './pages/Name';
import { AddressPage } from './pages/Address';
import { Integrate } from './pages/Integrate';

function Page(): ReactNode {
  const { path } = useRoute();
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '') return <Home />;
  if (path === '/search') return <Search />;
  if (path === '/integrate') return <Integrate />;
  if ((m = path.match(/^\/name\/(.+)$/))) return <Name key={m[1]} name={decodeURIComponent(m[1]!)} />;
  if ((m = path.match(/^\/address\/(0x[0-9a-fA-F]{40})$/))) return <AddressPage key={m[1]} address={m[1]!} />;
  if ((m = path.match(/^\/root\/([a-z0-9-]+)$/))) return <Root key={m[1]} tld={m[1]!} />;
  return <section><h1>Nothing here</h1><p className="lede">That page does not exist. Try the search box.</p></section>;
}

function Shell(): ReactNode {
  const { path } = useRoute();
  const health = useApi<{ town: string }>('/api/health');
  const town = health.state === 'ready' ? health.data.town : null;
  return (
    <>
      <style>{SCENE_CSS}</style>
      <a className="skip" href="#main">Skip to the page</a>
      <header className="top">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true" />Names{town && <span className="brand-town">the {town} town</span>}</Link>
        {path !== '/' && <SearchBox />}
        <nav aria-label="Sections"><Link href="/">Places</Link><Link href="/integrate">Integrate</Link><a href="https://town.faithnet.io/town" rel="noreferrer">The town</a></nav>
      </header>
      <main id="main"><Page /></main>
      <footer className="foot">
        <p>The town’s naming service. It reads the chain and holds no key. A name is an address card: it resolves, it lists, and it gives nobody authority.</p>
        <p><a href="https://github.com/agentictrustlabs/ap-town" rel="noreferrer">Source</a> · <Link href="/integrate">Integrate</Link></p>
      </footer>
    </>
  );
}

export function App(): ReactNode { return <Router><Shell /></Router>; }
