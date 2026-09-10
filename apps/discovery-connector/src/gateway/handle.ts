// THE HANDLE (spec 387 §2) — what an MCP host carries between calls instead of an endpoint. Minted only by the
// gateway, HMAC-signed with its secret, bound to the agent anchor, the card the registry named, the endpoint that
// card advertised, the card's digest, the registry, and a window. A host can select a target; it cannot mint or
// alter one, so the gateway never posts anywhere a verified card did not name.
export interface HandlePayloadV1 {
  v: 1;
  anchor: string;
  name: string;
  cardUrl: string;
  endpoint: string;
  cardDigest: string;
  skill?: string;
  registry: string;
  receipt?: string;
  issuedAt: number;
  expiresAt: number;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string): Uint8Array => { const p = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4); return Uint8Array.from(atob(p), (c) => c.charCodeAt(0)); };
const PREFIX = 'ap-agent:';

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
const same = (a: Uint8Array, b: Uint8Array): boolean => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!; return d === 0; };

export async function mintHandle(secret: string, p: Omit<HandlePayloadV1, 'v' | 'issuedAt' | 'expiresAt'>, opts: { now?: number; ttlSec?: number } = {}): Promise<string> {
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const payload: HandlePayloadV1 = { v: 1, ...p, issuedAt: now, expiresAt: now + (opts.ttlSec ?? 24 * 3600) };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  return `${PREFIX}${body}.${b64url(await hmac(secret, body))}`;
}

export async function verifyHandle(secret: string, handle: string, now = Math.floor(Date.now() / 1000)): Promise<{ ok: true; payload: HandlePayloadV1 } | { ok: false; refused: string }> {
  if (typeof handle !== 'string' || !handle.startsWith(PREFIX)) return { ok: false, refused: 'target is not a handle this gateway minted (ap-agent:…)' };
  const [body, sig] = handle.slice(PREFIX.length).split('.');
  if (!body || !sig) return { ok: false, refused: 'target handle is malformed' };
  if (!same(await hmac(secret, body), unb64url(sig))) return { ok: false, refused: 'target handle was not minted by this gateway (signature)' };
  let payload: HandlePayloadV1;
  try { payload = JSON.parse(new TextDecoder().decode(unb64url(body))) as HandlePayloadV1; } catch { return { ok: false, refused: 'target handle payload is not JSON' }; }
  if (payload.v !== 1 || !/^https:\/\//.test(payload.endpoint) || !/^https:\/\//.test(payload.cardUrl)) return { ok: false, refused: 'target handle payload is not a v1 handle' };
  if (now >= payload.expiresAt) return { ok: false, refused: 'target handle has expired — discover again' };
  return { ok: true, payload };
}
