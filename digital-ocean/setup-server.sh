#!/usr/bin/env bash
set -euo pipefail

# setup-server.sh — Configure a freshly-provisioned Docker droplet.
#
# This script SSHes into the droplet and:
#   1. Creates the "caddy" Docker network
#   2. Copies the Caddy docker-compose stack and starts it
#   3. Verifies Caddy is running with test services (whoami, hello)
#
# Caddy uses caddy-docker-proxy: it reads Docker labels from containers
# on the "caddy" network and auto-configures reverse proxy + TLS.
# No Caddyfile needed — apps just add labels to their services.
#
# Usage:
#   ./digital-ocean/setup-server.sh <number>       e.g. ./digital-ocean/setup-server.sh 2
#
# Prerequisites:
#   - Droplet exists (created by create-droplet.sh)
#   - DO_LEAGUE_STUDENT_TOKEN set in environment
#   - Domain DNS already points to the droplet IP (for TLS)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load config
if [[ -f "$SCRIPT_DIR/config.env" ]]; then
  set -a
  source "$SCRIPT_DIR/config.env"
  set +a
fi

: "${CADDY_ACME_EMAIL:?Set CADDY_ACME_EMAIL in config.env}"
: "${DROPLET_NAME_PREFIX:=docker}"

NUMBER="${1:-}"

if [[ -z "$NUMBER" ]]; then
  echo "Usage: $0 <number>"
  echo ""
  echo "  Sets up ${DROPLET_NAME_PREFIX}<number> with Docker networking and Caddy"
  echo "  Example: $0 2"
  exit 1
fi

if ! [[ "$NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Argument must be a number, got '$NUMBER'"
  exit 1
fi

# --- Token check ---
if [[ -z "${DO_LEAGUE_STUDENT_TOKEN:-}" ]]; then
  echo "ERROR: DO_LEAGUE_STUDENT_TOKEN is not set (needed to look up droplet IP)."
  echo "       See config.env for setup instructions."
  exit 1
fi

DOCTL="doctl --access-token $DO_LEAGUE_STUDENT_TOKEN"
DROPLET_NAME="${DROPLET_NAME_PREFIX}${NUMBER}"

# Look up the droplet IP
DROPLET_IP=$($DOCTL compute droplet list --format Name,PublicIPv4 --no-header \
  | awk -v name="$DROPLET_NAME" '$1 == name { print $2 }')

if [[ -z "$DROPLET_IP" ]]; then
  echo "ERROR: Droplet '$DROPLET_NAME' not found."
  echo "       Check: doctl compute droplet list --access-token \$DO_LEAGUE_STUDENT_TOKEN"
  exit 1
fi

SSH_TARGET="root@$DROPLET_IP"
SSH_OPTS="-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10"

echo "==> Connecting to $DROPLET_NAME ($SSH_TARGET)"

# Test SSH connectivity
if ! ssh $SSH_OPTS "$SSH_TARGET" "echo ok" >/dev/null 2>&1; then
  echo "ERROR: Cannot SSH to $SSH_TARGET"
  echo "       The droplet may still be booting. Wait a minute and retry."
  exit 1
fi

echo "==> Setting up Docker network and Caddy on $DROPLET_NAME ($DROPLET_IP)"

# Step 1: Create the caddy network (if it doesn't exist)
ssh $SSH_OPTS "$SSH_TARGET" bash -s <<'REMOTE_NETWORK'
set -euo pipefail

if ! docker network inspect caddy >/dev/null 2>&1; then
  echo "  Creating Docker network: caddy"
  docker network create caddy
else
  echo "  Docker network 'caddy' already exists"
fi
REMOTE_NETWORK

# Step 2: Copy the caddy compose file to the server
echo "==> Copying Caddy compose stack"
scp $SSH_OPTS "$SCRIPT_DIR/caddy-compose.yml" "$SSH_TARGET:/opt/caddy-compose.yml"

# Step 3: Start the Caddy stack with the correct apps domain
APPS_DOMAIN="apps${NUMBER}.${R53_DOMAIN_BASE:-jointheleague.org}"
echo "==> Starting Caddy stack (APPS_DOMAIN=$APPS_DOMAIN)"
ssh $SSH_OPTS "$SSH_TARGET" bash -s -- "$APPS_DOMAIN" <<'REMOTE_CADDY'
set -euo pipefail

APPS_DOMAIN="$1"
cd /opt
APPS_DOMAIN="$APPS_DOMAIN" docker compose -f caddy-compose.yml up -d

echo ""
echo "  Caddy containers:"
docker compose -f caddy-compose.yml ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}"
REMOTE_CADDY

echo ""
echo "==> Server setup complete: $DROPLET_NAME ($DROPLET_IP)"
echo ""
echo "Caddy is running with caddy-docker-proxy."
echo ""
echo "To deploy an app, its docker-compose services need:"
echo "  1. Join the 'caddy' network (networks: caddy: external: true)"
echo "  2. Add Caddy labels:"
echo "       labels:"
echo "         caddy: myapp.apps${NUMBER}.jointheleague.org"
echo '         caddy.reverse_proxy: "{{upstreams 3000}}"'
echo ""
echo "Docker context setup:"
echo "  docker context create $DROPLET_NAME --docker 'host=ssh://root@$DROPLET_IP'"
echo ""
