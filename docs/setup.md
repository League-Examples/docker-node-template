# Developer Setup

This guide covers everything needed to go from a fresh checkout to a running
development server, plus tests and common tasks. Codespaces-specific notes are
called out inline where the defaults differ.

---

## Prerequisites

- **Node.js 20** (LTS)
- **Docker** with a local daemon (e.g., OrbStack, Docker Desktop, or the
  daemon built into GitHub Codespaces)
- **SOPS** + **age** — only required for the standard secrets workflow;
  see [Option B](#option-b--create-manually-codespaces--no-sops) if you
  don't have them yet
  ```bash
  brew install sops age   # macOS
  ```
- An age keypair — see [Secrets Management](secrets.md) for setup
- **pipx** — required to install the CLASI SE process tooling
  ```bash
  brew install pipx && pipx ensurepath   # macOS
  ```

---

## 1. Run the Install Script

The install script handles all first-time setup in one step:

```bash
./scripts/install.sh
```

It performs the following, in order:

1. **npm dependencies** — installs packages for root, server, and client
2. **Docker context detection** — finds your local Docker daemon (OrbStack,
   Docker Desktop, or default)
3. **SOPS + age** — locates or generates an age keypair, adds your public
   key to `.sops.yaml`
4. **CLASI SE process** — installs the CLASI tooling via `pipx` and runs
   `clasi init` to configure the MCP server
5. **`.env` generation** — creates `.env` from `.env.template`, fills in
   detected values, and appends decrypted application secrets

Re-running the script is safe — it detects existing state and skips steps
that are already done. If `.env` already exists, it asks whether to
overwrite or keep it.

---

## 2. Review `.env`

The install script generates `.env` from `.env.template`. It contains Docker
context configuration, SOPS/age key settings, and decrypted application
secrets — all in one file sourced by every npm script.

To change your Docker context later, edit `.env` directly or delete it and
re-run `./scripts/install.sh`.

> **Codespaces:** The only available Docker context is `default`.

If the install script couldn't decrypt secrets (new key, not yet authorised),
add them manually:

```bash
echo "SESSION_SECRET=dev-session-secret-change-me" >> .env
echo "DATABASE_URL=postgresql://app:devpassword@localhost:${DB_PORT:-5433}/app" >> .env
```

See [Secrets Management](secrets.md) for key setup and onboarding.

> **Codespaces:** The devcontainer sets `DB_PORT=5432`, which causes Docker
> Compose to map Postgres to host port **5432** instead of the default 5433.
> The command above reads `$DB_PORT` automatically, so the right port is used.

To confirm which port Postgres is bound to after starting:

```bash
docker ps
# e.g. "0.0.0.0:5432->5432/tcp" or "0.0.0.0:5433->5432/tcp"
```

---

## 3. Start Development

There are two development modes.

### Local Native (recommended)

Database runs in Docker; server and client run natively with hot-reload:

```bash
npm run dev
```

`concurrently` starts three services in parallel:

| Label      | What it does |
|------------|--------------|
| `[db]`     | Starts `postgres:16-alpine` in Docker |
| `[server]` | Waits for Postgres, runs Prisma migrations, starts Express with hot-reload |
| `[client]` | Waits for the API health check, then starts Vite |

| Service  | URL | Hot-reload |
|----------|-----|------------|
| Frontend | http://localhost:5173 | Yes (Vite HMR) |
| Backend  | http://localhost:3000/api | Yes (ts-node-dev) |
| Database | localhost:5433 (or 5432 in Codespaces) | N/A |

### Docker Development

All three services run in Docker:

```bash
npm run dev:docker
```

| Service  | URL | Hot-reload |
|----------|-----|------------|
| Frontend | http://localhost:5173 | Rebuild required |
| Backend  | http://localhost:3000/api | Rebuild required |
| Database | Internal (port 5432) | N/A |

Stop with:

```bash
npm run dev:docker:down
```

---

## 4. Verify It's Working

```bash
curl http://localhost:3000/api/health
# → {"status":"ok"}
```

Opening http://localhost:5173 in a browser should show the React app.

---

## 5. Run Tests

```bash
npm run test:db       # Database layer (Jest + Prisma)
npm run test:server   # Backend API (Jest + Supertest)
npm run test:client   # Frontend components (Vitest + RTL)
npm run test:e2e      # End-to-end (Playwright, requires running containers)
```

---

## 6. Common Tasks

| Task | Command |
|------|---------|
| Run Prisma migrations (local) | `cd server && npx prisma migrate dev` |
| Run Prisma migrations (Docker dev) | `npm run dev:docker:migrate` |
| Open Prisma Studio | `cd server && npx prisma studio` |
| Build for production | `npm run build:docker` |
| Deploy to production | See [Deployment Guide](deployment.md) |

---

## Troubleshooting

**`concurrently: not found`**
The root `npm install` was skipped. Run `npm install` from the project root.

**`Waiting for database...` hangs or times out**
Either the Docker daemon isn't running, the Docker context in `.env`
is wrong, or the `DATABASE_URL` port in `.env` doesn't match the port Docker
actually bound. Check `docker ps` to confirm the port.

**`pg` module not found during DB wait**
Server dependencies aren't installed. Run `cd server && npm install`.

**Prisma migration errors on first run**
`_prisma_migrations` not found is normal on a brand-new database — Prisma
creates it automatically during `migrate dev`. Any other error usually means
`DATABASE_URL` points to the wrong host or port.

**Vite starts but the app can't reach the API**
Check that the Vite proxy target in `client/vite.config.ts` matches the
port the server is running on (default `http://localhost:3000`).
