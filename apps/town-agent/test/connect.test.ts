// The two legs of Connect, as behaviour: where it SENDS the browser.
//
// Both of these shipped wrong and neither showed up in a typecheck or a build. The leg out went to
// `<home>/authorize`, a 404 on a real Home — its authorization endpoint is the origin ROOT, because
// the consent screen and the ROOT-passkey ceremony are the SPA served there. And disconnecting cleared
// this tab only, leaving the person signed in at their Home and at every other app on it.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { goToHome, disconnectEverywhere, connectionToken } from '../app/Connect';

const HOME = 'https://www.faithnet.me';
const store = new Map<string, string>();
let assigned = '';

beforeEach(() => {
  store.clear();
  assigned = '';
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('window', {
    location: { origin: 'https://town.faithnet.io', pathname: '/agent/x', search: '', assign: (u: string) => { assigned = u; } },
    dispatchEvent: () => true,
  });
  vi.stubGlobal('crypto', {
    getRandomValues: (a: Uint8Array) => { a.fill(7); return a; },
    randomUUID: () => 'state-uuid',
    subtle: { digest: async () => new Uint8Array(32).fill(9).buffer },
  });
});

describe('the leg out', () => {
  it('goes to the Home ROOT, which is where the authorization endpoint is', async () => {
    await goToHome(HOME);
    const u = new URL(assigned);
    expect(u.origin).toBe(HOME);
    expect(u.pathname).toBe('/'); // NOT /authorize — that is a 404 on a real Home
  });

  it('carries the registered client, an exact redirect, and S256 PKCE', async () => {
    await goToHome(HOME);
    const q = new URL(assigned).searchParams;
    expect(q.get('client_id')).toBe('town-app');
    expect(q.get('redirect_uri')).toBe('https://town.faithnet.io/connected');
    expect(q.get('response_type')).toBe('code');
    expect(q.get('code_challenge_method')).toBe('S256');
    expect(q.get('code_challenge')).toBeTruthy();
    expect(q.get('state')).toBe('state-uuid');
  });

  /** site-login asserts who someone is and carries no authority to act for them (spec 429 D2). */
  it('asks for site-login and nothing wider', async () => {
    await goToHome(HOME);
    expect(new URL(assigned).searchParams.get('delegation_template')).toBe('site-login');
  });

  /** The verifier is the one secret of the round trip and it never leaves the tab. */
  it('keeps the verifier in this tab and sends only its hash', async () => {
    await goToHome(HOME);
    const pending = JSON.parse(store.get('ap-town.connecting')!);
    expect(pending.verifier).toBeTruthy();
    expect(assigned).not.toContain(pending.verifier);
  });

  it('remembers the page the person was on, so connecting does not lose it', async () => {
    await goToHome(HOME);
    expect(store.get('ap-town.return-to')).toBe('/agent/x');
  });
});

describe('the teardown', () => {
  beforeEach(() => {
    store.set('ap-town.home-session', JSON.stringify({ token: 't', name: 'rich.me', agent: '0xabc', home: HOME }));
  });

  it('ends the session at the Home, not just in this tab', () => {
    disconnectEverywhere({ token: 't', name: 'rich.me', agent: '0xabc', home: HOME });
    const u = new URL(assigned);
    expect(u.origin).toBe(HOME);
    expect(u.pathname).toBe('/logout');
    // The Home checks `return` against its registered relying origins and bounces back here.
    expect(u.searchParams.get('return')).toBe('https://town.faithnet.io/');
  });

  it('clears this tab even so — a bounce that never happens must not leave a live token', () => {
    disconnectEverywhere({ token: 't', name: 'rich.me', agent: '0xabc', home: HOME });
    expect(connectionToken()).toBeNull();
    expect(store.has('ap-town.home-session')).toBe(false);
  });

  it('still clears the tab when the Home URL is unusable', () => {
    disconnectEverywhere({ token: 't', name: null, agent: null, home: 'not a url' });
    expect(connectionToken()).toBeNull();
    expect(assigned).toBe('');
  });
});
