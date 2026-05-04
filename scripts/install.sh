#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

header() {
  echo ""
  echo "$1"
  printf '%.0s-' $(seq 1 ${#1})
  echo ""
}

info()    { echo "  $1"; }
detail()  { echo "  $1"; }
warn()    { echo "  WARNING: $1"; }
err()     { echo "  ERROR: $1"; }
success() { echo "  ✓ $1"; }
bullet()  { echo "  • $1"; }

# ---------------------------------------------------------------------------
# 1. Install npm dependencies
# ---------------------------------------------------------------------------
header "Installing Dependencies"

echo "  root"
npm install --silent

echo "  server"
npm install --silent --prefix server

echo "  client"
npm install --silent --prefix client

success "All dependencies installed"


# ---------------------------------------------------------------------------
# 3. Check for age and SOPS (needed by dotconfig for secrets)
# ---------------------------------------------------------------------------
header "Encryption Tools"

MISSING_TOOLS=()

if command -v age &>/dev/null; then
  success "age installed"
else
  MISSING_TOOLS+=("age")
fi

if command -v sops &>/dev/null; then
  success "sops installed"
else
  MISSING_TOOLS+=("sops")
fi

if [ ${#MISSING_TOOLS[@]} -gt 0 ]; then
  warn "Missing: ${MISSING_TOOLS[*]}"
  detail "These are needed by dotconfig for secrets encryption."
  echo ""
  bullet "macOS:   brew install ${MISSING_TOOLS[*]}"
  bullet "Linux:   See https://github.com/FiloSottile/age and https://github.com/getsops/sops"
  echo ""
  detail "Secrets will be unavailable until these are installed."
fi

# ---------------------------------------------------------------------------
# 4. Python Tools (CLASI, dotconfig, rundbat)
# ---------------------------------------------------------------------------
header "Python Tools"

# Helper: install or upgrade a pipx package
# Usage: pipx_install <command> <package_or_url> <display_name>
pipx_install() {
  local cmd="$1" pkg="$2" name="$3"
  if command -v "$cmd" &>/dev/null; then
    success "$name already installed"
  else
    info "Installing $name via pipx..."
    if pipx install "$pkg" 2>/dev/null; then
      success "$name installed"
    else
      if pipx upgrade "$pkg" 2>/dev/null; then
        success "$name upgraded"
      else
        err "Failed to install $name"
        detail "Try manually: pipx install $pkg"
      fi
    fi
  fi
}

if ! command -v pipx &>/dev/null; then
  warn "pipx is not installed"
  detail "Python tools require pipx. Install it first:"
  echo ""
  bullet "macOS:   brew install pipx && pipx ensurepath"
  bullet "Linux:   python3 -m pip install --user pipx && pipx ensurepath"
  bullet "Windows: pip install pipx && pipx ensurepath"
  echo ""
  detail "Then re-run this script."
else
  pipx_install dotconfig "git+https://github.com/ericbusboom/dotconfig.git" "dotconfig"
fi

# Run dotconfig init to set up age key and SOPS config
if command -v dotconfig &>/dev/null; then
  info "Initializing dotconfig..."
  if dotconfig init 2>/dev/null; then
    success "dotconfig initialized"
  else
    warn "dotconfig init returned an error — you may need to run it manually"
  fi
fi


echo "  Next step: npm run dev"
                                