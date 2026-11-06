// A Home's front-channel sign-out (ap-home spec 445 §16): the Home navigates the browser to an app's
// `/sso-logout?return=<url>`, the app clears its own session and sends the person back so the Home can walk on.
// The Worker answers this path itself, ahead of the built app, so the page runs before anything restores a session.
import type { TownManifest } from './types';

/**
 * Where the person goes next: the `/logout` of one of this town's Homes, and nowhere else — any other `return` would
 * make this an open redirect. Compared as parsed origins: `https://www.faithnet.me.evil.test` starts with the Home's
 * URL and is not the Home.
 */
export function ssoLogoutReturn(town: Pick<TownManifest, 'estates'>, requested: string | null): string {
  try {
    const u = new URL(requested ?? '');
    if (u.pathname === '/logout' && town.estates.some((e) => new URL(e.home).origin === u.origin)) return u.toString();
  } catch { /* no return, or a malformed one: stay on this site */ }
  return '/';
}

/** A value inside an inline script: `<` escaped, so nothing in it can close the tag. */
const inScript = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

/**
 * The page. The session lives in one tab's sessionStorage, so this tab cannot clear another's: `marker` in localStorage
 * tells every other tab (a `storage` event while open, and a session older than the marker is refused at boot).
 */
export function ssoLogoutPage(town: Pick<TownManifest, 'estates'>, url: URL, opts: { marker: string; clear: readonly string[] }): Response {
  const script = [
    `try { localStorage.setItem(${inScript(opts.marker)}, String(Date.now())); } catch { /* blocked: this tab is still cleared below */ }`,
    `try { for (const k of ${inScript(opts.clear)}) sessionStorage.removeItem(k); } catch { /* blocked */ }`,
    `location.replace(${inScript(ssoLogoutReturn(town, url.searchParams.get('return')))});`,
  ].join('\n');
  return new Response(`<!doctype html><meta charset="utf-8"><title>Signing out</title><script>\n${script}\n</script><p>Signing out…</p>`, {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
