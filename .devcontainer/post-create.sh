#!/bin/sh
set -e

install_packages() {
	if command -v apt-get >/dev/null 2>&1; then
		sudo apt-get update
		sudo apt-get install -y --no-install-recommends "$@"
		sudo rm -rf /var/lib/apt/lists/*
		return 0
	fi

	if command -v apk >/dev/null 2>&1; then
		sudo apk add --no-cache "$@"
		return 0
	fi

	echo "No supported package manager found (apt-get/apk)." >&2
	return 1
}

echo "=== Installing pipx and CLASI ==="
pip install --user pipx
pipx ensurepath
pipx install git+https://github.com/ericbusboom/claude-agent-skills.git

echo "=== Installing sops ==="
if ! command -v sops >/dev/null 2>&1; then
	install_packages sops
fi

echo "=== Installing age ==="
# age is needed for SOPS secret decryption
if ! command -v age >/dev/null 2>&1; then
	if ! install_packages age; then
		AGE_VERSION="1.2.0"
		curl -sLO "https://github.com/FiloSottile/age/releases/download/v${AGE_VERSION}/age-v${AGE_VERSION}-linux-amd64.tar.gz"
		tar -xzf "age-v${AGE_VERSION}-linux-amd64.tar.gz"
		sudo mv age/age age/age-keygen /usr/local/bin/
		rm -rf age "age-v${AGE_VERSION}-linux-amd64.tar.gz"
	fi
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
