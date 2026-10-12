// /connected — the leg home. The person signed in at their OWN Home and came back here with a single-use
// code; this tab redeems it with the PKCE verifier only it holds, and puts them back where they started.
//
// What lands is an id_token: it asserts WHO they are and carries no authority to act for them. The agent
// they go on to ask resolves it to their Smart Agent and decides from their own standing, on chain, per
// call. The town gains nothing from this page — it never sees a credential, mints no token, and keeps the
// one it was handed in this browser tab alone.
import { useEffect, useState, type ReactNode } from 'react';
import { Link } from '@ap-town/town-ui';
import { completeConnection, useConnection } from '../Connect';

export function Connected(): ReactNode {
  const { conn } = useConnection();
  const [err, setErr] = useState<string | null>(null);
  const [back, setBack] = useState('/');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // WHERE THEY WERE, kept across the round trip so Connect does not dump everyone on the front page.
    let where = '/';
    try { where = sessionStorage.getItem('ap-town.return-to') || '/'; sessionStorage.removeItem('ap-town.return-to'); } catch { /* no storage: the front page it is */ }
    setBack(where);
    void completeConnection(params).then((r) => {
      if (!r.ok) { setErr(r.error); return; }
      // The code is spent and the URL still carries it; replace rather than push, so Back cannot replay it.
      window.history.replaceState(null, '', where);
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
  }, []);

  if (err) {
    return (
      <section>
        <h1>That sign-in did not finish.</h1>
        <p className="lede">{err}</p>
        <p className="quiet">
          Nothing was connected, and nothing was changed here — the town holds no account and never saw your
          credential. <Link href={back}>Go back</Link> and try again, or carry on unconnected: every page answers
          a stranger too, with what each agent has made public.
        </p>
      </section>
    );
  }
  return (
    <section>
      <h1>{conn ? `Welcome, ${conn.name ?? 'you'}.` : 'Finishing your sign-in…'}</h1>
      <p className="lede">
        {conn
          ? 'You are connected. Questions you put to an agent now arrive as you, and the agent decides from your own standing.'
          : 'Redeeming the code your Home gave this tab.'}
      </p>
      {conn && <p className="quiet"><Link href={back}>Back to where you were →</Link></p>}
    </section>
  );
}
