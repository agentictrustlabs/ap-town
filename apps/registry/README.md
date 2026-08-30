# demo-discovery-a2a

Discovery **A2A agent** — the agent surface for discovery. Advertises a `discover-agents` skill
(`/.well-known/agent-card.json`) and orchestrates the discovery MCP over the knowledge base: a query
(and, increasingly, a stated **intent + mandate**) → MCP `search_agents` → rank by relevance + verifiable
trust → best agents with an evidence path. Mirrors `demo-bible-a2a` from `verifiable-content-demo`.

Reaches the MCP via a **service binding** (`env.MCP`) in production (a Worker can't fetch another Worker
on the same account by public URL — CF 1042); falls back to `MCP_URL` for local dev.

Chain: **browser → demo-discovery-a2a → demo-discovery-mcp → GraphDB knowledge base**.

## Architecture
See [`docs/architecture-and-design.md`](docs/architecture-and-design.md) for the Discovery A2A endpoint design, including the `/api/a2a` target, `/discover` shim, offering/source-observation model, reproducible discovery receipts, ranking policy, MCP contract, and source-adapter phases.

## Evolving into a full discovery app
The `discover-agents` skill is the seam where **intent + mandate matching** grows: parse the stated
intent/mandate, expand it (skills / geo / trust), query the graph, and return the best agents with an
explainable evidence path. This service is intended to grow into a full-featured discovery app.

## Agent service + custodial management
Like the MCP, this A2A agent is itself an **agent service** with a Smart Agent identity
(`discovery.agent`), **custodian-governed** lifecycle (deploy, config, the registry entry it
self-publishes — so the discovery agent is itself discoverable), and admin via its custodian SA. A
reference example of an agent service and its management by the custodian of that service.

## Run / deploy
```bash
pnpm --filter @agenticprimitives-demo/discovery-a2a dev      # local (port 8791)
pnpm --filter @agenticprimitives-demo/discovery-a2a deploy   # → workers.dev (service-bound to the MCP)
```
Live: https://demo-discovery-a2a.richardpedersen3.workers.dev

## ARD + ACP surfaces (spec 347 §8.5)

This Worker is the `discovery.registry` Service Agent's public discovery envelope, conformant to
[Agentic Resource Discovery v0.91](https://agenticresourcediscovery.org/spec/): `GET /.well-known/ard.json` (registry
entry + one entry per agent with an A2A host), `POST /search` (`{query:{text,filter},pageSize,pageToken,federation}` →
`{results[{…entry, score, source}], pageToken}` — **`score` is relevance only**; trust evidence rides under
`ap:trustEvidence`), `POST /explore` (facets `type`, `capabilities`, `ap:agentType`, `ap:tld`, `ap:kind`), `GET /agents`
(`filter=type = "…" AND tags:"…"`). It also hosts an [ACP registry](https://agentclientprotocol.com/get-started/registry)
projection at `GET /registry/v1/latest/registry.json` over agents whose canonical profile declares an ACP distribution.
Crosswalk + divergences: `docs/architecture/ard-acp-crosswalk.md`. Validate: `pnpm check:demo-discovery-a2a`.
