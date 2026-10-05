# DEPLOYER — who deploys what

Two deployers must never both believe they own a live environment. This file names, per Worker, the repository that
deploys it. A move between repositories keeps the Worker name, its hosts, its Durable Object classes and its
migration tags exactly as they were (spec 429 D5).

| App | Env | Worker | Deployer of record | Since | Was |
| --- | --- | --- | --- | --- | --- |
| `apps/registry` | faithnet | `demo-discovery-a2a-faithnet` | **ap-town** | 2026-10-05 | ap-discovery |
| `apps/discovery-mcp` | faithnet | `demo-discovery-mcp-faithnet` | **ap-town** | 2026-10-05 | ap-discovery |
| `apps/discovery-indexer` | faithnet | `demo-discovery-indexer-faithnet` | **ap-town** | 2026-10-05 | ap-discovery |
| `apps/discovery-connector` | faithnet | `demo-discovery-connector-faithnet` | **ap-town** | 2026-10-05 | ap-discovery |
| `apps/discovery-connector` | richcanvas | `gc-discovery-connector` (separate account) | **ap-town** | 2026-10-05 | ap-discovery |
| `apps/discovery-web` | faithnet | `demo-discovery-web-faithnet` | **ap-town** | 2026-10-05 | ap-discovery |
| `apps/chain-gateway` | faithnet | `faithchain-rpc-gateway` | **ap-town** | 2026-10-05 | ap-home `apps/rpc-gateway` |
| `apps/registry`, `discovery-mcp`, `discovery-indexer` | default (Base Sepolia demo town) | `demo-discovery-a2a`, `-mcp`, `-indexer` | **ap-town** | 2026-10-05 | ap-discovery |

Not deployed from here (listed in `towns/faithchain/town.yaml`): the estate's Workers (ap-home), skills (skills),
AKCS (faithkms), Game Night (pokernight), the field apps (engage).

Secrets are set per Worker with `wrangler secret put` and survive a redeploy from a new repository; nothing secret is
committed (`.secrets.<env>` and `*.local.json` are gitignored).
