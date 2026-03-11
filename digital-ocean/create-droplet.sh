#!/usr/bin/env bash
set -euo pipefail

# create-droplet.sh — Provision a new Docker droplet in the League Students team.
#
# Usage:
#   ./digital-ocean/create-droplet.sh <number>    e.g. ./digital-ocean/create-droplet.sh 3 → docker3
#
# Prerequisites:
#   - doctl installed (`brew install doctl`)
#   - DO_LEAGUE_STUDENT_TOKEN exported in your shell (see config.env for details)
#   - SSH key registered with DigitalOcean

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load config (environment variables override config file values)
if [[ -f "$SCRIPT_DIR/config.env" ]]; then
  set -a
  # shellcheck source=config.env
  source "$SCRIPT_DIR/config.env"
  set +a
fi

# --- Token check ---
if [[ -z "${DO_LEAGUE_STUDENT_TOKEN:-}" ]]; then
  echo "ERROR: DO_LEAGUE_STUDENT_TOKEN is not set."
  echo ""
  echo "This token authenticates to The League org → Students team on DigitalOcean."
  echo ""
  echo "To fix this:"
  echo "  1. Log in to DigitalOcean and switch to The League org → Students team"
  echo "  2. Go to API → Tokens → Generate New Token (read + write scope)"
  echo "  3. Add to your shell profile (e.g. ~/.zshenv):"
  echo ""
  echo "       export DO_LEAGUE_STUDENT_TOKEN=\"dop_v1_...\""
  echo ""
  echo "  4. Reload your shell: source ~/.zshenv"
  exit 1
fi

# All doctl commands use the Students team token
DOCTL="doctl --access-token $DO_LEAGUE_STUDENT_TOKEN"

# Droplet name from prefix + number argument
: "${DROPLET_NAME_PREFIX:=docker}"
DROPLET_NUMBER="${1:-}"

if [[ -z "$DROPLET_NUMBER" ]]; then
  echo "Usage: $0 <number>"
  echo ""
  echo "  Creates a droplet named ${DROPLET_NAME_PREFIX}<number>"
  echo "  Example: $0 3  →  ${DROPLET_NAME_PREFIX}3"
  exit 1
fi

if ! [[ "$DROPLET_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "ERROR: Argument must be a number, got '$DROPLET_NUMBER'"
  exit 1
fi

DROPLET_NAME="${DROPLET_NAME_PREFIX}${DROPLET_NUMBER}"

: "${DO_REGION:=sfo3}"
: "${DO_SIZE:=s-2vcpu-4gb}"
: "${DO_IMAGE:=docker-20-04}"
: "${DO_SSH_KEYS:?Set DO_SSH_KEYS in config.env (SSH key ID or fingerprint)}"
: "${DO_TAGS:=student-project}"
: "${DO_PROJECT_ID:=""}"

echo "==> Creating droplet: $DROPLET_NAME"
echo "    Team:    Students (The League)"
echo "    Project: App Deployment"
echo "    Region:  $DO_REGION"
echo "    Size:    $DO_SIZE"
echo "    Image:   $DO_IMAGE"
echo "    Tags:    $DO_TAGS"
echo ""

# Check if droplet already exists
if $DOCTL compute droplet list --format Name --no-header | grep -qx "$DROPLET_NAME"; then
  echo "ERROR: Droplet '$DROPLET_NAME' already exists."
  echo "       Use 'doctl compute droplet list' to see existing droplets."
  exit 1
fi

# Create the droplet
$DOCTL compute droplet create "$DROPLET_NAME" \
  --region "$DO_REGION" \
  --size "$DO_SIZE" \
  --image "$DO_IMAGE" \
  --ssh-keys "$DO_SSH_KEYS" \
  --tag-names "$DO_TAGS" \
  --enable-monitoring \
  --enable-backups \
  --wait

echo ""
echo "==> Droplet created. Fetching details..."

# Get the new droplet's ID and public IP
DROPLET_INFO=$($DOCTL compute droplet list --format Name,ID,PublicIPv4 --no-header \
  | awk -v name="$DROPLET_NAME" '$1 == name { print $2, $3 }')
DROPLET_ID=$(echo "$DROPLET_INFO" | awk '{ print $1 }')
DROPLET_IP=$(echo "$DROPLET_INFO" | awk '{ print $2 }')

# Assign to the App Deployment project
if [[ -n "$DO_PROJECT_ID" ]]; then
  echo "==> Assigning droplet to App Deployment project"
  $DOCTL projects resources assign "$DO_PROJECT_ID" \
    --resource "do:droplet:$DROPLET_ID"
fi

if [[ -z "$DROPLET_IP" ]]; then
  echo "WARNING: Could not retrieve IP. Check: doctl compute droplet list"
  exit 1
fi

echo ""
echo "==> Droplet '$DROPLET_NAME' is ready at $DROPLET_IP"
echo ""
echo "Next steps:"
echo "  1. Point your domain DNS to $DROPLET_IP"
echo "  2. Create a Docker context:"
echo "       docker context create $DROPLET_NAME --docker 'host=ssh://root@$DROPLET_IP'"
echo "  3. Set up Caddy and Docker networking:"
echo "       ./digital-ocean/setup-server.sh $DROPLET_IP"
echo ""
