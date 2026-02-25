# CLAUDE.md

@AGENTS.md
@docs/template-spec.md

## Project

Docker-based Node.js application template. Express backend, React frontend,
PostgreSQL database, deployed to Docker Swarm.

## Stack

- **Backend:** Express + TypeScript (`server/`)
- **Frontend:** Vite + React + TypeScript (`client/`)
- **Database:** PostgreSQL 16 Alpine, ORM via Prisma (`server/prisma/`)
- **Orchestration:** Docker Compose (dev), Docker Swarm (prod)
- **Secrets:** SOPS + age at rest, Swarm secrets at runtime (`secrets/`)
- **Reverse proxy:** Caddy with `*.jtlapp.net` wildcard domain

## Process

Follow the CLASI SE process defined in `AGENTS.md` by default.
Use `/se` or call `get_se_overview()` for process guidance.
Only skip the process if the stakeholder says "out of process" or "direct change."

## Docker Contexts

Docker context names are configured in `deploy.env`:
- `DEV_DOCKER_CONTEXT` — local Docker daemon for development (default: `orbstack`)
- `PROD_DOCKER_CONTEXT` — remote Docker host for production (default: `swarm1`)

All npm scripts that invoke Docker source `deploy.env` and set `DOCKER_CONTEXT`
automatically. Developers should edit `deploy.env` to match their local setup.

## Conventions

- TypeScript everywhere — backend and frontend
- All API routes prefixed with `/api`
- PostgreSQL is the single data store — use JSONB instead of MongoDB,
  LISTEN/NOTIFY instead of Redis
- Secrets are never hardcoded; they flow through `docker/entrypoint.sh`
- Tests are layered: `tests/db/`, `tests/server/`, `tests/client/`, `tests/e2e/`
- Production domain pattern: `<appname>.jtlapp.net`
