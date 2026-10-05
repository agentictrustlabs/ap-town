#!/usr/bin/env bash
# set-cloudflare-secrets.sh — set each app's Worker secrets for ONE environment from the operator's shell.
#
#   ./scripts/set-cloudflare-secrets.sh <env> apps/<app>            # e.g. env-a-split
#
# Reads NAME=value pairs from `apps/<app>/.secrets.<env>` (gitignored; never committed) and pushes each with
# `wrangler secret put --env <env>`. Values never echo. The live envs are set only by the deployer of record
# (DEPLOYER.md); during the parallel run that is the shadow env only.
set -euo pipefail
ENV_NAME="${1:?usage: set-cloudflare-secrets.sh <env> <app-dir>}"
APP_DIR="${2:?usage: set-cloudflare-secrets.sh <env> <app-dir>}"
FILE="$APP_DIR/.secrets.$ENV_NAME"
[ -f "$FILE" ] || { echo "no $FILE — nothing to set" >&2; exit 2; }
while IFS='=' read -r name value; do
  [ -z "$name" ] && continue
  case "$name" in \#*) continue ;; esac
  printf '%s' "$value" | (cd "$APP_DIR" && npx wrangler secret put "$name" --env "$ENV_NAME") >/dev/null
  echo "set $name for $ENV_NAME ($APP_DIR)"
done < "$FILE"
