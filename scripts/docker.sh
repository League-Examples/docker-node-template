#!/usr/bin/env bash
# Docker compose lifecycle dispatcher.
# Reads DOCKER_CONTEXT (and APP_DOMAIN/APP_PORT for the up message) from .env.
# Usage: ./scripts/docker.sh <build|up|down|restart|redeploy|logs|shell|ps>

set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env
    set +a
fi

: "${DOCKER_CONTEXT:?DOCKER_CONTEXT not set in .env}"

compose=(docker --context "$DOCKER_CONTEXT" compose -f docker-compose.yml)
service=app

verb="${1:-}"

print_url() {
    local domain="${APP_DOMAIN:-localhost}"
    local port="${APP_PORT:-3000}"
    echo ""
    echo "App running on context '$DOCKER_CONTEXT' — http://${domain}:${port}"
}

case "$verb" in
    build)    "${compose[@]}" build ;;
    up)       "${compose[@]}" up -d; print_url ;;
    down)     "${compose[@]}" down ;;
    restart)  "${compose[@]}" down; "${compose[@]}" build; "${compose[@]}" up -d; print_url ;;
    redeploy) "${compose[@]}" down; "${compose[@]}" build; "${compose[@]}" up -d; print_url
              exec "${compose[@]}" logs -f --tail=200 "$service" ;;
    logs)     exec "${compose[@]}" logs -f --tail=200 "$service" ;;
    shell)    exec "${compose[@]}" exec "$service" sh ;;
    ps)       "${compose[@]}" ps ;;
    "")       echo "usage: $0 <build|up|down|restart|redeploy|logs|shell|ps>" >&2; exit 2 ;;
    *)        echo "unknown verb: $verb" >&2; exit 2 ;;
esac
