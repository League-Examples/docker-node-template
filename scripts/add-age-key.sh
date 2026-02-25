#!/usr/bin/env bash
set -euo pipefail

SOPS_FILE=".sops.yaml"

# Check dependencies
if ! command -v sops >/dev/null 2>&1; then
  echo "Error: sops is not installed or not on PATH."
  echo "See docs/secrets.md for install instructions (or rebuild the devcontainer)."
  exit 1
fi

# Prompt for the age public key
read -rp "Age public key to add: " NEW_KEY

if [ -z "$NEW_KEY" ]; then
  echo "Error: no key provided."
  exit 1
fi

# Validate rough shape of an age public key
if [[ ! "$NEW_KEY" =~ ^age1[a-z0-9]{58}$ ]]; then
  echo "Warning: '$NEW_KEY' doesn't look like a valid age public key (age1...). Continuing anyway."
fi

# Check for duplicates
if grep -qF "$NEW_KEY" "$SOPS_FILE"; then
  echo "Key is already present in $SOPS_FILE."
  exit 0
fi

# Append the key to each age: line in .sops.yaml
# SOPS multi-key format uses a folded block scalar (>-) with comma-separated keys,
# one per indented line. Append ,\n      <newkey> after the last existing key line.
python3 - "$SOPS_FILE" "$NEW_KEY" <<'EOF'
import sys, re

path, new_key = sys.argv[1], sys.argv[2]
with open(path) as f:
    content = f.read()

# Find the age block: age: >-\n  followed by indented key lines
# Append the new key (with comma on previous last line) before the block ends
def append_key(m):
    block = m.group(0)
    # Strip any trailing whitespace/newline from the block match
    # Find the last non-empty indented line and add a comma + new key line
    lines = block.rstrip('\n').split('\n')
    # Add comma to last line if missing
    if not lines[-1].rstrip().endswith(','):
        lines[-1] = lines[-1].rstrip() + ','
    # Detect indentation of existing key lines (lines after the age: >- line)
    indent = '      '
    for l in lines[1:]:
        stripped = l.lstrip()
        if stripped:
            indent = l[:len(l) - len(stripped)]
            break
    lines.append(f"{indent}{new_key}")
    return '\n'.join(lines)

# Match each age: >- block
pattern = re.compile(r'(    age: >-\n(?:      [^\n]+\n?)+)', re.MULTILINE)
new_content = pattern.sub(append_key, content)

with open(path, 'w') as f:
    f.write(new_content)

print(f"Updated {path}")
EOF

# Re-encrypt all secrets files
echo ""
echo "Re-encrypting secrets with updated key list..."
for f in secrets/*.env secrets/*.json secrets/*.yaml secrets/*.yml secrets/*.txt secrets/*.conf; do
  [ -f "$f" ] || continue
  echo "  sops updatekeys -y $f"
  sops updatekeys -y "$f"
done

echo ""
echo "Done. All secrets files re-encrypted for the new key."
