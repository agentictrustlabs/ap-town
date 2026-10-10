// GRAPHDB — spec 437 §4. Health every five minutes from the monitor endpoint (`live`: heap, off-heap, threads, CPU
// load, file descriptors, disk free); repository statement counts hourly. The operator's monitor credential is sent as
// the full Authorization header value it gave (Basic or GDB token) — the town stores it, never prints it (I7). GraphDB
// is not an Azure resource; it is its own platform row.
//
// `/rest/monitor/infrastructure` answers in PROMETHEUS TEXT, not JSON (checked against graphdb.agentkg.io on
// 2026-10-10: 20 `graphdb_*` gauges). `/rest/repositories` and `…/size` are JSON. A parser that assumed JSON here read
// nothing and reported a healthy node, which is why the names below are the ones the live instance emits.
import type { InfraSampleV1 } from '@ap-town/town-model';
import { type FetchLike, failedInfra, infraSample, num, readHttp, readJson } from './common';

export interface GraphdbCfg { url: string; authorization?: string }
// `accept` matters here: the monitor endpoint answers Prometheus text but refuses to NEGOTIATE it — asked for
// `text/plain, application/json` it returns 500 "No converter for … ResourceUsage with preset Content-Type 'null'".
// `*/*` (what curl sends) is what it serves. The JSON endpoints are asked for JSON as usual.
const headers = (cfg: GraphdbCfg, accept: string): HeadersInit => ({ accept, ...(cfg.authorization ? { authorization: cfg.authorization } : {}) });
const base = (cfg: GraphdbCfg): string => cfg.url.replace(/\/$/, '');

/** Prometheus exposition text → `{ metric: value }` for the unlabelled gauges GraphDB emits. Comments and labelled series are skipped. */
export function parsePrometheus(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([-+0-9.eE]+|NaN|\+Inf|-Inf)$/.exec(t);
    if (!m) continue;
    const v = Number(m[2]);
    if (Number.isFinite(v)) out[m[1]!] = v;
  }
  return out;
}

/** The gauges the tab draws, named as the Pulse names them. A gauge the instance does not emit is `null`, never zero. */
export const GRAPHDB_METRICS: Record<string, string> = {
  graphdb_heap_used_mem: 'heapUsedBytes',
  graphdb_heap_max_mem: 'heapMaxBytes',
  graphdb_heap_committed_mem: 'heapCommittedBytes',
  graphdb_nonheap_used_mem: 'nonHeapUsedBytes',
  graphdb_threads_count: 'threadCount',
  graphdb_cpu_load: 'cpuLoad',
  graphdb_open_file_descriptors: 'openFileDescriptors',
  graphdb_max_file_descriptors: 'maxFileDescriptors',
  graphdb_class_count: 'classCount',
  graphdb_mem_garbage_collections_count: 'gcCount',
  graphdb_data_dir_free: 'dataDirFreeBytes',
  graphdb_data_dir_used: 'dataDirUsedBytes',
};

export async function collectGraphdbHealth(cfg: GraphdbCfg, fetchImpl: FetchLike, at: string): Promise<InfraSampleV1> {
  const r = await readHttp(fetchImpl, `${base(cfg)}/rest/monitor/infrastructure`, { headers: headers(cfg, '*/*') });
  if (!r.ok) return failedInfra('graphdb', cfg.url, 'graphdb', 'node', 'live', r.error, at);
  const g = parsePrometheus(r.data);
  if (!Object.keys(g).length) return failedInfra('graphdb', cfg.url, 'graphdb', 'node', 'live', 'the monitor answered nothing this parser recognises', at);
  const metrics: Record<string, number | null> = {};
  for (const [metric, name] of Object.entries(GRAPHDB_METRICS)) metrics[name] = num(g[metric]);
  const used = metrics.heapUsedBytes ?? null, max = metrics.heapMaxBytes ?? null;
  const heapRatio = used !== null && max ? used / max : null;
  const fds = metrics.openFileDescriptors ?? null, fdMax = metrics.maxFileDescriptors ?? null;
  // Degraded on heap over 90% of max, or file descriptors over 90% of the limit — the two ways this instance falls over.
  const strained = (heapRatio !== null && heapRatio > 0.9) || (fds !== null && fdMax ? fds / fdMax > 0.9 : false);
  return infraSample({ platform: 'graphdb', account: cfg.url, resource: 'graphdb', kind: 'node', at, asOf: at, lagClass: 'live', status: strained ? 'degraded' : 'up', metrics });
}

/** One sample per repository with its statement counts; a repository whose size cannot be read is its own failed sample. */
export async function collectGraphdbRepositories(cfg: GraphdbCfg, fetchImpl: FetchLike, at: string): Promise<InfraSampleV1[]> {
  const list = await readJson<Array<{ id: string; title?: string; type?: string }>>(fetchImpl, `${base(cfg)}/rest/repositories`, { headers: headers(cfg, 'application/json') });
  if (!list.ok) return [failedInfra('graphdb', cfg.url, '*', 'repository', 'hourly', `repositories: ${list.error}`, at)];
  if (!Array.isArray(list.data)) return [failedInfra('graphdb', cfg.url, '*', 'repository', 'hourly', 'repositories: not a list', at)];
  return Promise.all(list.data.map(async (repo) => {
    const s = await readJson<{ total?: number; explicit?: number; inferred?: number } | number>(fetchImpl, `${base(cfg)}/rest/repositories/${encodeURIComponent(repo.id)}/size`, { headers: headers(cfg, 'application/json') });
    if (!s.ok) return failedInfra('graphdb', cfg.url, repo.id, 'repository', 'hourly', s.error, at);
    const size = typeof s.data === 'number' ? { total: s.data } : s.data;
    return infraSample({ platform: 'graphdb', account: cfg.url, resource: repo.id, kind: 'repository', at, asOf: at, lagClass: 'hourly', status: 'up', metrics: { statementsTotal: num(size.total), statementsExplicit: num((size as { explicit?: number }).explicit), statementsInferred: num((size as { inferred?: number }).inferred) } });
  }));
}
