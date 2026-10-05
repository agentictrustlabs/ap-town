// What the portal reads from its own Worker (`/api/town`): the manifest's summary, each service with its signals,
// and the naming service's summary of the town's names (or null when it could not be asked).
import type { ServiceView } from '../worker/signals';
export type { ServiceView };

export interface EstateSummary { id: string; home: string; edge: string; nameRoots: string[]; repo: string }
export interface NameRow { name: string; label: string; owner: string; kind: string }
export interface NamesSummary { total: number; block: number; roots: Array<{ tld: string; names: string | null; kind: string; legacy: boolean; count: number; sample: NameRow[] }> }
export interface TownData {
  town: string; status: string;
  chain: { id: number; generation: string; rpc: string };
  estates: EstateSummary[];
  services: ServiceView[];
  names: NamesSummary | null;
  card: string;
}
export interface FindResult { results: Array<Record<string, unknown>>; query: string }
