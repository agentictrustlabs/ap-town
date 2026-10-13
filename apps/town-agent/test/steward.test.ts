// THE OPERATOR READ WITHOUT A SHARED SECRET — spec 437 I7. These are the four links of the chain, each one
// tested by breaking it: a token this town should not believe must not open the amounts, and the reason must
// say which link failed, because "unauthorized" teaches nobody anything.
import { describe, it, expect } from 'vitest';
import type { TownManifest } from '@ap-town/town-model';
import { allowedIssuers, declaredOperators, readAsOperator } from '../worker/steward';

const HOME = 'https://home.example';
const OPERATOR = '0xAbC0000000000000000000000000000000000001';
const STRANGER = '0x00000000000000000000000000000000000000ff';
const town = {
  town: 'faithchain', status: 'live', chain: { id: 34348, generation: '1', rpc: 'https://rpc' },
  estates: [{ id: 'faithnet', home: `${HOME}/`, repo: 'r', edge: 'e', a2a: 'a', agentZone: 'z', nameRoots: [], lanes: {} }],
  services: [],
  operators: [{ sa: OPERATOR, label: 'Town Operator' }],
} as unknown as TownManifest;

/** One real ES256 key pair, so the signature path is exercised rather than stubbed. */
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
const b64 = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const seg = (o: unknown): string => b64(new TextEncoder().encode(JSON.stringify(o)));
async function token(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = seg({ alg: 'ES256', kid: 'k1', typ: 'JWT', ...header });
  const p = seg({ iss: HOME, sub: `eip155:34348:${OPERATOR}`, exp: Math.floor(Date.now() / 1000) + 600, agent_name: 'Rich', ...claims });
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64(sig)}`;
}
const jwks = (keys: unknown[] = [jwk]): typeof fetch => (async () => new Response(JSON.stringify({ keys }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

describe('reading the operator view as a connected person (spec 437 I7)', () => {
  it('the manifest decides which Homes are believed and who is listed', () => {
    expect(allowedIssuers(town)).toEqual([HOME]);
    expect(declaredOperators(town)).toEqual([{ sa: OPERATOR.toLowerCase(), label: 'Town Operator' }]);
    // Absent is NOBODY, never everybody: silence must not be the open door.
    expect(declaredOperators({ ...town, operators: undefined } as TownManifest)).toEqual([]);
  });

  it('a listed operator, signed in at a declared Home, reads', async () => {
    const r = await readAsOperator(town, `Bearer ${await token({})}`, jwks());
    expect(r).toMatchObject({ ok: true, agent: OPERATOR.toLowerCase(), name: 'Rich', issuer: HOME });
  });

  it('breaks the chain one link at a time, and says which', async () => {
    // 1. an issuer no estate declares — otherwise the gate is "bring your own identity provider"
    const foreign = await readAsOperator(town, `Bearer ${await token({ iss: 'https://evil.example' })}`, jwks());
    expect(foreign).toMatchObject({ ok: false });
    expect((foreign as { reason: string }).reason).toMatch(/not a Home this town's manifest declares/);

    // 2. A FORGED SIGNATURE: signed by somebody else's key, while the Home publishes its own. (Signing with
    //    the real key and merely SERVING another is not a forgery — the first version of this test did that,
    //    the cached real key verified it, and it was right to.)
    const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const h = seg({ alg: 'ES256', kid: 'k1', typ: 'JWT' });
    const pl = seg({ iss: HOME, sub: `eip155:34348:${OPERATOR}`, exp: Math.floor(Date.now() / 1000) + 600 });
    const badSig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, other.privateKey, new TextEncoder().encode(`${h}.${pl}`)));
    const forged = await readAsOperator(town, `Bearer ${h}.${pl}.${b64(badSig)}`, jwks());
    expect((forged as { reason: string }).reason).toMatch(/not signed by the Home it names/);

    // 3. expiry is the issuer's own claim, and it is honoured
    const stale = await readAsOperator(town, `Bearer ${await token({ exp: Math.floor(Date.now() / 1000) - 60 })}`, jwks());
    expect((stale as { reason: string }).reason).toMatch(/expired/);

    // 4. a real person, really signed in, who is simply not listed
    const nobody = await readAsOperator(town, `Bearer ${await token({ sub: `eip155:34348:${STRANGER}` })}`, jwks());
    expect((nobody as { reason: string }).reason).toMatch(/does not list you as one of its operators/);

    // and an unsigned token ("alg: none" is the oldest trick there is)
    const none = await readAsOperator(town, `Bearer ${await token({}, { alg: 'none' })}`, jwks());
    expect((none as { reason: string }).reason).toMatch(/verifies ES256/);

    // nothing presented at all is a stranger, not an error
    expect(await readAsOperator(town, null, jwks())).toMatchObject({ ok: false, reason: 'no id_token presented' });
  });
});
