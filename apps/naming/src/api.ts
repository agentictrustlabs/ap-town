// Reading the naming service's API from the app. One fetch per view; an error is shown, never guessed around.
import { useEffect, useState } from 'react';
import type { ApiError } from './api-types';

export type Loaded<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; error: ApiError; status: number };

export async function getJson<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: ApiError; status: number }> {
  let res: Response;
  try { res = await fetch(path, { headers: { accept: 'application/json' } }); }
  catch (e) { return { ok: false, status: 0, error: { error: 'unreachable', detail: String((e as Error).message) } }; }
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok || !body) return { ok: false, status: res.status, error: (body as ApiError | null) ?? { error: `http_${res.status}` } };
  return { ok: true, data: body as T };
}

/** Load `path` and reload when it changes. */
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
