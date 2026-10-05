# DEPLOYER — who deploys what (spec 399 §5.5 / §10)

Two deployers must never both believe they own a live environment. This file names, per app and per
environment, which repository is the deployer of record. Until an app's announced cut PR, Ring 0
(`agenticprimitives`) deploys the LIVE environments and this repository deploys only its SHADOW environments.

| App | Environment | Deployer of record | Since | Notes |
| --- | --- | --- | --- | --- |
| `apps/<app>` | `env-a-split` (shadow) | ap-discovery | 2026-09-16.1 | fresh DOs, own secrets, own hostnames |
| `apps/<app>` | `env-a` (live) | agenticprimitives (Ring 0) | — | flips here at the cut PR, same Worker name |
| `apps/<app>` | `env-b` (live) | agenticprimitives (Ring 0) | — | idem |

Rules: a row flips only in the cut PR, with the seven green shadow nights attached; a flipped row is reversible by
reverting that PR for the seven nights after; the shadow env keeps deploying meanwhile.
