import { parse } from 'yaml';
import type { ServiceKind, TownManifest } from './types';

const KINDS: readonly ServiceKind[] = ['commons', 'domain-pack', 'agent-service', 'application'];
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
  for (const [k, v] of Object.entries(c?.contracts ?? {})) if (!/^0x[0-9a-fA-F]{40}$/.test(String(v))) errors.push(`chain.contracts.${k}: an address`);

  const estates = Array.isArray(t.estates) ? t.estates : [];
  if (estates.length === 0) errors.push('estates: a town has at least one estate');
  const estateIds = new Set<string>();
  const laneOwner = new Map<string, string>();
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
    for (const [pattern, worker] of Object.entries(e.lanes ?? {})) {
      if (!HOST.test(pattern)) errors.push(`${at}.lanes: "${pattern}" is not a host pattern`);
      if (typeof worker !== 'string' || !worker) errors.push(`${at}.lanes["${pattern}"]: a Worker name`);
      const prior = laneOwner.get(pattern);
      if (prior) errors.push(`${at}.lanes: "${pattern}" is already a lane of ${prior}`);
      laneOwner.set(pattern, e.id);
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
  }

  return { town: errors.length ? null : (t as TownManifest), errors };
}
