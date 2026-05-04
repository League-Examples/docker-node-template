#!/usr/bin/env bash
# Non-interactive install for devcontainers / CI / Codespaces.
# Plain log output, no prompts, no colors.
set -euo pipefail

cd "$(dirname "$0")/.."

log() { echo "[install] $*"; }

# ---------------------------------------------------------------------------
# Codespaces-only: write age key from GitHub Codespaces secret
# ---------------------------------------------------------------------------
if [ -n "${AGE_PRIVATE_KEY:-}" ]; then
  mkdir -p ~/.config/sops/age
  printf '%s\n' "$AGE_PRIVATE_KEY" > ~/.config/sops/age/keys.txt
  chmod 600 ~/.config/sops/age/keys.txt
  log "Age key installed from AGE_PRIVATE_KEY secret"
else
  log "AGE_PRIVATE_KEY not set — see docs/secrets.md for Codespaces key setup"
fi

# ---------------------------------------------------------------------------
# Codespaces-only: two-line prompt (better for narrow terminals)
# ---------------------------------------------------------------------------
grep -q 'PS1=.*\\n\$ ' ~/.bashrc || echo 'PS1="${PS1%\\\$ }\n$ "' >> ~/.bashrc

# ---------------------------------------------------------------------------
# npm dependencies
# ---------------------------------------------------------------------------
log "==> Installing npm dependencies (root)"
npm install --no-audit --no-fund

log "==> Installing npm dependencies (server)"
npm install --no-audit --no-fund --prefix server

log "==> Installing npm dependencies (client)"
npm install --no-audit --no-fund --prefix client

# ---------------------------------------------------------------------------
# Encryption tools
# ---------------------------------------------------------------------------
log "==> Checking encryption tools (age, sops)"
for tool in age sops; do
  if command -v "$tool" >/dev/null 2>&1; then
    log "$tool: ok ($(command -v "$tool"))"
  else
    log "$tool: MISSING (dotconfig secrets will be unavailable)"
  fi
done

# ---------------------------------------------------------------------------
# Python tools (dotconfig)
# ---------------------------------------------------------------------------
log "==> Checking pipx"
if ! command -v pipx >/dev/null 2>&1; then
  log "pipx: MISSING — skipping Python tool install"
else
  log "pipx: ok ($(command -v pipx))"

  # The devcontainer's pipx is installed system-wide (e.g. /opt/pipx) and
  # not writable by the non-root user. Force a user-local pipx home so
  # `pipx install` works without sudo.
  export PIPX_HOME="$HOME/.local/pipx"
  export PIPX_BIN_DIR="$HOME/.local/bin"
  mkdir -p "$PIPX_HOME" "$PIPX_BIN_DIR"
  case ":$PATH:" in
    *":$PIPX_BIN_DIR:"*) ;;
    *) export PATH="$PIPX_BIN_DIR:$PATH" ;;
  esac
  grep -q 'PIPX_BIN_DIR' ~/.bashrc 2>/dev/null || cat >> ~/.bashrc <<'EOF'
export PIPX_HOME="$HOME/.local/pipx"
export PIPX_BIN_DIR="$HOME/.local/bin"
export PATH="$PIPX_BIN_DIR:$PATH"
EOF

  log "==> Installing dotconfig via pipx (PIPX_HOME=$PIPX_HOME)"
  if command -v dotconfig >/dev/null 2>&1; then
    log "dotconfig: already installed"
  else
    pipx install "git+https://github.com/ericbusboom/dotconfig.git" \
      || pipx upgrade "git+https://github.com/ericbusboom/dotconfig.git" \
      || log "dotconfig: install failed (continuing)"
  fi
fi

if command -v dotconfig >/dev/null 2>&1; then
  log "==> Running dotconfig init"
  dotconfig init || log "dotconfig init returned non-zero (continuing)"
fi

log "==> Done"
