// THE TOWN ASK — spec 436 §5.5 T4. A question about the town's performance, spend or status goes to the town context
// agent's A2A door through the portal's own Worker (`/api/ask`), as a stranger: the agent answers from its public lane
// — the rollups it keeps are the numbers this page draws — on the subject-answer artifact, with the records it read
// named. The portal adds nothing: no key, no session, no rewrite. Until the context agent is chartered (T1) the door
// says so.
import { useState, type ReactNode } from 'react';
import { getJson } from '@ap-town/town-ui';
import type { ContextAgentView } from '../types';
import { useConnection } from '../Connect';

export interface AskAnswer { ok: boolean; answer?: string; agent?: string; asked?: string; cited?: Array<{ key: string; day?: string }>; runRef?: string; error?: string; detail?: string }

/**
 * WHICH AGENT YOU ARE TALKING TO IS A CHOICE, not a default. A town has estates — each with its OWN context
 * agent, its own vault and its own records — so "Ask the estate" on a town with more than one was asking the
 * first one in the manifest and never saying which. The estate travels to `/api/ask?estate=<id>`, which has
 * always taken it; what was missing was any way to say it, and any sign of which one answered.
 */
export function Ask({ scope, estates = [], agents, agent, examples: given }: {
  scope: 'town' | 'estate' | 'agent';
  estates?: Array<{ id: string }>;
  /** `scope: 'agent'` — the name of the one agent this Ask talks to, as the chain knows it. */
  agent?: string;
  /** What to suggest on an agent page, where the town cannot know what the agent is good for. */
  examples?: string[];
  /** Who answers for each context, from `/api/town` — so the page names the door before the question is sent. */
  agents?: { town: ContextAgentView | null; estates: Record<string, ContextAgentView> };
}): ReactNode {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<AskAnswer | null>(null);
  const [estate, setEstate] = useState(estates[0]?.id ?? '');
  const { conn } = useConnection();
  const who = scope === 'agent' ? (agent ?? 'this agent') : scope === 'estate' && estate ? `the ${estate} estate` : scope === 'estate' ? 'the estate' : 'the town';
  // WHICH AGENT, NAMED BEFORE YOU ASK. An answer already says who said it; this says who WILL — the name on the
  // chain and the card that names its door — so an unanswered question is read as a door, not as a mystery.
  const asked = scope === 'town' ? agents?.town ?? null : scope === 'estate' && estate ? agents?.estates[estate] ?? null : null;
  // Open-ended, not a menu: the agent answers about anything its records name — a Worker, a service, an
  // estate, a platform — so the examples show one of each rather than three phrasings of "how is it going".
  // The TOWN keeps the town of names (spec 430), so a names question is on its examples and not an estate's:
  // a root is shared by every estate that names under it, and no estate's record carries the count.
  const examples = given ?? (scope === 'town'
    ? ['how is the town doing this week', 'how many people are named here', 'tell me about demo-a2a-faithnet', 'is anything broken right now']
    : ['how many runs failed this week', 'what did it spend this week', 'is anything broken right now']);
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setOut(null);
    const qs = scope === 'estate' && estate ? `&estate=${encodeURIComponent(estate)}` : scope === 'agent' && agent ? `&agent=${encodeURIComponent(agent)}` : '';
    // THE CALLER'S OWN SESSION, when they connected one. The page carries it; it never holds anything else.
    const r = await getJson<AskAnswer>(`/api/ask?scope=${scope}${qs}&q=${encodeURIComponent(text.trim())}`, conn ? { authorization: `Bearer ${conn.token}` } : undefined);
    setOut(r.ok ? r.data : { ok: false, error: r.error.error, ...(r.error.detail ? { detail: r.error.detail } : {}) });
    setBusy(false);
  };
  return (
    <section className="ask">
      <h2>Ask {who}</h2>
      <p className="lede">Ask anything about this deployment — a service, a Worker, an estate, what it cost, what is down. Answered by {who}'s own agent from the records it keeps, with the records named. It answers only from those records and says so when they do not hold it. Counts, never a person.</p>
      {scope === 'agent' && (conn
        ? <p className="quiet">Asked as <span className="mono">{conn.name ?? conn.agent}</span> — this page relays the session your Home gave you; the agent decides from your own standing.</p>
        : <p className="quiet">Asked as a stranger: you will get what {who} has made public, and nothing else. <strong>Connect</strong> in the corner to ask as yourself.</p>)}
      {agents && (asked
        ? <p className="quiet">Asked of <span className="mono">{asked.name}</span>{asked.card ? <> · <a href={asked.card} rel="noreferrer">its agent card</a></> : null} — the door this question goes to.</p>
        : <p className="quiet">No agent is chartered to answer for {who} yet (spec 436 §5.5 T1), so this will say so rather than guess.</p>)}
      <form className="ask-row" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        {/* Shown only when there IS a choice: one estate needs no picker, and a picker with one option reads
            like a setting rather than the fact that there is only one estate. */}
        {scope === 'estate' && estates.length > 1 && (
          <>
            <label className="sr" htmlFor="ask-estate">Which estate to ask</label>
            <select id="ask-estate" className="ask-estate" value={estate} onChange={(e) => { setEstate(e.target.value); setOut(null); }} disabled={busy}>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.id}</option>)}
            </select>
          </>
        )}
        <input className="ask-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={examples[0]} aria-label={`Ask ${who}`} disabled={busy} />
        <button type="submit" className="button" disabled={busy || !q.trim()} aria-busy={busy}>{busy ? 'Asking…' : 'Ask'}</button>
      </form>
      <p className="quiet">Try: {examples.map((x, i) => <span key={x}>{i ? ' · ' : ''}<button type="button" className="linkish" onClick={() => { setQ(x); void ask(x); }} disabled={busy}>{x}</button></span>)}</p>
      {out && (out.ok ? (
        <div className="panel ask-answer">
          <p>{out.answer}</p>
          <p className="quiet">Said by <span className="mono">{out.agent}</span>{out.asked ? <> · asked {out.asked}</> : null}{out.cited?.length ? <> · read {out.cited.map((c) => c.key).join(', ')}</> : null}{out.runRef ? <> · run <span className="mono">{out.runRef}</span></> : null}</p>
        </div>
      ) : (
        <div className="banner banner-warn"><strong>Not answered.</strong> {out.detail ?? out.error}</div>
      ))}
    </section>
  );
}
