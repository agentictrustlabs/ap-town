// spec 347 §8.5 — a LOCAL structural parser for the `approf:distribution` literal (the SA-keyed
// `atl:distribution` JSON per agent-profile `AgentDistributionV1`). This Worker deliberately depends on no
// workspace package (only hono), so the shape + the fail-closed rules are mirrored here 1:1 with
// `packages/agent-profile/src/distribution.ts` (the ACP registry agent.schema.json `distribution`
// definitions + the AP-owned `acp` / `version`). Keep the two in lockstep; the package's tests are the
// vectors. Fail-closed: anything that is not a valid distribution is `null` — never partial, never a guess
// (ADR-0013).

export const ACP_PLATFORMS = [
  'darwin-aarch64', 'darwin-x86_64', 'linux-aarch64', 'linux-x86_64', 'windows-aarch64', 'windows-x86_64',
] as const;
export type AcpPlatform = (typeof ACP_PLATFORMS)[number];

export interface AgentPackageDistributionV1 { package: string; args?: string[]; env?: Record<string, string> }
export interface AgentBinaryTargetV1 { archive: string; cmd: string; sha256?: string; args?: string[]; env?: Record<string, string> }
export interface AgentDistributionV1 {
  acp?: boolean;
  /** Implementation semver — surfaced unchanged (the ACP registry entry REQUIRES one). */
  version?: string;
  npx?: AgentPackageDistributionV1;
  uvx?: AgentPackageDistributionV1;
  binary?: Partial<Record<AcpPlatform, AgentBinaryTargetV1>>;
}

const SHA256_HEX = /^[a-fA-F0-9]{64}$/;
const SEMVER_PREFIX = /^[0-9]+\.[0-9]+\.[0-9]+/;
const INSTALLER_EXTENSIONS = ['.dmg', '.pkg', '.deb', '.rpm'];
const TOP = new Set(['acp', 'version', 'npx', 'uvx', 'binary']);
const PKG = new Set(['package', 'args', 'env']);
const TGT = new Set(['archive', 'cmd', 'sha256', 'args', 'env']);
const PLATFORMS: ReadonlySet<string> = new Set(ACP_PLATFORMS);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function argsEnvOk(o: Record<string, unknown>): boolean {
  if (o.args !== undefined && !(Array.isArray(o.args) && o.args.every((a) => typeof a === 'string'))) return false;
  if (o.env !== undefined && !(isObj(o.env) && Object.values(o.env).every((v) => typeof v === 'string'))) return false;
  return true;
}
function packageOk(p: unknown): boolean {
  return isObj(p) && Object.keys(p).every((k) => PKG.has(k)) && typeof p.package === 'string' && p.package.length > 0 && argsEnvOk(p);
}
function archiveOk(a: unknown): boolean {
  if (typeof a !== 'string' || !a) return false;
  let u: URL; try { u = new URL(a); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const lower = u.pathname.toLowerCase();
  return !INSTALLER_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
function binaryOk(b: unknown): boolean {
  if (!isObj(b)) return false;
  const keys = Object.keys(b);
  if (!keys.length) return false;
  return keys.every((platform) => {
    if (!PLATFORMS.has(platform)) return false;
    const t = b[platform];
    return isObj(t) && Object.keys(t).every((k) => TGT.has(k)) && archiveOk(t.archive)
      && typeof t.cmd === 'string' && t.cmd.length > 0
      && (t.sha256 === undefined || (typeof t.sha256 === 'string' && SHA256_HEX.test(t.sha256)))
      && argsEnvOk(t);
  });
}

/** Structural validity per the agent-profile rules. */
export function isValidDistribution(d: unknown): d is AgentDistributionV1 {
  if (!isObj(d)) return false;
  if (!Object.keys(d).every((k) => TOP.has(k))) return false;
  if (d.acp !== undefined && typeof d.acp !== 'boolean') return false;
  if (d.version !== undefined && !(typeof d.version === 'string' && SEMVER_PREFIX.test(d.version))) return false;
  if (d.npx !== undefined && !packageOk(d.npx)) return false;
  if (d.uvx !== undefined && !packageOk(d.uvx)) return false;
  if (d.binary !== undefined && !binaryOk(d.binary)) return false;
  return d.npx !== undefined || d.uvx !== undefined || d.binary !== undefined;
}

/** Parse the on-chain / KB literal. Not JSON, not an object, or invalid ⇒ `null`. Never throws. */
export function decodeDistribution(s: string | null | undefined): AgentDistributionV1 | null {
  if (typeof s !== 'string' || !s) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(s); } catch { return null; }
  return isValidDistribution(parsed) ? parsed : null;
}
