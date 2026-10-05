# demo-discovery-indexer

Builds the **discovery knowledge base**: enumerates every Smart Agent registered in agent-naming and
projects the available on-chain facets into the A-box (GraphDB @ `agentkg.io`), then loads the
agentic-trust ontology so the graph **self-describes** (T-box + C-box SHACL + A-box together).

Lives in the monorepo (alongside `demo-discovery-a2a` / `demo-discovery-mcp`) and imports
`@agenticprimitives/*` directly — **no vendored ABIs/IRIs**:
- ontology IRIs + SHACL shape IRIs ← `@agenticprimitives/ontology` (`./src/ontology.ts`)
- ontology TTL (for the GraphDB load) ← `@agenticprimitives/ontology/artifacts`
- on-chain view/event ABIs are app-declared (an indexer declares what it reads); `registry-kit` owns the
  registry write/lifecycle ABI this indexer doesn't consume.

> **Ring 0 boundary (ADR-0037):** a *production* indexer is deployed infra and graduates to an external
> `agent-indexer` repo. This is the **demo-grade reference** — kept in the monorepo while the packages are
> unpublished so it imports them cleanly via `workspace:*` (supersedes the earlier standalone sibling).

## Pipeline (extensible facet projection)
Enumerate (`childLabelhashes → childNode → resolveName → reverseResolveString`, recursive, storage views,
no log scan) → run all `FacetProjector`s per SA (naming / profile / registry / relationship / attestation;
attestation via one bounded `Attested`-log sweep) → merge into one ontology-shaped, SHACL-tagged A-box
node → upsert to the store (JSON-LD file | GraphDB SPARQL). Add a source = drop a projector in `projectors.ts`.

## Run
```bash
cp .env.example .env   # fill GRAPHDB_USER / GRAPHDB_PASSWORD (gitignored)
pnpm --filter @ap-town/discovery-indexer index           # enumerate → A-box
pnpm --filter @ap-town/discovery-indexer load-ontology    # load T-box + C-box into GraphDB
```
Verified vs Base Sepolia + GraphDB: 16 `.impact` agents (incl. `lbsb`/`fbsb`) + the full ontology
(94 `owl:Class`, 11 `sh:NodeShape`) in the `smart-agents` repo.
