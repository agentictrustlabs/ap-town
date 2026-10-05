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
export interface FindHit {
  name: string | null; smartAgent: string; score: number; why: string[]; registered?: boolean; shaclConforms?: boolean;
  agentType?: string | null; tld?: string | null; kind?: string; facets?: string[]; capabilityIds?: string[];
  offerings?: Array<{ skillId?: string; name?: string | null }>; validAttestations?: number; activeRelationships?: number;
}
export interface FindResult { ok: boolean; query: string; type: string; registered: boolean; matched?: number; droppedBy?: Record<string, number>; results: FindHit[]; error?: string }
export interface Facets { ok: boolean; agentTypes: Array<{ value: string; count: number }>; kinds: Array<{ value: string; count: number }>; capabilityIds: Array<{ value: string; count: number }>; undeclaredType?: number }
export interface AgentDetail {
  key: string;
  agent: { ok: boolean; agent?: string; triples?: Array<{ p: string; o: string }>; error?: string };
  offerings: { ok?: boolean; offerings?: Array<{ skillId: string; name: string | null; effect?: string | null; exposure?: string | null; family?: string | null; status?: string | null; source?: string | null }>; error?: string } | null;
}
