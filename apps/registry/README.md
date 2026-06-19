# demo-discovery-a2a

Discovery **A2A agent** — the agent surface for discovery. Advertises a `discover-agents` skill
(`/.well-known/agent-card.json`) and orchestrates the discovery MCP over the knowledge base: a query
(and, increasingly, a stated **intent + mandate**) → MCP `search_agents` → rank by relevance + verifiable
trust → best agents with an evidence path. Mirrors `demo-bible-a2a` from `verifiable-content-demo`.

Reaches the MCP via a **service binding** (`env.MCP`) in production (a Worker can't fetch another Worker
on the same account by public URL — CF 1042); falls back to `MCP_URL` for local dev.

Chain: **browser → demo-discovery-a2a → demo-discovery-mcp → GraphDB knowledge base**.

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
