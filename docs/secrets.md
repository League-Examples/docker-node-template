# Secrets Management

## Overview

Secrets flow through three stages:

```
SOPS + age (at rest, in repo)
  → decrypt
    → Docker Swarm secrets (runtime, file-mounted)
      → entrypoint.sh
        → environment variables (application reads process.env)
```

Application code never reads files from `/run/secrets/` directly. The
`docker/entrypoint.sh` script handles that.

## File Inventory

| File | Committed | Purpose |
|------|-----------|---------|
| `config/sops.yaml` | Yes | Lists authorized age public keys |
| `config/dev/public.env` | Yes | Non-secret dev env vars (plaintext) |
| `config/dev/secrets.env` | Yes | Encrypted development secrets |
| `config/dev/secrets.env.example` | Yes | Plaintext template (shows required vars) |
| `config/prod/public.env` | Yes | Non-secret prod env vars (plaintext) |
| `config/prod/secrets.env` | Yes | Encrypted production secrets |
| `config/prod/secrets.env.example` | Yes | Plaintext template (shows required vars) |
| `config/local/` | No (gitignored) | Developer-specific overrides |
| `.env` | No (gitignored) | Decrypted local secrets |
| `*.agekey` | No (gitignored) | Private keys |

> **Legacy:** The `secrets/` directory still exists for reference but is
> superseded by `config/`. It will be removed in a future sprint.

## Required Secrets

| Secret | Used By | Description |
|--------|---------|-------------|
| `session_secret` | server | Express session signing key |
| `github_client_id` | server | GitHub OAuth app client ID |
| `github_client_secret` | server | GitHub OAuth app client secret |
| `google_client_id` | server | Google OAuth client ID |
| `google_client_secret` | server | Google OAuth client secret |
| `pike13_access_token` | server | Pike 13 API access token (pre-obtained) |

All OAuth secrets are optional. The app starts cleanly without them —
unconfigured integrations return 501 with setup instructions. See
[`docs/api-integrations.md`](api-integrations.md) for credential setup.

## Codespaces Key Setup

Codespaces environments are ephemeral — your age private key is not present
by default. Store it as a GitHub Codespaces secret and the devcontainer will
install it automatically on every new Codespace.

### 1. Find your age private key

If you don't have a keypair yet, generate one first (see
[Onboarding a New Developer](#onboarding-a-new-developer)), then have a
teammate add your public key to `.sops.yaml` and re-encrypt the secrets.

On your local machine:

```bash
cat ~/.config/sops/age/keys.txt
```

Copy the full output (the comment lines and the `AGE-SECRET-KEY-1...` line).

### 2. Store it as a Codespaces secret

1. Go to [GitHub → Settings → Codespaces → New secret](https://github.com/settings/codespaces)
2. Name: `AGE_PRIVATE_KEY`
3. Value: paste the full key contents
4. Under **Repository access**, authorize this repository

### 3. Use the key in a new Codespace

When you next create (or rebuild) a Codespace, `post-create.sh` reads
`$AGE_PRIVATE_KEY` and writes it to `~/.config/sops/age/keys.txt`
automatically. Option A (`sops -d`) in [setup.md](setup.md) will work
immediately.

> **Note:** The secret is user-scoped. Each developer must add their own
> `AGE_PRIVATE_KEY` and have their public key onboarded to `.sops.yaml`.

---

## Onboarding a New Developer

**Prerequisites:** `sops` and `age` must be installed.

- **Codespaces:** both are installed automatically by `post-create.sh` — nothing to do.
- **macOS (local):** `brew install sops age`
- **Linux (local):** see [SOPS releases](https://github.com/getsops/sops/releases) and [age releases](https://github.com/FiloSottile/age/releases)
- **Windows (local):** `winget install Mozilla.SOPS FiloSottile.age` or use WSL and follow the Linux instructions. You should almost certainly be using WSL. 

### 1. New developer: generate an age keypair

Run this on your own machine:

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt
cat ~/.config/sops/age/keys.txt

```

This prints your public key (starts with `age1...`). Share it with the team.

### 2. Teammate with access: add the key and re-encrypt

Run the interactive script — it handles both steps:

```bash
npm run secrets:add-key
```

It will prompt for the new age public key, append it to `.sops.yaml`, and
run `sops updatekeys` on every encrypted file in `config/`.

Commit and push the updated `config/sops.yaml` and re-encrypted files.

### 4. Decrypt for local development

```bash
sops -d config/dev/secrets.env >> .env
```

## Editing Secrets

SOPS decrypts to an editor buffer and re-encrypts on save:

```bash
sops config/dev/secrets.env
sops config/prod/secrets.env
```

## Adding a New Secret

1. Add the key to `config/dev/secrets.env.example` and
   `config/prod/secrets.env.example`
2. Edit the encrypted files: `sops config/dev/secrets.env` and
   `sops config/prod/secrets.env`
3. Re-decrypt locally: `sops -d config/dev/secrets.env >> .env`
4. If the secret is used in production, add it to the `secrets:` block in
   `docker-compose.prod.yml`:
   ```yaml
   secrets:
     db_password:
       external: true
     new_secret_name:
       external: true
   ```
5. Reference it in the server's `secrets:` list in the same file
6. Load it to the swarm: `npm run secrets:prod:rm && npm run secrets:prod`
7. Re-deploy: `npm run deploy:prod`

The `docker/entrypoint.sh` script automatically converts any file under
`/run/secrets/` to an uppercase environment variable. No code changes
needed for the entrypoint.

## Loading Secrets to Docker Swarm

```bash
# Create secrets (first time)
npm run secrets:prod

# Update secrets (remove old, create new)
npm run secrets:prod:rm
npm run secrets:prod
```

These scripts use `scripts/load-secrets.sh` which:
- Decrypts `config/prod/secrets.env` via SOPS
- Creates each `KEY=value` as a lowercase Docker Swarm secret
- Uses the production Docker context from `.env`

## Security Rules

- Never hardcode secrets in source code
- Never commit `.env` (it's gitignored)
- Never commit `*.agekey` private keys (gitignored)
- Secrets flow through `entrypoint.sh` — app code reads `process.env`
- Use `sops` to edit encrypted files — never decrypt to a file other
  than `.env`
