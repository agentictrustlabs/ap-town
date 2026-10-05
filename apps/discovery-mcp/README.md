# demo-discovery-mcp

Discovery **MCP server** — exposes discovery tools (`search_agents`, `get_agent`) over the discovery
knowledge base (GraphDB @ `agentkg.io`, populated by `agent-indexer` from agent-naming + on-chain facets,
spec 279). Holds the GraphDB credentials server-side; the browser never sees them.

Surfaced two ways: a **REST seam** the A2A agent calls (`GET /search`, `GET /agent`) and an **MCP
JSON-RPC** endpoint (`POST /mcp`: `initialize` / `tools/list` / `tools/call`). Mirrors `demo-bible-mcp`
from `verifiable-content-demo`.

Chain: **browser → demo-discovery-a2a → demo-discovery-mcp → GraphDB**.

## Agent service + custodial management
This MCP is itself an **agent service**: it has (will have) a Smart Agent identity in agent-naming
(`discovery-mcp.agent`), and its lifecycle — config, secret rotation (GraphDB creds), deploy, the
registry entry it self-publishes — is **governed by its custodian SA** (custody-policy authorized), the
same model as any agent. It's intended as a reference example of running + managing an agent-backed
service. Admin operations route through the custodian, not ambient operator keys.

## Run / deploy
```bash
pnpm --filter @ap-town/discovery-mcp dev      # local (port 8790)
pnpm --filter @ap-town/discovery-mcp deploy   # → workers.dev
wrangler secret put GRAPHDB_USER ; wrangler secret put GRAPHDB_PASSWORD
```
Live: https://demo-discovery-mcp.richardpedersen3.workers.dev
