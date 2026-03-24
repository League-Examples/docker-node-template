# Developer Setup

This guide covers everything needed to go from a fresh checkout to a running
development server.

---

## Prerequisites

- **Node.js 20** (LTS)
- **Docker** — optional. The app defaults to SQLite for development. Docker
  is only needed if you want to use PostgreSQL.
  Install via [OrbStack](https://orbstack.dev/) (macOS) or
  [Docker Desktop](https://docs.docker.com/get-docker/).
- **pipx** — required to install Python tools (CLASI, dotconfig, rundbat)
  ```bash
  brew install pipx && pipx ensurepath   # macOS
  ```

---

## 1. Run the Install Script

```bash
./scripts/install.sh
```

The script performs the following, in order:

1. **npm dependencies** — installs packages for root, server, and client
2. **Docker context detection** — finds your local Docker daemon (OrbStack,
   Docker Desktop, or default). Skips gracefully if Docker is not installed.
3. **Project initialization** — asks whether to delete `docs/clasi/` (the
   template's SE process directory). Delete it unless you're contributing
   to the template itself.
4. **Python tools** — installs CLASI, dotconfig, and rundbat via pipx
   (if pipx is available), then runs `clasi init`
5. **`.env` generation** — assembles `.env` from `config/dev/public.env`
   and appends secrets via dotconfig (or placeholders if dotconfig is not
   installed)

Re-running the script is safe — if `.env` already exists, it asks whether
to overwrite or keep it.

---

## 2. Review `.env`

The install script generates `.env` from `config/dev/public.env` plus
Docker context settings and (optionally) decrypted secrets via dotconfig.

Key defaults:

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `file:./data/dev.db` | SQLite — works without Docker |
| `DEV_DOCKER_CONTEXT` | auto-detected | OrbStack, Docker Desktop, or default |

To use PostgreSQL instead, change `DATABASE_URL` to a `postgresql://` URL
and start a Postgres container (see [Deployment Guide](deployment.md)).

If the install script couldn't load secrets (dotconfig not installed or
no key access), add them manually to `.env`. See
`config/dev/secrets.env.example` for the required variables, and
[Secrets Management](secrets.md) for key setup.

---

## 3. Start Development

```bash
npm run dev
```

This runs `scripts/dev.sh`, which detects the database mode from
`DATABASE_URL`:

**SQLite mode** (default — no Docker needed):

| Label | What it does |
|-------|--------------|
| `[server]` | Pushes SQLite schema, starts Express with hot-reload |
| `[client]` | Waits for the API health check, then starts Vite |

**PostgreSQL mode** (when `DATABASE_URL` is a `postgresql://` URL):

| Label | What it does |
|-------|--------------|
| `[db]` | Starts `postgres:16-alpine` via `docker-compose.dev.yml` |
| `[server]` | Waits for Postgres, runs Prisma migrations, starts Express |
| `[client]` | Waits for the API health check, then starts Vite |

| Service | URL | Hot-reload |
|---------|-----|------------|
| Frontend | http://localhost:5173 | Yes (Vite HMR) |
| Backend | http://localhost:3000/api | Yes (tsx watch) |

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
npm run test:server   # Backend API (Vitest + Supertest)
npm run test:client   # Frontend components (Vitest + RTL)
```

Tests default to SQLite. No Docker or external database required.

---

## 6. Common Tasks

| Task | Command |
|------|---------|
| Run Prisma migrations (PostgreSQL) | `cd server && npx prisma migrate dev` |
| Push schema to SQLite | `cd server && ./prisma/sqlite-push.sh` |
| Open Prisma Studio | `cd server && npx prisma studio` |
| Deploy to production | See [Deployment Guide](deployment.md) |

---

## Troubleshooting

**`concurrently: not found`**
The root `npm install` was skipped. Run `npm install` from the project root.

**Vite starts but the app can't reach the API**
Check that the Vite proxy target in `client/vite.config.ts` matches the
port the server is running on (default `http://localhost:3000`).

**SQLite "database is locked" errors**
Only one process can write to SQLite at a time. Make sure you don't have
multiple dev servers running against the same `.db` file.

**Prisma schema mismatch**
If you switch between SQLite and PostgreSQL, regenerate the Prisma client:
- SQLite: `cd server && ./prisma/sqlite-push.sh`
- PostgreSQL: `cd server && npx prisma generate && npx prisma migrate dev`
