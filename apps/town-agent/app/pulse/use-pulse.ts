// THE PULSE READ, SHARED — spec 437. Two surfaces ask for it now: the operations centre (every tab) and a single
// service's own page, which shows what that service runs on and what it costs. One hook so they cannot drift into
// two readings of one number, and so the operator's token is held in exactly one place.
//
// The token unlocks a READ and grants nothing: it is kept in this tab's sessionStorage, sent as a bearer on the
// pulse request, and the server decides what `detail` means. A page without it still renders — status is public;
// amounts and metrics are withheld and SAID to be withheld, never zeroed to look complete (I3).
import { useEffect, useState } from 'react';
import type { Loaded, PulseWindow } from '@ap-town/town-ui';
import type { PerfView } from './InfraTabs';
import type { PulseReadV1 } from '../../worker/pulse';
import { connectionToken } from '../Connect';

/** The Pulse read plus spec 437's performance view (`/api/pulse` returns both). */
export type PulseView = PulseReadV1 & { performance: PerfView };

export const TOKEN_KEY = 'ap-town.ops-token';
export const readToken = (): string | null => { try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; } };

/** `/api/pulse` for a window; with the operator's token the read carries cost and metrics (spec 437 / 434 §10). */
export function usePulse(window: PulseWindow, token: string | null): Loaded<PulseView> {
  const [v, setV] = useState<Loaded<PulseView>>({ state: 'loading' });
  // WHO IS ASKING: the pasted ops token if there is one, otherwise the session the reader's own Home gave
  // them when they connected. The second is the one a person should be using — the town verifies it against
  // that Home's keys and looks them up in the manifest — and it means an operator who is signed in never has
  // to find a shared secret. A reader who is neither gets the public page, which is what it is for.
  const bearer = token ?? connectionToken();
  useEffect(() => {
    let live = true; setV({ state: 'loading' });
    fetch(`/api/pulse?window=${window}`, { headers: { accept: 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } })
      .then(async (r) => { const body = (await r.json().catch(() => null)) as PulseView | null; if (!live) return; setV(r.ok && body ? { state: 'ready', data: body } : { state: 'error', status: r.status, error: { error: `http_${r.status}` } }); })
      .catch((e) => { if (live) setV({ state: 'error', status: 0, error: { error: 'unreachable', detail: String((e as Error).message) } }); });
    return () => { live = false; };
  }, [window, bearer]);
  return v;
}
