---
status: done
---

# Plan: Replace justfile with scripts/ + npm scripts

## Context

The repo currently uses a `justfile` at the root for Docker compose lifecycle commands (`build`, `up`, `down`, `restart`, `logs`, `shell`, `ps`). The user is questioning whether `just` is worth the extra tool dependency given that:

- `scripts/dev.sh` already exists — there's a precedent for shell scripts in `scripts/`.
- The justfile recipes are all short (1–2 lines) and mostly the same shape: `docker --context $DOCKER_CONTEXT compose -f docker-compose.yml <verb>`.
- `npm` is already required by the project; `just` isn't installed by default and adds friction for new contributors and CI.

The question is exploratory — pick a direction.

## Recommendation

Replace the justfile with **one shell dispatcher + npm script wrappers**. Zero new dependencies, consistent with the existing `scripts/dev.sh`, and discoverable via `npm run`.

## Approach

### 1. New file: `scripts/docker.sh`

Single dispatcher that:
- Loads `.env` (export-style, like `set -a; source .env; set +a`).
- Reads `DOCKER_CONTEXT` (errors if missing).
- Builds the base command: `docker --context "$DOCKER_CONTEXT" compose -f docker-compose.yml`.
- Dispatches on `$1`: `build | up | down | restart | logs | shell | ps`.
- After `up`, echoes: `App running on context '$DOCKER_CONTEXT' — http://${APP_DOMAIN:-localhost}:${APP_PORT:-3000}`.
- `restart` = `down` + `build` + `up`.
- `shell` = `exec app sh`.
- `logs` = `logs -f --tail=200 app`.

### 2. Update `package.json` scripts

Add:

```json
"docker:build":   "./scripts/docker.sh build",
"docker:up":      "./scripts/docker.sh up",
"docker:down":    "./scripts/docker.sh down",
"docker:restart": "./scripts/docker.sh restart",
"docker:logs":    "./scripts/docker.sh logs",
"docker:shell":   "./scripts/docker.sh shell",
"docker:ps":      "./scripts/docker.sh ps"
```

Keep existing `dev`, `test:server`, `test:client`. Run as `npm run docker:up`.

### 3. Delete `justfile`

Remove the file entirely. The `push` recipe in it (version bump + tag + push) moves to `scripts/push.sh` and gets a `"push": "./scripts/push.sh"` npm script — same dispatch pattern.

### 4. Document in README (or CLAUDE.md rules)

One-liner: "Docker lifecycle commands are `npm run docker:<verb>` — see `scripts/docker.sh`."

## Files touched

- `scripts/docker.sh` — new
- `scripts/push.sh` — new (extracted from justfile `push` recipe)
- [package.json](package.json) — add docker:* and push scripts
- [justfile](justfile) — delete
- [.claude/rules/setup.md](.claude/rules/setup.md) or README — mention the new commands (optional, low priority)

## Verification

After change:

```bash
npm run docker:build
npm run docker:up      # should print the URL line
npm run docker:logs    # streams app logs
npm run docker:shell   # drops into container
npm run docker:down
```

End-to-end: `npm run docker:build && npm run docker:up && curl http://localhost:3000/api/health` should hit the running container on the configured Docker context.

## Out of scope

- Fixing the Dockerfile (separate work, already done in prior turn).
- Adding new recipes (e.g. `db:migrate`, `db:seed`) — can come later.
- CI integration — the new scripts work in CI as-is.
