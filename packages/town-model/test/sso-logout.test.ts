import { describe, expect, it } from 'vitest';
import { ssoLogoutPage, ssoLogoutReturn } from '../src/sso-logout';

const HOME = 'https://www.faithnet.me';
const town = { estates: [{ home: HOME }] } as unknown as Parameters<typeof ssoLogoutReturn>[0];

/** Run the page's own script against stand-ins for the browser's storage and location. */
async function run(ret: string | null, opts = { marker: 'x.signed-out', clear: ['x.session', 'x.pending'] }) {
  const url = new URL('https://app.example/sso-logout');
  if (ret !== null) url.searchParams.set('return', ret);
  const html = await ssoLogoutPage(town, url, opts).text();
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  const local = new Map<string, string>();
  const session = new Map([['x.session', 't'], ['x.pending', 'p'], ['x.other', 'o']]);
  let went = '';
  new Function('localStorage', 'sessionStorage', 'location', script)(
    { setItem: (k: string, v: string) => local.set(k, v) },
    { removeItem: (k: string) => session.delete(k) },
    { replace: (u: string) => { went = u; } },
  );
  return { html, local, session, went };
}

describe('where a sign-out returns to', () => {
  it("goes back to the Home's /logout, with its query", () => {
    expect(ssoLogoutReturn(town, `${HOME}/logout`)).toBe(`${HOME}/logout`);
    expect(ssoLogoutReturn(town, `${HOME}/logout?next=2`)).toBe(`${HOME}/logout?next=2`);
  });

  it.each([
    ['a host that only starts with the Home', 'https://www.faithnet.me.evil.test/logout'],
    ['the Home as a username', 'https://www.faithnet.me@evil.test/logout'],
    ['another host', 'https://evil.test/logout'],
    ['the Home over http', 'http://www.faithnet.me/logout'],
    ['another port', 'https://www.faithnet.me:8443/logout'],
    ['another path on the Home', `${HOME}/`],
    ['a longer path on the Home', `${HOME}/logout/x`],
    ['a script', 'javascript:alert(1)//www.faithnet.me/logout'],
    ['a relative path', '/logout'],
    ['nothing usable', 'not a url'],
    ['nothing', null],
  ])('refuses %s', (_why, ret) => {
    expect(ssoLogoutReturn(town, ret)).toBe('/');
  });

  it('accepts any Home of a town with two estates', () => {
    const two = { estates: [{ home: HOME }, { home: 'https://www.impact-agent.me/' }] } as unknown as typeof town;
    expect(ssoLogoutReturn(two, 'https://www.impact-agent.me/logout')).toBe('https://www.impact-agent.me/logout');
  });
});

describe('the page', () => {
  it('marks the other tabs, clears this one, and leaves what is not the session', async () => {
    const r = await run(`${HOME}/logout`);
    expect(Number(r.local.get('x.signed-out'))).toBeGreaterThan(0);
    expect([...r.session.keys()]).toEqual(['x.other']);
    expect(r.went).toBe(`${HOME}/logout`);
  });

  it('works with no return at all: this site, still cleared', async () => {
    const r = await run(null);
    expect(r.went).toBe('/');
    expect(r.session.has('x.session')).toBe(false);
  });

  it('sends a refused return home, not onward', async () => {
    expect((await run('https://www.faithnet.me.evil.test/logout')).went).toBe('/');
  });

  it('no return can break out of the script', async () => {
    const r = await run(`${HOME}/logout?x=</script><script>alert(1)</script>`);
    expect(r.html.match(/<script>/g)).toHaveLength(1);
    expect(new URL(r.went).origin).toBe(HOME);
  });

  it('is not cached', () => {
    expect(ssoLogoutPage(town, new URL('https://a.example/sso-logout'), { marker: 'm', clear: [] }).headers.get('cache-control')).toBe('no-store');
  });
});
