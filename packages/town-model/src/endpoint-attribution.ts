// WHAT SERVES THIS ENDPOINT — spec 437 I4, asked the other way round.
//
// The Pulse attributes a RESOURCE to an owner ("this Worker belongs to the faithnet estate"). A reader on an
// agent's page is holding the opposite half of the same fact: they have a URL the chain gave them — an A2A
// door, an MCP door — and want to know what is behind it. Which Worker. From which repository. How it is
// doing.
//
// EVERY ANSWER IS A DECLARATION, NEVER A GUESS. The temptation is to derive the Worker from the host, and it
// almost works: `demo-edge-faithnet.richardpedersen3.workers.dev` does name its Worker. Then
// `mcp.faithnet.io` names nothing, `alice.faithnet.ai` names nothing, and a convention that is right four
// times out of six produces two confident falsehoods about where somebody's agent actually runs. So the
// attribution reads what the manifest DECLARES — a service's hosts, an estate's lanes, an estate's doors, a
// declared MCP server's url — and says `unattributed` when the manifest declares nothing. "The town does not
// know" is an answer; a hostname split on a dot is not.
//
// NOTHING HERE IS AUTHORITY (spec 429 D2). Knowing which Worker serves an agent's door says nothing about
// whether anybody may send it anything; that is decided inside, against the chain, on every call.
import type { TownManifest } from './types';

/** How the manifest connected this URL to what runs it. Ordered most specific first, and reported as read. */
export type EndpointHow =
  | 'mcp-server'    // an `mcpServers[].url` this town or one of its estates declares
  | 'service-host'  // a host in `services[].hosts`
  | 'estate-lane'   // a host pattern in `estates[].lanes` (the Worker that serves that lane)
  | 'estate-zone'   // a host under `estates[].agentZone` — every agent of that estate answers there
  | 'estate-door'   // the estate's own `a2a`, `edge` or `home`
  | 'unattributed'; // the manifest declares nothing for this host, and nothing is inferred

export interface EndpointAttribution {
  url: string;
  host: string;
  how: EndpointHow;
  /** The Cloudflare Worker that serves it, when the manifest names one. */
  worker?: string;
  /** The town service this endpoint belongs to, when it is one. */
  serviceId?: string;
  /** The estate it belongs to, when it is one. */
  estate?: string;
  /** The declared MCP server's id, for an `mcp-server` attribution. */
  mcpServerId?: string;
  /** The repository that deploys it, and the app directory inside it when the repo says. */
  repo?: string;
  app?: string;
  /** The Vercel project, when what answers here is one rather than a Worker. */
  vercelProject?: string;
  /** In a sentence: what the reader is looking at. */
  note: string;
}

const hostOf = (url: string): string | null => { try { return new URL(url).host.toLowerCase(); } catch { return null; } };

/** `*.faithnet.ai` matches `alice.faithnet.ai`; a plain pattern matches itself. Lanes are the only wildcards. */
function laneMatches(pattern: string, host: string): boolean {
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) { const z = p.slice(2); return host === z || host.endsWith(`.${z}`); }
  return p === host;
}

const repoUrl = (repo: string): string => (repo === 'ap-town' ? 'https://github.com/agentictrustlabs/ap-town' : `https://github.com/${repo}`);

/** The GitHub link for an attribution, when it has a repository. `app` deep-links to the directory. */
export function sourceUrlOf(a: EndpointAttribution): string | null {
  if (!a.repo) return null;
  return a.app ? `${repoUrl(a.repo)}/tree/HEAD/${a.app.replace(/^\/+/, '')}` : repoUrl(a.repo);
}

/**
 * Attribute one endpoint URL to what runs it. Reads only the manifest; makes no network call and no guess.
 * An unparsable URL and an undeclared host are both `unattributed`, and both say so.
 */
export function attributeEndpoint(town: TownManifest, url: string): EndpointAttribution {
  const host = hostOf(url);
  const base = { url, host: host ?? '' };
  if (!host) return { ...base, how: 'unattributed', note: 'that is not a URL this town can read, so nothing is attributed to it' };

  // 1. A DECLARED MCP SERVER, the most specific thing the manifest says about a host.
  for (const s of town.services) {
    for (const m of [...(s.mcp?.url ? [{ id: s.id, url: s.mcp.url, worker: s.worker }] : []), ...(s.mcpServers ?? [])]) {
      if (m.url && hostOf(m.url) === host) {
        return { ...base, how: 'mcp-server', mcpServerId: m.id, serviceId: s.id, ...(m.worker ?? s.worker ? { worker: m.worker ?? s.worker! } : {}), repo: s.repo, ...(s.app ? { app: s.app } : {}),
          note: `the ${m.id} MCP server, declared by the ${s.id} service of this town` };
      }
    }
  }
  for (const e of town.estates) {
    for (const m of e.mcpServers ?? []) {
      if (m.url && hostOf(m.url) === host) {
        return { ...base, how: 'mcp-server', mcpServerId: m.id, estate: e.id, ...(m.worker ? { worker: m.worker } : {}), repo: e.repo,
          note: `the ${m.id} MCP server, declared by the ${e.id} estate` };
      }
    }
  }

  // 2. A LISTED SERVICE'S OWN HOST.
  for (const s of town.services) {
    if (s.hosts.some((h) => h.toLowerCase() === host)) {
      return { ...base, how: 'service-host', serviceId: s.id, ...(s.worker ? { worker: s.worker } : {}), repo: s.repo, ...(s.app ? { app: s.app } : {}),
        note: `the ${s.id} service of this town` };
    }
  }

  // 3. AN ESTATE'S LANE — the Worker that actually serves that host pattern, which is the only thing that
  //    knows what runs behind a per-agent hostname. `*.faithnet.ai` is how every agent of that estate answers.
  for (const e of town.estates) {
    for (const [pattern, worker] of Object.entries(e.lanes ?? {})) {
      if (laneMatches(pattern, host)) {
        const zone = e.agentZone?.toLowerCase();
        const byZone = !!zone && (host === zone || host.endsWith(`.${zone}`));
        return { ...base, how: byZone ? 'estate-zone' : 'estate-lane', estate: e.id, worker, repo: e.repo,
          note: byZone
            ? `an agent of the ${e.id} estate: every agent under ${e.agentZone} answers at the ${worker} Worker`
            : `the ${e.id} estate, served by the ${worker} Worker` };
      }
    }
  }

  // 4. THE ESTATE'S OWN THREE DOORS, when no lane named the host (an estate on another account has no lanes).
  for (const e of town.estates) {
    const doors: Array<[string, string]> = [[e.a2a, 'its A2A door'], [e.edge, 'its gate'], [e.home, 'its Home']];
    for (const [u, what] of doors) {
      if (hostOf(u) === host) {
        return { ...base, how: 'estate-door', estate: e.id, repo: e.repo,
          ...(what === 'its Home' && e.vercelProjects?.[0] ? { vercelProject: e.vercelProjects[0] } : {}),
          note: `${what} — the ${e.id} estate` };
      }
    }
  }

  return { ...base, how: 'unattributed',
    note: 'this town’s manifest declares nothing that serves this host. It may belong to another town, to a party outside any town, or to a resource nobody has declared yet — the town does not guess' };
}
