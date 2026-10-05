import type { ReactNode } from 'react';
import { MAP_CSS, SCENE_CSS } from '@ap-town/town-scene';
import { Link, Loading, Router, useApi, useRoute } from '@ap-town/town-ui';
import type { TownData } from './types';
import { Overview } from './pages/Overview';
import { Find } from './pages/Find';
import { Service } from './pages/Service';
import { Operations } from './pages/Operations';
import { AgentPage } from './pages/Agent';

function Page({ t }: { t: TownData }): ReactNode {
  const { path } = useRoute();
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '') return <Overview t={t} />;
  if (path === '/find') return <Find t={t} />;
  if (path === '/operations') return <Operations t={t} />;
  if ((m = path.match(/^\/service\/([a-z0-9-]+)$/))) return <Service t={t} id={m[1]!} />;
  if ((m = path.match(/^\/agent\/(.+)$/))) return <AgentPage key={m[1]} t={t} id={decodeURIComponent(m[1]!)} />;
  return <section><h1>Nothing here</h1><p className="lede">That page does not exist. <Link href="/">Back to the town.</Link></p></section>;
}

function Shell(): ReactNode {
  const v = useApi<TownData>('/api/town');
  const town = v.state === 'ready' ? v.data : null;
  const naming = town?.services.find((s) => s.id === 'naming')?.hosts[0];
  const skills = town?.services.find((s) => s.id === 'skills')?.hosts[0];
  return (
    <>
      <style>{SCENE_CSS}{MAP_CSS}</style>
      <a className="skip" href="#main">Skip to the page</a>
      <header className="top">
        <Link href="/" className="brand"><span className="brand-mark" aria-hidden="true" />The town{town && <span className="brand-town">{town.town} · chain {town.chain.id}</span>}</Link>
        <nav aria-label="Areas">
          <Link href="/find">Find</Link>
          {naming && <a href={`https://${naming}`} rel="noreferrer">Names</a>}
          {skills && <a href={`https://${skills}`} rel="noreferrer">Skills</a>}
          <Link href="/operations">Operations</Link>
        </nav>
      </header>
      <main id="main"><Loading v={v} what="Reading the town">{(t) => <Page t={t} />}</Loading></main>
      <footer className="foot">
        <p>The town portal. It reads the town's manifest, probes its services and asks its registry; it holds no key. Shared by all, owned by none.</p>
        <p><a href="https://github.com/agentictrustlabs/ap-town" rel="noreferrer">Source</a> · {town && <a href={town.card} rel="noreferrer">the town's agent card</a>}</p>
      </footer>
    </>
  );
}

export function App(): ReactNode { return <Router><Shell /></Router>; }
