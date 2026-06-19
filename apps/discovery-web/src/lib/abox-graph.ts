// Reads the discovery A-box produced by the external agent-indexer (naming enumeration → SHACL-shaped
// graph of every Smart Agent + its on-chain facets). In production the UI queries the discovery API over
// GraphDB (agentkg.io); here it fetches the indexer's JSON-LD snapshot — the same A-box, same shape. This
// is the "indexer → A-box → UI" loop: every named agent + whatever facets it carries, projected once.

const NS = 'https://agenticprimitives.dev/ns/';
const P_SA = `${NS}core#smartAgent`;
const P_NAME = `${NS}naming#name`;
const P_NODE = `${NS}naming#node`;

export interface AboxAgent {
  id: string;
  smartAgent: string;
  name: string | null;
  node: string;
  conforms: boolean;
  facets: { kind: string; present: boolean; pending: string | null }[];
  raw: Record<string, unknown>;
}

export interface AboxDoc {
  agents: AboxAgent[];
  facetCoverage: Record<string, number>;
}

export async function loadAboxGraph(url = '/discovery-graph.jsonld'): Promise<AboxDoc> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`A-box fetch failed: ${res.status}`);
  const doc = (await res.json()) as { '@graph'?: Record<string, unknown>[] };
  const graph = doc['@graph'] ?? [];
  const agents: AboxAgent[] = graph.map((n) => {
    const coverage = (n['ap:facetCoverage'] as { kind: string; present: boolean; pending: string | null }[] | undefined) ?? [];
    return {
      id: String(n['@id'] ?? ''),
      smartAgent: String(n[P_SA] ?? ''),
      name: (n[P_NAME] as string | null) ?? null,
      node: String(n[P_NODE] ?? ''),
      conforms: n['sh:conforms'] !== false,
      facets: coverage,
      raw: n,
    };
  });
  const facetCoverage: Record<string, number> = {};
  for (const a of agents) for (const f of a.facets) if (f.present) facetCoverage[f.kind] = (facetCoverage[f.kind] ?? 0) + 1;
  return { agents, facetCoverage };
}
