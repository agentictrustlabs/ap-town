#!/usr/bin/env bash
# Spec 437 I7/§4 — the TOWN MCP's read-only tokens for the platforms it samples. The town MCP (apps/town-mcp) is the
# only Worker that holds them and the only one that reaches a provider; the portal holds none (the owner's rule,
# 2026-10-10: "the town app should not retrieve this data"). Values come from `.env.ops.local` (gitignored, 0600;
# never printed); an unset one is skipped and the Pulse shows that source as "not configured".
#
#   CLOUDFLARE_ACCOUNTS   JSON [{"id":"<account id>","label":"faithnet-town","token":"<API token: Account Analytics Read>"}, …]
#                         (ids must match towns/<town>/town.yaml accounts.cloudflare; one token per account, created at
#                         dash.cloudflare.com → My Profile → API Tokens → Custom → Account · Account Analytics · Read)
#   VERCEL_TOKEN          vercel.com → Settings → Tokens (read is enough for deployments; billing/charges needs the team owner's)
#   AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_SUBSCRIPTION_ID
#                         a service principal with Reader + Cost Management Reader on the subscription:
#                         az ad sp create-for-rbac --name ap-town-pulse --role Reader --scopes /subscriptions/<id>
#                         az role assignment create --assignee <appId> --role "Cost Management Reader" --scope /subscriptions/<id>
#   GRAPHDB_MONITOR_TOKEN the full Authorization header value for GraphDB's /rest/monitor endpoints ("Basic …" or "GDB …")
#
# Usage: scripts/set-pulse-secrets.sh [wrangler env]   (default: faithnet)
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_NAME="${1:-faithnet}"
[ -f .env.ops.local ] || { echo "no .env.ops.local — create it (0600) with the names above"; exit 1; }
set -a; . ./.env.ops.local; set +a
put() { local name="$1"; local val="${!name:-}"; if [ -z "$val" ]; then echo "  skip  $name (unset — the Pulse shows this source as not configured)"; return; fi; printf '%s' "$val" | npx -y wrangler secret put "$name" --env "$ENV_NAME" -c apps/town-mcp/wrangler.toml >/dev/null && echo "  set   $name"; }
echo "town-mcp secrets (env $ENV_NAME):"
for n in TOWN_OPS_TOKEN CLOUDFLARE_ACCOUNTS VERCEL_TOKEN AZURE_TENANT_ID AZURE_CLIENT_ID AZURE_CLIENT_SECRET AZURE_SUBSCRIPTION_ID GRAPHDB_MONITOR_TOKEN; do put "$n"; done
echo "done — the town MCP's own crons read them: status every 5 min, metrics at :07, cost at 06:30 UTC."
echo "       GET https://town.faithnet.io/api/config names what the town is configured with (never a value)."
