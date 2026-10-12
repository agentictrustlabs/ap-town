// WHAT IS BEHIND THIS ENDPOINT — spec 437 I4, on the page where a reader meets the URL.
//
// A reader on an agent's page has an A2A door and an MCP door and nothing else. The questions they actually
// have are: what runs there, where is its source, and is it all right. This answers all three from the two
// places that can answer them honestly — the manifest, which DECLARES which Worker serves which host, and
// the town MCP, which is the only thing in the town holding a platform read credential.
//
// THREE THINGS IT IS CAREFUL ABOUT.
//
//   An UNATTRIBUTED endpoint is said, not hidden. `demo-gc-pg.r-pedersen.workers.dev` looks exactly like a
//   Worker name and is on an account this town does not list; printing a guessed Worker there would be a
//   confident falsehood about where somebody's agent runs.
//
//   NUMBERS ARE THE OPERATOR'S (spec 437). Without the town ops token the readings are withheld and say so.
//   Nothing is zeroed to fill the space: a zero looks like a measurement and gets believed.
//
//   AND NONE OF IT IS AUTHORITY. Knowing which Worker serves an agent's door says nothing about whether
//   anybody may send it anything, which is decided inside, against the chain, on every call.
import { useEffect, useState, type ReactNode } from 'react';
import { Chip, fmtAgo, fmtInt, fmtMs } from '@ap-town/town-ui';
import type { EndpointInfo } from '../types';

const TOKEN_KEY = 'ap-town.ops-token';
const readToken = (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };

const HOW_WORDS: Record<EndpointInfo['attribution']['how'], string> = {
  'mcp-server': 'a declared MCP server',
  'service-host': 'a listed service of this town',
  'estate-lane': 'an estate’s own lane',
  'estate-zone': 'an agent host under an estate’s zone',
  'estate-door': 'one of an estate’s three doors',
  unattributed: 'not declared by this town',
};

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted'> = { up: 'ok', degraded: 'warn', down: 'bad', unknown: 'muted' };

/** The handful of metrics worth a sentence, in the order an operator reads them. Absent is absent. */
function metricLine(m: Record<string, number | null>): ReactNode {
  const bits: string[] = [];
  if (m.requests != null) bits.push(`${fmtInt(m.requests)} requests`);
  if (m.errors != null) bits.push(`${fmtInt(m.errors)} errors`);
  if (m.subrequests != null) bits.push(`${fmtInt(m.subrequests)} subrequests`);
  if (m.cpuP50Ms != null) bits.push(`CPU p50 ${fmtMs(m.cpuP50Ms)}`);
  if (m.cpuP99Ms != null) bits.push(`p99 ${fmtMs(m.cpuP99Ms)}`);
  if (m.wallP99Ms != null) bits.push(`wall p99 ${fmtMs(m.wallP99Ms)}`);
  if (m.cpuPercent != null) bits.push(`${m.cpuPercent}% CPU`);
  if (m.storageBytes != null) bits.push(`${fmtInt(m.storageBytes)} bytes stored`);
  return bits.length ? bits.join(' · ') : <span className="quiet">the reading carried no metric this panel names</span>;
}

export function EndpointPanel({ url, label }: { url: string; label: string }): ReactNode {
  const [v, setV] = useState<EndpointInfo | null | 'error'>(null);
  useEffect(() => {
    let live = true; setV(null);
    const token = readToken();
    fetch(`/api/endpoint?url=${encodeURIComponent(url)}`, { headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) } })
      .then((r) => r.json() as Promise<EndpointInfo>)
      .then((d) => { if (live) setV(d); })
      .catch(() => { if (live) setV('error'); });
    return () => { live = false; };
  }, [url]);

  if (v === null) return <p className="quiet small">Reading what serves {label}…</p>;
  if (v === 'error') return <p className="quiet small">What serves {label} could not be read from here.</p>;

  const a = v.attribution;
  return (
    <div className="panel" style={{ marginTop: '.4rem' }}>
      <p style={{ margin: '0 0 .35rem' }}>
        <strong>{label}</strong> <span className="mono break">{a.url}</span>
      </p>
      <p className="quiet" style={{ margin: '0 0 .4rem' }}>{a.note}.</p>
      {a.how === 'unattributed' ? (
        <p className="quiet" style={{ margin: 0 }}>
          Nothing is shown about what runs here, because nothing in this town&rsquo;s manifest declares it. A hostname
          that <em>looks</em> like a Worker name is not a declaration, and the town does not guess at one.
        </p>
      ) : (
        <>
          <dl className="kv kv-facts">
            {a.worker && <><dt>Cloudflare Worker</dt><dd className="mono">{a.worker}</dd></>}
            {a.vercelProject && <><dt>Vercel project</dt><dd className="mono">{a.vercelProject}</dd></>}
            {a.serviceId && <><dt>Service</dt><dd>{a.serviceId}</dd></>}
            {a.estate && <><dt>Estate</dt><dd>{a.estate}</dd></>}
            <dt>Attributed by</dt><dd>{HOW_WORDS[a.how]}</dd>
            {a.repo && (
              <>
                <dt>Source</dt>
                <dd>
                  {v.source ? <a href={v.source} rel="noreferrer">{a.repo}{a.app ? ` · ${a.app}` : ''}</a> : <span className="mono">{a.repo}</span>}
                </dd>
              </>
            )}
          </dl>
          {v.reading ? (
            <>
              <p style={{ margin: '.3rem 0 0' }}>
                <Chip tone={STATUS_TONE[v.reading.status] ?? 'muted'}>{v.reading.status}</Chip>{' '}
                <span className="quiet">
                  {v.reading.platform} · {v.reading.kind} · read {fmtAgo(v.reading.asOf)}
                  {v.reading.lagClass ? ` (${v.reading.lagClass})` : ''}
                </span>
                {v.reading.error && <span className="quiet"> — {v.reading.error}</span>}
              </p>
              <p className="quiet" style={{ margin: '.25rem 0 0' }}>
                {v.reading.metrics
                  ? metricLine(v.reading.metrics)
                  : v.reading.withheld ?? 'the readings are the operator’s'}
              </p>
            </>
          ) : (
            <p className="quiet" style={{ margin: '.3rem 0 0' }}>
              {v.unavailable ?? 'no reading has been collected for it yet'}. Status and readings come from the
              town&rsquo;s own MCP, which is the only thing here that holds a platform credential.
            </p>
          )}
        </>
      )}
    </div>
  );
}
