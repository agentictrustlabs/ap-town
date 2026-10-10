# inference.svc — the town's model gateway

Spec 434 §9. Two doors over one contract — `POST /v1/generate` (the contract, JSON or SSE) and `POST /v1/chat/completions`
+ `GET /v1/models` (OpenAI-compatible; `model` names a PROFILE) — and `GET /v1/ops/summary` for the Pulse, `GET /healthz`
for the manifest's probe. The handler is `@agenticprimitives/model-gateway`'s; this Worker binds its ports:

| Port | Binding |
| --- | --- |
| principal | `CACHE` KV `client:<sha256(appKey)>` → the client's Service SA (+ estate, kind). A session wire is declared, not served yet. |
| policy | `CACHE` KV `policy:profiles` / `policy:catalog` (W6 admin writes) over `seeds/*.json` as the floor; `entitlement:<sa>` per client |
| meter | `BudgetDO`, one per principal: reserve → settle; alarm expires held reservations at the reserved cost; 30-day receipts table (the rollup source) |
| ledger | inference.svc's vault through the estate vault's native door, as the service itself (`VAULT_GRANT` + `VAULT_SESSION_LEAF` + `INFERENCE_SIGNER_KEY`) |
| adapters | Anthropic (`ANTHROPIC_API_KEY`), OpenAI-compatible per endpoint (`GEMINI_API_KEY` for Gemini; `OPENAI_COMPAT_KEYS` for others) |

```sh
pnpm --filter @ap-town/inference typecheck && pnpm --filter @ap-town/inference test
pnpm --filter @ap-town/inference deploy:faithnet
npx tsx scripts/inference-client.mts <principal-sa> <estate> <kind> <profiles,csv>    # prints the app key once; writes KV
curl -s https://inference.faithnet.io/v1/chat/completions -H "authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"model":"composer-default","messages":[{"role":"user","content":"hello"}]}'
```

The town governs model access and acts for no one: an entitlement is this service's own policy over its own budget,
never a delegation (429 D2 / 434 G8). What a caller says it acts for (`metadata.agent`) is recorded as asserted.
