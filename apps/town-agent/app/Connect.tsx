// CONNECT — who is asking, when the asker is a person rather than a stranger.
//
// The town holds no key and acts for no one (spec 429 D2). So "connected" here cannot mean the portal
// gained authority on your behalf; it means you signed in AT YOUR OWN HOME, your Home issued you a session,
// and this page RELAYS that session on the asks you make. The agent you ask resolves the bearer to your
// Smart Agent and decides from your own standing — its door already does exactly this (`principalBySchemes`
// … `bearer: verifySession`). The portal adds nothing to the request and takes nothing from it.
//
// Three things this deliberately is not:
//   · it is not a delegation. Connecting grants nothing. "Authorized" was always the caller's own
//     delegation (D7), and it still is — the agent re-decides every call.
//   · it is not storage. The session lives in THIS TAB's sessionStorage and nowhere else: not in a cookie,
//     not on the Worker, not in any record. Close the tab and it is gone.
//   · it is not the operator token. That one unlocks a READ of the town's own cost and metrics
//     (`ap-town.ops-token`); this one is a person's identity at their Home. Two different things, two keys,
//     and conflating them would let a town secret pass for somebody's identity.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Chip } from '@ap-town/town-ui';

const KEY = 'ap-town.home-session';
const EVENT = 'ap-town:connection';
/** The leg in flight: which Home, and the PKCE verifier only this tab knows. Dropped the moment it lands. */
const PENDING = 'ap-town.connecting';
const CLIENT_ID = 'town-app';
const REDIRECT = () => `${window.location.origin}/connected`;

/** PKCE S256 (spec 230 §4.3). The verifier never leaves this tab; the Home only ever sees its hash. */
async function pkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64url = (b: ArrayBuffer | Uint8Array): string =>
    btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const verifier = b64url(bytes);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  return { verifier, challenge };
}

/**
 * Leave for the Home, and come back here. The person signs in at their OWN Home — the town has no account
 * to hold and never sees a credential — and returns with a code this tab alone can redeem.
 */
export async function goToHome(home: string, hint?: string): Promise<void> {
  // WHERE THEY WERE. Connecting is something you do in the middle of reading a page, and landing back on
  // the front page afterwards loses the agent you were looking at.
  try { sessionStorage.setItem('ap-town.return-to', `${window.location.pathname}${window.location.search}`); } catch { /* the front page, then */ }
  const { verifier, challenge } = await pkce();
  const state = crypto.randomUUID();
  try { sessionStorage.setItem(PENDING, JSON.stringify({ home, verifier, state, at: Date.now() })); } catch { /* no storage ⇒ the round trip cannot be completed, and the callback says so */ }
  // THE AUTHORIZATION ENDPOINT IS THE HOME'S ROOT, not `/authorize`. The Home's own discovery doc says so
  // (`authorization_endpoint: <iss>/`) because the consent + ROOT-passkey ceremony IS the SPA at the origin
  // root, which reads these params and posts them to its own `/oidc/authorize-grant` first. Every other
  // relying app in the set leaves the same way (engage-web, demo-jp); `/authorize` is a 404 there.
  const u = new URL('/', home);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', REDIRECT());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid agent');
  u.searchParams.set('code_challenge', challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('state', state);
  // SITE-LOGIN, and nothing wider. It asserts who someone is; it carries no authority to act for them.
  u.searchParams.set('delegation_template', 'site-login');
  if (hint) u.searchParams.set('agent_name', hint);
  window.location.assign(u.toString());
}

/** Redeem the code this tab asked for. Single-use, PKCE-bound, and the token never appeared in a URL. */
export async function completeConnection(params: URLSearchParams): Promise<{ ok: true } | { ok: false; error: string }> {
  let pending: { home: string; verifier: string; state: string } | null = null;
  try { pending = JSON.parse(sessionStorage.getItem(PENDING) ?? 'null'); } catch { pending = null; }
  try { sessionStorage.removeItem(PENDING); } catch { /* nothing to clear */ }
  const err = params.get('error');
  if (err) return { ok: false, error: params.get('error_description') ?? err };
  const code = params.get('code');
  if (!code) return { ok: false, error: 'your Home sent no code back' };
  if (!pending) return { ok: false, error: 'this tab did not start that sign-in, so it cannot finish it' };
  // STATE IS CHECKED, because a code this tab did not ask for is somebody else's.
  if (params.get('state') !== pending.state) return { ok: false, error: 'that sign-in does not match the one this tab started' };
  try {
    const r = await fetch(new URL('/token', pending.home).toString(), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: pending.verifier, client_id: CLIENT_ID, redirect_uri: REDIRECT() }),
    });
    const b = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
    if (!r.ok || !b.id_token) return { ok: false, error: b.error_description ?? b.error ?? `your Home refused the exchange (${r.status})` };
    const c = claimsOf(b.id_token);
    write({ token: b.id_token, name: c.name, agent: c.agent, home: pending.home });
    return { ok: true };
  } catch (e) { return { ok: false, error: `your Home could not be reached: ${(e as Error).message}` }; }
}

export interface Connection { token: string; name: string | null; agent: string | null; home: string }

const read = (): Connection | null => {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Connection;
    return c?.token ? c : null;
  } catch { return null; }
};
const write = (c: Connection | null): void => {
  try { if (c) sessionStorage.setItem(KEY, JSON.stringify(c)); else sessionStorage.removeItem(KEY); } catch { /* no storage: the page still works, unconnected */ }
  window.dispatchEvent(new Event(EVENT));
};

/** The connection this tab holds, if any. Every surface READS it from here so there is one answer; the only
 *  two writers are `completeConnection` (the leg home) and `disconnectEverywhere` (the teardown). */
export function useConnection(): { conn: Connection | null } {
  const [conn, setConn] = useState<Connection | null>(null);
  useEffect(() => {
    const sync = () => setConn(read());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return { conn };
}

/** The bearer to put on a relayed ask, or nothing. Never read straight from storage elsewhere. */
export const connectionToken = (): string | null => read()?.token ?? null;

/**
 * DISCONNECT, EVERYWHERE — the same teardown every other app in the set does (engage's field-web,
 * coach-web and gather27-web, demo-gs, demo-sso): clear this tab FIRST, then hand the person to their
 * own Home's `/logout`, which ends the cross-app SSO session, flips FedCM to logged-out so nothing
 * silently re-recognizes them, front-channel-notifies the Home's other relying apps, and bounces back
 * here.
 *
 * Dropping the token in this tab alone is the lie those apps already refuse to tell: the Home would
 * still know them, FedCM would still recognize them, and the next Connect would walk straight back in
 * with no ceremony — which reads as "disconnect did nothing". The Home decides where the person lands:
 * `return` is checked against its registered relying origins, and `https://town.faithnet.io` is one
 * (`town-app` in ap-home's whitelabel registry), so the bounce comes back to the town.
 *
 * This takes nothing away from D2. The town still holds no key and still acts for no one; ending a
 * session is the one thing a sign-out may do, and it is the PERSON'S Home that does it.
 */
export function disconnectEverywhere(conn: Connection): void {
  write(null);
  try {
    const u = new URL('/logout', conn.home);
    u.searchParams.set('return', `${window.location.origin}/`);
    window.location.assign(u.toString());
  } catch {
    /* a Home we cannot even form a URL for: the tab is already cleared, which is all this page can do */
  }
}

/**
 * What a Home's session token says about who holds it. The token is a JWT the HOME signed; this reads its
 * claims to LABEL the connection and nothing more — the portal verifies nothing and decides nothing from
 * it. The agent verifies it against its own Home's keys, which is the only verification that matters.
 */
function claimsOf(token: string): { name: string | null; agent: string | null } {
  try {
    const p = token.split('.')[1];
    if (!p) return { name: null, agent: null };
    const c = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; agent_name?: string };
    return { name: c.agent_name ?? null, agent: c.sub?.match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase() ?? null };
  } catch { return { name: null, agent: null }; }
}

/** How to call someone whose Home asserted no agent name: their Smart Agent, shortened. */
const label = (conn: Connection): string =>
  conn.name ?? (conn.agent ? `${conn.agent.slice(0, 6)}\u2026${conn.agent.slice(-4)}` : 'connected');

/**
 * WHO YOU ARE, as one control.
 *
 * This was a name chip beside a bare "disconnect" link — two things of equal weight in the corner, one of
 * which signs you out of every app on your Home. The name is the control now and the menu is where sign-out
 * lives, which is the shape every other app in the set uses: you go looking for it, you do not brush past it.
 * The menu also says the thing the chip could not — WHICH Home this session came from — because on a town
 * with more than one estate that is the difference between two people with the same name.
 */
function Account({ conn }: { conn: Connection }): ReactNode {
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

  let host = conn.home;
  try { host = new URL(conn.home).host; } catch { /* show it as given */ }

  return (
    <span className="account" ref={box}>
      <button type="button" className="account-name" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Chip tone="ok">connected</Chip>
        <span className="who">{label(conn)}</span>
        <span className="caret" aria-hidden="true">{open ? '\u25b4' : '\u25be'}</span>
      </button>
      {open && (
        <div className="account-menu" role="menu">
          <p className="account-who">
            <b>{label(conn)}</b>
            <small>{conn.agent ?? 'no Smart Agent in the session'}</small>
            <small>signed in at {host}</small>
          </p>
          <div className="account-sep" />
          <a className="account-item" role="menuitem" href={conn.home} target="_blank" rel="noreferrer">Open my Home</a>
          <div className="account-sep" />
          <button type="button" className="account-item" role="menuitem" onClick={() => { setOpen(false); disconnectEverywhere(conn); }}>
            Disconnect
          </button>
          <p className="account-note">Signs you out at {host} too, and at the other apps connected to it.</p>
        </div>
      )}
    </span>
  );
}

export function ConnectButton({ estates, prominent }: { estates: Array<{ id: string; home: string }>; prominent?: boolean }): ReactNode {
  const { conn } = useConnection();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [draft, setDraft] = useState('');
  const [home, setHome] = useState<{ id: string | null; home: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const close = useCallback(() => { setOpen(false); setErr(null); setName(''); setDraft(''); setHome(null); }, []);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, close]);

  /**
   * A NAME SAYS WHICH HOME, and the chain is what says it. Two people named under the same root can belong
   * to different estates, and signing in at the wrong one does not fail — it derives a DIFFERENT Smart Agent
   * for the same credential. So the name is resolved before anyone is sent anywhere, and an agent that
   * declares no estate is told so rather than sent to the first Home in the list.
   */
  const findHome = async () => {
    const n = name.trim().toLowerCase();
    if (!n) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/home-for?name=${encodeURIComponent(n)}`, { headers: { accept: 'application/json' } });
      const b = (await r.json().catch(() => ({}))) as { ok?: boolean; estate?: { id: string | null; home: string }; detail?: string; error?: string };
      if (!r.ok || !b.ok || !b.estate) { setErr(b.detail ?? b.error ?? 'that name could not be looked up'); return; }
      setHome(b.estate);
      // The name said which Home; there is nothing left to choose, so go.
      leave(b.estate.home, n);
    } catch { setErr('the town could not be asked just now'); }
    finally { setBusy(false); }
  };

  const leave = (home: string, hint?: string) => { setBusy(true); void goToHome(home, hint); };

  if (conn && !open) return <Account conn={conn} />;
  // In the corner it is one link among the areas; on the front door it is THE action, and a page whose only
  // way in looks like body text leaves the reader hunting for it.
  if (!open) return <button type="button" className={prominent ? 'button' : 'linkish'} onClick={() => setOpen(true)}>Connect{prominent ? ' at your Home' : ''}</button>;

  const chosen = home ?? (estates.length === 1 ? { id: estates[0]!.id, home: estates[0]!.home } : null);
  return (
    <div className="panel connect-pop" role="dialog" aria-modal="true" aria-label="Connect with your home">
      <div className="pop-head">
        <h2 style={{ marginTop: 0 }}>Connect with your home</h2>
        <button type="button" className="pop-close" onClick={close} aria-label="Close">{'\u00d7'}</button>
      </div>
      <p className="quiet">
        Sign in at your own Home. Unconnected, a question reaches an agent as a <strong>stranger</strong> and it
        answers from what it has made public. Connected, it arrives as <strong>you</strong>, and the agent decides
        from your own standing — this page relays your session and adds nothing to it.
      </p>
      <p className="quiet">
        Connecting grants nothing. The town holds no key and acts for no one: your session stays in this browser
        tab, and the agent re-decides every call.
      </p>

      <form className="ask-row" onSubmit={(e) => { e.preventDefault(); void findHome(); }}>
        <label className="sr" htmlFor="connect-name">Your agent name</label>
        <input id="connect-name" className="ask-q" value={name} onChange={(e) => { setName(e.target.value); setErr(null); setHome(null); }} placeholder="yourname.me" autoComplete="off" disabled={busy} />
        <button type="submit" className="button" disabled={busy || !name.trim()}>{busy ? 'Looking\u2026' : 'Go to my home'}</button>
      </form>
      <p className="quiet">Have an agent name? It says which Home you are on, and takes you straight there.</p>

      {!home && (
        <>
          <p className="quiet">or</p>
          {estates.map((e) => (
            <p key={e.id} style={{ margin: '.25rem 0' }}>
              <button type="button" className="button" disabled={busy} onClick={() => leave(e.home)}>Continue with {e.id}</button>
            </p>
          ))}
          <p className="quiet">
            Each estate holds its own people and its own records — sign in at the one where you have an account.
            The town lists them; it holds none of them.
          </p>
        </>
      )}

      {busy && <p className="quiet">Taking you to {chosen ? new URL(chosen.home).host : 'your Home'}…</p>}

      {err && <p className="banner banner-warn" style={{ marginBottom: 0 }}>{err}</p>}
    </div>
  );
}
