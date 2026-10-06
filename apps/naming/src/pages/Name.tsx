import { useEffect, useState, type ReactNode } from 'react';
import { PLACE_SHAPES } from '@ap-town/town-scene';
import { useApi } from '../api';
import type { NameView } from '../api-types';
import { Link, nameHref, registerHref, rootHref, useRoute } from '../router';
import { Waiting, useHomeCeremony } from '../register';
import { useSession } from '../use-session';
import { agentNamingHref, forgetJustRegistered, justRegistered } from '../session';
import { lotScene } from '../scenes';
import { Addr, AtYourHome, Banners, Chip, Copy, Glyph, Loading, Scene, Signals, Stamped, Tabs } from '../ui';

const date = (t: number | null): string => (t ? new Date(t * 1000).toISOString().slice(0, 10) : '—');

function Invalid({ v }: { v: NameView }): ReactNode {
  return (
    <section>
      <h1>{v.input} <Chip kind="invalid" /></h1>
      <p className="lede">{v.invalid?.detail}</p>
      {v.form === 'root' && v.tld ? <p><Link href={rootHref(v.tld)} className="button">Open .{v.tld}</Link></p> : (
        <p className="quiet">Names look like <span className="mono">nathan.me</span>, <span className="mono">missio-nexus.org</span> or, inside an organization, <span className="mono">vault.svc@richcanvas.org</span>.</p>
      )}
    </section>
  );
}

function Free({ v }: { v: NameView }): ReactNode {
  return (
    <>
      <section className="title">
        <Glyph kind={v.kind} lit={false} size={72} />
        <div>
          <h1>{v.name} <Chip kind={v.status} /></h1>
          <p className="lede">{v.status === 'available' ? `Nobody holds this name.${v.names ? ` It would name ${v.names}.` : ''}` : v.status === 'expired' ? 'This name has expired and no longer resolves.' : 'This name cannot be claimed here.'}</p>
        </div>
      </section>
      <Banners banners={v.banners} />
      {v.price && (
        <section className="price">
          <div className="price-tag"><span className="price-n">{v.price.coins}</span> <span className="price-coin">{v.price.coin}</span></div>
          <div>
            <p><strong>What it costs.</strong> Paid from the buyer’s treasury in the same signed operation that registers the name. Shorter names cost more; nothing costs 50. Once, never again: no rent, no resale.</p>
            {v.price.protectedBy
              ? <p className="price-domain"><strong>{v.name.split('.')[0]} is a domain.</strong> {v.price.protectedBy} exists, so this name belongs to whoever can receive mail there: the buyer’s Home must hold a verified email at {v.price.protectedBy}. Adding one is under the Home’s Security section.</p>
              : v.price.dnsUnknown ? <p className="quiet">Whether a domain protects this label could not be checked just now; the Home checks again at purchase.</p>
              : <p className="quiet">No domain protects this label ({v.name.split('.')[0]}.com and .org do not exist), so any agent of the right kind may buy it.</p>}
          </div>
        </section>
      )}
      {v.availability && (
        <section>
          <h2>Who could {v.price ? 'buy' : 'claim'} it</h2>
          <p><strong>{v.availability.by.charAt(0).toUpperCase() + v.availability.by.slice(1)}.</strong> {v.availability.rule}</p>
          {v.status === 'available' && v.form === 'canonical' && v.tld && (
            <div className="home-cta register">
              <p><strong>Register {v.name}{v.price ? ` for ${v.price.coins} ${v.price.coin}` : ''}.</strong> Four short steps, then your Home signs in a window and this page shows the name as yours.</p>
              <div className="home-cta-row"><Link href={registerHref(v.name)} className="button">Register {v.name} →</Link></div>
            </div>
          )}
          {v.status === 'available' && v.form !== 'canonical' && <AtYourHome estates={v.estates} verb="Issuing a scoped name" />}
        </section>
      )}
      <Stamped s={v} />
    </>
  );
}

function Profile({ v }: { v: NameView }): ReactNode {
  const endpoint = v.records.find((r) => r.key === 'a2aEndpoint' || r.key === 'serviceUrl');
  const card = v.records.find((r) => r.key === 'cardUri');
  const about = v.records.find((r) => r.key === 'description');
  return (
    <div className="profile">
      <Scene scene={lotScene(v)} selected={v.name} legend={`${v.name} is drawn as ${PLACE_SHAPES[v.kind].noun}. Lit windows: it resolves and nothing about it is flagged.`} />
      <dl className="facts">
        {v.displayName && <><dt>Display name</dt><dd>{v.displayName}</dd></>}
        <dt>What it is</dt><dd>{v.declared?.agentType ? `The agent declares itself ${v.declared.noun ?? v.declared.agentType}${v.declared.serviceRole ? ` (role: ${v.declared.serviceRole})` : ''}.` : 'The agent has declared no type.'}</dd>
        {about && <><dt>About</dt><dd>{about.value}</dd></>}
        <dt>Points at</dt><dd>{v.agent ? <Addr address={v.agent} full /> : 'No agent.'}</dd>
        {v.purchase && <><dt>Bought</dt><dd>for {v.purchase.coins} {v.purchase.coin} on {new Date(v.purchase.at * 1000).toISOString().slice(0, 10)}, from its treasury.</dd></>}
        <dt>Presented by the agent</dt><dd>{v.presentsThis ? 'Yes. This is the name the agent shows as its own.' : v.presented ? <>No. It presents <Link href={nameHref(v.presented)}>{v.presented}</Link>.</> : 'No. The agent presents no name.'}</dd>
        {endpoint && <><dt>Reach it at</dt><dd><a href={endpoint.value} rel="noreferrer" className="mono break">{endpoint.value}</a></dd></>}
        {card && <><dt>Agent card</dt><dd><a href={card.value} rel="noreferrer" className="mono break">{card.value}</a></dd></>}
      </dl>
    </div>
  );
}

function Records({ v }: { v: NameView }): ReactNode {
  return (
    <>
      <p className="public-note">Everything here is public. Anyone can read a name’s records, and they stay readable.</p>
      {v.records.length === 0 ? <p className="quiet">This name has no records set.</p> : (
        <table className="table">
          <thead><tr><th scope="col">Record</th><th scope="col">Value</th></tr></thead>
          <tbody>
            {v.records.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}<span className="record-key mono">{r.key}</span></th>
                <td>{r.kind === 'address' ? <Addr address={r.value} full /> : r.kind === 'url' ? <a href={r.value} rel="noreferrer" className="mono break">{r.value}</a> : <span className={r.kind === 'hash' ? 'mono break' : 'break'}>{r.value}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function Can({ v }: { v: NameView }): ReactNode {
  return (
    <>
      <p className="quiet">Worked out from what the naming contracts check, which is always the caller’s address.</p>
      <div className="can">
        {v.can.map((c) => (
          <div key={c.who} className="can-row">
            <div className="can-who">
              <h3>{c.who}</h3>
              {c.address && <Addr address={c.address} name={c.name ?? null} />}
              {c.note && <p className="quiet">{c.note}</p>}
            </div>
            <div className="can-lists">
              {c.can.length > 0 && <ul className="can-yes" aria-label="Can">{c.can.map((x) => <li key={x}><span className="tag tag-yes">Can</span> {x}</li>)}</ul>}
              {c.cannot.length > 0 && <ul className="can-no" aria-label="Cannot">{c.cannot.map((x) => <li key={x}><span className="tag tag-no">Cannot</span> {x}</li>)}</ul>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Under({ v }: { v: NameView }): ReactNode {
  if (!v.childCount) return <p className="quiet">No names are registered under {v.name}.{v.kind === 'org' || v.kind === 'workspace' ? ' An organization can issue scoped names here, like vault.svc@' + v.name + '.' : ''}</p>;
  return (
    <ul className="rows">
      {v.children.map((c) => (
        <li key={c.name} className="row">
          <Glyph kind={c.kind} />
          <span className="row-main"><Link href={nameHref(c.name)} className="row-name">{c.name}</Link></span>
          <span className="row-owner"><span className="quiet">owner</span> <Addr address={c.owner} /></span>
        </li>
      ))}
      {v.childCount > v.children.length && <li className="quiet">…and {v.childCount - v.children.length} more.</li>}
    </ul>
  );
}

function Details({ v }: { v: NameView }): ReactNode {
  const d = v.details;
  return (
    <dl className="facts facts-wide">
      <dt>Name on chain</dt><dd className="mono break">{v.onChainName} <Copy value={v.onChainName} label="on-chain name" /></dd>
      <dt>Node</dt><dd className="mono break">{v.node} <Copy value={v.node} label="node" /></dd>
      {d && <>
        <dt>Under</dt><dd>{d.parent.includes('.') ? <Link href={nameHref(d.parent)}>{d.parent}</Link> : <Link href={rootHref(d.parent)}>.{d.parent}</Link>}</dd>
        <dt>Owner</dt><dd>{v.owner ? <Addr address={v.owner} name={v.ownerName} full /> : '—'}</dd>
        <dt>Resolver</dt><dd>{d.resolver ? <span className="mono break">{d.resolver}</span> : 'None'}</dd>
        <dt>Subregistry</dt><dd>{d.subregistry ? <span className="mono break">{d.subregistry}</span> : 'None. Only the owner registers names under it.'}</dd>
        <dt>Registered</dt><dd>{date(d.registeredAt)}</dd>
        <dt>Expires</dt><dd>{d.expiry ? date(d.expiry) : 'Never.'}</dd>
        {d.hosts.map((h) => <span key={h.host} className="contents"><dt>Host in its records</dt><dd className="mono">{h.host}{h.estate ? <span className="quiet"> · the {h.estate} estate</span> : null}</dd></span>)}
      </>}
      <dt>Read at</dt><dd>block {v.block.toLocaleString()} of chain {v.chainId}</dd>
    </dl>
  );
}

/** The owner's lever (430 N6c): for a name the connected person keeps, the Home's naming page in the popup; else the link. */
function EditAtHome({ v, mine, own }: { v: NameView; mine: boolean; own: boolean }): ReactNode {
  const { session, agents } = useSession();
  const { run, cancel, busy, error } = useHomeCeremony();
  if (!session || !mine || !v.agent) return <AtYourHome estates={v.estates} verb="Changing a record, the presented name or the owner" name={v.name} />;
  const who = own ? 'own' : (agents ?? []).find((a) => a.agent === v.agent!.toLowerCase())?.kind ?? 'org';
  return (
    <div className="home-cta">
      <p><strong>This name is yours.</strong> Records, the presented name and the agent's card are changed at your Home, signed by the agent's own account; this page shows the result when you come back.</p>
      <div className="home-cta-row"><button type="button" className="button" disabled={!!busy} onClick={() => void run(agentNamingHref(session.estate, v.agent!, { name: v.name }, who))}>Edit at your Home →</button></div>
      <Waiting busy={busy} cancel={cancel} />
      {error && <p className="search-problem" role="alert">{error}</p>}
    </div>
  );
}

export function Name({ name }: { name: string }): ReactNode {
  const { search } = useRoute();
  const [tab, setTab] = useState('profile');
  // Just registered at the Home (`?just=1`, set by the ceremony's return): the chain read behind the API can lag
  // the receipt by a block or two, and the service caches a name page briefly. Re-read past the cache until the
  // name shows as registered (bounded), rather than greet the buyer with "available". The route carries the
  // marker because the buyer was usually ALREADY on this page: a same-path navigation does not remount it.
  // Decided once, at mount: a later render must not flip the read back to the cached path after the fresh read
  // showed the name registered (that is how a buyer once saw "available" AFTER the chain had answered).
  const [freshAt] = useState(() => (new URLSearchParams(search).has('just') && justRegistered()?.name === name ? Date.now() : 0));
  const [changed] = useState(() => !!justRegistered()?.changed);
  const fresh = freshAt > 0;
  const { session, agents } = useSession();
  const [tick, setTick] = useState(0);
  const [shown, setShown] = useState(false);
  const v = useApi<NameView>(`/api/name/${encodeURIComponent(name)}${fresh ? `?fresh=${freshAt}-${tick}` : ''}`);
  useEffect(() => {
    if (!fresh || v.state === 'loading') return;
    if (v.state === 'ready' && (v.data.status === 'registered' || changed)) { if (!shown) { setShown(true); forgetJustRegistered(); } return; }
    // Not there yet, or a read that failed mid-ceremony: try again, a bounded number of times.
    if (tick >= 14) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), 2500);
    return () => window.clearTimeout(t);
  }, [fresh, v, tick, shown, changed]);
  if (fresh && v.state === 'error' && tick < 14) return <section><h1>{name}</h1><p className="loading" role="status">Registered at your Home a moment ago — waiting for the chain to show it…</p></section>;
  return (
    <Loading v={v}>{(n) => {
      if (n.status === 'invalid') return <Invalid v={n} />;
      if (n.status !== 'registered' && fresh) return <section><h1>{name}</h1><p className="loading" role="status">{tick < 14 ? 'Registered at your Home a moment ago — waiting for the chain to show it…' : 'The chain has not shown this name yet. Reload in a moment; your Home\'s receipt stands.'}</p></section>;
      if (n.status !== 'registered') return <Free v={n} />;
      const mismatch = n.typeCheck && !n.typeCheck.ok;
      return (
        <>
          <section className="title">
            <Glyph kind={n.kind} lit={!mismatch} size={72} />
            <div>
              <h1>{n.name} <Chip kind={mismatch ? 'mismatch' : 'registered'} />{n.legacy && <Chip kind="legacy" />}</h1>
              <p className="lede">{n.displayName ? `${n.displayName}. ` : ''}{n.names ? `A name ending in .${n.tld} names ${n.names}.` : n.form === 'type-node' ? 'A type node: it holds an organization’s scoped names.' : 'An untyped name.'}</p>
              {n.agent && <p className="title-addr"><span className="quiet">points at</span> <Addr address={n.agent} full /></p>}
            </div>
          </section>
          {shown && <div className="banner banner-ok" role="status"><strong>{changed ? 'Updated.' : 'Yours.'}</strong> {changed ? 'Changed just now at your Home; this page read it back from the chain.' : 'Registered just now, signed at your Home; this service only read it back from the chain.'}</div>}
          <Banners banners={n.banners} />
          {n.signals && <section aria-label="Signals"><Signals signals={n.signals} /></section>}
          <section>
            <Tabs active={tab} onPick={setTab} tabs={[{ id: 'profile', label: 'Profile' }, { id: 'records', label: 'Records', count: n.records.length }, { id: 'can', label: 'Who can do what' }, { id: 'under', label: 'Names under it', count: n.childCount }, { id: 'details', label: 'Details' }]} />
            <div role="tabpanel" className="panel">
              {tab === 'profile' && <Profile v={n} />}
              {tab === 'records' && <Records v={n} />}
              {tab === 'can' && <Can v={n} />}
              {tab === 'under' && <Under v={n} />}
              {tab === 'details' && <Details v={n} />}
            </div>
          </section>
          <section><h2>Change something</h2><EditAtHome v={n} mine={!!session && !!n.agent && (n.agent.toLowerCase() === session.address.toLowerCase() || (agents ?? []).some((a) => a.agent === n.agent!.toLowerCase()))} own={!!session && !!n.agent && n.agent.toLowerCase() === session.address.toLowerCase()} /></section>
          <Stamped s={n} />
        </>
      );
    }}</Loading>
  );
}
