import { useEffect, useState } from 'react';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/base-sepolia';
import { CLASS } from '@agenticprimitives/ontology';
import { discover, getAgentDetail, fetchA2aCard, getOfferings, DISCOVERY_AGENT_URL, type DiscoverResponse, type AgentDetail, type A2aCard, type CrawledOffering } from './lib/discovery-a2a';
import { Pill, Spinner, short } from './components/ui';

// Single live source of truth: everything reads the GraphDB A-box through the discovery agent + MCP. (The
// former "Indexed graph · A-box" tab read a static JSON-LD snapshot that drifted from the live tier — dropped
// in favour of this one live path; agent discovery + the detail drill-down both query GraphDB.)
type View = { tab: 'search' } | { tab: 'agent'; key: string; label: string };

const REGISTRY_ADDRESS = CONTRACTS.agentRegistryBase as string;

export function App() {
  const [view, setView] = useState<View>({ tab: 'search' });
  const open = (key: string, label: string) => setView({ tab: 'agent', key, label });

  return (
    <>
      <header className="topbar">
        <div className="wrap">
          <div className="brand">
            <span className="brand-glyph">◎</span>
            <div>AP Discovery<small>agent knowledge graph · spec 279</small></div>
          </div>
          <span className="powered">via <b>discovery.agent</b> → MCP → GraphDB</span>
        </div>
      </header>
      <main className="wrap">
        {view.tab === 'agent'
          ? <AgentDetailView agentKey={view.key} label={view.label} onBack={() => setView({ tab: 'search' })} />
          : <SearchView onOpen={open} />}
      </main>
      <footer className="wrap">
        Discovery knowledge graph · registry <code>{short(REGISTRY_ADDRESS, 10)}</code> on Base Sepolia ·
        agents enumerated from agent-naming, projected with the agentic-trust ontology
        (<code>{CLASS.RegistryEntry.split('/ns/')[1]}</code>) into GraphDB · read through the discovery agent + MCP.
      </footer>
    </>
  );
}

function SearchView({ onOpen }: { onOpen: (key: string, label: string) => void }) {
  const [intent, setIntent] = useState('');
  const [requireRegistered, setRequireRegistered] = useState(false);
  const [requireSkill, setRequireSkill] = useState('');
  const [resp, setResp] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true); setResp(null);
    try { setResp(await discover({ intent: intent || undefined, mandates: { requireRegistered, requireSkill: requireSkill.trim() || undefined } })); }
    catch (e) { setResp({ ok: false, query: '', intent: null, results: [], error: String(e) }); }
    finally { setLoading(false); }
  };
  return (
    <>
      <p className="eyebrow">Search · agent service</p>
      <h1 style={{ marginBottom: '.4rem' }}>Find an agent for what you need</h1>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        <b>UI → A2A → MCP → GraphDB.</b> Describe your need; the agent ranks candidates by fit + verifiable trust (0.6·fit + 0.4·trust). Add mandates to hard-filter. Click a result for its full node.
      </p>
      <div className="card" style={{ marginBottom: '1.2rem' }}>
        <input className="input" placeholder="What do you need? e.g. 'help managing a treasury'" value={intent} onChange={(e) => setIntent(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} style={{ marginBottom: '.6rem' }} />
        <div className="row" style={{ gap: '1rem', flexWrap: 'wrap', marginBottom: '.7rem', alignItems: 'center' }}>
          <label className="row" style={{ gap: '.4rem', cursor: 'pointer', fontSize: '.85rem' }}>
            <input type="checkbox" checked={requireRegistered} onChange={(e) => setRequireRegistered(e.target.checked)} /> Registered only
          </label>
          <input className="input" placeholder="Required skill (optional)…" value={requireSkill} onChange={(e) => setRequireSkill(e.target.value)} style={{ flex: 1, minWidth: 160, marginBottom: 0 }} />
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn --p" onClick={run} disabled={loading}>{loading ? <Spinner /> : 'Discover'}</button>
          <span className="cite">agent: <a href={`${DISCOVERY_AGENT_URL}/.well-known/agent-card.json`} target="_blank" rel="noreferrer">discovery.agent</a></span>
        </div>
      </div>
      {loading && <div className="row"><Spinner /> <span className="muted">A2A → MCP → GraphDB…</span></div>}
      {resp && !resp.ok && <div className="card"><Pill kind="err">error</Pill> <span className="muted">{resp.error}</span></div>}
      {resp?.ok && (
        <>
          <p className="cite" style={{ marginBottom: '1rem' }}>{resp.results.length} match(es){typeof resp.droppedByMandates === 'number' && resp.droppedByMandates > 0 ? ` · ${resp.droppedByMandates} dropped by mandates` : ''} · {resp.source}</p>
          {resp.results.map((r) => {
            const skills = (r.skills ?? '').split(',').map((s) => s.trim()).filter(Boolean);
            return (
            <button key={r.smartAgent} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', width: '100%' }} onClick={() => onOpen(r.name ?? r.smartAgent, r.name ?? short(r.smartAgent, 10))}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                <h3 style={{ fontSize: '1rem' }}>{r.name ?? '(unnamed)'}</h3>
                <div className="row" style={{ gap: '.4rem' }}>
                  {r.registered && <Pill kind="ok">registered</Pill>}
                  <Pill kind={r.shaclConforms ? 'ok' : 'err'}>{r.shaclConforms ? 'SHACL ✓' : 'SHACL ✗'}</Pill>
                  <Pill kind={r.score >= 0.6 ? 'ok' : r.score >= 0.3 ? 'warn' : 'neutral'}>score {r.score.toFixed(2)}</Pill>
                </div>
              </div>
              <p className="mono muted" style={{ fontSize: '.74rem', margin: '.3rem 0 .5rem' }}>{short(r.smartAgent, 14)}</p>
              {skills.length > 0 && (
                <div className="row" style={{ gap: '.3rem', flexWrap: 'wrap', marginBottom: '.5rem' }}>
                  {skills.map((s) => <Pill key={s} kind="neutral">{s}</Pill>)}
                </div>
              )}
              <p className="cite">{r.why.join(' · ')}</p>
            </button>
          ); })}
          {resp.results.length === 0 && <p className="muted">No agents matched — try a broader need or drop a mandate.</p>}
        </>
      )}
    </>
  );
}

const local = (iri: string) => iri.includes('#') ? iri.split('#').pop()! : iri.split('/').pop() || iri;

function AgentDetailView({ agentKey, label, onBack }: { agentKey: string; label: string; onBack: () => void }) {
  const [data, setData] = useState<AgentDetail | null>(null);
  useEffect(() => { setData(null); getAgentDetail(agentKey).then(setData).catch((e) => setData({ ok: false, error: String(e) })); }, [agentKey]);

  const rows = (data?.triples ?? []).filter((t) => !t.p.endsWith('#type'));
  const conforms = (data?.triples ?? []).find((t) => t.p.endsWith('shacl#conforms'))?.o;
  const types = (data?.triples ?? []).filter((t) => t.p.endsWith('#type')).map((t) => local(t.o));
  // spec 280 — the agent's bound A2A host (its live skills card). Present once the indexer projects it.
  const a2aEndpoint = (data?.triples ?? []).find((t) => t.p.endsWith('a2aEndpoint'))?.o;

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: '1rem' }}>← back</button>
      <p className="eyebrow">Agent · A-box node</p>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1>{label}</h1>
        {conforms !== undefined && <Pill kind={conforms === 'false' ? 'err' : 'ok'}>{conforms === 'false' ? 'SHACL ✗' : 'SHACL ✓'}</Pill>}
      </div>

      {!data ? <div className="row" style={{ marginTop: '1.2rem' }}><Spinner /> <span className="muted">A2A → MCP → GraphDB…</span></div>
        : !data.ok ? <div className="card" style={{ marginTop: '1.2rem' }}><Pill kind="err">not found</Pill> <span className="muted">{data.error ?? 'no A-box node for this agent'}</span></div>
        : (
          <>
            <div className="card" style={{ marginTop: '1.2rem' }}>
              <div className="row" style={{ flexWrap: 'wrap', gap: '.4rem', marginBottom: '.7rem' }}>
                {types.map((t) => <Pill key={t} kind="neutral">{t}</Pill>)}
              </div>
              <dl className="kv">
                <dt>node IRI</dt><dd className="mono">{data.agent}</dd>
                {rows.map((t, i) => (
                  <div key={i} style={{ display: 'contents' }}>
                    <dt>{local(t.p)}</dt>
                    <dd className="mono">{t.o.startsWith('http') || t.o.startsWith('urn:') ? <span>{t.o}</span> : t.o}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <IndexedOfferingsPanel agentKey={agentKey} />
            <A2aSkillsPanel discovered={a2aEndpoint} />
            <p className="cite" style={{ marginTop: '.8rem' }}>
              Read live through <b>discovery.agent → MCP → GraphDB</b>. Facets populate as the agent's on-chain data grows (a registry entry is written during onboarding; the indexer projects it here). The card + binding proof become client-side re-verifiable once the registrant publishes their bodies by hash.
            </p>
          </>
        )}
    </>
  );
}

/** Indexed Offerings (spec 286 P3): the agent's per-skill Offerings as CRAWLED INTO THE A-BOX ahead of time
 *  (from its public A2A card), so discovery can rank over them offline. This is the queryable, host-asserted
 *  view with provenance — distinct from the live-card panel below (which re-fetches the freshest snapshot). */
function IndexedOfferingsPanel({ agentKey }: { agentKey: string }) {
  const [offerings, setOfferings] = useState<CrawledOffering[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setOfferings(null); setErr(null);
    getOfferings(agentKey)
      .then((r) => { if (cancelled) return; if (r.ok) setOfferings(r.offerings ?? []); else setErr(r.error ?? 'no offerings'); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [agentKey]);

  const prov = offerings?.find((o) => o.sourceEndpoint || o.observedAt);
  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <h3 style={{ fontSize: '.95rem' }}>Indexed offerings <span className="muted" style={{ fontWeight: 400 }}>· crawled into the knowledge base</span></h3>
        {offerings && <Pill kind="neutral">{offerings.length} skill(s)</Pill>}
      </div>
      {!offerings && !err && <div className="row" style={{ marginTop: '.5rem' }}><Spinner /> <span className="muted">A2A → MCP → GraphDB…</span></div>}
      {err && <div className="row" style={{ marginTop: '.5rem' }}><Pill kind="err">error</Pill> <span className="muted">{err}</span></div>}
      {offerings && offerings.length === 0 && <span className="muted">No offerings crawled yet — the indexer projects them from the agent&apos;s public A2A card on its next run.</span>}
      {offerings && offerings.length > 0 && (
        <>
          <table className="tbl" style={{ width: '100%', marginTop: '.5rem', fontSize: '.82rem' }}>
            <thead><tr><th style={{ textAlign: 'left' }}>skill</th><th style={{ textAlign: 'left' }}>effect</th><th style={{ textAlign: 'left' }}>exposure</th><th style={{ textAlign: 'left' }}>family</th><th style={{ textAlign: 'left' }}>status</th></tr></thead>
            <tbody>
              {offerings.map((o) => (
                <tr key={o.skillId}>
                  <td className="mono">{o.skillId}{o.hasInputSchema ? ' ·⃝' : ''}</td>
                  <td>{o.effect ?? '—'}</td>
                  <td>{o.exposure ?? '—'}</td>
                  <td>{o.family ?? '—'}</td>
                  <td>{o.status ? <Pill kind={o.status === 'suspended' ? 'err' : 'ok'}>{o.status}</Pill> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {prov && (
            <p className="cite" style={{ marginTop: '.6rem' }}>
              Host-asserted, crawled from {prov.sourceEndpoint ?? 'the public card'}
              {prov.observedAt ? ` · observed ${new Date(prov.observedAt * 1000).toISOString().slice(0, 16).replace('T', ' ')}` : ''}
              {prov.cardDigest ? ` · ${prov.cardDigest.slice(0, 16)}…` : ''}. A cache of public card data (ADR-0040 amended) — re-fetch the live card below to re-verify; on-chain a2aEndpoint + atl:skills remain the authority.
            </p>
          )}
        </>
      )}
    </div>
  );
}

const TREASURY_A2A_DEFAULT = 'https://demo-treasury-a2a.richardpedersen3.workers.dev';

/** Live A2A skills for a smart agent: fetch its bound a2aEndpoint card (/.well-known/agent-card.json) and
 *  show the skills it advertises. `discovered` is the indexed a2aEndpoint (spec 280); when absent you can
 *  enter one (prefilled with the treasury host) so the flow is demoable before a reindex. */
function A2aSkillsPanel({ discovered }: { discovered?: string }) {
  const [endpoint, setEndpoint] = useState(discovered ?? TREASURY_A2A_DEFAULT);
  const [view, setView] = useState<'public' | 'authenticated'>('public');
  const [card, setCard] = useState<A2aCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (discovered) setEndpoint(discovered); }, [discovered]);

  const load = async () => {
    setLoading(true); setErr(null); setCard(null);
    try { setCard(await fetchA2aCard(endpoint, view === 'authenticated' ? 'authenticated' : undefined)); }
    catch (e) { setErr(String(e)); }
    finally { setLoading(false); }
  };
  const skills = card?.skills ?? [];

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
        <h3 style={{ fontSize: '.95rem' }}>A2A skills {discovered ? '' : <span className="muted" style={{ fontWeight: 400 }}>(no a2aEndpoint indexed — enter one)</span>}</h3>
        <div className="row" style={{ gap: '.4rem' }}>
          <select className="input" value={view} onChange={(e) => setView(e.target.value as 'public' | 'authenticated')} style={{ marginBottom: 0, width: 'auto' }}>
            <option value="public">public · families</option>
            <option value="authenticated">authenticated · fine</option>
          </select>
          <button className="btn --p" onClick={load} disabled={loading || !endpoint}>{loading ? <Spinner /> : 'Fetch card'}</button>
        </div>
      </div>
      <input className="input mono" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://…a2a host" style={{ margin: '.5rem 0', fontSize: '.78rem' }} />
      {err && <div className="row"><Pill kind="err">error</Pill> <span className="muted">{err}</span></div>}
      {card && (
        <>
          <p className="cite" style={{ marginBottom: '.5rem' }}>{card.name ?? 'agent'}{card.type ? ` · ${card.type}` : ''} · {String(card.view ?? view)} card · {skills.length} skill(s)</p>
          {skills.length > 0 ? (
            <div className="row" style={{ gap: '.3rem', flexWrap: 'wrap' }}>
              {skills.map((s) => <Pill key={s.id} kind="neutral">{s.name ?? s.id}{s.effect ? ` · ${s.effect}` : ''}</Pill>)}
            </div>
          ) : <span className="muted">No skills advertised on this card.</span>}
        </>
      )}
      <p className="cite" style={{ marginTop: '.6rem' }}>Fetched live from the agent&apos;s A2A host card. Card visibility ≠ authorization — invocation re-checks entitlement ∩ delegation ∩ assertion ∩ policy.</p>
    </div>
  );
}
