# Docker Node Application Template

A fully containerised, AI-first Node.js application stack for rapid
production-ready app development. Clone, configure, and deploy.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Express 4 + TypeScript (Node.js 20 LTS) |
| Frontend SPA | Vite + React + TypeScript |
| Database | PostgreSQL 16 Alpine via Prisma ORM |
| Orchestration | Docker Compose (dev), Docker Swarm (prod) |
| Secrets | SOPS + age at rest; Docker Swarm secrets at runtime |
| Reverse proxy | Caddy (`<appname>.jtlapp.net`) |
| AI process | CLASI (Claude Agent Skills Instructions) |

## Quick Start

```bash
# 1. Install dependencies, detect Docker contexts, decrypt secrets
./scripts/install.sh

# 2. Start dev server
npm run dev
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api
- Health check: `curl http://localhost:3000/api/health`

See [docs/setup.md](docs/setup.md) for full setup, Docker dev mode, and troubleshooting.

## Repository Layout

```
client/          Vite + React frontend
server/          Express backend + Prisma schema/migrations
docker/          Dockerfiles, Caddy config, entrypoint scripts
secrets/         SOPS-encrypted env files (dev + prod)
tests/           db / server / client / e2e test layers
docs/            Setup, deployment, secrets, and template spec guides
```

## Development

```bash
npm run dev              # Local native (DB in Docker, server + client native)
npm run dev:docker       # All services in Docker
npm run dev:docker:down  # Stop Docker dev stack
```

## Testing

```bash
npm run test:db       # Database layer (Jest + Prisma)
npm run test:server   # Backend API (Jest + Supertest)
npm run test:client   # Frontend components (Vitest + RTL)
npm run test:e2e      # End-to-end (Playwright, requires running containers)
```

## Key Conventions

- All API routes prefixed with `/api`
- PostgreSQL is the single data store — JSONB instead of MongoDB, LISTEN/NOTIFY instead of Redis
- Secrets are never hardcoded; they flow through `docker/entrypoint.sh`
- TypeScript everywhere — backend and frontend

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/setup.md](docs/setup.md) | First checkout → running dev server |
| [docs/deployment.md](docs/deployment.md) | Production deploy, rollback, troubleshooting |
| [docs/secrets.md](docs/secrets.md) | SOPS + age setup, onboarding, rotating secrets |
| [docs/template-spec.md](docs/template-spec.md) | Full template spec and technology decisions |

## AI-Assisted Development

This template uses the [CLASI](https://github.com/ericbusboom/claude-agent-skills)
(Claude Agent Skills Instructions) MCP server for structured AI-driven development.

```bash
pipx install git+https://github.com/ericbusboom/claude-agent-skills.git
clasi init
```

Use `/se` in Claude Code for process guidance, or call `get_se_overview()` via the MCP server.
