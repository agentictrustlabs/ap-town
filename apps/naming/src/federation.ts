// THE FEDERATION'S RESOLVER, asked from the browser (ap-federation spec 440 C5). This town's chain answers for ITS
// registry; a name is one across the federation, and a claim made on another chain (an estate's Home claims where its
// agent lives — rich-impact.me was born on hopechain on 2026-10-15 while the root said "available") is visible only
// through the resolver that asks every town. Asked from the page, not the Worker: a Worker fetching another Worker on
// this account by its public hostname hangs under concurrency, and the resolver itself asks THIS service, so a
// Worker-side ask would be a loop. The one federation literal of this app lives here.
export const FEDERATION_RESOLVER = 'https://ap-federation.faithnet.io/api/names';

export interface Elsewhere { town: string; chainId: number; agent: string | null; display: string }

interface ResolverTownRow { town: string; chainId: number; ok: boolean; row?: { status?: string; agent?: string | null; display?: string } | null }

/** Where else in the federation this name is registered — null when nowhere, or when the resolver could not be asked
 *  (said as null, never as "free": the page keeps the chain's own answer and this is a second signal beside it). */
export async function registeredElsewhere(name: string, hereChainId: number): Promise<Elsewhere | null> {
  try {
    const r = await fetch(`${FEDERATION_RESOLVER}/${encodeURIComponent(name)}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return null;
    const body = (await r.json()) as { towns?: ResolverTownRow[] };
    const hit = (body.towns ?? []).find((t) => t.ok && t.chainId !== hereChainId && t.row?.status === 'registered');
    if (!hit) return null;
    return { town: hit.town, chainId: hit.chainId, agent: hit.row?.agent ?? null, display: hit.row?.display ?? `${name} · ${hit.town} (eip155:${hit.chainId})` };
  } catch { return null; }
}
