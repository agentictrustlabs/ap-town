import type { ReactNode } from 'react';
import { MAP_CSS, SCENE_CSS } from '@ap-town/town-scene';
import { Link, Loading, Router, setAuthHeader, useApi, useRoute } from '@ap-town/town-ui';
import type { TownData } from './types';
import { Overview } from './pages/Overview';
import { Find } from './pages/Find';
import { Service } from './pages/Service';
import { Operations, type Tab } from './pages/Operations';
import { AgentPage } from './pages/Agent';
import { ConnectButton } from './Connect';
import { Connected } from './pages/Connected';
import { Estate } from './pages/Estate';
import { Mcp } from './pages/Mcp';
import { Welcome } from './pages/Welcome';
import { connectionToken, useConnection } from './Connect';

// EVERY read this app makes carries the reader's own session, once, here — not on the handful of call sites a
// developer thought of. The town's API is behind a sign-in, and a page that forgets the header does not show a
// refusal, it shows nothing.
setAuthHeader(() => { const t = connectionToken(); return t ? { authorization: `Bearer ${t}` } : undefined; });

function Page({ t }: { t: TownData }): ReactNode {
  const { path } = useRoute();
  const { conn } = useConnection();
  // BEHIND A SIGN-IN (the owner's decision, 2026-10-13). Every page but the front door and the leg home reads
  // this deployment's operational record, so a stranger is shown what a town IS and how to come in, rather than
  // a page of refusals. The API is gated on the same question — the browser is where a gate is CONVENIENT, never
  // where it is kept — so this is the sentence, not the lock.
  if (!conn && path !== '/connected') return <Welcome t={t} />;
  let m: RegExpMatchArray | null;
  if (path === '/' || path === '') return <Overview t={t} />;
  if (path === '/find') return <Find t={t} />;
  if (path === '/connected') return <Connected />;
  if (path === '/operations') return <Operations t={t} />;
  if ((m = path.match(/^\/operations\/(estates|homes|inference|chain|apps|infra|cost|performance)$/))) return <Operations t={t} tab={m[1] as Tab} />;
  if (path === '/mcp') return <Mcp t={t} />;
  if ((m = path.match(/^\/estate\/([a-z0-9-]+)$/))) return <Estate key={m[1]} t={t} id={m[1]!} />;
  if ((m = path.match(/^\/service\/([a-z0-9-]+)$/))) return <Service t={t} id={m[1]!} />;
  if ((m = path.match(/^\/agent\/(.+)$/))) return <AgentPage key={m[1]} t={t} id={decodeURIComponent(m[1]!)} />;
  return <section><h1>Nothing here</h1><p className="lede">That page does not exist. <Link href="/">Back to the town.</Link></p></section>;
}

function Shell(): ReactNode {
  const { conn } = useConnection();
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
        {/* A LINK THAT GOES NOWHERE IS WORSE THAN NO LINK. The town's own areas are behind the sign-in, so an
            unconnected reader is not offered four of them that all render the front door. Names and Skills are
            other services with their own front doors, and they stay — they were never this portal's to gate. */}
        <nav aria-label="Areas">
          {conn && <Link href="/find">Find</Link>}
          {conn && <Link href="/mcp">MCP</Link>}
          {naming && <a href={`https://${naming}`} rel="noreferrer">Names</a>}
          {skills && <a href={`https://${skills}`} rel="noreferrer">Skills</a>}
          {conn && <Link href="/operations">Pulse</Link>}
        </nav>
        {/* WHO IS ASKING, in the corner, because it changes what every answer on every page can be. It is
            not a sign-in TO the town: the town has no account to hold. It is the session your own Home
            issued, relayed by this page to whichever agent you ask. */}
        <span className="top-right">{town && <ConnectButton estates={town.estates} />}</span>
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
