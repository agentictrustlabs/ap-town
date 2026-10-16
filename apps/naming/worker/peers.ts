// THE OTHER TOWNS' NAMING SERVICES, asked the way the federation's resolver asks them (ap-federation spec 440 §C5):
// through each town's public read API (spec 430 §4), which reads its chain at request time. One universal namespace
// has ONE root (§C1); the other chains carry local tables. So a town that is not the root answers "does this name
// exist / is it free" by asking the root town — and the root town, whose chain says a name is free, asks the other
// towns whether a Home on their chain has claimed it in a local table, because until wave U3 carries such a claim to
// the root that is where it is (`rich-impact.me`, hopechain, 2026-10-15).
//
// The road is a service binding when the Worker has one (`PEER_<TOWN>`), the town's public host otherwise — the same
// choice `chain.ts` makes for the gateway: a Worker that fetches another Worker on its own account by hostname hangs
// under concurrency. Only the road differs; the question and the answer are the same.
//
// An answer a peer cannot give is said as "could not be asked" (`ok: false`), never as "free" and never as "held".
import { TOWNS, type TownManifest } from '@ap-town/town-model';

export interface Peer {
  town: string;
  chainId: number;
  /** The naming service's public host, from that town's manifest. */
  host: string;
  manifest: TownManifest;
  get<T>(path: string): Promise<{ ok: true; data: T } | { ok: false; error: string }>;
}

export type PeerFetcher = { fetch(req: Request): Promise<Response> };

const TIMEOUT_MS = 6000;
/** `PEER_HOPENET` for the hopenet town — the binding name `check:town` holds the wrangler file to. */
export const peerBindingName = (town: string): string => `PEER_${town.toUpperCase().replace(/-/g, '_')}`;

/** Every town other than `self` that runs a naming service, as something that can be asked. */
export function peersOf(self: TownManifest, bindings: Record<string, PeerFetcher | undefined>): Peer[] {
  return Object.values(TOWNS).filter((t) => t.town !== self.town).flatMap((t) => {
    const host = t.services.find((s) => s.id === 'naming')?.hosts[0];
    if (!host) return [];
    const via = bindings[peerBindingName(t.town)];
    const get = async <T,>(path: string) => {
      const url = `https://${host}/api${path}`;
      try {
        const req = new Request(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
        const r = via ? await via.fetch(req) : await fetch(req);
        if (!r.ok) return { ok: false as const, error: `${t.town}'s naming service answered ${r.status} for ${path}` };
        return { ok: true as const, data: (await r.json()) as T };
      } catch (e) { return { ok: false as const, error: `${t.town}'s naming service could not be asked: ${String((e as Error)?.message ?? e)}` }; }
    };
    return [{ town: t.town, chainId: t.chain.id, host, manifest: t, get }];
  });
}
