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
    // `estateName` and `a2a` ride along so a reader can see WHO answers for an estate and WHERE — the estate's
    // own name on the chain, and the door its agents are reached through. Both are facts the manifest records;
    // neither is authority (spec 429 D2), and the name is the stable one of the two (the URL moves).
    estates: town.estates.map((e) => ({
      id: e.id, home: e.home, edge: e.edge, a2a: e.a2a, nameRoots: e.nameRoots, repo: e.repo,
      ...(e.estateName ? { estateName: e.estateName } : {}),
      ...(e.agentZone ? { agentZone: e.agentZone } : {}),
    })),
    // Spec 437 I4 — account ids and labels only; the tokens are the Worker's secrets.
    accounts: town.accounts ?? null,
  };
}

// ── WHO ANSWERS, AND AT WHICH DOOR ────────────────────────────────────────────────────────────

/**
 * An agent's card host, per spec 346 §5: `<label>-<type>.<zone>` — `faith-town.workspace` on `faithnet.ai`
 * is `faith-town-workspace.faithnet.ai`. ONE definition, used both by the Ask that sends the question and by
 * the page that shows where it goes: two spellings of this drifting apart is a page that names a door nobody
 * is listening at.
 */
export function agentCardHost(name: string, zone: string): string | null {
  const [label, type] = name.split('.');
  return label && type && zone ? `${label}-${type}.${zone}` : null;
}

/** The agent that answers for one context (spec 436 §5.5): its name on the chain and the card that names its door. */
export interface ContextAgentView { context: 'town' | 'estate'; estate?: string; name: string; card: string | null; cardHost: string | null }

/**
 * The context agents, as the Ask resolves them: the town's, and one per estate. `CONTEXT_AGENTS` is the one
 * place that says which name answers for which context — an unconfigured context is `null` here and the page
 * says the Ask is not chartered for it, rather than showing a name that answers nothing.
 */
export function contextAgentViews(
  town: TownManifest,
  cfg: { town?: string; estates: Record<string, string> },
  zone: string | undefined,
): { town: ContextAgentView | null; estates: Record<string, ContextAgentView> } {
  const z = zone ?? town.estates[0]?.agentZone ?? '';
  const view = (name: string, context: 'town' | 'estate', estate?: string): ContextAgentView => {
    const host = agentCardHost(name, z);
    return { context, ...(estate ? { estate } : {}), name, cardHost: host, card: host ? `https://${host}/.well-known/agent-card.json` : null };
  };
  const estates: Record<string, ContextAgentView> = {};
  for (const e of town.estates) { const n = cfg.estates[e.id]; if (n) estates[e.id] = view(n, 'estate', e.id); }
  return { town: cfg.town ? view(cfg.town, 'town') : null, estates };
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
