// The signals the town can answer about a service (spec 429 D7) — listed · healthy · compatible. Four questions,
// three answers here: whether YOU may use a service is your own delegation's question, so it is stated, never scored.
import { AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL, type TownManifest, type TownService } from '@ap-town/town-model';

export interface ServiceView {
  id: string;
  kind: TownService['kind'];
  description: string;
  repo: string;
  hosts: string[];
  agentName?: string;
  card?: string;
  estates: string[];
  signals: {
    listed: true;
    healthy: 'up' | 'down' | 'unobserved' | 'self';
    healthDetail?: string;
    compatible: 'unknown';
    compatibleDetail: string;
  };
  authorized: string;
}

export type Probe = (url: string) => Promise<{ status: number } | { error: string }>;

/** Probe every listed service with a probe, concurrently; a Worker never probes its own host (it cannot fetch it). */
export async function serviceViews(town: TownManifest, probe: Probe, selfHost: string | null): Promise<ServiceView[]> {
  return Promise.all(town.services.map(async (s) => {
    let healthy: ServiceView['signals']['healthy'] = 'unobserved';
    let healthDetail: string | undefined;
    if (selfHost && s.hosts.includes(selfHost)) { healthy = 'self'; healthDetail = 'this agent — answering is its health'; }
    else if (s.probe) {
      const r = await probe(s.probe);
      if ('error' in r) { healthy = 'down'; healthDetail = r.error; }
      else { healthy = r.status >= 200 && r.status < 400 ? 'up' : 'down'; healthDetail = `GET ${s.probe} → ${r.status}`; }
    } else healthDetail = 'no public probe';
    return {
      id: s.id, kind: s.kind, description: s.description, repo: s.repo, hosts: s.hosts,
      ...(s.agentName ? { agentName: s.agentName } : {}), ...(s.card ? { card: s.card } : {}),
      estates: s.estates ?? town.estates.map((e) => e.id),
      signals: {
        listed: true, healthy, ...(healthDetail ? { healthDetail } : {}),
        compatible: 'unknown',
        compatibleDetail: 'the town does not yet record what each service runs (town.lock.json); compatibility is not claimed',
      },
      authorized: AUTHORIZATION_IS_NOT_A_TOWN_SIGNAL,
    };
  }));
}

export function townSummary(town: TownManifest) {
  return {
    town: town.town, status: town.status,
    chain: { id: town.chain.id, generation: town.chain.generation, rpc: town.chain.rpc },
    estates: town.estates.map((e) => ({ id: e.id, home: e.home, edge: e.edge, nameRoots: e.nameRoots, repo: e.repo })),
  };
}

/** A plain-language line per service — what a person reading the reply sees first. */
export function describe(town: TownManifest, views: ServiceView[]): string {
  const up = views.filter((v) => v.signals.healthy === 'up' || v.signals.healthy === 'self').length;
  const probed = views.filter((v) => v.signals.healthy !== 'unobserved').length;
  const lines = [
    `The ${town.town} town: chain ${town.chain.id}, ${town.estates.length} estate(s) (${town.estates.map((e) => e.id).join(', ')}), ${views.length} listed service(s); ${up} of ${probed} probed are up.`,
    ...views.map((v) => `- ${v.id} (${v.kind}): ${v.description} [${v.signals.healthy}]`),
    'Listed is not permission: whether you may use a service is decided by your own delegation, checked by that service.',
  ];
  return lines.join('\n');
}
