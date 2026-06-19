import { useEffect, useMemo, useState } from 'react';
import {
  loadAbox,
  verifyEvidence,
  REGISTRY_ADDRESS,
  ONTOLOGY,
  EXPOSURE_FINDINGS,
  type AgentRecord,
  type EvidencePath,
} from './lib/abox';
import { loadLive, LIVE, type LiveAgent } from './lib/live';
import { loadAboxGraph, type AboxDoc } from './lib/abox-graph';
import { discover, DISCOVERY_AGENT_URL, type DiscoverResponse } from './lib/discovery-a2a';
import { Pill, StatusPill, VerifyPill, Spinner, short } from './components/ui';

type View = { tab: 'discover' } | { tab: 'agent'; slug: string } | { tab: 'findings' } | { tab: 'live' } | { tab: 'graph' } | { tab: 'search' };

export function App() {
  const [records, setRecords] = useState<AgentRecord[] | null>(null);
  const [view, setView] = useState<View>({ tab: 'discover' });
  const [admin, setAdmin] = useState(false);

  useEffect(() => { loadAbox().then(setRecords); }, []);

  return (
    <>
      <Topbar admin={admin} onToggleAdmin={() => setAdmin((a) => !a)} />
      <main className="wrap">
        <nav className="tabs" role="tablist">
          <button className={`tab ${view.tab === 'search' ? '--active' : ''}`} onClick={() => setView({ tab: 'search' })}>Search · via A2A</button>
          <button className={`tab ${view.tab === 'discover' || view.tab === 'agent' ? '--active' : ''}`} onClick={() => setView({ tab: 'discover' })}>Discover <span className="muted" style={{ fontWeight: 600 }}>(fixtures)</span></button>
          <button className={`tab ${view.tab === 'live' ? '--active' : ''}`} onClick={() => setView({ tab: 'live' })}>Live · Base Sepolia</button>
          <button className={`tab ${view.tab === 'graph' ? '--active' : ''}`} onClick={() => setView({ tab: 'graph' })}>Indexed graph · A-box</button>
          {admin && <button className={`tab ${view.tab === 'findings' ? '--active' : ''}`} onClick={() => setView({ tab: 'findings' })}>Exposure findings</button>}
        </nav>

        {view.tab === 'search' ? (
          <SearchView />
        ) : view.tab === 'graph' ? (
          <GraphView />
        ) : view.tab === 'live' ? (
          <LiveView />
        ) : !records ? (
          <div className="row"><Spinner /> <span className="muted">Building the fixture A-box + signing cards…</span></div>
        ) : view.tab === 'discover' ? (
          <DiscoverView records={records} onOpen={(slug) => setView({ tab: 'agent', slug })} />
        ) : view.tab === 'agent' ? (
          <AgentView record={records.find((r) => r.slug === view.slug)!} onBack={() => setView({ tab: 'discover' })} />
        ) : (
          <FindingsView records={records} onOpen={(slug) => setView({ tab: 'agent', slug })} />
        )}
      </main>
      <footer className="wrap">
        Reference UI · registry <code>{short(REGISTRY_ADDRESS, 10)}</code> on Base Sepolia ·
        cards + proofs verified live with <b>@agenticprimitives/registry-kit</b> + <b>agent-profile</b> ·
        ontology <code>{ONTOLOGY.CLASS.RegistryEntry.split('/ns/')[1]}</code>
      </footer>
    </>
  );
}

function Topbar({ admin, onToggleAdmin }: { admin: boolean; onToggleAdmin: () => void }) {
  return (
    <header className="topbar">
      <div className="wrap">
        <div className="brand">
          <span className="brand-glyph">◎</span>
          <div>AP Discovery<small>agent registry explorer · spec 279</small></div>
        </div>
        <button className="btn" onClick={onToggleAdmin}>{admin ? '🔓 admin on' : '🔒 admin'}</button>
      </div>
    </header>
  );
}

function DiscoverView({ records, onOpen }: { records: AgentRecord[]; onOpen: (slug: string) => void }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return records.filter((r) => !t || r.name.toLowerCase().includes(t) || r.blurb.toLowerCase().includes(t) || r.cardType.includes(t) || r.entry.registryLabel.toLowerCase().includes(t) || r.claims.some((c) => c.value.toLowerCase().includes(t)));
  }, [records, q]);

  return (
    <>
      <p className="eyebrow">Public search</p>
      <h1 style={{ marginBottom: '.4rem' }}>Find a trustable agent</h1>
      <p className="muted" style={{ marginBottom: '1.2rem' }}>Search the registry. Every result links to an <b>evidence path</b> — the cited public facts behind its trust, verified live, never taken on the registry's word.</p>
      <input className="input" placeholder="Search by name, capability, registry, type…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '1.4rem' }} />
      <div className="grid">
        {filtered.map((r) => (
          <button key={r.slug} className="card" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit' }} onClick={() => onOpen(r.slug)}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>{r.name}</h3>
              <StatusPill status={r.entry.status} />
            </div>
            <p className="muted" style={{ fontSize: '.86rem', margin: '.5rem 0 .7rem' }}>{r.blurb}</p>
            <div className="row" style={{ flexWrap: 'wrap', gap: '.4rem' }}>
              <Pill kind="neutral">{r.cardType}</Pill>
              <Pill kind="neutral">{r.entry.registryLabel}</Pill>
              {r.claims.map((c) => <Pill key={c.slotId} kind="neutral">{c.value}</Pill>)}
            </div>
          </button>
        ))}
        {filtered.length === 0 && <p className="muted">No agents match “{q}”.</p>}
      </div>
    </>
  );
}

function AgentView({ record, onBack }: { record: AgentRecord; onBack: () => void }) {
  const [ev, setEv] = useState<EvidencePath | null>(null);
  useEffect(() => { setEv(null); verifyEvidence(record).then(setEv); }, [record]);
  const e = record.entry;

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: '1rem' }}>← back to search</button>
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.6rem' }}>
        <div><p className="eyebrow">Evidence path</p><h1>{record.name}</h1></div>
        <StatusPill status={e.status} live={ev?.live} />
      </div>

      {!ev ? (
        <div className="row" style={{ marginTop: '1.2rem' }}><Spinner /> <span className="muted">Verifying card + binding proof…</span></div>
      ) : (
        <>
          <div className="card" style={{ marginTop: '1.2rem', borderColor: ev.confidence >= 0.9 ? 'var(--ok-bd)' : ev.confidence >= 0.5 ? 'var(--warn-bd)' : 'var(--err-bd)' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3>Trust determination</h3>
              <Pill kind={ev.confidence >= 0.9 ? 'ok' : ev.confidence >= 0.5 ? 'warn' : 'err'}>confidence {ev.confidence.toFixed(2)}</Pill>
            </div>
            <ul style={{ margin: '.7rem 0 0', paddingLeft: '1.1rem', fontSize: '.86rem' }}>
              {ev.reasons.map((r, i) => <li key={i} style={{ marginBottom: '.25rem' }}>{r}</li>)}
            </ul>
            <p className="cite" style={{ marginTop: '.7rem' }}>A determination over public evidence — it informs ranking, it does <b>not</b> grant authority to act.</p>
          </div>

          <div className="card evidence" style={{ marginTop: '1rem' }}>
            <Step n="Signed agent card" pill={<VerifyPill ok={ev.card.ok} reason={ev.card.ok ? undefined : ev.card.reason} />} cite={`${ONTOLOGY.CLASS.SignedAgentCard.split('#')[1]} · ERC-1271`}>
              <dl className="kv">
                <dt>cardHash</dt><dd className="mono">{short(e.cardHash, 12)}</dd>
                <dt>subjectAgent</dt><dd className="mono">{short(e.subjectAgent, 10)}</dd>
                <dt>card.type</dt><dd>{record.cardType}</dd>
              </dl>
            </Step>
            <Step n="Binding proof" pill={<VerifyPill ok={ev.binding.ok} reason={ev.binding.ok ? undefined : ev.binding.reason} />} cite={`${ONTOLOGY.CLASS.RegistryEntryBindingProof.split('#')[1]}`}>
              <dl className="kv">
                <dt>proofHash</dt><dd className="mono">{short(record.proof.proofHash, 12)}</dd>
                <dt>binds</dt><dd>registry entry ⇄ subject agent ⇄ card ⇄ claims</dd>
              </dl>
            </Step>
            <Step n="Registry entry" pill={<StatusPill status={e.status} live={ev.live} />} cite={`${ONTOLOGY.CLASS.RegistryEntry.split('#')[1]} · ${e.registryLabel}`}>
              <dl className="kv">
                <dt>registryId</dt><dd className="mono">{e.registryId}</dd>
                <dt>entryId</dt><dd className="mono">{e.entryId}</dd>
                <dt>bindingProofHash</dt><dd className="mono">{short(e.bindingProofHash, 12)}</dd>
                <dt>expiresAt</dt><dd>{e.expiresAt ?? 'non-expiring'}</dd>
              </dl>
            </Step>
            <Step n="Claims" pill={<Pill kind="neutral">{record.claims.length} slot{record.claims.length === 1 ? '' : 's'}</Pill>} cite={`${ONTOLOGY.PREDICATE.claimHash.split('#')[1]}`}>
              <dl className="kv">
                {record.claims.map((c, i) => (<div key={c.slotId} style={{ display: 'contents' }}><dt>{c.label}</dt><dd>{c.value} · <span className="mono">{short(e.claimHashes[i] ?? '', 8)}</span></dd></div>))}
              </dl>
            </Step>
            <Step n="SHACL conformance" pill={<VerifyPill ok={ev.shapesOk} reason="shape violation" />} cite="cbox/discovery-graph-shapes.shacl.ttl">
              <div className="row" style={{ flexWrap: 'wrap', gap: '.4rem' }}>
                {ev.shapes.map((s) => <Pill key={s.shapeIri} kind={s.ok ? 'ok' : 'err'}>{s.label}</Pill>)}
              </div>
            </Step>
            <Step n="Graph provenance" pill={<Pill kind="neutral">fixture</Pill>} cite="apdisc:GraphSnapshot · apdisc:InferenceProfile">
              <dl className="kv">
                <dt>snapshot</dt><dd className="mono">{ev.graphSnapshot}</dd>
                <dt>inference</dt><dd className="mono">{ev.inferenceProfile}</dd>
                <dt>registry</dt><dd className="mono">{short(REGISTRY_ADDRESS, 12)} (Base Sepolia)</dd>
              </dl>
            </Step>
          </div>
        </>
      )}
    </>
  );
}

function Step({ n, pill, cite, children }: { n: string; pill: React.ReactNode; cite: string; children: React.ReactNode }) {
  return (
    <div className="evidence-step">
      <div className="step-h" style={{ justifyContent: 'space-between' }}><span>{n}</span>{pill}</div>
      <div style={{ margin: '.5rem 0' }}>{children}</div>
      <p className="cite">cites <b>{cite}</b></p>
    </div>
  );
}

function SearchView() {
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
        The browser never touches the chain or the graph directly — it asks the <b>Discovery A2A agent</b>, which orchestrates the <b>Discovery MCP</b> over the GraphDB knowledge base. <b>UI → A2A → MCP → GraphDB.</b> Intent + mandate weighting is the growing edge.
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
            <div key={r.smartAgent} className="card">
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
                <h3 style={{ fontSize: '1rem' }}>{r.name ?? '(unnamed)'}</h3>
                <div className="row" style={{ gap: '.4rem' }}>
                  <Pill kind={r.shaclConforms ? 'ok' : 'err'}>{r.shaclConforms ? 'SHACL ✓' : 'SHACL ✗'}</Pill>
                  <Pill kind={r.score >= 0.6 ? 'ok' : r.score >= 0.3 ? 'warn' : 'neutral'}>score {r.score.toFixed(2)}</Pill>
                </div>
              </div>
              <p className="mono muted" style={{ fontSize: '.74rem', margin: '.3rem 0 .5rem' }}>{short(r.smartAgent, 14)}</p>
              <p className="cite">{r.why.join(' · ')}</p>
            </div>
          ))}
          {resp.results.length === 0 && <p className="muted">No agents matched.</p>}
        </>
      )}
    </>
  );
}

function GraphView() {
  const [doc, setDoc] = useState<AboxDoc | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadAboxGraph().then(setDoc).catch((e) => setErr(String(e))); }, []);
  const ALL_FACETS = ['naming', 'profile', 'registry', 'relationship', 'attestation'];

  return (
    <>
      <p className="eyebrow">Indexed · A-box</p>
      <h1 style={{ marginBottom: '.4rem' }}>The discovery knowledge graph</h1>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Projected by the external <b>agent-indexer</b>: every Smart Agent registered in agent-naming, with every available on-chain facet (naming · profile · registry · relationship · attestation) merged into one SHACL-shaped node keyed by the SA. In production this is queried over GraphDB (agentkg.io); here it's the indexer's JSON-LD snapshot.
      </p>
      {doc && (
        <p className="cite" style={{ marginBottom: '1.2rem' }}>
          {doc.agents.length} agents · facet coverage: {ALL_FACETS.map((f) => `${f} ${doc.facetCoverage[f] ?? 0}`).join(' · ')}
        </p>
      )}
      {err ? <div className="card"><Pill kind="err">load error</Pill> <span className="muted">{err}</span></div>
        : !doc ? <div className="row"><Spinner /> <span className="muted">Loading the A-box…</span></div>
        : (
          <div className="grid">
            {doc.agents.map((a) => (
              <div key={a.smartAgent} className="card">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 style={{ fontSize: '.98rem' }}>{a.name ?? '(unnamed)'}</h3>
                  <Pill kind={a.conforms ? 'ok' : 'err'}>{a.conforms ? 'SHACL ✓' : 'SHACL ✗'}</Pill>
                </div>
                <p className="mono muted" style={{ fontSize: '.74rem', margin: '.3rem 0 .6rem' }}>{short(a.smartAgent, 14)}</p>
                <div className="row" style={{ flexWrap: 'wrap', gap: '.35rem' }}>
                  {ALL_FACETS.map((kind) => {
                    const f = a.facets.find((x) => x.kind === kind);
                    return <Pill key={kind} kind={f?.present ? 'ok' : 'neutral'}>{kind}{f?.present ? '' : ' —'}</Pill>;
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

function LiveView() {
  const [agents, setAgents] = useState<LiveAgent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setAgents(null); setErr(null); loadLive().then(setAgents).catch((e) => setErr(String(e))); }, []);

  return (
    <>
      <p className="eyebrow">Live · on-chain</p>
      <h1 style={{ marginBottom: '.4rem' }}>Real agents from available public data</h1>
      <p className="muted" style={{ marginBottom: '1rem' }}>
        Read directly from <b>AgentRegistryBase</b> + <b>agent-naming</b> on Base Sepolia. An agent surfaces from whatever public on-chain data exists — its <b>name</b> resolves now; its <b>registry entry</b> is written during onboarding. No enumeration (that's the indexer's job) — these are specific watched agents.
      </p>
      <p className="cite" style={{ marginBottom: '1.2rem' }}>
        registry <code>{short(LIVE.registry, 10)}</code> · resolver <code>{short(LIVE.resolver, 8)}</code> · chain {LIVE.chainId}
      </p>

      {err ? <div className="card"><Pill kind="err">RPC error</Pill> <span className="muted">{err}</span></div>
        : !agents ? <div className="row"><Spinner /> <span className="muted">Reading the chain…</span></div>
        : agents.map((a) => (
          <div key={a.watched.entryId} className="card">
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
              <div>
                <h3>{a.reverseName ?? a.watched.name}</h3>
                <p className="muted" style={{ fontSize: '.82rem', margin: '.2rem 0 0' }}>{a.watched.note}</p>
              </div>
              {a.error ? <Pill kind="err">read error</Pill>
                : a.entry ? <StatusPill status={a.entry.status} live={a.entry.live} />
                : a.subjectAgent ? <Pill kind="warn">named · entry pending onboarding</Pill>
                : <Pill kind="neutral">unresolved</Pill>}
            </div>
            <dl className="kv" style={{ marginTop: '.7rem' }}>
              <dt>name</dt><dd>{a.watched.name} {a.reverseName && a.reverseName !== a.watched.name ? <span className="muted">(reverse: {a.reverseName})</span> : null}</dd>
              <dt>subjectAgent</dt><dd className="mono">{a.subjectAgent ? short(a.subjectAgent, 12) : '—'}</dd>
              <dt>registry entry</dt><dd>{a.entry ? <><Pill kind={a.entry.live ? 'ok' : 'warn'}>{a.entry.status}{a.entry.live ? '' : ' · not live'}</Pill></> : <span className="muted">not yet written — added during onboarding</span>}</dd>
              {a.entry && <><dt>cardHash</dt><dd className="mono">{short(a.entry.cardHash, 12)}</dd></>}
              {a.entry && <><dt>bindingProofHash</dt><dd className="mono">{short(a.entry.bindingProofHash, 12)}</dd></>}
              {a.entry && a.entry.expiresAt > 0 && <><dt>expiresAt</dt><dd>{new Date(a.entry.expiresAt * 1000).toISOString()}</dd></>}
              <dt>watched entryId</dt><dd className="mono">{a.watched.entryId}</dd>
            </dl>
            {a.entry && <p className="cite" style={{ marginTop: '.6rem' }}>On-chain facts. Full client-side re-verify of the card + binding proof needs their published bodies (the registrant publishes them by hash); the <b>fixtures</b> tab demonstrates that re-verification path with bodies in hand.</p>}
          </div>
        ))}
    </>
  );
}

function FindingsView({ records, onOpen }: { records: AgentRecord[]; onOpen: (slug: string) => void }) {
  const name = (slug: string) => records.find((r) => r.slug === slug)?.name ?? slug;
  return (
    <>
      <div className="admin-bar" style={{ marginBottom: '1.2rem' }}>🛡 ADMIN · ap:abox:pentest exposure findings — restricted; not part of public discovery.</div>
      <p className="muted" style={{ marginBottom: '1rem' }}>Findings projected into the restricted A-box alongside public discovery facts. Each cites an affected agent + evidence.</p>
      {EXPOSURE_FINDINGS.map((f) => (
        <div key={f.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '.5rem' }}>
            <h3 style={{ fontSize: '1rem' }}>{f.title}</h3>
            <div className="row" style={{ gap: '.4rem' }}>
              <span className={`pill sev-${f.severity}`}>{f.severity}</span>
              <Pill kind={f.status === 'open' ? 'err' : f.status === 'triaged' ? 'warn' : 'ok'}>{f.status}</Pill>
            </div>
          </div>
          <p className="muted" style={{ fontSize: '.86rem', margin: '.5rem 0 .6rem' }}>{f.detail}</p>
          <p className="cite">affects <button className="btn" style={{ padding: '.1rem .5rem', fontSize: '.78rem' }} onClick={() => onOpen(f.affectsSlug)}>{name(f.affectsSlug)}</button> · <span className="mono">{f.id}</span></p>
        </div>
      ))}
    </>
  );
}
