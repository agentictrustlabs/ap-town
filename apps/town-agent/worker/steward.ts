// WHO IS READING — the operator view without a shared secret.
//
// The town's amounts have been behind one bearer token that everybody who may see them has to hold and paste.
// A shared secret is a poor answer to "who are you": it cannot be attributed, it cannot be revoked for one
// person, and it ends up in a terminal's history. The person is already signed in at their own Home — the
// portal's Connect does OIDC with it and holds the `id_token` — so the honest gate is that token, verified,
// against a list of operators the manifest DECLARES.
//
// WHAT THIS IS NOT. It is not authority: an id_token asserts WHO somebody is and carries nothing they may do
// (429 D2 — nothing in the town grants). It unlocks a READ of aggregate numbers this deployment already holds,
// and the manifest says whose read that is. Nobody's Home, nobody's record, no act.
//
// THE CHAIN OF TRUST, and each link is checked:
//   1. the token names an issuer, and it must be a Home an ESTATE IN THIS MANIFEST declares — not any issuer
//      that can mint a JWT, or the gate is "bring your own identity provider";
//   2. its signature verifies against that issuer's published JWKS (ES256, the key named by `kid`);
//   3. it is unexpired, by the issuer's own `exp`;
//   4. its subject resolves to a Smart Agent the manifest lists as an operator.
// Any link missing ⇒ the reader is a stranger and sees the public page, which is what a stranger should see.
import type { TownManifest } from '@ap-town/town-model';

export interface StewardRead {
  ok: true;
  /** The Smart Agent the issuer asserted. */
  agent: string;
  /** What to call them, as their Home said it — a label, never an authorization input. */
  name: string | null;
  issuer: string;
}
export type StewardCheck = StewardRead | { ok: false; reason: string };

const b64url = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
};
const jsonOf = (seg: string): Record<string, unknown> | null => {
  try { return JSON.parse(new TextDecoder().decode(b64url(seg))) as Record<string, unknown>; } catch { return null; }
};

/** The Homes this town will believe, from the manifest alone: one per estate, origin only. */
export function allowedIssuers(town: TownManifest): string[] {
  const origin = (u: string | undefined): string | null => { try { return u ? new URL(u).origin : null; } catch { return null; } };
  return [...new Set(town.estates.map((e) => origin(e.home)).filter((x): x is string => !!x))];
}

/** The Smart Agents the manifest names as this town's operators, lower-cased. Empty ⇒ nobody, and the ops token
 *  stays the only way in — an empty list is not "everybody". */
export function declaredOperators(town: TownManifest): Array<{ sa: string; label: string }> {
  return (town.operators ?? []).map((o) => ({ sa: o.sa.toLowerCase(), label: o.label }));
}

const jwksCache = new Map<string, { at: number; keys: Array<JsonWebKey & { kid?: string; alg?: string }> }>();
const JWKS_TTL_MS = 10 * 60_000;

async function keysOf(issuer: string, fetchImpl: typeof fetch, force = false): Promise<{ keys: Array<JsonWebKey & { kid?: string; alg?: string }>; cached: boolean }> {
  const hit = jwksCache.get(issuer);
  if (!force && hit && Date.now() - hit.at < JWKS_TTL_MS) return { keys: hit.keys, cached: true };
  const r = await fetchImpl(`${issuer}/jwks`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`the Home's keys could not be read (${r.status})`);
  const body = (await r.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
  const keys = body.keys ?? [];
  jwksCache.set(issuer, { at: Date.now(), keys });
  return { keys, cached: false };
}

/** True when any of `keys` signed `data`. */
async function signedBy(keys: Array<JsonWebKey & { kid?: string }>, kid: string | null, data: Uint8Array, signature: Uint8Array): Promise<boolean> {
  for (const jwk of kid ? keys.filter((k) => k.kid === kid) : keys) {
    try {
      const key = await crypto.subtle.importKey('jwk', { ...jwk, ext: true, key_ops: ['verify'] }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
      if (await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature as BufferSource, data as BufferSource)) return true;
    } catch { /* a key that cannot be imported is not a failure of the token; try the next */ }
  }
  return false;
}

/**
 * WHO IS SIGNED IN — a Home-issued `id_token`, verified, with no question of what they may do.
 *
 * This is the first three links of the chain: a declared issuer, its signature, its expiry. It answers "this is
 * a person with an account at a Home this town knows", which is what the portal's pages are behind. Being an
 * OPERATOR is a fourth link on top of it, and a different question.
 *
 * `nowMs` and `fetchImpl` are injected so this is testable without a clock or a network.
 */
export async function verifyHomeToken(town: TownManifest, authorization: string | null, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<StewardCheck> {
  const raw = (authorization ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!raw || raw.split('.').length !== 3) return { ok: false, reason: 'no id_token presented' };
  const [h, p, sig] = raw.split('.') as [string, string, string];
  const header = jsonOf(h); const claims = jsonOf(p);
  if (!header || !claims) return { ok: false, reason: 'the token is not a JWT' };
  if (header.alg !== 'ES256') return { ok: false, reason: `this town verifies ES256; the token says ${String(header.alg)}` };

  const issuer = typeof claims.iss === 'string' ? claims.iss.replace(/\/$/, '') : '';
  if (!allowedIssuers(town).includes(issuer)) return { ok: false, reason: `${issuer || 'that issuer'} is not a Home this town's manifest declares` };

  const exp = Number(claims.exp ?? 0);
  if (!Number.isFinite(exp) || exp * 1000 <= nowMs) return { ok: false, reason: 'that sign-in has expired — connect again' };

  const kid = typeof header.kid === 'string' ? header.kid : null;
  const data = new TextEncoder().encode(`${h}.${p}`);
  const signature = b64url(sig);
  let verified = false;
  try {
    const first = await keysOf(issuer, fetchImpl);
    verified = await signedBy(first.keys, kid, data, signature);
    // A ROTATED KEY MUST NOT LOCK ANYONE OUT. The keys are cached for ten minutes, so a Home that rotates
    // would otherwise refuse every operator until the cache aged out. One forced re-read when a CACHED set
    // did not verify — and only then, so a stranger's bad token cannot make us hammer somebody's Home.
    if (!verified && first.cached) verified = await signedBy((await keysOf(issuer, fetchImpl, true)).keys, kid, data, signature);
  } catch (e) { return { ok: false, reason: (e as Error).message }; }
  if (!verified) return { ok: false, reason: 'that token was not signed by the Home it names' };

  // The subject is CAIP-10 (`eip155:<chain>:0x…`); the address is what the manifest lists.
  const agent = String(claims.sub ?? '').match(/0x[0-9a-fA-F]{40}/)?.[0]?.toLowerCase() ?? '';
  if (!agent) return { ok: false, reason: 'the token names no Smart Agent' };
  return { ok: true, agent, name: typeof claims.agent_name === 'string' ? claims.agent_name : null, issuer };
}

/** Signed in AND listed by the manifest as one of this town's operators — what the amounts are behind. */
export async function readAsOperator(town: TownManifest, authorization: string | null, fetchImpl: typeof fetch = fetch, nowMs = Date.now()): Promise<StewardCheck> {
  const who = await verifyHomeToken(town, authorization, fetchImpl, nowMs);
  if (!who.ok) return who;
  const operator = declaredOperators(town).find((o) => o.sa === who.agent);
  if (!operator) return { ok: false, reason: 'you are signed in, but this town does not list you as one of its operators' };
  return { ...who, name: who.name ?? operator.label };
}
