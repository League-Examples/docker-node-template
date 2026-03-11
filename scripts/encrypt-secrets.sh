#!/usr/bin/env bash
set -euo pipefail
#
# encrypt-secrets.sh — Encrypt the secrets portion of .env back into
# config/dev/secrets.env or config/prod/secrets.env.
#
# Reads .env, extracts everything below the "Application secrets" marker,
# and encrypts it with SOPS into the file matching the DEPLOYMENT variable.
#
# Usage:
#   ./scripts/encrypt-secrets.sh          # auto-detect from DEPLOYMENT in .env
#   ./scripts/encrypt-secrets.sh dev      # force dev
#   ./scripts/encrypt-secrets.sh prod     # force prod

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Terminal colors
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold)  DIM=$(tput dim)  RESET=$(tput sgr0)
  RED=$(tput setaf 1)  GREEN=$(tput setaf 2)  YELLOW=$(tput setaf 3)  CYAN=$(tput setaf 6)
else
  BOLD="" DIM="" RESET="" RED="" GREEN="" YELLOW="" CYAN=""
fi

err()     { echo "  ${RED}ERROR:${RESET} $1"; }
info()    { echo "  ${GREEN}$1${RESET}"; }
success() { echo "  ${GREEN}✓${RESET} $1"; }
warn()    { echo "  ${YELLOW}WARNING:${RESET} $1"; }

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------
if [ ! -f .env ]; then
  err ".env not found. Run ./scripts/install.sh first."
  exit 1
fi

if ! command -v sops &>/dev/null; then
  err "sops is not installed. Install it: brew install sops"
  exit 1
fi

# ---------------------------------------------------------------------------
# Determine target (dev or prod)
# ---------------------------------------------------------------------------
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  # Auto-detect from DEPLOYMENT variable in .env
  TARGET=$(grep -E '^DEPLOYMENT=' .env | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)
fi

if [ -z "$TARGET" ]; then
  err "Cannot determine target deployment."
  echo ""
  echo "  Either:"
  echo "    ${CYAN}1${RESET}) Add ${BOLD}DEPLOYMENT=dev${RESET} or ${BOLD}DEPLOYMENT=prod${RESET} to the secrets section of .env"
  echo "    ${CYAN}2${RESET}) Pass the target as an argument: ${BOLD}./scripts/encrypt-secrets.sh dev${RESET}"
  exit 1
fi

case "$TARGET" in
  dev)  TARGET_FILE="config/dev/secrets.env" ;;
  prod) TARGET_FILE="config/prod/secrets.env" ;;
  *)
    err "DEPLOYMENT must be 'dev' or 'prod', got: ${BOLD}$TARGET${RESET}"
    exit 1
    ;;
esac

echo ""
info "Encrypting .env secrets → ${BOLD}$TARGET_FILE${RESET}"

# ---------------------------------------------------------------------------
# Extract the secrets portion of .env
# ---------------------------------------------------------------------------
# Everything below the "Application secrets" marker, skipping blank lines
# and comments (but keeping DEPLOYMENT and actual KEY=VALUE lines).
MARKER="# Application secrets"
SECRETS_CONTENT=$(awk -v marker="$MARKER" '
  found { print }
  index($0, marker) { found = 1 }
' .env | grep -E '^[A-Za-z_][A-Za-z0-9_]*=' || true)

if [ -z "$SECRETS_CONTENT" ]; then
  err "No secrets found below the '${MARKER}' line in .env"
  exit 1
fi

# Show what will be encrypted (keys only, not values)
echo ""
echo "  ${DIM}Variables to encrypt:${RESET}"
echo "$SECRETS_CONTENT" | while IFS='=' read -r key _; do
  echo "    ${CYAN}•${RESET} $key"
done

# ---------------------------------------------------------------------------
# Encrypt with SOPS
# ---------------------------------------------------------------------------
# Write to a temp file inside config/ so SOPS path_regex matches.
TMPFILE="config/.encrypt-tmp.env"
echo "$SECRETS_CONTENT" > "$TMPFILE"

# Source .env to get SOPS_AGE_KEY_FILE (or SOPS_AGE_KEY)
set +u
source <(grep -E '^(SOPS_AGE_KEY_FILE|SOPS_AGE_KEY)=' .env)
set -u

SOPS_ARGS=()
if [ -n "${SOPS_AGE_KEY:-}" ]; then
  export SOPS_AGE_KEY
elif [ -n "${SOPS_AGE_KEY_FILE:-}" ]; then
  export SOPS_AGE_KEY_FILE
fi

if sops -e -i "$TMPFILE" 2>/dev/null; then
  mv "$TMPFILE" "$TARGET_FILE"
  echo ""
  success "Encrypted secrets written to ${BOLD}$TARGET_FILE${RESET}"
  echo ""
  echo "  ${DIM}Remember to commit this change:${RESET}"
  echo "    ${CYAN}git add $TARGET_FILE && git commit -m 'chore: update $TARGET secrets'${RESET}"
else
  rm -f "$TMPFILE"
  echo ""
  err "SOPS encryption failed"
  echo "  ${DIM}Make sure your age key is configured and listed in .sops.yaml${RESET}"
  exit 1
fi
