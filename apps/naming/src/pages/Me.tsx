import { useState, type FormEvent, type ReactNode } from 'react';
import type { PlaceKind } from '@ap-town/town-scene';
import { useApi } from '../api';
import type { AddressView } from '../api-types';
import { KindPicker, Waiting, useHomeCeremony } from '../register';
import { Link, addressHref, nameHref, useRoute } from '../router';
import { addressScene } from '../scenes';
import { agentNamingHref, handoffHref, justRegistered } from '../session';
import { Banners, Chip, Copy, Glyph, Loading, Scene, short } from '../ui';
import { useSession } from '../use-session';

/** The Home's agent kinds, drawn as the town draws them. */
export const PLACE_OF_KIND: Record<string, PlaceKind> = { person: 'person', org: 'org', team: 'team', service: 'service', workspace: 'workspace', 'person-treasury': 'treasury', 'org-treasury': 'treasury', church: 'church', circle: 'circle', household: 'household' };
const KIND_WORD: Record<string, string> = { person: 'another person of yours', org: 'an organization', team: 'a team', service: 'a service', workspace: 'a workspace', 'person-treasury': 'your treasury', 'org-treasury': 'a treasury', church: 'a church', circle: 'a circle', household: 'a household' };

/** The Home's kind for an agent → the ending its name would carry (430 N6b: *Name it* for an unnamed agent). */
const TLD_OF_KIND: Record<string, string> = { person: 'me', org: 'org', team: 'team', service: 'svc', workspace: 'workspace', 'person-treasury': 'treasury', 'org-treasury': 'treasury', church: 'church', circle: 'circle', household: 'household' };

/**
 * The agents the connected person keeps, through their Home (W5c) — the session's shared read, with the ENS
 * dashboard's levers (430 N6b): search within, filter by kind, sort by name or kind; an unnamed agent offers
 * *Name it*, which opens its own naming page at the Home in the popup.
 */
function YourAgents(): ReactNode {
  const { agents, agentsError, session } = useSession();
  const { run, cancel, busy, error } = useHomeCeremony();
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'name' | 'kind'>('kind');
  if (agents === null) return <p className="loading" role="status">Asking your Home…</p>;
  if (agentsError) return <p className="quiet">{agentsError}</p>;
  if (agents.length === 0) return <p className="quiet">None yet. Register one below.</p>;
  const kinds = [...new Set(agents.map((a) => a.kind))].sort();
  const needle = q.trim().toLowerCase();
  const rows = agents
    .filter((a) => kind === 'all' || a.kind === kind)
    .filter((a) => !needle || (a.name ?? '').includes(needle) || (a.label ?? '').toLowerCase().includes(needle) || a.agent.includes(needle))
    .sort((x, y) => sort === 'name' ? (x.name ?? x.label ?? x.agent).localeCompare(y.name ?? y.label ?? y.agent) : (x.kind.localeCompare(y.kind) || (x.name ?? x.label ?? x.agent).localeCompare(y.name ?? y.label ?? y.agent)));
  const unnamed = agents.filter((a) => !a.name).length;
  return (
    <>
      <div className="filters">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="find among yours" aria-label="Find among your agents" />
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="all">Every kind ({agents.length})</option>{kinds.map((k) => <option key={k} value={k}>{KIND_WORD[k] ?? k} ({agents.filter((a) => a.kind === k).length})</option>)}</select>
        <select value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'kind')} aria-label="Sort"><option value="kind">By kind</option><option value="name">By name</option></select>
        {unnamed > 0 && <span className="quiet">{unnamed} unnamed</span>}
      </div>
      <Waiting busy={busy} cancel={cancel} />
      {error && <p className="search-problem" role="alert">{error}</p>}
      {rows.length === 0 ? <p className="quiet">Nothing matches.</p> : (
        <ul className="rows">
          {rows.map((a) => (
            <li key={a.agent} className="row">
              <Glyph kind={PLACE_OF_KIND[a.kind] ?? 'service'} lit={!!a.name} />
              <span className="row-main">
                {a.name ? <Link href={nameHref(a.name)} className="row-name">{a.name}</Link> : <Link href={addressHref(a.agent)} className="row-name mono">{short(a.agent)}</Link>}
                <span className="row-sub">{KIND_WORD[a.kind] ?? a.kind}{a.label && a.label !== a.name ? ` · ${a.label}` : ''}{a.name ? '' : ' · unnamed'}</span>
              </span>
              {a.relationship === 'self' && <Chip kind="persona" />}
              {!a.name && session && TLD_OF_KIND[a.kind] && <button type="button" className="button button-quiet" disabled={!!busy} onClick={() => void run(agentNamingHref(session.estate, a.agent, { tld: TLD_OF_KIND[a.kind]! }, a.kind))}>Name it</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * YOU, at the naming service (spec 431 §5.1): the names your agent holds, read from the chain the way anyone could;
 * your own name to set when you have none; and a new agent to register under a name — a second person, an
 * organization, a service. Each action is a hand-off to your Home; this page only reads.
 */
export function Me(): ReactNode {
  const { session, leave } = useSession();
  const { go } = useRoute();
  const { run, cancel, busy, error } = useHomeCeremony();
  const just = justRegistered();
  const v = useApi<AddressView>(session ? `/api/address/${session.address}?t=${just?.name ?? ''}` : null);
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
          <h1>{session.name ?? (session.label ? `${session.label}, nameless so far` : 'You, nameless so far')}</h1>
          <p className="title-addr"><span className="mono break">{session.address}</span> <Copy value={session.address} label="address" /></p>
          <p className="lede">{session.name ? `Connected through ${new URL(estate.home).host} as ${session.name}.` : `Connected through ${new URL(estate.home).host}. Your agent presents no name yet — pick one below and your Home will buy it.`}</p>
          <p className="quiet"><button type="button" className="linkish" onClick={() => leave()}>Disconnect here</button> · <button type="button" className="linkish" onClick={() => leave(true)}>Sign out of your Home too</button> · <Link href={addressHref(session.address)}>Public view</Link></p>
        </div>
      </section>
      {just && (
        <div className="banner banner-ok" role="status"><strong>{just.name} is yours.</strong> Registered just now, signed at your Home. <Link href={nameHref(just.name)}>Open it →</Link></div>
      )}
      {!session.name && (
        <section>
          <h2>Your own name</h2>
          <form className="search" onSubmit={onOwn}>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="yourname" aria-label="Your name, before .me" pattern="[a-z0-9][a-z0-9-]{2,}" />
            <span className="search-suffix mono">.me</span>
            <button type="submit" className="button">Check and buy →</button>
          </form>
          <p className="quiet">Three letters or more; shorter costs more; nothing costs 50. Or <button type="button" className="linkish" disabled={!!busy} onClick={() => void run(handoffHref(estate, { tld: 'me' }))}>pick it at your Home</button>.{error ? ` ${error}` : ''}</p>
          <Waiting busy={busy} cancel={cancel} />
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
        <h2>Your agents</h2>
        <p className="quiet">What you keep, as your Home lists it: a second person of yours, organizations, teams, services, treasuries. Read as you; nothing here can act for any of them.</p>
        <YourAgents />
      </section>
      <section>
        <h2>Register a new agent under a name</h2>
        <p>An agent you keep, with its own treasury, named at creation: a second person (another name of yours), an organization, a team, a service, a church, a circle, a household. Your Home creates it, buys the name, and brings you back. The ending is the kind; the label is yours to choose there.</p>
        <KindPicker />
      </section>
    </>
  );
}
