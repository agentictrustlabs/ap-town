# ap-discovery

A product repository on published `@agenticprimitives/*` packages, generated from the Developer Kit's
`product-repo` template (spec 399 §3.6, revision 2026-09-16.1) by `@agenticprimitives/create-app`
0.0.0-alpha.9. Ring 0 (`agenticprimitives`) keeps the packages, the contracts and the kit; this repository
owns its UX, its runtime (Workers, Durable Objects, bindings, wrangler configs, secrets), its ops scripts, its
live gates, its product specs and its white-label config (ADR-0063 §2).

## Layout

| Path | What lives there |
| --- | --- |
| `apps/*` | the product's deployables — each with its own `wrangler.toml` (see `wrangler.example.toml` for the env layout) |
| `examples/*` | relying-app demonstrations of the product's ceremonies; each builds against published packages or is retired |
| `scripts/` | ops scripts that operate THIS product's deployments (`set-cloudflare-secrets.sh`, provisioning, verify scripts) |
| `live-gates.json` | the live-gates ledger (spec 392 shape) the nightly runs through `ap test --live-gates` |
| `agentic.lock.json` | the coherent `@agenticprimitives/*` set, the rules-source digests, the doctor config |
| `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/` | projected from the pinned rules source — regenerate with `ap doctor --rules --write`, never edit the managed block |
| `DEPLOYER.md` | which repository deploys which Worker, and in which environment — one line per app |

## Commands

```
pnpm install
pnpm doctor                     # ap doctor — the doctrine rules over this tree
pnpm doctor:rules               # drift between the projected rules and the pinned source
pnpm upgrade:canary             # newest canary of every pin, one coherent set, then doctor
pnpm upgrade:pin 1.0.0-alpha.24 # or one named version / dist-tag
pnpm live-gates                 # the ledger against HOME_URL (nightly in CI)
pnpm conform:a2a https://…      # A2A 1.0 conformance of a deployment
pnpm conform:mcp https://…      # MCP conformance of a deployment
```

## Rules that bind every change

- Every `@agenticprimitives/*` dependency is an exact published version; the set is coherent (`lock-coherent`).
- Doctrine is projected, never restated: `AGENTS.md` / `CLAUDE.md` managed blocks and `.cursor/rules/*.mdc` come
  from the pinned source by digest (`rules-drift`). A product repo may not paraphrase a rule.
- A shadow environment (`<env>-split`) is where this repo deploys during a parallel run; the live environment
  changes hands only at the announced cut (spec 399 §5.3). Worker names, DO bindings and migration tags never change.
