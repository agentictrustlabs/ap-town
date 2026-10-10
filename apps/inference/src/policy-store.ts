// THE POLICY STORE — spec 434 §4 / §9. Profiles and the catalog are the service's records (`inference.profile:<id>`,
// `inference.model:<provider>/<model>` in inference.svc's vault — W6 writes them); the Worker SERVES them from a KV cache
// seeded from `seeds/profiles.json` + `seeds/models.json` (rebuildable, never the record). Client entitlements are
// `client:<sha256(appKey)>` rows the steward registers (`scripts/inference-client.mts`). Every row is validated by the
// same functions the admin page will run; an invalid row is refused into the cache, never served half-right.
import {
  validateProfile, validateCatalogEntry, validateEntitlement, profileVersion, catalogKey,
  type ModelProfileV1, type ModelCatalogEntryV1, type ClientEntitlementV1, type PolicyStorePort, type PrincipalResolverPort, type ResolvedPrincipalV1,
} from '@agenticprimitives/model-gateway';
import type { Address } from 'viem';
import profilesSeed from '../seeds/profiles.json';
import modelsSeed from '../seeds/models.json';

export const CACHE_KEYS = { profiles: 'policy:profiles', catalog: 'policy:catalog', client: (hash: string) => `client:${hash}`, principals: 'clients:principals', entitlement: (sa: string) => `entitlement:${sa.toLowerCase()}` } as const;

export async function sha256Hex(s: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The seeds, validated — the shape the cache holds when nothing has been written over it. */
export function seededPolicy(): { profiles: ModelProfileV1[]; catalog: ModelCatalogEntryV1[]; errors: string[] } {
  const errors: string[] = [];
  const profiles = (profilesSeed as unknown[]).filter((p) => { const v = validateProfile(p); if (!v.ok) errors.push(`profile ${(p as { id?: string }).id ?? '?'}: ${v.errors.join('; ')}`); return v.ok; }) as ModelProfileV1[];
  const catalog = (modelsSeed as unknown[]).filter((c) => { const v = validateCatalogEntry(c); if (!v.ok) errors.push(`model ${catalogKey(String((c as { provider?: string }).provider), String((c as { model?: string }).model))}: ${v.errors.join('; ')}`); return v.ok; }) as ModelCatalogEntryV1[];
  return { profiles, catalog, errors };
}

export interface PolicyEnv { CACHE: KVNamespace }

/** `PolicyStorePort` over KV with the seeds as the floor: a KV row (written by W6 admin or the register script) wins; absent ⇒ the seed. */
export function kvPolicyStore(env: PolicyEnv): PolicyStorePort & { principals(): Promise<Address[]>; putEntitlement(e: ClientEntitlementV1, appKeyHash?: string): Promise<void> } {
  const seeds = seededPolicy();
  const versions = new Map<string, Promise<string>>();
  const versionOf = (p: ModelProfileV1): Promise<string> => { const k = JSON.stringify(p); let v = versions.get(k); if (!v) { v = profileVersion(p); versions.set(k, v); } return v; };
  async function profiles(): Promise<ModelProfileV1[]> {
    const raw = await env.CACHE.get(CACHE_KEYS.profiles, 'json') as unknown[] | null;
    if (!raw) return seeds.profiles;
    return raw.filter((p) => validateProfile(p).ok) as ModelProfileV1[];
  }
  return {
    async profile(id) {
      const p = (await profiles()).find((x) => x.id === id);
      return p ? { profile: p, version: await versionOf(p) } : null;
    },
    async catalog() {
      const raw = await env.CACHE.get(CACHE_KEYS.catalog, 'json') as unknown[] | null;
      if (!raw) return seeds.catalog;
      return raw.filter((c) => validateCatalogEntry(c).ok) as ModelCatalogEntryV1[];
    },
    async entitlement(principal) {
      const raw = await env.CACHE.get(CACHE_KEYS.entitlement(principal), 'json');
      return raw && validateEntitlement(raw).ok ? (raw as ClientEntitlementV1) : null;
    },
    async principals() {
      return ((await env.CACHE.get(CACHE_KEYS.principals, 'json')) as Address[] | null) ?? [];
    },
    async putEntitlement(e, appKeyHash) {
      const v = validateEntitlement(e); if (!v.ok) throw new Error(`entitlement: ${v.errors.join('; ')}`);
      await env.CACHE.put(CACHE_KEYS.entitlement(e.principal), JSON.stringify(e));
      if (appKeyHash) await env.CACHE.put(CACHE_KEYS.client(appKeyHash), JSON.stringify({ principal: e.principal, principalClass: 'app', ...(e.estate ? { estate: e.estate } : {}), clientKind: e.kind } satisfies ResolvedPrincipalV1));
      const list = new Set(await this.principals()); list.add(e.principal);
      await env.CACHE.put(CACHE_KEYS.principals, JSON.stringify([...list]));
    },
  };
}

/** Caller class (a): `sha256(appKey)` → the client row. Class (b) is declared by the contract and not served here yet (said, never guessed). */
export function kvPrincipalResolver(env: PolicyEnv): PrincipalResolverPort {
  return {
    async resolve(caller) {
      if (caller.kind !== 'app-key') return null;
      const row = (await env.CACHE.get(CACHE_KEYS.client(await sha256Hex(caller.key)), 'json')) as ResolvedPrincipalV1 | null;
      return row && /^0x[0-9a-fA-F]{40}$/.test(String(row.principal)) ? row : null;
    },
  };
}
