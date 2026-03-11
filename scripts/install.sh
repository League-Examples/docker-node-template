#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------------------
# Terminal colors and helpers
# ---------------------------------------------------------------------------
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  BOLD=$(tput bold)
  DIM=$(tput dim)
  RESET=$(tput sgr0)
  RED=$(tput setaf 1)
  GREEN=$(tput setaf 2)
  YELLOW=$(tput setaf 3)
  BLUE=$(tput setaf 4)
  CYAN=$(tput setaf 6)
else
  BOLD="" DIM="" RESET="" RED="" GREEN="" YELLOW="" BLUE="" CYAN=""
fi

header() {
  echo ""
  echo "${BLUE}${BOLD}$1${RESET}"
  echo "${BLUE}$(printf '%.0s─' $(seq 1 ${#1}))${RESET}"
}

info()    { echo "  ${GREEN}$1${RESET}"; }
detail()  { echo "  ${DIM}$1${RESET}"; }
warn()    { echo "  ${YELLOW}WARNING:${RESET} $1"; }
err()     { echo "  ${RED}ERROR:${RESET} $1"; }
success() { echo "  ${GREEN}✓${RESET} $1"; }
bullet()  { echo "  ${CYAN}•${RESET} $1"; }

# ---------------------------------------------------------------------------
# 1. Install npm dependencies
# ---------------------------------------------------------------------------
header "Installing Dependencies"

echo "  ${DIM}root${RESET}"
npm install --silent

echo "  ${DIM}server${RESET}"
npm install --silent --prefix server

echo "  ${DIM}client${RESET}"
npm install --silent --prefix client

success "All dependencies installed"

# ---------------------------------------------------------------------------
# 2. Check for Docker and detect contexts
# ---------------------------------------------------------------------------
header "Docker"

DEV_CONTEXT="default"
PROD_CONTEXT="swarm1"

if ! command -v docker &>/dev/null; then
  err "Docker is not installed"
  detail "This project requires Docker to run the database (and optionally"
  detail "the full stack). Install Docker Desktop, OrbStack, or the Docker"
  detail "Engine before running 'npm run dev'."
  echo ""
  detail "https://docs.docker.com/get-docker/"
else
  available_contexts=$(docker context ls --format '{{.Name}}' 2>/dev/null || true)

  for candidate in orbstack desktop-linux; do
    if echo "$available_contexts" | grep -qx "$candidate"; then
      DEV_CONTEXT="$candidate"
      break
    fi
  done
  success "Dev context: ${BOLD}$DEV_CONTEXT${RESET}"

  if echo "$available_contexts" | grep -qx "swarm1"; then
    PROD_CONTEXT="swarm1"
    success "Prod context: ${BOLD}$PROD_CONTEXT${RESET}"
  else
    warn "No ${BOLD}swarm1${RESET} Docker context found"
    detail "Production deployment won't work until you create a remote context:"
    detail "  docker context create swarm1 --docker 'host=ssh://user@your-swarm-host'"
    detail "Then update PROD_DOCKER_CONTEXT in .env"
  fi
fi

# ---------------------------------------------------------------------------
# 3. Check for SOPS and age
# ---------------------------------------------------------------------------
header "Secrets Tooling"

HAS_SOPS_AGE=true
missing_tools=()

if ! command -v sops &>/dev/null; then
  missing_tools+=("sops")
fi

if ! command -v age &>/dev/null; then
  missing_tools+=("age")
fi

if [ ${#missing_tools[@]} -gt 0 ]; then
  HAS_SOPS_AGE=false
  err "Missing: ${BOLD}${missing_tools[*]}${RESET}"
  detail "This project uses SOPS + age to encrypt secrets at rest."
  detail "Install them before working with secrets:"
  echo ""
  bullet "macOS:    ${CYAN}brew install sops age${RESET}"
  bullet "Linux:    ${CYAN}https://github.com/getsops/sops/releases${RESET}"
  detail "          ${CYAN}https://github.com/FiloSottile/age/releases${RESET}"
  bullet "Windows:  ${CYAN}winget install Mozilla.SOPS FiloSottile.age${RESET}  (or use WSL)"
else
  success "sops found"
  success "age found"
fi

# ---------------------------------------------------------------------------
# 4. Locate or create age key
# ---------------------------------------------------------------------------
AGE_KEY=""
AGE_KEY_FILE=""
SOPS_LINE=""

if [ "$HAS_SOPS_AGE" = true ]; then
  header "Age Key"

  # Check SOPS_AGE_KEY env var (inline key)
  if [ -n "${SOPS_AGE_KEY:-}" ]; then
    AGE_KEY="$SOPS_AGE_KEY"
    success "Found age key in ${BOLD}SOPS_AGE_KEY${RESET} env var"
    # Already in env — write commented out for visibility
    SOPS_LINE="# SOPS_AGE_KEY is set in the environment"

  # Check SOPS_AGE_KEY_FILE env var (path to key file)
  elif [ -n "${SOPS_AGE_KEY_FILE:-}" ] && [ -f "${SOPS_AGE_KEY_FILE}" ]; then
    AGE_KEY=$(grep -o "AGE-SECRET-KEY-[A-Za-z0-9]*" "$SOPS_AGE_KEY_FILE" | head -1)
    AGE_KEY_FILE="$SOPS_AGE_KEY_FILE"
    success "Found age key via ${BOLD}SOPS_AGE_KEY_FILE${RESET} ($SOPS_AGE_KEY_FILE)"
    # Already in env — write commented out for visibility
    SOPS_LINE="# SOPS_AGE_KEY_FILE=$SOPS_AGE_KEY_FILE (set in environment)"

  # Check default age key file
  elif [ -f "$HOME/.config/sops/age/keys.txt" ]; then
    AGE_KEY=$(grep -o "AGE-SECRET-KEY-[A-Za-z0-9]*" "$HOME/.config/sops/age/keys.txt" | head -1)
    AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
    success "Found age key in ${BOLD}~/.config/sops/age/keys.txt${RESET}"
    SOPS_LINE="SOPS_AGE_KEY_FILE=$AGE_KEY_FILE"
  fi

  if [ -z "$AGE_KEY" ]; then
    echo ""
    echo "  ${YELLOW}${BOLD}No age key found${RESET}"
    echo ""
    detail "Searched:"
    detail "  SOPS_AGE_KEY env var"
    detail "  SOPS_AGE_KEY_FILE env var"
    detail "  ~/.config/sops/age/keys.txt"
    echo ""
    echo "  ${BOLD}What would you like to do?${RESET}"
    echo ""
    echo "  ${CYAN}1${RESET}) Generate a new age keypair"
    echo "  ${CYAN}2${RESET}) Paste an existing age secret key"
    echo "  ${CYAN}3${RESET}) Skip — I'll set up my key later"
    echo ""

    while true; do
      read -rp "  ${BOLD}Choose [1/2/3]:${RESET} " age_choice
      case "$age_choice" in
        1)
          info "Generating a new age keypair..."
          mkdir -p "$HOME/.config/sops/age"

          keygen_output=$(age-keygen 2>&1)
          echo "$keygen_output" > "$HOME/.config/sops/age/keys.txt"
          chmod 600 "$HOME/.config/sops/age/keys.txt"

          AGE_KEY=$(echo "$keygen_output" | grep -o "AGE-SECRET-KEY-[A-Za-z0-9]*" | head -1)
          AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
          SOPS_LINE="SOPS_AGE_KEY_FILE=$AGE_KEY_FILE"

          echo ""
          echo "  ${GREEN}${BOLD}┌──────────────────────────────────────┐${RESET}"
          echo "  ${GREEN}${BOLD}│       NEW AGE KEYPAIR GENERATED      │${RESET}"
          echo "  ${GREEN}${BOLD}└──────────────────────────────────────┘${RESET}"
          echo ""
          detail "Key file: ~/.config/sops/age/keys.txt"
          echo ""
          echo "  ${DIM}┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄${RESET}"
          sed "s/^/  ${CYAN}/" "$HOME/.config/sops/age/keys.txt"
          echo "${RESET}"
          echo "  ${DIM}┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄${RESET}"

          if [ "${CODESPACES:-}" = "true" ]; then
            echo ""
            echo "  ${RED}${BOLD}!! CODESPACES — THIS KEY IS EPHEMERAL !!${RESET}"
            echo "  ${RED}It will be LOST when your Codespace is deleted.${RESET}"
            echo "  Save it as a GitHub Codespaces secret:"
            echo ""
            bullet "Go to: ${CYAN}https://github.com/settings/codespaces${RESET}"
            bullet "Click ${BOLD}New secret${RESET}"
            bullet "Name:  ${BOLD}AGE_PRIVATE_KEY${RESET}"
            bullet "Value: paste the ${BOLD}FULL${RESET} contents shown above"
            detail "  (including the comment lines and the AGE-SECRET-KEY-... line)"
            bullet "Under ${BOLD}Repository access${RESET}, authorize this repository"
            echo ""
            detail "The devcontainer will install it automatically on future Codespaces."
          else
            echo ""
            success "Key saved at ${BOLD}~/.config/sops/age/keys.txt${RESET}"
            detail "It will be found automatically on future runs."
          fi
          break
          ;;
        2)
          echo ""
          echo "  Paste your age secret key (starts with ${CYAN}AGE-SECRET-KEY-...${RESET}):"
          read -rp "  ${BOLD}>${RESET} " pasted_key

          if [[ "$pasted_key" != AGE-SECRET-KEY-* ]]; then
            echo ""
            err "That doesn't look like an age secret key."
            detail "It should start with AGE-SECRET-KEY-"
            echo ""
            continue
          fi

          AGE_KEY="$pasted_key"

          mkdir -p "$HOME/.config/sops/age"
          pasted_public=$(echo "$pasted_key" | age-keygen -y 2>/dev/null || true)
          {
            echo "# created: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
            [ -n "$pasted_public" ] && echo "# public key: $pasted_public"
            echo "$pasted_key"
          } > "$HOME/.config/sops/age/keys.txt"
          chmod 600 "$HOME/.config/sops/age/keys.txt"

          AGE_KEY_FILE="$HOME/.config/sops/age/keys.txt"
          SOPS_LINE="SOPS_AGE_KEY_FILE=$AGE_KEY_FILE"
          success "Key saved to ${BOLD}~/.config/sops/age/keys.txt${RESET}"
          break
          ;;
        3)
          echo ""
          info "Skipping age key setup"
          detail "To set up later, see docs/secrets.md"
          break
          ;;
        *)
          err "Please enter 1, 2, or 3."
          ;;
      esac
    done
  fi

  # -------------------------------------------------------------------------
  # 5. Ensure public key is in .sops.yaml
  # -------------------------------------------------------------------------
  if [ -n "$AGE_KEY" ]; then
    header "SOPS Configuration"

    AGE_PUBLIC_KEY=$(echo "$AGE_KEY" | age-keygen -y 2>/dev/null || true)

    if [ -z "$AGE_PUBLIC_KEY" ]; then
      warn "Could not derive public key from age secret key"
      detail "You may need to manually add your public key to .sops.yaml"
    elif grep -qF "$AGE_PUBLIC_KEY" .sops.yaml 2>/dev/null || grep -qF "$AGE_PUBLIC_KEY" config/sops.yaml 2>/dev/null; then
      success "Public key already in .sops.yaml"
    else
      info "Adding your public key to .sops.yaml..."
      last_key_line=$(grep -n 'age1' .sops.yaml | tail -1 | cut -d: -f1)
      if [ -n "$last_key_line" ]; then
        awk -v line="$last_key_line" -v key="$AGE_PUBLIC_KEY" \
          'NR==line { sub(/,?$/, ",") } { print } NR==line { print "      " key }' \
          .sops.yaml > .sops.yaml.tmp && mv .sops.yaml.tmp .sops.yaml
        success "Added: ${DIM}$AGE_PUBLIC_KEY${RESET}"
        echo ""
        warn "A maintainer must commit this .sops.yaml change and re-encrypt:"
        detail "  sops updatekeys config/dev/secrets.env"
        detail "  sops updatekeys config/prod/secrets.env"
      else
        warn "Could not find age key list in .sops.yaml"
        detail "Manually add this public key to the 'age:' field:"
        detail "  $AGE_PUBLIC_KEY"
      fi
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 6. CLASI Software Engineering Process
# ---------------------------------------------------------------------------
header "CLASI SE Process"

CLASI_REPO="git+https://github.com/ericbusboom/claude-agent-skills.git"

if command -v clasi &>/dev/null; then
  success "clasi already installed"
else
  if ! command -v pipx &>/dev/null; then
    warn "${BOLD}pipx${RESET} is not installed"
    detail "CLASI requires pipx. Install it first:"
    echo ""
    bullet "macOS:   ${CYAN}brew install pipx && pipx ensurepath${RESET}"
    bullet "Linux:   ${CYAN}python3 -m pip install --user pipx && pipx ensurepath${RESET}"
    bullet "Windows: ${CYAN}pip install pipx && pipx ensurepath${RESET}"
    echo ""
    detail "Then re-run this script to install CLASI."
  else
    info "Installing CLASI via pipx..."
    if pipx install "$CLASI_REPO" 2>/dev/null; then
      success "CLASI installed"
    else
      # pipx install fails if already installed but not on PATH; try upgrade
      if pipx upgrade claude-agent-skills 2>/dev/null; then
        success "CLASI upgraded"
      else
        err "Failed to install CLASI"
        detail "Try manually: pipx install $CLASI_REPO"
      fi
    fi
  fi
fi

# Run clasi init if the MCP config doesn't reference clasi yet
if command -v clasi &>/dev/null; then
  if [ -f .mcp.json ] && grep -q "clasi" .mcp.json 2>/dev/null; then
    success "CLASI already initialised"
  else
    info "Running clasi init..."
    if clasi init 2>/dev/null; then
      success "CLASI initialised"
    else
      warn "clasi init returned an error — you may need to run it manually"
    fi
  fi
fi

# ---------------------------------------------------------------------------
# 7. Generate .env
# ---------------------------------------------------------------------------
header "Environment File"

if [ -f .env ]; then
  warn ".env already exists"
  echo ""
  echo "  ${CYAN}1${RESET}) Overwrite with fresh .env"
  echo "  ${CYAN}2${RESET}) Keep existing .env"
  echo ""

  while true; do
    read -rp "  ${BOLD}Choose [1/2]:${RESET} " env_choice
    case "$env_choice" in
      1)
        info "Overwriting .env..."
        rm -f .env
        break
        ;;
      2)
        success "Keeping existing .env"
        echo ""
        echo "${GREEN}${BOLD}Setup complete.${RESET}"
        exit 0
        ;;
      *)
        err "Please enter 1 or 2."
        ;;
    esac
  done
fi

info "Generating .env from template..."

# Start from template, substitute detected Docker contexts
sed \
  -e "s/^DEV_DOCKER_CONTEXT=.*/DEV_DOCKER_CONTEXT=$DEV_CONTEXT/" \
  -e "s/^PROD_DOCKER_CONTEXT=.*/PROD_DOCKER_CONTEXT=$PROD_CONTEXT/" \
  .env.template > .env

# Add SOPS_AGE_KEY_FILE if we found a key file that isn't already in the env
if [ -n "$SOPS_LINE" ]; then
  sed -i.bak "s|^#:SOPS_AGE_KEY_FILE=.*|$SOPS_LINE|" .env
  rm -f .env.bak
fi

# Append decrypted application secrets
if [ "$HAS_SOPS_AGE" = true ] && [ -n "$AGE_KEY" ]; then
  info "Decrypting config/dev/secrets.env..."

  # Pass the key inline so sops doesn't rely on auto-detection of key files
  if SOPS_AGE_KEY="$AGE_KEY" sops -d config/dev/secrets.env >> .env 2>/dev/null; then
    success "Appended decrypted secrets to .env"
  else
    echo ""
    err "Failed to decrypt config/dev/secrets.env"
    detail "Your age key may not be authorised for this project yet."
    detail "Ask a maintainer to add your public key to .sops.yaml and run:"
    detail "  sops updatekeys config/dev/secrets.env"
    echo ""
    detail "In the meantime, add secrets manually (see config/dev/secrets.env.example)."
  fi
else
  warn "Skipped secrets decryption (no SOPS/age or no key)"
  detail "Add secrets manually to .env — see config/dev/secrets.env.example"
fi

success "Created .env"

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo ""
echo "${GREEN}${BOLD}┌──────────────────────────────────────┐${RESET}"
echo "${GREEN}${BOLD}│          Setup complete!             │${RESET}"
echo "${GREEN}${BOLD}└──────────────────────────────────────┘${RESET}"
echo ""
echo "  Next step: ${CYAN}npm run dev${RESET}"
echo ""
