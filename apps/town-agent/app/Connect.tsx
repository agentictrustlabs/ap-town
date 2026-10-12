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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Chip } from '@ap-town/town-ui';

const KEY = 'ap-town.home-session';
const EVENT = 'ap-town:connection';

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

/** The connection this tab holds, if any. Every surface reads it from here so there is one answer. */
export function useConnection(): { conn: Connection | null; set: (c: Connection | null) => void } {
  const [conn, setConn] = useState<Connection | null>(null);
  useEffect(() => {
    const sync = () => setConn(read());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return { conn, set: write };
}

/** The bearer to put on a relayed ask, or nothing. Never read straight from storage elsewhere. */
export const connectionToken = (): string | null => read()?.token ?? null;

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

export function ConnectButton({ estates }: { estates: Array<{ id: string; home: string }> }): ReactNode {
  const { conn, set } = useConnection();
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
   * to different estates, and signing in at the wrong one does not fail \u2014 it derives a DIFFERENT Smart Agent
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
    } catch { setErr('the town could not be asked just now'); }
    finally { setBusy(false); }
  };

  const connect = (at: string) => {
    const token = draft.trim();
    if (!token) { setErr('Paste the session your Home gave you.'); return; }
    // A JWT has three dot-separated parts. Saying so beats relaying a typo and showing an agent's 401.
    if (token.split('.').length !== 3) { setErr('That does not look like a session \u2014 a Home issues a three-part token.'); return; }
    const c = claimsOf(token);
    set({ token, name: c.name, agent: c.agent, home: at });
    close();
  };

  if (conn && !open) {
    return (
      <span className="operator">
        <Chip tone="ok">{conn.name ?? (conn.agent ? `${conn.agent.slice(0, 6)}\u2026${conn.agent.slice(-4)}` : 'connected')}</Chip>{' '}
        <button type="button" className="linkish" onClick={() => set(null)}>disconnect</button>
      </span>
    );
  }
  if (!open) return <button type="button" className="linkish" onClick={() => setOpen(true)}>Connect</button>;

  const chosen = home ?? (estates.length === 1 ? { id: estates[0]!.id, home: estates[0]!.home } : null);
  return (
    <div className="panel connect-pop" role="dialog" aria-modal="true" aria-label="Connect with your home">
      <h2 style={{ marginTop: 0 }}>Connect with your home</h2>
      <p className="quiet">
        Sign in at your own Home. Unconnected, a question reaches an agent as a <strong>stranger</strong> and it
        answers from what it has made public. Connected, it arrives as <strong>you</strong>, and the agent decides
        from your own standing \u2014 this page relays your session and adds nothing to it.
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
              <a className="button" href={e.home} target="_blank" rel="noreferrer" onClick={() => setHome({ id: e.id, home: e.home })}>Continue with {e.id}</a>
            </p>
          ))}
          <p className="quiet">
            Each estate holds its own people and its own records \u2014 sign in at the one where you have an account.
            The town lists them; it holds none of them.
          </p>
        </>
      )}

      {chosen && (
        <>
          <p>
            {home ? <>That name is on <strong>{home.id ?? 'an estate'}</strong>. </> : null}
            <a href={chosen.home} target="_blank" rel="noreferrer">Open {new URL(chosen.home).host}</a>, sign in, and paste the session it gives you.
          </p>
          <form className="ask-row" onSubmit={(e) => { e.preventDefault(); connect(chosen.home); }}>
            <label className="sr" htmlFor="connect-token">Your Home session</label>
            <input id="connect-token" className="ask-q" value={draft} onChange={(e) => { setDraft(e.target.value); setErr(null); }} placeholder="the session from your Home" autoComplete="off" />
            <button type="submit" className="button" disabled={!draft.trim()}>Connect</button>
          </form>
        </>
      )}

      {err && <p className="banner banner-warn" style={{ marginBottom: 0 }}>{err}</p>}
      <p className="quiet"><button type="button" className="linkish" onClick={close}>\u2190 Back</button></p>
    </div>
  );
}
