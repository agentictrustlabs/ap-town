import { parse } from 'yaml';
import type { ServiceKind, TownManifest } from './types';

const KINDS: readonly ServiceKind[] = ['commons', 'domain-pack', 'agent-service', 'application', 'federation'];
const ID = /^[a-z][a-z0-9-]*$/;
const HOST = /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const isUrl = (s: unknown): s is string => typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s);

export interface TownValidation { town: TownManifest | null; errors: string[] }

/** Parse and validate a town.yaml. Errors are listed, never repaired: a manifest that is wrong is refused (ADR-0013). */
export function parseTown(text: string): TownValidation {
  let raw: unknown;
  try { raw = parse(text); } catch (e) { return { town: null, errors: [`not YAML: ${(e as Error).message}`] }; }
  return validateTown(raw);
}


/** One declared MCP server, checked. `at` names where it was found so an error is findable in the YAML.
 *
 * The rule worth stating: `binding` means NO DOOR, so a url on one is a contradiction and is refused rather
 * than ignored. A manifest that says both "unreachable from outside" and "here is where to reach it" tells a
 * reader the opposite things on the same row, and the row is what the portal renders.
 */
function checkMcp(m: unknown, at: string, errors: string[], opts: { urlRequired: boolean }): void {
  const x = m as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') { errors.push(`${at}: an object`); return; }
  if (!MCP_EXPOSURES.includes(x.exposure as string)) errors.push(`${at}.exposure: one of ${MCP_EXPOSURES.join(' | ')}`);
  if (x.url !== undefined && !isUrl(x.url)) errors.push(`${at}.url: an https URL`);
  if (x.exposure === 'binding' && x.url !== undefined) errors.push(`${at}.url: a binding-only server has no door — remove the url or change the exposure`);
  // An estate's server must say where its door is; a town SERVICE need not, because its row already carries
  // the hosts the census reads it from.
  if (opts.urlRequired && x.exposure !== 'binding' && x.url === undefined) errors.push(`${at}.url: a server with a door says where it is`);
  if (x.probe !== undefined && !isUrl(x.probe)) errors.push(`${at}.probe: an https URL`);
}
const MCP_EXPOSURES = ['binding', 'authenticated', 'open'];

export function validateTown(raw: unknown): TownValidation {
  const errors: string[] = [];
  const t = raw as Partial<TownManifest> | null;
  if (!t || typeof t !== 'object') return { town: null, errors: ['manifest is not an object'] };
  if (typeof t.town !== 'string' || !ID.test(t.town)) errors.push('town: a lower-case id');
  if (t.status !== 'live' && t.status !== 'demo') errors.push('status: live | demo');
  const c = t.chain;
  if (!c || !Number.isInteger(c.id) || c.id <= 0) errors.push('chain.id: a positive integer');
  if (!c || typeof c.generation !== 'string') errors.push('chain.generation: a string');
  if (!c || !isUrl(c.rpc)) errors.push('chain.rpc: an https URL');
  if (c?.coin && (!/^0x[0-9a-fA-F]{40}$/.test(String(c.coin.address)) || typeof c.coin.symbol !== 'string' || !Number.isInteger(c.coin.decimals))) errors.push('chain.coin: { address, symbol, decimals }');
  if (!c || typeof c.deployment !== 'string' || !/^[a-z][a-z0-9-]*$/.test(c.deployment)) errors.push('chain.deployment: the network key in @agenticprimitives/contracts/deployments');

  const estates = Array.isArray(t.estates) ? t.estates : [];
  if (estates.length === 0) errors.push('estates: a town has at least one estate');
  const estateIds = new Set<string>();
  const laneOwner = new Map<string, string>();
  const gateOwner = new Map<string, string>();
  for (const [i, e] of estates.entries()) {
    const at = `estates[${i}]${e?.id ? ` (${e.id})` : ''}`;
    if (!e || typeof e.id !== 'string' || !ID.test(e.id)) { errors.push(`${at}.id: a lower-case id`); continue; }
    if (estateIds.has(e.id)) errors.push(`${at}: duplicate estate id`);
    estateIds.add(e.id);
    for (const k of ['home', 'edge', 'a2a'] as const) if (!isUrl(e[k])) errors.push(`${at}.${k}: an https URL`);
    if (typeof e.repo !== 'string' || !e.repo) errors.push(`${at}.repo: required`);
    if (!Array.isArray(e.nameRoots) || e.nameRoots.length === 0 || !e.nameRoots.every((r) => typeof r === 'string' && ID.test(r))) {
      errors.push(`${at}.nameRoots: one or more lower-case roots`);
    }
    // A GATE IS AN ADDRESS, AND NO TWO ESTATES SHARE ONE: the whole use of the field is to tell one
    // estate's names from another's, so a duplicate would make the naming service answer confidently
    // with the wrong estate — the failure this field exists to prevent.
    if (e.namingGate !== undefined) {
      if (typeof e.namingGate !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(e.namingGate)) errors.push(`${at}.namingGate: a 0x address`);
      else {
        const g = e.namingGate.toLowerCase();
        const prior = gateOwner.get(g);
        if (prior) errors.push(`${at}.namingGate: ${e.namingGate} is already ${prior}'s gate`);
        gateOwner.set(g, e.id);
      }
    }
    // THE PROJECTION ROW IS A DECLARATION TO CROSS-CHECK, so a half-written one is worse than none: a
    // reader who finds a registry and an estate id but no signer cannot tell whether the estate forgot the
    // signer or whether somebody else holds it. All five fields, or the row is refused (ADR-0013).
    if (e.projection !== undefined) {
      const pj = e.projection as Record<string, unknown> | null;
      if (!pj || typeof pj !== 'object') errors.push(`${at}.projection: an object`);
      else {
        for (const k of ['registry', 'governance', 'signer'] as const) {
          if (typeof pj[k] !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(String(pj[k]))) errors.push(`${at}.projection.${k}: a 0x address`);
        }
        if (typeof pj.estateId !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(String(pj.estateId))) errors.push(`${at}.projection.estateId: a 0x bytes32 (keccak256 of "eip155:<chainId>:<governance>")`);
        if (!Number.isInteger(pj.registryChainId) || Number(pj.registryChainId) <= 0) errors.push(`${at}.projection.registryChainId: the chain the registry is on`);
        // Stated, never defaulted: "we have not done the on-chain declaration yet" must be said out loud,
        // because the absence of the stronger check is exactly what a verifier needs to know.
        if (typeof pj.declaredOnChain !== 'boolean') errors.push(`${at}.projection.declaredOnChain: true | false — say whether the estate has declared this signer on its own chain`);
      }
    }
    for (const [pattern, worker] of Object.entries(e.lanes ?? {})) {
      if (!HOST.test(pattern)) errors.push(`${at}.lanes: "${pattern}" is not a host pattern`);
      if (typeof worker !== 'string' || !worker) errors.push(`${at}.lanes["${pattern}"]: a Worker name`);
      const prior = laneOwner.get(pattern);
      if (prior) errors.push(`${at}.lanes: "${pattern}" is already a lane of ${prior}`);
      laneOwner.set(pattern, e.id);
    }
    const mcps = e.mcpServers;
    if (mcps !== undefined) {
      if (!Array.isArray(mcps)) errors.push(`${at}.mcpServers: a list`);
      else {
        const ids = new Set<string>();
        for (const [j, m] of mcps.entries()) {
          const mat = `${at}.mcpServers[${j}]${(m as { id?: string })?.id ? ` (${(m as { id: string }).id})` : ''}`;
          const id = (m as { id?: unknown })?.id;
          if (typeof id !== 'string' || !ID.test(id)) errors.push(`${mat}.id: a lower-case id`);
          else if (ids.has(id)) errors.push(`${mat}: duplicate MCP server id in this estate`);
          else ids.add(id);
          const d = (m as { description?: unknown })?.description;
          if (typeof d !== 'string' || !d.trim()) errors.push(`${mat}.description: required — say what it serves`);
          checkMcp(m, mat, errors, { urlRequired: true });
        }
      }
    }
  }

  const services = Array.isArray(t.services) ? t.services : [];
  const serviceIds = new Set<string>();
  const hostOwner = new Map<string, string>();
  for (const [i, s] of services.entries()) {
    const at = `services[${i}]${s?.id ? ` (${s.id})` : ''}`;
    if (!s || typeof s.id !== 'string' || !ID.test(s.id)) { errors.push(`${at}.id: a lower-case id`); continue; }
    if (serviceIds.has(s.id)) errors.push(`${at}: duplicate service id`);
    serviceIds.add(s.id);
    if (!KINDS.includes(s.kind as ServiceKind)) errors.push(`${at}.kind: one of ${KINDS.join(' | ')}`);
    if (typeof s.repo !== 'string' || !s.repo) errors.push(`${at}.repo: required`);
    if (s.repo === 'ap-town' && !s.app) errors.push(`${at}.app: a service ap-town deploys names its app directory`);
    if (s.repo !== 'ap-town' && s.app) errors.push(`${at}.app: only services ap-town deploys have an app here`);
    if (typeof s.description !== 'string' || !s.description.trim()) errors.push(`${at}.description: required`);
    if (!Array.isArray(s.hosts)) errors.push(`${at}.hosts: a list (may be empty for a binding-only service)`);
    for (const h of s.hosts ?? []) {
      if (!HOST.test(h)) errors.push(`${at}.hosts: "${h}" is not a host`);
      const prior = hostOwner.get(h);
      if (prior) errors.push(`${at}.hosts: "${h}" is already served by ${prior}`);
      hostOwner.set(h, s.id);
    }
    if (s.probe !== undefined && !isUrl(s.probe)) errors.push(`${at}.probe: an https URL`);
    if (s.card !== undefined && !isUrl(s.card)) errors.push(`${at}.card: an https URL`);
    for (const e of s.estates ?? []) if (!estateIds.has(e)) errors.push(`${at}.estates: "${e}" is not an estate of this town`);
    // A service whose OWN interface is MCP. Its id and description are the row's, so only the MCP-specific
    // half is checked here — and a `binding` service that also lists a host is left alone: the host may be a
    // health page or a redirect, and only the `mcp.url` claim is this rule's business.
    if (s.mcp !== undefined) checkMcp(s.mcp, `${at}.mcp`, errors, { urlRequired: false });
    for (const [j, m] of (s.mcpServers ?? []).entries()) {
      const mat = `${at}.mcpServers[${j}]${(m as { id?: string })?.id ? ` (${(m as { id: string }).id})` : ''}`;
      if (typeof (m as { id?: unknown })?.id !== 'string' || !ID.test((m as { id: string }).id)) errors.push(`${mat}.id: a lower-case id`);
      if (typeof (m as { description?: unknown })?.description !== 'string' || !(m as { description: string }).description.trim()) errors.push(`${mat}.description: required — say what it serves`);
      checkMcp(m, mat, errors, { urlRequired: true });
    }
  }

  return { town: errors.length ? null : (t as TownManifest), errors };
}
