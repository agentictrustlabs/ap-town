# demo-discovery-connector

Spec 386. A thin, public, read-only Streamable HTTP MCP server for external assistants (a Claude.ai custom connector): `find_services`, `get_service`, `list_topics` over the discovery registry's ARD `POST /search`. The registry finds and points; the assistant goes to the ministry's own website itself. This Worker never calls a ministry's A2A or MCP interface and never relays a page. Every vertical literal lives in `src/whitelabel.ts` (ADR-0021).

- `POST /mcp` — JSON-RPC (`initialize`, `notifications/initialized`, `ping`, `server/discover`, `tools/list`, `tools/call`); `GET /mcp` → 405; `GET /health`.
- faithnet: `https://discovery-connector.faithnet.io/mcp` (registry `discovery-a2a.faithnet.io` over a service binding).
