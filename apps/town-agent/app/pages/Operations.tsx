// THE PULSE — spec 434 §10 / spec 436 §5.3. `/operations` keeps its URL and becomes the operations center: one tab per
// thing an operator comes to know — the Town (services, chain, rules: today's page), the Estates (each estate's heartbeat),
// the Homes (the estates' run mix), Inference and Chain (the two metered gateways), Applications. Everything here is
// aggregate and public: probes, rollups, counts. Nothing here is anybody's Home; a person's truth is reached by link.
import { useEffect, useState, type ReactNode } from 'react';
import { Band, Link, Loading, useRoute, Chip, Stat, Sparkline, UpStrip, WindowPicker, Bar, fmtInt, fmtUsd, fmtMs, fmtAgo, type Loaded, type PulseWindow } from '@ap-town/town-ui';
import { InfraTab, PerformanceTab, type EstatePerf, type PerfView } from '../pulse/InfraTabs';
import type { ContextAgentView, TownData } from '../types';
import type { PulseReadV1 } from '../../worker/pulse';
import { Health } from '../ui';
import { Ask } from '../pulse/Ask';

export type Tab = 'town' | 'estates' | 'homes' | 'inference' | 'chain' | 'apps' | 'infra' | 'performance';
const TABS: Array<[Tab, string]> = [['town', 'Town'], ['estates', 'Estates'], ['homes', 'Homes'], ['inference', 'Inference'], ['chain', 'Chain'], ['apps', 'Applications'], ['infra', 'Infra'], ['performance', 'Performance']];
type Window = PulseWindow;
/** The Pulse read plus spec 437's performance view (`/api/pulse` returns both). */
type PulseView = PulseReadV1 & { performance: PerfView };
const TOKEN_KEY = 'ap-town.ops-token';
const readToken = (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };

/** `/api/pulse` for a window; with the operator's token the read carries cost and metrics (spec 437 / 434 §10). */
function usePulse(window: Window, token: string | null): Loaded<PulseView> {
  const [v, setV] = useState<Loaded<PulseView>>({ state: 'loading' });
  useEffect(() => {
    let live = true; setV({ state: 'loading' });
    fetch(`/api/pulse?window=${window}`, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
      .then(async (r) => { const body = (await r.json().catch(() => null)) as PulseView | null; if (!live) return; setV(r.ok && body ? { state: 'ready', data: body } : { state: 'error', status: r.status, error: { error: `http_${r.status}` } }); })
      .catch((e) => { if (live) setV({ state: 'error', status: 0, error: { error: 'unreachable', detail: String((e as Error).message) } }); });
    return () => { live = false; };
  }, [window, token]);
  return v;
}

/** The operator's token, kept in this tab's session only — it unlocks a READ; it grants nothing. */
function OperatorToken({ token, onChange, detail }: { token: string | null; onChange: (t: string | null) => void; detail: boolean }): ReactNode {
  const [open, setOpen] = useState(false); const [draft, setDraft] = useState('');
  if (token) return <span className="operator"><Chip tone={detail ? 'ok' : 'warn'}>{detail ? 'operator view' : 'token not accepted'}</Chip> <button type="button" className="linkish" onClick={() => { try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* no storage */ } onChange(null); }}>forget</button></span>;
  if (!open) return <button type="button" className="linkish" onClick={() => setOpen(true)}>Operator</button>;
  return (
    <form className="operator" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (!t) return; try { sessionStorage.setItem(TOKEN_KEY, t); } catch { /* no storage */ } onChange(t); setDraft(''); setOpen(false); }}>
      <input type="password" className="ask-q ask-q-short" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="town ops token" aria-label="Town ops token" autoComplete="off" />
      <button type="submit" className="button button-quiet">Read as operator</button>
    </form>
  );
}

interface ChainSummary { totals: { requests: number; reads: number; writes: number; denied: Record<string, number>; cacheHitRate: number; upstreamErrors: number }; latency: { upstreamP50Ms: number; upstreamP95Ms: number }; byToken: Array<{ app: string; estate: string | null; kind: string; requests: number; reads: number; writes: number; denied: number; p95Ms: number; limits?: { readRps: number; writeRps: number } }>; byEstate: Array<{ estate: string; requests: number }>; byMethod: Array<{ method: string; count: number; cacheHitRate: number; p95Ms: number }>; chain: { head: number | null; headAt: string | null; blockRateS: number | null; generation: string; nodeHealthy: boolean } }
interface InfSlice { key: string; requests: number; answered: number; failed: number; refused: number; tokensIn: number; tokensOut: number; costMicroUsd: number; fallbacks: number; latencyP50Ms: number; latencyP95Ms: number }
interface InfSummary { totals: InfSlice; byClient: InfSlice[]; byProfile: InfSlice[]; byProvider: InfSlice[]; byModel: InfSlice[]; byEstate: InfSlice[]; pendingReconciliation: number }
interface Heartbeat { estate: string; at: string; generation: string; versions: Record<string, string>; agents: { person: number; org: number; service: number }; homesActive24h: number; runs: { started: number; completed: number; parked: number; failed: number; canceled: number }; parkedForSignature: number; modelCalls: number; tokensIn: number; tokensOut: number; inferenceMicroUsd: number | null; vaultCalls: number; doRequests: number; askLatencyP95Ms: number | null; evidenceCoverage?: { runs: number; complete: number; incomplete: number; unknown: number } }

export function Operations({ t, tab = 'town' }: { t: TownData; tab?: Tab }): ReactNode {
  const [window, setWindow] = useState<Window>('24h');
  const [token, setToken] = useState<string | null>(readToken);
  const pulse = usePulse(window, token);
  const { go } = useRoute();
  const wide = tab === 'infra' || tab === 'performance';
  return (
    <>
      <section className="hero">
        <h1>Operations.</h1>
        <p className="lede">How the {t.town} town is doing — now and over the last {window}. One manifest describes it, every service is probed, the two gateways report what they metered, every estate reports its counts. Nothing here is anybody's Home.</p>
        {pulse.state === 'ready' && (
          <Band
            figures={[
              (() => { const d = t.services.filter((s) => s.signals.healthy === 'down').length; const u = t.services.filter((s) => s.signals.healthy === 'up' || s.signals.healthy === 'self').length; const pr = t.services.filter((s) => s.signals.healthy !== 'unobserved').length;
                return d > 0 ? { label: 'Services answering', value: `${u} of ${pr}`, sub: `${d} not answering`, tone: 'bad' as const }
                             : { label: 'Services answering', value: `${u} of ${pr}`, sub: 'probed just now', tone: 'ok' as const }; })(),
              (() => { const src = pulse.data.performance.sources ?? []; const okN = src.filter((x) => x.ok).length;
                return { label: 'Infra sources', value: src.length ? `${okN} of ${src.length}` : '—', sub: src.length ? (okN === src.length ? 'all reading' : `${src.length - okN} not configured`) : 'none yet', ...(src.length && okN < src.length ? { tone: 'warn' as const } : {}) }; })(),
              { label: 'Last sample', value: pulse.data.sampledAt ? fmtAgo(pulse.data.sampledAt) : '—', sub: pulse.data.sampledAt ? 'the sampler runs every 5 min' : 'no sample yet' },
              { label: 'This window', value: window, sub: pulse.data.performance.detail ? 'operator read' : 'public read' },
            ]}
          />
        )}
      </section>
      <nav className="tabs" aria-label="Pulse">
        {TABS.map(([id, label]) => <Link key={id} href={id === 'town' ? '/operations' : `/operations/${id}`} className={`tab${tab === id ? ' is-on' : ''}`} aria-current={tab === id ? 'page' : undefined}>{label}</Link>)}
        <span className="tabs-right"><OperatorToken token={token} onChange={setToken} detail={pulse.state === 'ready' && pulse.data.performance.detail} /> <WindowPicker value={window} windows={wide ? ['24h', '7d', '30d', '90d'] : ['24h', '7d', '30d']} onChange={(w) => { setWindow(w); if (tab !== 'town') go(`/operations/${tab}`); }} /></span>
      </nav>
      <Loading v={pulse} what="Reading the pulse">{(p) => (
        <>
          {p.sampledAt === null && <div className="banner banner-warn"><strong>No samples yet.</strong> The sampler runs every five minutes; until the first pass, this page shows the live probes only.</div>}
          {tab === 'town' && <TownTab t={t} p={p} />}
          {tab === 'estates' && <EstatesTab t={t} p={p} />}
          {tab === 'homes' && <HomesTab t={t} p={p} />}
          {tab === 'inference' && <InferenceTab p={p} />}
          {tab === 'chain' && <ChainTab t={t} p={p} />}
          {tab === 'apps' && <AppsTab t={t} p={p} />}
          {tab === 'infra' && <InfraTab t={t} perf={p.performance} />}
          {tab === 'performance' && <PerformanceTab t={t} perf={p.performance} chain={p.chain.latest?.ok ? (p.chain.latest.payload as ChainSummary) : null} />}
        </>
      )}</Loading>
    </>
  );
}

function TownTab({ t, p }: { t: TownData; p: PulseReadV1 }): ReactNode {
  const chain = p.chain.latest?.payload as ChainSummary | null | undefined;
  return (
    <>
      <section className="stats">
        <Stat label="Services up" value={`${t.services.filter((s) => s.signals.healthy === 'up' || s.signals.healthy === 'self').length} / ${t.services.filter((s) => s.signals.healthy !== 'unobserved').length}`} sub={`${t.services.length} listed`} />
        <Stat label="Chain head" value={chain?.chain.head !== null && chain?.chain.head !== undefined ? fmtInt(chain.chain.head) : '—'} sub={chain?.chain.blockRateS ? `a block every ${chain.chain.blockRateS.toFixed(1)} s` : 'block rate unknown'} tone={chain ? (chain.chain.nodeHealthy ? 'ok' : 'bad') : 'muted'} />
        <Stat label="Contract generation" value={t.chain.generation} />
        <Stat label="Names" value={t.names ? fmtInt(t.names.total) : '—'} sub={t.names ? `across ${t.names.roots.length} roots` : 'the naming service did not answer'} />
        <Stat label="Last sample" value={fmtAgo(p.sampledAt)} sub="every 5 minutes" tone={p.sampledAt && Date.now() - Date.parse(p.sampledAt) < 12 * 60_000 ? 'ok' : 'warn'} />
      </section>
      <section>
        <h2>The town</h2>
        <p className="lede">The town is a context like its estates (spec 436 §4) — its own record, its own agent. This is who answers for it, and the card that names the door a question goes to.</p>
        <div className="cards"><TownCard t={t} p={p} /></div>
      </section>
      <Ask scope="town" agents={t.agents} />
      <section>
        <h2>Every listed service</h2>
        <table className="table">
          <thead><tr><th scope="col">Service</th><th scope="col">Kind</th><th scope="col">Now</th><th scope="col">Over the window</th><th scope="col">Host</th><th scope="col">Deployed from</th></tr></thead>
          <tbody>
            {t.services.map((s) => {
              const series = p.services[s.id]?.series ?? [];
              return (
                <tr key={s.id}>
                  <th scope="row"><Link href={`/service/${s.id}`}>{s.id}</Link></th>
                  <td>{s.kind}</td>
                  <td><Health s={s} /></td>
                  <td>{series.length ? <UpStrip cells={series.map((x) => x.up)} label={`${s.id}: ${series.filter((x) => x.up === true).length} of ${series.length} intervals up`} /> : <span className="quiet">not sampled</span>}</td>
                  <td className="mono">{s.hosts[0] ?? '—'}</td>
                  <td>{s.repo}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="quiet">"Now" is one unauthenticated GET per service when this page was read; "over the window" is the sampler's record, one cell per interval. A service with no probe is listed, not judged.</p>
      </section>
      <section>
        <h2>The chain</h2>
        <dl className="kv">
          <dt>Chain id</dt><dd>{t.chain.id}</dd>
          <dt>Contract generation</dt><dd>{t.chain.generation}</dd>
          <dt>Public RPC</dt><dd className="mono">{t.chain.rpc} <span className="quiet">(per-app tokens; read-only by default — the Chain tab shows their use)</span></dd>
          <dt>Estates</dt><dd>{t.estates.map((e) => <Link key={e.id} href="/operations/estates">{e.id}</Link>)}</dd>
          {/* TWO DIFFERENT AGENTS, and reading them as one is how "ask the town" ends up pointed at the portal.
              This Worker describes the town and keeps no record; the context agent has the vault with the day's
              record in it and is the one the Ask talks to. Both are on the town's card at the top of this tab. */}
          <dt>The portal's agent card</dt><dd><a href={t.card} rel="noreferrer" className="mono break">{t.card}</a> <span className="quiet">(this Worker — it describes the town; it keeps no record)</span></dd>
        </dl>
      </section>
      <section>
        <h2>Rules the town keeps</h2>
        <ul className="plain">
          <li>Nothing in the town grants. A resolver returns an address, a registry lists, a graph holds what the chain can prove, a gateway meters.</li>
          <li>No estate is privileged. A town service reaches an estate only through a lane the manifest declares; a second estate is a manifest edit.</li>
          <li>The public graph holds only what anyone could rebuild from the chain; the indexer is its only writer.</li>
          <li>Four signals, never a score: listed · healthy · compatible — and "authorized" is the caller's own delegation.</li>
          <li>The Pulse is counts, never a person: an estate reports numbers over a token; its people's records stay in their vaults.</li>
        </ul>
        <p className="quiet">The manifest, the checks and the deploy record: <a href="https://github.com/agentictrustlabs/ap-town" rel="noreferrer">agentictrustlabs/ap-town</a>. The design: spec 434 (the Pulse), spec 436 (the four contexts).</p>
      </section>
    </>
  );
}

/**
 * WHO ANSWERS FOR A CONTEXT, AND AT WHICH DOOR — spec 436 §4/§5.5. One operator, four contexts, and each one
 * answers for itself through an agent of its own: the question is not "which server is this" but "whose record
 * is this, and who speaks from it". So the name on the chain comes first (it is the stable one), the card that
 * names the A2A door second, and the door itself third. `null` says not chartered — never a name that answers nothing.
 */
function WhoAnswers({ agent, name, nameLabel, a2a, note }: {
  agent: ContextAgentView | null;
  name?: string | undefined;
  nameLabel: string;
  a2a?: string | undefined;
  note?: string | undefined;
}): ReactNode {
  return (
    <>
      <dl className="kv">
        <dt>{nameLabel}</dt><dd>{name ? <span className="mono">{name}</span> : <span className="quiet">not named in the manifest</span>}</dd>
        <dt>Answers the Ask</dt><dd>{agent ? <span className="mono">{agent.name}</span> : <span className="quiet">no context agent chartered yet (spec 436 §5.5 T1)</span>}</dd>
        <dt>Agent card</dt><dd>{agent?.card ? <a href={agent.card} rel="noreferrer" className="mono break">{agent.card}</a> : <span className="quiet">—</span>}</dd>
        {a2a ? <><dt>A2A door</dt><dd className="mono break">{a2a}</dd></> : null}
      </dl>
      {note ? <p className="quiet">{note}</p> : null}
    </>
  );
}

/**
 * THE TOWN, ON THE SAME PAGE AS ITS ESTATES and in the same shape — because it is one more context with one
 * more record and one more agent, not the frame the others sit in. What it keeps that no estate does: the
 * services every estate shares, and the town of names.
 */
function TownCard({ t, p }: { t: TownData; p: PulseReadV1 }): ReactNode {
  const fresh = p.sampledAt !== null && Date.now() - Date.parse(p.sampledAt) < 12 * 60_000;
  return (
    <article className="card estate-card">
      <span className="card-head">
        <span><span className="card-title">{t.town}</span><br /><span className="card-sub">the town — what every estate here shares</span></span>
        {fresh ? <Chip tone="ok">live · {fmtAgo(p.sampledAt)}</Chip> : <Chip tone="muted">{p.sampledAt ? `stale · ${fmtAgo(p.sampledAt)}` : 'no sample yet'}</Chip>}
      </span>
      {/* No figures here: the band at the top of this tab already carries them, and a number said twice on
          one page is a number a reader has to reconcile. This card answers WHO, which nothing else did. */}
      <WhoAnswers agent={t.agents?.town ?? null} name={t.town} nameLabel="Town" />
      <span className="card-foot"><a href={t.card} rel="noreferrer">The portal's own agent card</a><span className="mono">agentictrustlabs/ap-town</span></span>
    </article>
  );
}

function EstatesTab({ t, p }: { t: TownData; p: PulseView }): ReactNode {
  return (
    <section>
      <h2>Estates</h2>
      <Ask scope="estate" estates={t.estates} agents={t.agents} />
      <p className="lede">One card per estate on this chain — each a context with its own record and its own agent (spec 436 §4; the town's own card is on the Town tab). Each estate reports its own counts to the town — agents, homes, runs, spend — over a token the estate issued. The estate's people and their records stay at the estate; a stale card is dark, never guessed. These are the operations numbers; everything else about an estate — where it lives, what it may name, whose keys hold it, its MCP servers, which agents are its — is on its own page.</p>
      <div className="cards">
        {t.estates.map((e) => {
          const st = p.estates[e.id];
          const hb = st?.latest?.ok ? (st.latest.payload as Heartbeat) : null;
          // Spec 437 — cost over the window and run p95, from the performance read (amounts are the operator's).
          const cpr = p.performance?.costPerCompletedRun[e.id]; const prov = (p.performance?.provenance[e.id] ?? null) as EstatePerf | null;
          return (
            <article key={e.id} className={`card estate-card${st?.stale ? ' is-stale' : ''}`}>
              <span className="card-head"><span><span className="card-title">{e.id}</span><br /><span className="card-sub mono">{e.home.replace(/^https?:\/\//, '')}</span></span>{st?.stale ? <Chip tone="muted">{st?.latest ? `stale · ${fmtAgo(st.latest.at)}` : 'no heartbeat yet'}</Chip> : <Chip tone="ok">live · {fmtAgo(st?.latest?.at)}</Chip>}</span>
              {hb ? (
                <>
                  <div className="stats stats-tight">
                    <Stat label="People" value={fmtInt(hb.agents.person)} /><Stat label="Organizations" value={fmtInt(hb.agents.org)} /><Stat label="Services" value={fmtInt(hb.agents.service)} />
                    <Stat label="Homes active 24h" value={fmtInt(hb.homesActive24h)} />
                    <Stat label="Runs 24h" value={fmtInt(hb.runs.started)} sub={`${fmtInt(hb.runs.completed)} completed · ${fmtInt(hb.runs.failed)} failed`} tone={hb.runs.failed > hb.runs.completed / 4 ? 'warn' : undefined} />
                    <Stat label="Waiting for a signature" value={fmtInt(hb.parkedForSignature)} />
                    <Stat label="Ask p95" value={fmtMs(hb.askLatencyP95Ms)} />
                    {/* Spec 438 §4 — how much of this estate's work left a complete record. Three numbers, not a
                        percentage: `unknown` is runs that stopped before their plan finished (parked, denied,
                        canceled), which is the authority plane WORKING. A single ratio would fall whenever the
                        estate refused something correctly, and a tile that punishes correct behaviour gets ignored.
                        Absent when the estate has not computed it — absent is said, never shown as zero. */}
                    {hb.evidenceCoverage
                      ? <Stat label="Records complete" value={`${fmtInt(hb.evidenceCoverage.complete)} / ${fmtInt(hb.evidenceCoverage.runs)}`}
                          sub={<span>{fmtInt(hb.evidenceCoverage.incomplete)} incomplete · {fmtInt(hb.evidenceCoverage.unknown)} stopped early (not a gap)</span>} />
                      : <Stat label="Records complete" value="not reported" sub={<span>this estate has not computed its coverage</span>} />}
                    <Stat label="Model calls" value={fmtInt(hb.modelCalls)} sub={hb.inferenceMicroUsd !== null ? fmtUsd(hb.inferenceMicroUsd) : 'spend: not a gateway client yet'} />
                    <Stat label="Cost over the window" value={cpr && p.performance.detail ? (cpr.infraMicroUsd === null && !cpr.inferenceMicroUsd ? '—' : fmtUsd(cpr.inferenceMicroUsd + (cpr.infraMicroUsd ?? 0))) : 'operator'} sub={cpr && p.performance.detail ? `${cpr.microUsd !== null ? `${fmtUsd(cpr.microUsd)} per completed run` : 'per run: not yet'}${cpr.complete ? '' : ' · incomplete'}` : 'amounts are the operator\'s read'} tone={cpr && !cpr.complete ? 'warn' : undefined} />
                    <Stat label="Run p95" value={fmtMs(prov?.runDurationMs.p95)} sub={prov ? `${prov.runDurationMs.count} runs in the block` : 'no performance block yet'} />
                  </div>
                  <p className="quiet">Generation {hb.generation}{Object.keys(hb.versions).length ? ` · ${Object.entries(hb.versions).map(([k, v]) => `${k} ${v}`).join(' · ')}` : ''}. Runs over the window: <Sparkline points={st!.series.map((x) => x.runsCompleted)} label="runs completed per interval" /></p>
                </>
              ) : (
                <p className="quiet">{st?.latest?.error ?? 'This estate has not reported yet. Its runtime answers GET /ops/heartbeat under a token the town holds (spec 434 §10.2).'}</p>
              )}
              <WhoAnswers
                agent={t.agents?.estates[e.id] ?? null}
                name={e.estateName}
                nameLabel="Estate name on chain"
                a2a={e.a2a}
                note={e.agentZone
                  ? undefined
                  : `This estate serves no agent zone of its own, so its agents are reached through its edge by name; the card above is on the zone the Ask is configured with, not ${e.id}'s.`}
              />
              <span className="card-foot"><Link href={`/estate/${e.id}`}>The {e.id} estate &rarr;</Link><a href={e.home} rel="noreferrer">its Home</a><span className="mono">{e.repo}</span></span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function HomesTab({ t, p }: { t: TownData; p: PulseReadV1 }): ReactNode {
  return (
    <section>
      <h2>Homes</h2>
      <p className="lede">The estates' run mix over the window — completed, parked, failed — and what they cost. Counts only: which person asked what is that person's, at their Home.</p>
      {t.estates.map((e) => {
        const st = p.estates[e.id];
        const hb = st?.latest?.ok ? (st.latest.payload as Heartbeat) : null;
        if (!hb) return <p key={e.id} className="quiet">{e.id}: no heartbeat yet.</p>;
        return (
          <div key={e.id} className="panel">
            <h3>{e.id}</h3>
            <div className="stats stats-tight">
              <Stat label="Completed" value={fmtInt(hb.runs.completed)} sub={<Sparkline points={st!.series.map((x) => x.runsCompleted)} />} tone="ok" />
              <Stat label="Parked" value={fmtInt(hb.runs.parked)} sub={<Sparkline points={st!.series.map((x) => x.runsParked)} />} />
              <Stat label="Failed" value={fmtInt(hb.runs.failed)} sub={<Sparkline points={st!.series.map((x) => x.runsFailed)} />} tone={hb.runs.failed ? 'warn' : undefined} />
              <Stat label="Canceled" value={fmtInt(hb.runs.canceled)} />
              <Stat label="Vault calls" value={fmtInt(hb.vaultCalls)} sub={<Sparkline points={st!.series.map((x) => x.vaultCalls)} />} />
              <Stat label="DO requests" value={fmtInt(hb.doRequests)} />
              <Stat label="Tokens" value={`${fmtInt(hb.tokensIn)} in · ${fmtInt(hb.tokensOut)} out`} />
              <Stat label="Ask p95" value={fmtMs(hb.askLatencyP95Ms)} sub={<Sparkline points={st!.series.map((x) => x.askP95Ms)} />} />
            </div>
            <p className="quiet">The per-agent truth is at the estate: <a href={`${e.home.replace(/\/$/, '')}/estate`} rel="noreferrer">open its operator view</a>.</p>
          </div>
        );
      })}
    </section>
  );
}

function InferenceTab({ p }: { p: PulseReadV1 }): ReactNode {
  const s = p.inference.latest?.ok ? (p.inference.latest.payload as InfSummary) : null;
  return (
    <section>
      <h2>Inference</h2>
      <p className="lede">The town's model gateway (inference.svc): spend and tokens by client, profile, provider and model; fallbacks; budget utilisation. Every number is a receipt the gateway wrote; a profile is the policy unit, a model is a switch.</p>
      {!s ? <p className="quiet">{p.inference.latest?.error ? `The gateway's summary could not be read: ${p.inference.latest.error}.` : 'No gateway sample yet.'}</p> : (
        <>
          <div className="stats">
            <Stat label="Requests" value={fmtInt(s.totals.requests)} sub={<Sparkline points={p.inference.series.map((x) => x.requests)} />} />
            <Stat label="Spend" value={fmtUsd(s.totals.costMicroUsd)} sub={<Sparkline points={p.inference.series.map((x) => x.costMicroUsd)} />} />
            <Stat label="Tokens" value={`${fmtInt(s.totals.tokensIn)} in · ${fmtInt(s.totals.tokensOut)} out`} />
            <Stat label="Fallbacks" value={fmtInt(s.totals.fallbacks)} sub="declared, each receipted" tone={s.totals.fallbacks ? 'warn' : undefined} />
            <Stat label="Failed · refused" value={`${fmtInt(s.totals.failed)} · ${fmtInt(s.totals.refused)}`} tone={s.totals.failed ? 'warn' : undefined} />
            <Stat label="Latency p50 · p95" value={`${fmtMs(s.totals.latencyP50Ms)} · ${fmtMs(s.totals.latencyP95Ms)}`} />
            <Stat label="Pending reconciliation" value={fmtInt(s.pendingReconciliation)} sub="held reservations" tone={s.pendingReconciliation ? 'warn' : undefined} />
          </div>
          <SliceTable title="By client" rows={s.byClient} keyLabel="Principal" mono />
          <SliceTable title="By profile" rows={s.byProfile} keyLabel="Profile" />
          <SliceTable title="By provider / model" rows={s.byModel} keyLabel="Model" />
          <SliceTable title="By estate" rows={s.byEstate} keyLabel="Estate" />
        </>
      )}
    </section>
  );
}

function SliceTable({ title, rows, keyLabel, mono }: { title: string; rows: InfSlice[]; keyLabel: string; mono?: boolean }): ReactNode {
  if (!rows.length) return null;
  return (
    <>
      <h3>{title}</h3>
      <table className="table">
        <thead><tr><th scope="col">{keyLabel}</th><th scope="col">Requests</th><th scope="col">Answered</th><th scope="col">Failed</th><th scope="col">Fallbacks</th><th scope="col">Tokens in / out</th><th scope="col">Spend</th><th scope="col">p95</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><th scope="row" className={mono ? 'mono break' : undefined}>{r.key}</th><td>{fmtInt(r.requests)}</td><td>{fmtInt(r.answered)}</td><td>{fmtInt(r.failed)}</td><td>{fmtInt(r.fallbacks)}</td><td>{fmtInt(r.tokensIn)} / {fmtInt(r.tokensOut)}</td><td>{fmtUsd(r.costMicroUsd)}</td><td>{fmtMs(r.latencyP95Ms)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

function ChainTab({ t, p }: { t: TownData; p: PulseReadV1 }): ReactNode {
  const s = p.chain.latest?.ok ? (p.chain.latest.payload as ChainSummary) : null;
  return (
    <section>
      <h2>Chain</h2>
      <p className="lede">The chain gateway in front of chain {t.chain.id}: requests by token, estate and method; denials by reason; cache; upstream latency; the head and the block rate. Each token is an application's, attributed to its estate and kind.</p>
      {!s ? <p className="quiet">{p.chain.latest?.error ? `The gateway's summary could not be read: ${p.chain.latest.error}.` : 'No gateway sample yet.'}</p> : (
        <>
          <div className="stats">
            <Stat label="Requests" value={fmtInt(s.totals.requests)} sub={<Sparkline points={p.chain.series.map((x) => x.requests)} />} />
            <Stat label="Reads · writes" value={`${fmtInt(s.totals.reads)} · ${fmtInt(s.totals.writes)}`} />
            <Stat label="Denied" value={fmtInt(Object.values(s.totals.denied).reduce((a, b) => a + b, 0))} sub={Object.entries(s.totals.denied).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ') || 'none'} tone={Object.values(s.totals.denied).some((n) => n) ? 'warn' : undefined} />
            <Stat label="Cache hit rate" value={`${Math.round(s.totals.cacheHitRate * 100)}%`} />
            <Stat label="Upstream p50 · p95" value={`${fmtMs(s.latency.upstreamP50Ms)} · ${fmtMs(s.latency.upstreamP95Ms)}`} sub={<Sparkline points={p.chain.series.map((x) => x.p95Ms)} />} />
            <Stat label="Upstream errors" value={fmtInt(s.totals.upstreamErrors)} tone={s.totals.upstreamErrors ? 'bad' : undefined} />
            <Stat label="Head" value={s.chain.head !== null ? fmtInt(s.chain.head) : '—'} sub={s.chain.blockRateS ? `a block every ${s.chain.blockRateS.toFixed(1)} s` : s.chain.headAt ? `seen ${fmtAgo(s.chain.headAt)}` : 'no eth_blockNumber passed yet'} tone={s.chain.nodeHealthy ? 'ok' : 'warn'} />
          </div>
          <h3>By token</h3>
          <table className="table">
            <thead><tr><th scope="col">App</th><th scope="col">Estate</th><th scope="col">Kind</th><th scope="col">Requests</th><th scope="col">Reads · writes</th><th scope="col">Denied</th><th scope="col">p95</th><th scope="col">Limits (r/w per s)</th></tr></thead>
            <tbody>{s.byToken.map((r) => <tr key={r.app}><th scope="row" className="mono">{r.app}</th><td>{r.estate ?? <span className="quiet">—</span>}</td><td>{r.kind}</td><td>{fmtInt(r.requests)}</td><td>{fmtInt(r.reads)} · {fmtInt(r.writes)}</td><td>{fmtInt(r.denied)}</td><td>{fmtMs(r.p95Ms)}</td><td>{r.limits ? `${r.limits.readRps} / ${r.limits.writeRps}` : <span className="quiet">—</span>}</td></tr>)}</tbody>
          </table>
          {s.byEstate.length > 0 && (<><h3>By estate</h3><table className="table"><thead><tr><th scope="col">Estate</th><th scope="col">Requests</th></tr></thead><tbody>{s.byEstate.map((r) => <tr key={r.estate}><th scope="row">{r.estate}</th><td>{fmtInt(r.requests)}</td></tr>)}</tbody></table></>)}
          <h3>Top methods</h3>
          <table className="table">
            <thead><tr><th scope="col">Method</th><th scope="col">Count</th><th scope="col">Cache hit rate</th><th scope="col">p95</th></tr></thead>
            <tbody>{s.byMethod.map((m) => <tr key={m.method}><th scope="row" className="mono">{m.method}</th><td>{fmtInt(m.count)}</td><td>{Math.round(m.cacheHitRate * 100)}%</td><td>{fmtMs(m.p95Ms)}</td></tr>)}</tbody>
          </table>
        </>
      )}
    </section>
  );
}

function AppsTab({ t, p }: { t: TownData; p: PulseReadV1 }): ReactNode {
  const apps = t.services.filter((s) => s.kind === 'application');
  const chain = p.chain.latest?.ok ? (p.chain.latest.payload as ChainSummary) : null;
  const inf = p.inference.latest?.ok ? (p.inference.latest.payload as InfSummary) : null;
  return (
    <section>
      <h2>Applications</h2>
      <p className="lede">The listed applications — on the town's identity and naming, using estate endpoints and the two gateways under their own tokens and app keys. Listed is not authorized.</p>
      {apps.length === 0 ? <p className="quiet">No applications are listed in the manifest.</p> : (
        <table className="table">
          <thead><tr><th scope="col">Application</th><th scope="col">Now</th><th scope="col">Over the window</th><th scope="col">Chain requests</th><th scope="col">Inference requests</th><th scope="col">Hosts</th></tr></thead>
          <tbody>{apps.map((a) => {
            const series = p.services[a.id]?.series ?? [];
            const chainReq = chain?.byToken.filter((r) => r.kind === 'application' && (r.app === a.id || r.app.startsWith(a.id))).reduce((n, r) => n + r.requests, 0) ?? 0;
            const infReq = inf?.byClient.filter((r) => r.key.toLowerCase().includes(a.id)).reduce((n, r) => n + r.requests, 0) ?? 0;
            return <tr key={a.id}><th scope="row"><Link href={`/service/${a.id}`}>{a.id}</Link></th><td><Health s={a} /></td><td>{series.length ? <UpStrip cells={series.map((x) => x.up)} /> : <span className="quiet">not sampled</span>}</td><td>{fmtInt(chainReq)}</td><td>{fmtInt(infReq)}</td><td className="mono">{a.hosts.join(', ')}</td></tr>;
          })}</tbody>
        </table>
      )}
      <p className="quiet">Chain and inference usage attribute by the token's or client's name; an application whose token is named differently shows nothing here until its row is attributed (spec 436 §6.1).</p>
    </section>
  );
}
