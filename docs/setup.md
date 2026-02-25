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

---

## 1. Install Dependencies

Three separate `package.json` files exist — one at the root and one each for
the server and client. All three must be installed:

```bash
npm install
cd server && npm install
cd ../client && npm install
```

The root package provides `concurrently`, which runs all three dev services
in parallel. The server package includes `pg`, which `docker/wait-for-db.sh`
needs to poll Postgres on startup. Missing either causes the dev server to
fail immediately.

---

## 2. Configure Your Docker Context

`deploy.env` controls which Docker context is used for development. The
default is `orbstack`, but it must match what's available on your machine:

```bash
docker context ls
```

Edit `deploy.env` with the correct value:

```bash
DEV_DOCKER_CONTEXT=orbstack         # OrbStack (macOS)
DEV_DOCKER_CONTEXT=desktop-linux    # Docker Desktop (macOS/Windows)
DEV_DOCKER_CONTEXT=default          # Codespaces / Linux / plain Docker
```

> **Codespaces:** The only available context is `default`.

---

## 3. Create `.env`

The server reads secrets from `.env` at the project root. This file is
gitignored and must be created locally.

### Option A — Decrypt with SOPS (standard, including Codespaces)

If your age key is configured (see [Secrets Management](secrets.md#codespaces-key-setup)
for Codespaces setup):

```bash
sops -d secrets/dev.env > .env
```

See [Secrets Management](secrets.md) for key setup and onboarding.

### Option B — Create manually (age key not configured)

Create `.env` from the example file plus the dev database credentials from
`docker-compose.yml`:

```bash
cat secrets/dev.env.example > .env
echo "DATABASE_URL=postgresql://app:devpassword@localhost:${DB_PORT:-5433}/app" >> .env
```

The result should look like:

```
SESSION_SECRET=dev-session-secret-change-me
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

> **Codespaces:** The devcontainer sets `DB_PORT=5432`, which causes Docker
> Compose to map Postgres to host port **5432** instead of the default 5433.
> The command above reads `$DB_PORT` automatically, so the right port is used.

To confirm which port Postgres is bound to after starting:

```bash
docker ps
# e.g. "0.0.0.0:5432->5432/tcp" or "0.0.0.0:5433->5432/tcp"
```

---

## 4. Start Development

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

## 5. Verify It's Working

```bash
curl http://localhost:3000/api/health
# → {"status":"ok"}
```

Opening http://localhost:5173 in a browser should show the React app.

---

## 6. Run Tests

```bash
npm run test:db       # Database layer (Jest + Prisma)
npm run test:server   # Backend API (Jest + Supertest)
npm run test:client   # Frontend components (Vitest + RTL)
npm run test:e2e      # End-to-end (Playwright, requires running containers)
```

---

## 7. Common Tasks

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
Either the Docker daemon isn't running, the Docker context in `deploy.env`
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
