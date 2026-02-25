#!/usr/bin/env bash
set -euo pipefail

ENV="${1:-}"
RM_FLAG="${2:-}"

if [ -z "$ENV" ]; then
  echo "Usage: load-secrets.sh <dev|prod> [--rm]"
  exit 1
fi

SECRETS_FILE="secrets/${ENV}.env"
CONTEXT_VAR="PROD_DOCKER_CONTEXT"
[ "$ENV" = "dev" ] && CONTEXT_VAR="DEV_DOCKER_CONTEXT"
CONTEXT="${!CONTEXT_VAR}"

if [ "$RM_FLAG" = "--rm" ]; then
  echo "Removing swarm secrets for ${ENV}..."
  sops -d "$SECRETS_FILE" | while IFS='=' read -r key value; do
    [ -z "$key" ] || [[ "$key" =~ ^# ]] && continue
    secret_name="$(echo "$key" | tr '[:upper:]' '[:lower:]')"
    DOCKER_CONTEXT="$CONTEXT" docker secret rm "$secret_name" 2>/dev/null && \
      echo "  removed: $secret_name" || echo "  not found: $secret_name"
  done
  exit 0
fi

echo "Loading swarm secrets for ${ENV} on context ${CONTEXT}..."
sops -d "$SECRETS_FILE" | while IFS='=' read -r key value; do
  [ -z "$key" ] || [[ "$key" =~ ^# ]] && continue
  secret_name="$(echo "$key" | tr '[:upper:]' '[:lower:]')"
  echo "$value" | DOCKER_CONTEXT="$CONTEXT" docker secret create "$secret_name" - 2>/dev/null && \
    echo "  created: $secret_name" || echo "  exists: $secret_name (use --rm first to update)"
done
echo "Done."
