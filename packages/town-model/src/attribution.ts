// ATTRIBUTION — spec 437 I4. Who owns which platform resource, from the manifest ALONE. It lives here, in the model,
// because two sides read it and neither should own it: the town MCP (which collects the samples) and the portal (which
// draws them). Declared, never guessed: a resource listed nowhere is `null` — the Unattributed bucket the Pulse SHOWS.
// Nothing here is authority; an owner is a label on a cost row.
import type { AttributedOwner, InfraPlatform, InfraSampleV1 } from './pulse-types';
import type { TownEstate, TownManifest, TownService } from './types';

/** Every resource the manifest declares, by platform — the lists the status and metrics passes walk. */
export function declaredResources(town: TownManifest): { vercelProjects: string[]; azureResources: string[]; workers: string[]; pagesProjects: string[] } {
  const owners: Array<TownEstate | TownService> = [...town.estates, ...town.services];
  const uniq = (xs: Array<string | undefined>): string[] => [...new Set(xs.filter((x): x is string => !!x))];
  return { vercelProjects: uniq(owners.flatMap((o) => o.vercelProjects ?? [])), azureResources: uniq(owners.flatMap((o) => o.azureResources ?? [])), workers: uniq([...owners.flatMap((o) => o.workers ?? []), ...town.services.map((s: TownService) => s.worker)]), pagesProjects: uniq(owners.flatMap((o) => o.pagesProjects ?? [])) };
}

/** Who owns a platform resource, from the manifest alone. `null` is the honest answer for one listed nowhere. */
export function attributeResource(town: TownManifest, platform: InfraPlatform, resource: string, kind?: InfraSampleV1['kind']): AttributedOwner | null {
  const field = platform === 'cloudflare' ? (kind === 'pages' ? 'pagesProjects' : 'workers') : platform === 'vercel' ? 'vercelProjects' : platform === 'azure' ? 'azureResources' : null;
  if (platform === 'graphdb' || platform === 'chain-node') { const svc = town.services.find((s: TownService) => (platform === 'graphdb' ? s.id === 'graphdb' || s.id === 'discovery-mcp' : s.id === 'rpc')); return svc ? { kind: 'service', id: svc.id } : { kind: 'town', id: town.town }; }
  if (!field) return null;
  const matches = (xs: string[] | undefined): boolean => !!xs?.some((x) => x === resource || (platform === 'azure' && resource === x.split('/').pop()));
  for (const e of town.estates) if (matches((e as TownEstate)[field])) return { kind: 'estate', id: e.id };
  for (const s of town.services) if (matches((s as TownService)[field]) || (field === 'workers' && s.worker === resource)) return { kind: 'service', id: s.id };
  return null;
}

