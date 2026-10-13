// Reading a town service's API from an app. One fetch per view; an error is shown, never guessed around.
import { useEffect, useState } from 'react';

export interface ApiError { error: string; detail?: string }
export type Loaded<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; error: ApiError; status: number };

/**
 * WHO THE APP IS, for every read it makes — registered once by the app, consulted here.
 *
 * An app whose pages are behind a sign-in has to send the credential on EVERY read, not on the two a developer
 * remembered: when the town's API went behind a sign-in, `usePulse` and the Ask sent it and every page built on
 * `useApi` did not, so a signed-in reader got an empty MCP page and a Find page with no census — a 401 rendered
 * as nothing rather than as a refusal (2026-10-13). One place to register it, one place to read it.
 *
 * This package stays ignorant of what the credential IS: it calls the function and puts the header on the
 * request. Nothing here stores or inspects it.
 */
let authHeader: (() => Record<string, string> | undefined) | null = null;
export function setAuthHeader(fn: (() => Record<string, string> | undefined) | null): void { authHeader = fn; }

/** `headers` carries the CALLER's own credential when they brought one (their Home session); when they did not
 *  pass one explicitly, the app's registered provider is asked. It is put on the request and nowhere else. */
export async function getJson<T>(path: string, headers?: Record<string, string>): Promise<{ ok: true; data: T } | { ok: false; error: ApiError; status: number }> {
  let res: Response;
  const auth = headers ?? authHeader?.();
  try { res = await fetch(path, { headers: { accept: 'application/json', ...auth } }); }
  catch (e) { return { ok: false, status: 0, error: { error: 'unreachable', detail: String((e as Error).message) } }; }
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !body) return { ok: false, status: res.status, error: (body as ApiError | null) ?? { error: `http_${res.status}` } };
  return { ok: true, data: body as T };
}

export function useApi<T>(path: string | null): Loaded<T> {
  const [v, setV] = useState<Loaded<T>>({ state: 'loading' });
  useEffect(() => {
    if (!path) return;
    let live = true;
    setV({ state: 'loading' });
    void getJson<T>(path).then((r) => { if (live) setV(r.ok ? { state: 'ready', data: r.data } : { state: 'error', error: r.error, status: r.status }); });
    return () => { live = false; };
  }, [path]);
  return v;
}
