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
| `apps/town-agent` | faithnet | `faithchain-town-agent` (`town.faithnet.io`) | **ap-town** | 2026-10-05 | new |
| `apps/naming` | faithnet | `faithchain-naming` (`names.faithnet.io`) | **ap-town** | 2026-10-05 | new |
| `apps/registry`, `discovery-mcp`, `discovery-indexer` | default (Base Sepolia demo town) | `demo-discovery-a2a`, `-mcp`, `-indexer` | **ap-town** | 2026-10-05 | ap-discovery |

Not deployed from here (listed in `towns/faithchain/town.yaml`): the estate's Workers (ap-home), skills (skills),
AKCS (faithkms), Game Night (pokernight), the field apps (engage).

Chain access: each town Worker that reads the chain holds its own read-only app token for the town's gateway as an
`RPC_URL` secret (`discovery-indexer-faithnet`, `naming-faithnet`; the skills service holds `skills-a2a-production`).
A new token is one KV entry on the gateway (`apps/chain-gateway/README.md`) and is set with the deploy
(`wrangler deploy --env faithnet --secrets-file <file>`), so the Worker never runs without it.

Secrets are set per Worker with `wrangler secret put` and survive a redeploy from a new repository; nothing secret is
committed (`.secrets.<env>` and `*.local.json` are gitignored).
