// ACP Registry (Agent Client Protocol) — aggregate projection, spec 347 §8.5. The registry file is
// `{ version, agents[] }` with `additionalProperties: false`, so NOTHING of ours goes inside it; the ARD entry that
// points at this file carries the AP metadata. Eligible = agents whose canonical profile declares an
// `AgentDistributionV1` with `acp: true` (on chain `atl:distribution`, KB `approf:distribution`). No trust
// semantics are added: this is a distribution catalog, and we keep it one.

export const ACP_REGISTRY_VERSION = '1.0.0';
export const ACP_REGISTRY_PATH = '/registry/v1/latest/registry.json';
export const ACP_PLATFORMS = ['darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64'] as const;

export interface AcpDistributionLike {
  acp?: boolean;
  version?: string;
  npx?: { package: string; args?: string[]; env?: Record<string, string> };
  uvx?: { package: string; args?: string[]; env?: Record<string, string> };
  binary?: Partial<Record<(typeof ACP_PLATFORMS)[number], { archive: string; cmd: string; sha256?: string; args?: string[]; env?: Record<string, string> }>>;
}
export interface AcpAgentRowLike {
  name?: string | null;
  smartAgent: string;
  displayName?: string | null;
  description?: string | null;
  siteUrl?: string | null;
  distribution?: AcpDistributionLike | null;
}
export interface AcpAgent {
  id: string; name: string; version: string; description: string;
  distribution: Omit<AcpDistributionLike, 'acp' | 'version'>;
  repository?: string; website?: string; authors?: string[]; license?: string; icon?: string;
}
export interface AcpRegistry { version: string; agents: AcpAgent[] }

const ID = /^[a-z][a-z0-9-]*$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+/;

export function acpIdFor(name: string | null | undefined): string | null {
  const label = (name ?? '').split('@')[0]?.split('.')[0]?.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') ?? '';
  return ID.test(label) ? label : null;
}

/** One ACP agent entry, or the reason the row is not eligible. Pure; never throws on data. */
export function acpAgentFor(row: AcpAgentRowLike): { agent: AcpAgent } | { agent: null; reason: 'no-distribution' | 'not-acp' | 'no-version' | 'no-method' | 'bad-id' } {
  const d = row.distribution;
  if (!d) return { agent: null, reason: 'no-distribution' };
  if (d.acp !== true) return { agent: null, reason: 'not-acp' };
  if (!d.version || !SEMVER.test(d.version)) return { agent: null, reason: 'no-version' };
  const { acp: _a, version: _v, ...methods } = d;
  if (!methods.npx && !methods.uvx && !(methods.binary && Object.keys(methods.binary).length)) return { agent: null, reason: 'no-method' };
  const id = acpIdFor(row.name);
  if (!id) return { agent: null, reason: 'bad-id' };
  const agent: AcpAgent = {
    id,
    name: row.displayName || row.name || id,
    version: d.version,
    description: row.description || row.displayName || row.name || id,
    distribution: methods,
    ...(row.siteUrl ? { website: row.siteUrl } : {}),
  };
  return { agent };
}

export function acpRegistry(rows: AcpAgentRowLike[]): { registry: AcpRegistry; skipped: Record<string, number> } {
  const agents: AcpAgent[] = [];
  const skipped: Record<string, number> = {};
  const seen = new Set<string>();
  for (const r of rows) {
    const a = acpAgentFor(r);
    if (!a.agent) { skipped[a.reason] = (skipped[a.reason] ?? 0) + 1; continue; }
    if (seen.has(a.agent.id)) { skipped['duplicate-id'] = (skipped['duplicate-id'] ?? 0) + 1; continue; }
    seen.add(a.agent.id); agents.push(a.agent);
  }
  agents.sort((x, y) => x.id.localeCompare(y.id));
  return { registry: { version: ACP_REGISTRY_VERSION, agents }, skipped };
}
