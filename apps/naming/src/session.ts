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
  /** The name the agent PRESENTS on the chain (`/api/display`), or `null` when nameless — the register flow's first state. */
  readonly name: string | null;
  /** What the Home calls the person (the id_token's `agent_name`), shown when there is no chain name. */
  readonly label: string | null;
  readonly address: string;
  /** The Home id_token: the envelope of every read made as the person. */
  readonly token: string;
  /** The estate the person connected through — where every hand-off goes. */
  readonly estate: EstateRef;
  readonly via: 'home' | 'quick-connect';
  /**
   * A demo person's Home session (quick connect only): the Home popup a ceremony opens adopts it from the URL
   * fragment, the way every relying app hands a demo person to their Home. A real person's Home has its own cookie.
   */
  readonly homeSession?: string;
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

/** The name the agent presents, read from the chain through this service — never the Home's word for it. */
async function withChainName(session: NamesSession): Promise<NamesSession> {
  try {
    const r = await fetch(`/api/display/${session.address}?t=${Date.now()}`, { headers: { accept: 'application/json' } });
    const b = (await r.json()) as { name?: string | null };
    return { ...session, name: r.ok && b.name ? b.name : null };
  } catch { return session; }
}

/** Re-read the presented name (after the person bought their own). */
export async function refreshSessionName(session: NamesSession): Promise<NamesSession> {
  const next = await withChainName(session);
  persist(next);
  return next;
}

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
  const session = await withChainName({ name: null, label: claimed && !ADDRESS_RE.test(claimed) ? claimed : null, address, token: idToken, estate, via: 'home' });
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
  const session = await withChainName({ name: null, label: claimed && !ADDRESS_RE.test(claimed) ? claimed : null, address, token, estate, via: 'quick-connect', ...(s.homeSession ? { homeSession: s.homeSession } : {}) });
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

// ── The ceremony hop (owner, 2026-10-06: "make the transfer to and from Home as simple as connecting") ──────────
// The Home opens in a POPUP, like the connect door. When the purchase or the charter lands, the Home sends the popup
// back here with `?registered=<name>&agent=<address>&popup=1`; this app, loaded in the popup, relays the result to
// the opener over a BroadcastChannel (which survives a severed opener) and closes itself; the opener shows the new
// name. A blocked popup falls back to a full-page hand-off, which comes back to the same `?registered=` leg.

export const HOME_RELAY_CHANNEL = 'naming-app-home-relay';
const JUST_KEY = 'names.justRegistered';

export interface HomeResult { readonly name: string; readonly agent: string | null }

/** The ceremony URL as a popup: `popup=1`, the way back to `/me`, and a demo person's Home session in the fragment. */
function ceremonyUrl(session: NamesSession, href: string): string {
  const u = new URL(href);
  u.searchParams.set('popup', '1');
  u.searchParams.set('return', `${window.location.origin}/me`);
  if (session.via === 'quick-connect' && session.homeSession) u.hash = `session=${encodeURIComponent(session.homeSession)}&via=Wallet`;
  return u.toString();
}

/**
 * Open the Home ceremony in a popup and wait for its result. `null` = the person closed it without finishing;
 * `'blocked'` = no popup could open (the caller navigates instead).
 */
export function openHomeCeremony(session: NamesSession, href: string, onProgress?: (msg: string) => void): Promise<HomeResult | null | 'blocked'> {
  const url = ceremonyUrl(session, href);
  const w = 560, h = 840;
  const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
  const popup = window.open(url, 'ap-home-ceremony', `popup=1,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) return Promise.resolve('blocked');
  onProgress?.('Your Home is open in a window. Finish there; this page follows.');
  return new Promise((resolve) => {
    const bc = new BroadcastChannel(HOME_RELAY_CHANNEL);
    let settled = false;
    const done = (r: HomeResult | null) => {
      if (settled) return;
      settled = true;
      bc.close(); window.removeEventListener('message', onMessage); clearInterval(poll);
      if (r) rememberJustRegistered(r);
      resolve(r);
    };
    const take = (data: unknown) => {
      const d = data as { type?: string; name?: string; agent?: string | null } | null;
      if (d && d.type === 'ap:naming:registered' && d.name) done({ name: d.name, agent: d.agent ?? null });
    };
    bc.onmessage = (e) => take(e.data);
    const onMessage = (e: MessageEvent) => { if (e.origin === window.location.origin) take(e.data); };
    window.addEventListener('message', onMessage);
    const poll = window.setInterval(() => { if (popup.closed) window.setTimeout(() => done(null), 400); }, 500);
  });
}

/** The ceremony as a full page, for a blocked popup: the same return leg lands on `/me?registered=…`. */
export function navigateToHomeCeremony(href: string): void {
  const u = new URL(href);
  u.searchParams.set('return', `${window.location.origin}/me`);
  window.location.assign(u.toString());
}

/**
 * The return leg. In a popup: relay the result to the opener and close. As a full page: remember it and let the
 * page show the new name. Returns the result when this window should go on to render it, else null (closing).
 */
export function takeHomeReturn(search: URLSearchParams): HomeResult | null {
  const name = search.get('registered');
  if (!name) return null;
  const result: HomeResult = { name, agent: search.get('agent') };
  rememberJustRegistered(result);
  if (search.get('popup') !== '1') window.history.replaceState({}, '', `/name/${encodeURIComponent(name)}?just=1`);
  if (search.get('popup') === '1') {
    try { new BroadcastChannel(HOME_RELAY_CHANNEL).postMessage({ type: 'ap:naming:registered', ...result }); } catch { /* the page below still shows it */ }
    try { window.opener?.postMessage({ type: 'ap:naming:registered', ...result }, window.location.origin); } catch { /* severed opener — the channel carried it */ }
    window.setTimeout(() => window.close(), 150);
  }
  return result;
}

export function rememberJustRegistered(r: HomeResult): void {
  try { sessionStorage.setItem(JUST_KEY, JSON.stringify({ ...r, at: Date.now() })); } catch { /* the page still loads */ }
}
/** The name registered in the last few minutes, for the page that shows it; cleared by the caller when shown. */
export function justRegistered(): HomeResult | null {
  try {
    const raw = sessionStorage.getItem(JUST_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as HomeResult & { at: number };
    return Date.now() - r.at < 10 * 60_000 ? { name: r.name, agent: r.agent } : null;
  } catch { return null; }
}
export function forgetJustRegistered(): void { try { sessionStorage.removeItem(JUST_KEY); } catch { /* nothing */ } }

// ── Your agents (W5c) ─────────────────────────────────────────────────────────────────────────────────────────────

export interface YourAgent {
  readonly agent: string;
  /** The name the agent PRESENTS on the chain, read through this service; null when it has none. */
  readonly name: string | null;
  /** What the person's Home calls it (a common name, or the chain name again). */
  readonly label: string | null;
  readonly kind: string;
  readonly relationship: string;
}

/**
 * The agents the connected person keeps, read from their Home with the session this site holds — the same list
 * their Stewardship page shows: a second person of theirs, organizations, teams, services, treasuries. Links where
 * they are only a member are not theirs and are left out. The Home answers a registered relying app's token with
 * the person's own view; the NAMES come from the chain, through this service, never from the Home's word. Nothing
 * here can act on any of them.
 */
export async function listYourAgents(session: NamesSession): Promise<YourAgent[]> {
  const home = session.estate.home.replace(/\/$/, '');
  const res = await fetch(`${home}/connect/related-orgs`, { headers: { authorization: `Bearer ${session.token}`, accept: 'application/json' } });
  if (!res.ok) throw new Error(`your Home would not list your agents (${res.status})`);
  const body = (await res.json().catch(() => ({}))) as { orgs?: Array<{ orgAgent?: string; orgName?: string; kind?: string; relationship?: string }> };
  const mine = (body.orgs ?? []).filter((o) => o.orgAgent && ((o.relationship ?? 'steward') === 'steward' || o.relationship === 'self'));
  const addresses = mine.map((o) => String(o.orgAgent).toLowerCase());
  const names: Record<string, string | null> = {};
  for (let i = 0; i < addresses.length; i += 50) {
    const r = await fetch(`/api/display?a=${addresses.slice(i, i + 50).join(',')}&t=${Date.now()}`, { headers: { accept: 'application/json' } });
    const b = (await r.json().catch(() => ({}))) as { names?: Record<string, string | null> };
    Object.assign(names, b.names ?? {});
  }
  return mine.map((o) => {
    const agent = String(o.orgAgent).toLowerCase();
    const label = o.orgName && !ADDRESS_RE.test(o.orgName) ? o.orgName : null;
    return { agent, name: names[agent] ?? null, label, kind: String(o.kind ?? 'org'), relationship: String(o.relationship ?? 'steward') };
  });
}
