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
  // AZURE COST NAMES A RESOURCE GROUP, NOT A RESOURCE. Cost Management groups by `ResourceGroupName`, so a cost
  // row's `resource` is `rg-faithnet` while `azureResources` lists `/subscriptions/…/virtualMachines/faithnet-vm`
  // — nothing matched, and every Azure dollar read as unattributed while the VMs above it read as owned
  // (2026-10-13). A group is claimed by its own declaration, never inferred from a resource inside it: of the 21
  // resources billed in these two groups only 3 are VMs, and the rest — a bastion, a Postgres server, a registry,
  // a key vault, the disks — are most of the money. Case-insensitive: the id says `RG-FAITHNET`, the bill says
  // `rg-faithnet`, and they are one group.
  const claimsGroup = (xs: string[] | undefined): boolean => !!xs?.some((x) => x.toLowerCase() === resource.toLowerCase());
  for (const e of town.estates) if (matches((e as TownEstate)[field]) || (platform === 'azure' && claimsGroup(e.azureResourceGroups))) return { kind: 'estate', id: e.id };
  for (const s of town.services) if (matches((s as TownService)[field]) || (field === 'workers' && s.worker === resource) || (platform === 'azure' && claimsGroup(s.azureResourceGroups))) return { kind: 'service', id: s.id };
  return null;
}

