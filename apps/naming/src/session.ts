/**
 * Connecting at the naming service (spec 431 §5.1, W5a). The service is a relying app of the estate's Home over
 * `@agenticprimitives/connect-client` — the same door Gather27 and the field app use: FedCM first, then the Home's
 * popup, then a full-page redirect when the popup is blocked. The session lets this site read AS the person (their
 * address, their names); it signs nothing and holds no key. Every purchase and every charter is a hand-off back to
 * the Home, which is why the Home's origin here comes from the town manifest, never from a constant.
 */

import { connectAsQuickConnect, connectViaFedcm, createConnectClient, listQuickConnect, openCentralAuthPopup, relayCodeIfPopupReturn } from '@agenticprimitives/connect-client';

import type { EstateRef } from './api-types';

export const CLIENT_ID = 'naming-app';
export const RELAY_CHANNEL = 'naming-app-connect-relay';
/** The relying-site delegate the Home scopes its login grant TO — the one every town relying app names. */
const CONNECT_DELEGATE = '0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0';

const KEY = 'names.session';
const PENDING_KEY = 'names.connect.pending';
const ERROR_KEY = 'names.connect.error';
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface NamesSession {
  /** The name the Home presented, or `null` when the person is nameless — the register flow's first state. */
  readonly name: string | null;
  readonly address: string;
  /** The Home id_token: the envelope of every read made as the person. */
  readonly token: string;
  /** The estate the person connected through — where every hand-off goes. */
  readonly estate: EstateRef;
  readonly via: 'home' | 'quick-connect';
}

/** A demo person the Home offers for quick connect — the town's roster, never a real person. */
export interface Persona { readonly handle: string; readonly name: string; readonly sa: string; readonly blurb: string }

const isAllowedIssuerOrigin = (estates: EstateRef[]) => (origin: string): boolean => {
  try {
    const host = new URL(origin).hostname;
    return estates.some((e) => {
      const home = new URL(e.home).hostname;
      return host === home || host.endsWith('.' + home.replace(/^www\./, ''));
    });
  } catch { return false; }
};

const client = (estate: EstateRef, estates: EstateRef[]) =>
  createConnectClient({
    clientId: CLIENT_ID,
    delegate: CONNECT_DELEGATE,
    redirectUri: () => `${window.location.origin}/`,
    resolveAuthOrigin: () => estate.home.replace(/\/$/, ''),
    isAllowedIssuerOrigin: isAllowedIssuerOrigin(estates),
  });

function persist(session: NamesSession): void {
  try { sessionStorage.setItem(KEY, JSON.stringify(session)); } catch { /* a private window still gets this page's session */ }
}

function tokenExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number };
    return typeof claims.exp === 'number' ? claims.exp : null;
  } catch { return null; }
}

export function getSession(): NamesSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as NamesSession;
    const exp = tokenExpiry(session.token);
    if (exp !== null && exp * 1000 <= Date.now() + 30_000) { sessionStorage.removeItem(KEY); return null; }
    return session;
  } catch { return null; }
}

export function disconnect(): void {
  try { sessionStorage.removeItem(KEY); } catch { /* nothing to forget */ }
}

/** Full sign-out: the Home ends its own session and bounces back here. */
export function signOutEverywhere(session: NamesSession): void {
  disconnect();
  window.location.assign(`${session.estate.home.replace(/\/$/, '')}/logout?return=${encodeURIComponent(`${window.location.origin}/`)}`);
}

async function finishFromIdToken(c: ReturnType<typeof createConnectClient>, estate: EstateRef, authOrigin: string, idToken: string, nonce = ''): Promise<NamesSession> {
  const claims = await c.verifyIdToken(authOrigin, idToken, nonce);
  const address = c.personAddressFromIdToken(idToken);
  const claimed = String((claims as { agent_name?: string }).agent_name ?? '').trim();
  const session: NamesSession = { name: claimed && !ADDRESS_RE.test(claimed) ? claimed : null, address, token: idToken, estate, via: 'home' };
  persist(session);
  return session;
}

async function finishConnect(c: ReturnType<typeof createConnectClient>, estate: EstateRef, authOrigin: string, code: string, codeVerifier: string, nonce: string): Promise<NamesSession> {
  const { idToken } = await c.exchangeCode(authOrigin, code, codeVerifier);
  if (!idToken) throw new Error('the Home returned no id_token');
  return finishFromIdToken(c, estate, authOrigin, idToken, nonce);
}

function withPopupMode(url: string): string {
  const next = new URL(url);
  next.searchParams.set('mode', 'popup');
  next.searchParams.set('prompt', 'select_account');
  return next.toString();
}
function redirectMode(url: string): string {
  const next = new URL(url);
  next.searchParams.delete('mode');
  return next.toString();
}

/**
 * Connect through the estate's Home. A visitor with no Home yet gets one at the Home's front door — nameless — and
 * comes straight back here, which is the register flow's first step. Resolves `null` when the person closed the
 * popup; never resolves at all on the redirect path (the page navigates away and `completeRedirectIfReturning`
 * finishes on the way back, landing on `returnPath`).
 */
export async function connectViaHome(estate: EstateRef, estates: EstateRef[], returnPath: string, onProgress?: (msg: string) => void): Promise<NamesSession | null> {
  const c = client(estate, estates);
  const home = estate.home.replace(/\/$/, '');
  try {
    const fedcm = await connectViaFedcm(home, CLIENT_ID);
    return await finishFromIdToken(c, estate, fedcm.authOrigin, fedcm.idToken);
  } catch { /* no FedCM, or no Home session yet — the ceremony next */ }
  const start = await c.startEnrollment('');
  const popup = await openCentralAuthPopup(withPopupMode(start.url), start.state, start.authOrigin, RELAY_CHANNEL, onProgress, undefined, c.isAllowedIssuerOrigin);
  if (popup.status === 'success') return finishConnect(c, estate, popup.authOrigin ?? start.authOrigin, popup.code, start.codeVerifier, start.nonce);
  if (popup.status === 'cancelled') return null;
  if (popup.status === 'error') throw new Error(popup.error);
  sessionStorage.setItem(PENDING_KEY, JSON.stringify({ state: start.state, authOrigin: start.authOrigin, codeVerifier: start.codeVerifier, nonce: start.nonce, estate, estates, returnPath }));
  window.location.href = redirectMode(start.url);
  return null;
}

/** The estate's demo roster, for a town visitor who wants to try the flow as one of them. `[]` when the Home offers none. */
export async function listPersonas(estate: EstateRef): Promise<Persona[]> {
  const offered = await listQuickConnect({ homeOrigin: estate.home.replace(/\/$/, ''), clientId: CLIENT_ID });
  return offered
    .map((q) => ({ handle: String(q.handle ?? ''), name: String(q.name ?? q.handle ?? ''), sa: String(q.sa ?? ''), blurb: String(q.blurb ?? '') }))
    .filter((p) => p.handle);
}

export async function connectAsPersona(estate: EstateRef, handle: string): Promise<NamesSession> {
  const s = await connectAsQuickConnect({ homeOrigin: estate.home.replace(/\/$/, ''), clientId: CLIENT_ID }, handle);
  const token = String(s.idToken ?? '');
  if (!token) throw new Error('the Home returned no id_token for that person');
  const address = /0x[0-9a-fA-F]{40}/.exec(String(s.sub ?? ''))?.[0] ?? '';
  const claimed = String(s.agentName ?? '').trim();
  const session: NamesSession = { name: claimed && !ADDRESS_RE.test(claimed) ? claimed : null, address, token, estate, via: 'quick-connect' };
  persist(session);
  return session;
}

/** True at the app's entry when this page is the Home's redirect back from a full-page ceremony. */
export function hasPendingCeremony(state: string | null): boolean {
  if (!state) return false;
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    return Boolean(raw && (JSON.parse(raw) as { state?: string }).state === state);
  } catch { return false; }
}

/** True when this page is the popup's own return leg (COOP severed the opener); the code was relayed to the opener. */
export function relayedToOpener(search: URLSearchParams): boolean {
  return search.get('ac_relay') === '1' && Boolean(search.get('code')) && relayCodeIfPopupReturn(RELAY_CHANNEL);
}

export async function completeRedirectIfReturning(): Promise<NamesSession | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) return null;
  const raw = sessionStorage.getItem(PENDING_KEY);
  if (!raw) return null;
  const stash = JSON.parse(raw) as { state: string; authOrigin: string; codeVerifier: string; nonce: string; estate: EstateRef; estates: EstateRef[]; returnPath?: string };
  if (stash.state !== state) {
    sessionStorage.removeItem(PENDING_KEY);
    throw new Error('the Home returned a state this page did not issue — the callback was discarded');
  }
  try {
    return await finishConnect(client(stash.estate, stash.estates), stash.estate, stash.authOrigin, code, stash.codeVerifier, stash.nonce);
  } catch (e) {
    sessionStorage.setItem(ERROR_KEY, e instanceof Error ? e.message : 'the Home would not complete this connection');
    throw e;
  } finally {
    sessionStorage.removeItem(PENDING_KEY);
    window.history.replaceState({}, '', stash.returnPath ?? '/me');
  }
}

export function consumeConnectError(): string | null {
  try {
    const raw = sessionStorage.getItem(ERROR_KEY);
    if (raw) sessionStorage.removeItem(ERROR_KEY);
    return raw;
  } catch { return null; }
}

/** The kinds a connected person may register a NEW agent as (431 §5.1): the suffix is the type, the kind decides the ending. */
export const CHARTER_KINDS: ReadonlyArray<{ kind: string; tld: string; label: string; blurb: string }> = [
  { kind: 'person', tld: 'me', label: 'A second person', blurb: 'another name of yours, a persona with its own agent and treasury' },
  { kind: 'org', tld: 'org', label: 'An organization', blurb: 'you are its first steward' },
  { kind: 'team', tld: 'team', label: 'A team', blurb: 'an organization of a few' },
  { kind: 'service', tld: 'svc', label: 'A service', blurb: 'a thing that runs, named and reachable' },
  { kind: 'church', tld: 'church', label: 'A church', blurb: 'a congregation; you hold its keys at first' },
  { kind: 'circle', tld: 'circle', label: 'A circle', blurb: 'a small group' },
  { kind: 'household', tld: 'household', label: 'A household', blurb: 'the people at one address' },
];

/**
 * The hand-off to the Home (430 N2 + 431 §5.1): `claim`/`tld` prefill the purchase card for the person's own name;
 * `charter=<kind>` opens the charter-and-buy ceremony for a new agent the person will custody. `return` brings them
 * back to the name page when it lands.
 */
export function handoffHref(estate: EstateRef, p: { claim?: string; tld: string; charter?: string; return?: string }): string {
  const home = estate.home.replace(/\/$/, '');
  const u = new URL(p.charter ? `${home}/naming/register` : `${home}/naming`);
  if (p.charter) u.searchParams.set('charter', p.charter);
  if (p.claim) u.searchParams.set('claim', p.claim);
  u.searchParams.set('tld', p.tld);
  u.searchParams.set('return', p.return ?? (typeof window === 'undefined' ? '' : window.location.href));
  return u.toString();
}
