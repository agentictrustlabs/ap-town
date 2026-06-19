import { useEffect, useMemo, useState } from 'react';
import { CONTRACTS } from '@agenticprimitives/contracts/deployments/base-sepolia';
import { CLASS } from '@agenticprimitives/ontology';
import { loadAboxGraph, type AboxDoc } from './lib/abox-graph';
import { discover, getAgentDetail, DISCOVERY_AGENT_URL, type DiscoverResponse, type AgentDetail } from './lib/discovery-a2a';
import { Pill, Spinner, short } from './components/ui';

type View = { tab: 'graph' } | { tab: 'search' } | { tab: 'agent'; key: string; label: string; back: 'graph' | 'search' };

const REGISTRY_ADDRESS = CONTRACTS.agentRegistryBase as string;

export function App() {
  const [view, setView] = useState<View>({ tab: 'graph' });
  const open = (key: string, label: string, back: 'graph' | 'search') => setView({ tab: 'agent', key, label, back });

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
        <nav className="tabs" role="tablist">
          <button className={`tab ${view.tab === 'graph' ? '--active' : ''}`} onClick={() => setView({ tab: 'graph' })}>Indexed graph · A-box</button>
          <button className={`tab ${view.tab === 'search' ? '--active' : ''}`} onClick={() => setView({ tab: 'search' })}>Search · via A2A</button>
        </nav>

        {view.tab === 'graph' ? <GraphView onOpen={(k, l) => open(k, l, 'graph')} />
          : view.tab === 'search' ? <SearchView onOpen={(k, l) => open(k, l, 'search')} />
          : <AgentDetailView agentKey={view.key} label={view.label} onBack={() => setView({ tab: view.back })} />}
      </main>
      <footer className="wrap">
        Discovery knowledge graph · registry <code>{short(REGISTRY_ADDRESS, 10)}</code> on Base Sepolia ·
        agents enumerated from agent-naming, projected with the agentic-trust ontology
        (<code>{CLASS.RegistryEntry.split('/ns/')[1]}</code>) into GraphDB · read through the discovery agent + MCP.
      </footer>
    </>
  );
}

function GraphView({ onOpen }: { onOpen: (key: string, label: string) => void }) {
  const [doc, setDoc] = useState<AboxDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { loadAboxGraph().then(setDoc).catch((e) => setErr(String(e))); }, []);
  const ALL = ['naming', 'profile', 'registry', 'relationship', 'attestation'];

  const agents = useMemo(() => {
    if (!doc) return [];
    const t = q.trim().toLowerCase();
    return doc.agents.filter((a) => !t || (a.name ?? '').toLowerCase().includes(t) || a.smartAgent.toLowerCase().includes(t));
  }, [doc, q]);

  return (
    <>
      <p className="eyebrow">Indexed · A-box</p>
      <h1 style={{ marginBottom: '.4rem' }}>The discovery knowledge graph</h1>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Every Smart Agent enumerated from agent-naming, projected with its available on-chain facets into the agentic-trust ontology graph. Click an agent for its full node.
      </p>
      {doc && <p className="cite" style={{ marginBottom: '1rem' }}>{doc.agents.length} agents · facet coverage: {ALL.map((f) => `${f} ${doc.facetCoverage[f] ?? 0}`).join(' · ')}</p>}
      <input className="input" placeholder="Filter by name or address…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '1.4rem' }} />
      {err ? <div className="card"><Pill kind="err">load error</Pill> <span className="muted">{err}</span></div>
        : !doc ? <div className="row"><Spinner /> <span className="muted">Loading the A-box…</span></div>
        : (
          <div className="grid">
            {agents.map((a) => (
              <button key={a.smartAgent} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => onOpen(a.name ?? a.smartAgent, a.name ?? short(a.smartAgent, 10))}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: '.98rem' }}>{a.name ?? '(unnamed)'}</h3>
                  <Pill kind={a.conforms ? 'ok' : 'err'}>{a.conforms ? 'SHACL ✓' : 'SHACL ✗'}</Pill>
                </div>
                <p className="mono muted" style={{ fontSize: '.74rem', margin: '.3rem 0 .6rem' }}>{short(a.smartAgent, 14)}</p>
                <div className="row" style={{ flexWrap: 'wrap', gap: '.35rem' }}>
                  {ALL.map((kind) => { const f = a.facets.find((x) => x.kind === kind); return <Pill key={kind} kind={f?.present ? 'ok' : 'neutral'}>{kind}{f?.present ? '' : ' —'}</Pill>; })}
                </div>
              </button>
            ))}
            {agents.length === 0 && <p className="muted">No agents match “{q}”.</p>}
          </div>
        )}
    </>
  );
}

function SearchView({ onOpen }: { onOpen: (key: string, label: string) => void }) {
  const [query, setQuery] = useState('');
  const [intent, setIntent] = useState('');
  const [resp, setResp] = useState<DiscoverResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const run = async () => {
    setLoading(true); setResp(null);
    try { setResp(await discover({ query, intent: intent || undefined })); }
    catch (e) { setResp({ ok: false, query, intent: null, results: [], error: String(e) }); }
    finally { setLoading(false); }
  };
  return (
    <>
      <p className="eyebrow">Search · agent service</p>
      <h1 style={{ marginBottom: '.4rem' }}>Ask the Discovery Agent</h1>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        <b>UI → A2A → MCP → GraphDB.</b> The agent ranks by relevance + verifiable trust; intent + mandate weighting is the growing edge. Click a result for its full node.
      </p>
      <div className="card" style={{ marginBottom: '1.2rem' }}>
        <input className="input" placeholder="Query (e.g. lbsb, scripture, org)…" value={query} onChange={(e) => setQuery(e.target.value)} style={{ marginBottom: '.6rem' }} />
        <input className="input" placeholder="Intent (optional, e.g. 'licensed scripture provider')…" value={intent} onChange={(e) => setIntent(e.target.value)} style={{ marginBottom: '.7rem' }} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="btn --p" onClick={run} disabled={loading}>{loading ? <Spinner /> : 'Discover'}</button>
          <span className="cite">agent: <a href={`${DISCOVERY_AGENT_URL}/.well-known/agent-card.json`} target="_blank" rel="noreferrer">discovery.agent</a></span>
        </div>
      </div>
      {loading && <div className="row"><Spinner /> <span className="muted">A2A → MCP → GraphDB…</span></div>}
      {resp && !resp.ok && <div className="card"><Pill kind="err">error</Pill> <span className="muted">{resp.error}</span></div>}
      {resp?.ok && (
        <>
          <p className="cite" style={{ marginBottom: '1rem' }}>{resp.results.length} result(s) · {resp.source}{resp.note ? ` · ${resp.note}` : ''}</p>
          {resp.results.map((r) => (
            <button key={r.smartAgent} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', width: '100%' }} onClick={() => onOpen(r.name ?? r.smartAgent, r.name ?? short(r.smartAgent, 10))}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                <h3 style={{ fontSize: '1rem' }}>{r.name ?? '(unnamed)'}</h3>
                <div className="row" style={{ gap: '.4rem' }}>
                  <Pill kind={r.shaclConforms ? 'ok' : 'err'}>{r.shaclConforms ? 'SHACL ✓' : 'SHACL ✗'}</Pill>
                  <Pill kind={r.score >= 0.6 ? 'ok' : r.score >= 0.3 ? 'warn' : 'neutral'}>score {r.score.toFixed(2)}</Pill>
                </div>
              </div>
              <p className="mono muted" style={{ fontSize: '.74rem', margin: '.3rem 0 .5rem' }}>{short(r.smartAgent, 14)}</p>
              <p className="cite">{r.why.join(' · ')}</p>
            </button>
          ))}
          {resp.results.length === 0 && <p className="muted">No agents matched.</p>}
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
            <p className="cite" style={{ marginTop: '.8rem' }}>
              Read live through <b>discovery.agent → MCP → GraphDB</b>. Facets populate as the agent's on-chain data grows (a registry entry is written during onboarding; the indexer projects it here). The card + binding proof become client-side re-verifiable once the registrant publishes their bodies by hash.
            </p>
          </>
        )}
    </>
  );
}
