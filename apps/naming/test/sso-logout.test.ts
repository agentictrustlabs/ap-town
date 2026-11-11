import toml from '../wrangler.toml?raw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endIfSignedOut, getSession } from '../src/session';
import worker from '../worker/index';

const session = new Map<string, string>();
const local = new Map<string, string>();
let reloads = 0;

beforeEach(() => {
  session.clear();
  local.clear();
  reloads = 0;
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => session.get(k) ?? null,
    setItem: (k: string, v: string) => void session.set(k, v),
    removeItem: (k: string) => void session.delete(k),
  });
  vi.stubGlobal('localStorage', { getItem: (k: string) => local.get(k) ?? null });
  vi.stubGlobal('window', { location: { reload: () => { reloads += 1; } } });
});

const held = (at?: number) => JSON.stringify({ name: null, label: null, address: '0x', token: 'a.e30.c', ...(at === undefined ? {} : { at }) });
const env = (town: string) => ({ TOWN: town, ASSETS: { fetch: async () => new Response('the app') } }) as unknown as Parameters<typeof worker.fetch>[1];
const exec = {} as Parameters<typeof worker.fetch>[2];
const page = (ret: string, town = 'faithchain') =>
  worker.fetch(new Request(`https://names.example/sso-logout?return=${encodeURIComponent(ret)}`), env(town), exec).then((r) => r.text());

describe('/sso-logout (a Home sign-out passes through)', () => {
  it('the Worker answers it ahead of the built app', () => {
    expect(/^run_worker_first = .*"\/sso-logout"/m.test(toml)).toBe(true);
  });

  it("names this app's keys and returns to the town's own Home only", async () => {
    const good = await page('https://www.faithnet.me/logout');
    expect(good).toContain('location.replace("https://www.faithnet.me/logout")');
    expect(good).toContain('"names.signed-out"');
    expect(good).toContain('["names.session","names.connect.pending"]');
    expect(await page('https://www.faithnet.me.evil.test/logout')).toContain('location.replace("/")');
    // hopenet's Home is not faithchain's, and the reverse.
    expect(await page('https://www.faithnet.me/logout', 'hopenet')).toContain('location.replace("/")');
    expect(await page('https://www.impact-agent.me/logout', 'hopenet')).toContain('location.replace("https://www.impact-agent.me/logout")');
  });
});

describe("a Home's sign-out, seen from another tab", () => {
  it('refuses at boot a session older than the marker, and forgets it', () => {
    session.set('names.session', held(1000));
    local.set('names.signed-out', '2000');
    expect(getSession()).toBeNull();
    expect(session.has('names.session')).toBe(false);
  });

  it('keeps a session made since the sign-out, and one with no sign-out at all', () => {
    session.set('names.session', held(3000));
    local.set('names.signed-out', '2000');
    expect(getSession()?.token).toBe('a.e30.c');
    local.clear();
    session.set('names.session', held());
    expect(getSession()?.token).toBe('a.e30.c');
  });

  it('drops the session and reloads when the marker lands', () => {
    session.set('names.session', held(1000));
    endIfSignedOut({ key: 'names.signed-out' });
    expect(session.has('names.session')).toBe(false);
    expect(reloads).toBe(1);
  });

  it('leaves a tab alone when it holds no session, or the key is another one', () => {
    endIfSignedOut({ key: 'names.signed-out' });
    session.set('names.session', held(1000));
    endIfSignedOut({ key: 'something-else' });
    expect(session.has('names.session')).toBe(true);
    expect(reloads).toBe(0);
  });
});
