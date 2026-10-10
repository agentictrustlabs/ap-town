// THE TOWN ASK — spec 436 §5.5 T4. A question about the town's performance, spend or status goes to the town context
// agent's A2A door through the portal's own Worker (`/api/ask`), as a stranger: the agent answers from its public lane
// — the rollups it keeps are the numbers this page draws — on the subject-answer artifact, with the records it read
// named. The portal adds nothing: no key, no session, no rewrite. Until the context agent is chartered (T1) the door
// says so.
import { useState, type ReactNode } from 'react';
import { getJson } from '@ap-town/town-ui';

export interface AskAnswer { ok: boolean; answer?: string; agent?: string; cited?: Array<{ key: string; day?: string }>; runRef?: string; error?: string; detail?: string }

export function Ask({ scope }: { scope: 'town' | 'estate'; estate?: string }): ReactNode {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<AskAnswer | null>(null);
  const examples = scope === 'town' ? ['how is the town doing this week', 'what did inference cost yesterday', 'which services were down in the last 7 days'] : ['how many runs failed this week', 'what is parked for a signature right now', 'how many people joined this month'];
  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true); setOut(null);
    const r = await getJson<AskAnswer>(`/api/ask?scope=${scope}&q=${encodeURIComponent(text.trim())}`);
    setOut(r.ok ? r.data : { ok: false, error: r.error.error, ...(r.error.detail ? { detail: r.error.detail } : {}) });
    setBusy(false);
  };
  return (
    <section className="ask">
      <h2>Ask the {scope}</h2>
      <p className="lede">Performance, spend, status — answered by the {scope}'s own agent from the records it keeps, with the records named. Counts, never a person.</p>
      <form className="ask-row" onSubmit={(e) => { e.preventDefault(); void ask(q); }}>
        <input className="ask-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={examples[0]} aria-label={`Ask the ${scope}`} disabled={busy} />
        <button type="submit" className="button" disabled={busy || !q.trim()} aria-busy={busy}>{busy ? 'Asking…' : 'Ask'}</button>
      </form>
      <p className="quiet">Try: {examples.map((x, i) => <span key={x}>{i ? ' · ' : ''}<button type="button" className="linkish" onClick={() => { setQ(x); void ask(x); }} disabled={busy}>{x}</button></span>)}</p>
      {out && (out.ok ? (
        <div className="panel ask-answer">
          <p>{out.answer}</p>
          <p className="quiet">Said by <span className="mono">{out.agent}</span>{out.cited?.length ? <> · read {out.cited.map((c) => c.key).join(', ')}</> : null}{out.runRef ? <> · run <span className="mono">{out.runRef}</span></> : null}</p>
        </div>
      ) : (
        <div className="banner banner-warn"><strong>Not answered.</strong> {out.detail ?? out.error}</div>
      ))}
    </section>
  );
}
