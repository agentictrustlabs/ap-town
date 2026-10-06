/**
 * REGISTER <name> — the step page (owner, 2026-10-06: "something like app.ens.domains/<name>/register"). What ENS
 * shows as duration · price · primary-name toggle · Connect/Register, this shows as what it is · the price and who
 * pays · a few words · presented as its name · one button. The signing happens at the Home in the popup, as
 * everywhere; this page prepares the hand-off and shows the result when it comes back.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getJson, useApi } from '../api';
import type { NameView } from '../api-types';
import { KIND_OF_TLD, Waiting, connectHref, useHomeCeremony } from '../register';
import { Link, nameHref, rootHref, useRoute } from '../router';
import { CHARTER_KINDS, handoffHref } from '../session';
import { Chip, Glyph, Loading, Stamped } from '../ui';
import { useSession } from '../use-session';

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function RegisterPage({ name }: { name: string }): ReactNode {
  const { session, agents } = useSession();
  const { path, go } = useRoute();
  const { run, cancel, busy, error } = useHomeCeremony();
  const v = useApi<NameView>(`/api/name/${encodeURIComponent(name)}`);
  const [displayName, setDisplayName] = useState('');
  const [about, setAbout] = useState('');
  const [asOwn, setAsOwn] = useState<boolean | null>(null);
  // The payer: the connected person's treasury, read from the chain through this service (430 N6).
  const treasury = useMemo(() => (agents ?? []).find((a) => a.kind === 'person-treasury') ?? null, [agents]);
  const [coins, setCoins] = useState<{ coin: string | null; coins: number | null } | null>(null);
  useEffect(() => {
    if (!treasury) { setCoins(null); return; }
    let live = true;
    void getJson<{ coin: string | null; coins: number | null }>(`/api/coins/${treasury.agent}?t=${Date.now()}`).then((r) => { if (live) setCoins(r.ok ? r.data : null); });
    return () => { live = false; };
  }, [treasury]);

  return (
    <Loading v={v}>{(n) => {
      const tld = n.tld ?? '';
      const kind = CHARTER_KINDS.find((k) => k.tld === tld) ?? null;
      const canBeOwn = tld === 'me' && !!session && !session.name;
      const own = asOwn ?? canBeOwn;
      const price = n.price;
      const protectedBy = price?.protectedBy ?? null;
      const label = n.name.split('.')[0] ?? '';
      const after = coins?.coins !== null && coins?.coins !== undefined && price ? coins.coins - price.coins : null;
      const shortOfCoins = after !== null && after < 0;
      const words = { ...(displayName.trim() ? { displayName: displayName.trim() } : {}), ...(about.trim() ? { about: about.trim() } : {}) };
      const register = () => {
        if (!session) { go(connectHref(path)); return; }
        void run(own ? handoffHref(session.estate, { claim: label, tld, ...words }) : handoffHref(session.estate, { charter: kind?.kind ?? 'org', claim: label, tld, ...words }));
      };
      if (n.status === 'invalid' || n.form !== 'canonical') {
        return <section><h1>{n.name}</h1><p className="lede">{n.invalid?.detail ?? 'Only a canonical name is registered here.'}</p><p><Link href={nameHref(n.name)}>The name's page →</Link></p></section>;
      }
      if (n.status !== 'available') {
        return (
          <section className="title">
            <Glyph kind={n.kind} size={72} />
            <div><h1>{n.name} <Chip kind={n.status} /></h1><p className="lede">{n.status === 'registered' ? 'This name is taken.' : 'This name cannot be registered here.'} <Link href={nameHref(n.name)}>See its page →</Link></p></div>
          </section>
        );
      }
      return (
        <>
          <section className="title">
            <Glyph kind={n.kind} lit={false} size={72} />
            <div>
              <h1>Register {n.name} <Chip kind="available" /></h1>
              <p className="lede">{n.names ? `A .${tld} name names ${n.names}.` : ''} Registered once, never resold; it is yours as long as the agent stands.</p>
            </div>
          </section>

          <div className="reg">
            <ol className="reg-steps">
              <li className="reg-step">
                <h2><span className="reg-n">1</span> What it is</h2>
                {canBeOwn ? (
                  <div className="reg-choice">
                    <label className={own ? 'reg-opt reg-on' : 'reg-opt'}><input type="radio" name="who" checked={own} onChange={() => setAsOwn(true)} /><span><strong>My own name.</strong> You present no name yet; this becomes it.</span></label>
                    <label className={!own ? 'reg-opt reg-on' : 'reg-opt'}><input type="radio" name="who" checked={!own} onChange={() => setAsOwn(false)} /><span><strong>A second person of mine.</strong> A persona — its own agent and treasury, custodied by you.</span></label>
                  </div>
                ) : (
                  <p>{kind ? <><strong>{kind.label}.</strong> {kind.blurb.charAt(0).toUpperCase() + kind.blurb.slice(1)}. The ending decides this; it is not a choice.</> : <>A <span className="mono">.{tld}</span> name is claimed by the kind of agent it names.</>}{session && !own && <> Your Home creates it as a new agent you keep.</>}</p>
                )}
              </li>

              <li className="reg-step">
                <h2><span className="reg-n">2</span> The price, and who pays</h2>
                {price ? (
                  <dl className="reg-bill">
                    <div><dt>{n.name}</dt><dd>{price.coins} {price.coin}</dd></div>
                    <div><dt>Network fee</dt><dd>sponsored</dd></div>
                    <div className="reg-total"><dt>Paid from your treasury</dt><dd>{price.coins} {price.coin}</dd></div>
                    {session && treasury && coins?.coins !== null && coins?.coins !== undefined && <div className="quiet"><dt><span className="mono">{short(treasury.agent)}</span> holds</dt><dd>{coins.coins} {coins.coin}{after !== null ? ` → ${Math.max(0, after)} after` : ''}</dd></div>}
                    {session && !treasury && agents !== null && <div className="quiet"><dt>Treasury</dt><dd>none yet — your Home makes one, with 1,000 SHQ</dd></div>}
                  </dl>
                ) : <p>Free to claim: one signed operation at your Home.</p>}
                {protectedBy && <p className="banner banner-warn"><strong>{label} is a domain.</strong> {protectedBy} exists, so this name belongs to whoever can receive mail there: your Home must hold a verified email at {protectedBy}. Adding one is under the Home's Security section; the Home asks for it when you register.</p>}
                {shortOfCoins && <p className="banner banner-warn"><strong>Short by {-after!} {coins?.coin}.</strong> Your treasury does not hold the price.</p>}
              </li>

              <li className="reg-step">
                <h2><span className="reg-n">3</span> A few words <span className="quiet">(optional, public)</span></h2>
                <div className="words">
                  <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="what people call it" aria-label="Display name" maxLength={80} />
                  <input value={about} onChange={(e) => setAbout(e.target.value)} placeholder="a line about it" aria-label="About" maxLength={280} />
                </div>
                <p className="quiet">Written as the name's records in the same ceremony; changeable later from the name's page.</p>
              </li>

              <li className="reg-step">
                <h2><span className="reg-n">4</span> Presented as its name</h2>
                <p>The agent shows <strong>{n.name}</strong> as its own, and the name points back at it — checked on chain every time it is displayed. One presented name per agent.</p>
              </li>
            </ol>

            <aside className="reg-side">
              <div className="reg-card">
                <Glyph kind={KIND_OF_TLD[tld] ?? 'service'} lit={false} size={48} />
                <div className="reg-name">{n.name}</div>
                <div className="reg-price">{price ? `${price.coins} ${price.coin}` : 'free'}</div>
                {session ? (
                  <>
                    <p className="quiet">Connected as <strong>{session.name ?? session.label ?? short(session.address)}</strong>. Your Home opens in a window; two signatures there; back here.</p>
                    <button type="button" className="button reg-go" disabled={!!busy || shortOfCoins} onClick={register}>{own ? `Buy ${n.name} as my name →` : `Register ${n.name} →`}</button>
                    <Waiting busy={busy} cancel={cancel} />
                    {error && <p className="search-problem" role="alert">{error}</p>}
                  </>
                ) : (
                  <>
                    <p className="quiet">Connect first. Your Home is where a name is bought and signed; new here, the front door makes you a Home and brings you straight back.</p>
                    <Link href={connectHref(path)} className="button reg-go">Connect to register →</Link>
                  </>
                )}
                <p className="quiet"><Link href={nameHref(n.name)}>The name's page</Link> · <Link href={rootHref(tld)}>every .{tld}</Link></p>
              </div>
            </aside>
          </div>
          <Stamped s={n} />
        </>
      );
    }}</Loading>
  );
}
