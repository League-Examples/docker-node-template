#!/bin/sh
set -e


echo "=== Installing pipx and CLASI ==="
pip install --user pipx
pipx ensurepath
pipx install git+https://github.com/ericbusboom/claude-agent-skills.git


echo "=== Configuring age key for SOPS ==="
# If AGE_PRIVATE_KEY is set (via a GitHub Codespaces secret), write it to the
# default SOPS key location so `sops -d` works immediately after container start.
if [ -n "${AGE_PRIVATE_KEY:-}" ]; then
	mkdir -p ~/.config/sops/age
	printf '%s\n' "$AGE_PRIVATE_KEY" > ~/.config/sops/age/keys.txt
	chmod 600 ~/.config/sops/age/keys.txt
	echo "Age key installed from AGE_PRIVATE_KEY secret"
else
	echo "AGE_PRIVATE_KEY not set — see docs/secrets.md for Codespaces key setup"
fi

echo "=== Installing project dependencies ==="
npm ci
cd server && npm ci && cd ..
cd client && npm ci && cd ..

echo "=== Initializing CLASI ==="
export PATH="$HOME/.local/bin:$PATH"
clasi init || echo "CLASI init skipped (may already be initialized)"

echo "=== Configuring shell prompt ==="
grep -q 'PS1=.*\\n\$ ' ~/.bashrc || echo 'PS1="${PS1%\\\$ }\n$ "' >> ~/.bashrc

echo "=== Done ==="
