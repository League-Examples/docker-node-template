# AGENTS.md

## Software Engineering Process

This project uses the **CLASI Software Engineering Process** (Claude Agent
Skills Instructions) for structured, AI-driven development.

**The SE process is the default.** When asked to build a feature, fix a bug,
or make any code change, follow this process unless the stakeholder explicitly
says "out of process" or "direct change."

### Installation

```bash
pipx install git+https://github.com/ericbusboom/claude-agent-skills.git
clasi init
```

### Process Overview

| Stage | Activity | Output |
|-------|----------|--------|
| 1a | Requirements elicitation | Project overview, brief, use cases |
| 1b | Architecture | Technical plan, versioned architecture docs |
| 2 | Ticketing | Sequenced, numbered tickets with dependencies |
| 3 | Implementation | Code, tests, review, documentation, commit |

Work is organised into **sprints** that progress through a gated lifecycle:

```
planning-docs → architecture-review → stakeholder-review → ticketing → executing → closing → done
```

Use the `/se` slash command or call `get_se_overview()` via the CLASI MCP
server for detailed guidance at any stage.

### CLASI Built-in Agents

The CLASI process provides these agents: project-manager, product-manager,
requirements-analyst, architect, technical-lead, architecture-reviewer,
code-reviewer, python-expert, documentation-expert.

Refer to `get_agent_definition(<name>)` for each agent's full instructions.

---

## Custom Domain Agents

The following agents are specific to this project's technology stack. They
supplement the CLASI built-in agents and are invoked during Stage 3
(implementation) when working on tickets that touch their domain.

---

### Backend Engineer

**Role:** Expert in Express, Node.js, and server-side TypeScript.

**Owns:** Everything under `server/`.

**Responsibilities:**
- Design and implement Express routes, middleware, and error handling
- Integrate with the Prisma client for database access
- Implement authentication flows (session, passport strategies)
- Connect to external APIs (Google Workspace, GitHub OAuth, Pike 13)
- Ensure all API routes are prefixed with `/api`
- Return consistent error shapes: `{ error: string, detail?: string }`

**Key conventions:**
- Use `pino` for request logging
- Centralise error handling in `server/src/middleware/errorHandler.ts`
- Group route handlers by domain in `server/src/routes/`
- Business logic lives in `server/src/services/`, not in route handlers
- Environment variables come from the entrypoint script (see `docker/entrypoint.sh`);
  never hardcode secrets or read from `/run/secrets/` directly in application code
- For Postgres features beyond Prisma (LISTEN/NOTIFY, raw JSONB queries),
  use `prisma.$queryRaw` / `prisma.$executeRaw`

**Testing:** Write tests in `tests/server/` using Jest + Supertest.

---

### Frontend Engineer

**Role:** Expert in React, Vite, and client-side TypeScript.

**Owns:** Everything under `client/`.

**Responsibilities:**
- Build React components and page-level views
- Manage client-side routing with React Router
- Implement forms, state management, and data fetching
- Configure Vite (plugins, proxy, build optimisation)
- Ensure the dev proxy routes `/api` to the backend

**Key conventions:**
- Functional components with hooks (no class components)
- Co-locate component styles (CSS Modules or Tailwind utility classes)
- API calls go through `client/src/services/` — a thin fetch wrapper
- Share TypeScript interfaces in `client/src/types/` for API response shapes
- Pages (route-level components) live in `client/src/pages/`
- Reusable components live in `client/src/components/`

**Testing:** Write component tests in `tests/client/` using Vitest + React Testing Library.

---

### Database Engineer

**Role:** Expert in PostgreSQL, Prisma ORM, and migration management.

**Owns:** `server/prisma/` and `tests/db/`.

**Responsibilities:**
- Design and evolve the Prisma schema (`server/prisma/schema.prisma`)
- Create and manage migrations (`prisma migrate dev` / `prisma migrate deploy`)
- Implement JSONB patterns for document-style storage (MongoDB alternative)
- Implement LISTEN/NOTIFY for pub/sub messaging (Redis alternative)
- Implement job queues using `FOR UPDATE SKIP LOCKED`
- Design indexes (B-tree, GIN for JSONB, GiST for full-text search)
- Advise on query performance and explain plans

**Key conventions:**
- Use `postgres:16-alpine` — no other Postgres distribution
- Default to `GENERATED ALWAYS AS IDENTITY` for primary keys
- JSONB columns use the `Json` Prisma type; add GIN indexes for queried fields
- For features Prisma doesn't cover, write raw SQL via `prisma.$executeRaw`
- Never create a separate MongoDB or Redis service without explicit stakeholder
  approval; always propose the Postgres equivalent first

**MongoDB equivalents this agent must know:**

| MongoDB Operation | Postgres Equivalent |
|-------------------|-------------------|
| `insertOne` / `insertMany` | `INSERT INTO ... (data) VALUES ($1::jsonb)` |
| `find({ field: value })` | `SELECT * FROM t WHERE data->>'field' = 'value'` |
| `find({ nested.path: value })` | `SELECT * FROM t WHERE data #>> '{nested,path}' = 'value'` |
| `updateOne($set)` | `UPDATE t SET data = data \|\| $1::jsonb WHERE ...` |
| `$push` to array | `UPDATE t SET data = jsonb_set(data, '{arr}', data->'arr' \|\| $1::jsonb)` |
| Aggregation pipeline | SQL `GROUP BY`, `FILTER`, window functions, or CTEs |
| TTL indexes | `pg_cron` scheduled cleanup or application-level expiry |

**Redis equivalents this agent must know:**

| Redis Operation | Postgres Equivalent |
|-----------------|-------------------|
| `PUB/SUB` | `LISTEN` / `NOTIFY` channels |
| `SET key value EX ttl` | `UNLOGGED` table with expiry column + scheduled cleanup |
| `INCR` / `DECR` | `UPDATE t SET counter = counter + 1 RETURNING counter` |
| Simple cache | `UNLOGGED` table or application-level `Map` if single-process |
| Rate limiting | Sliding-window counter in a regular table |

**Testing:** Write database tests in `tests/db/` using Jest + Prisma Client
against a dedicated test database.

---

### Test Engineer

**Role:** Expert in testing strategy across all layers of the stack.

**Owns:** The `tests/` directory and test configuration.

**Responsibilities:**
- Maintain the four-layer test structure (db, server, client, e2e)
- Ensure each ticket's changes have appropriate test coverage
- Run the correct subset of tests based on what changed
- Manage test database lifecycle (create, migrate, reset, teardown)
- Configure and maintain Playwright for end-to-end tests

**Test layers:**

| Layer | Location | Framework | Trigger |
|-------|----------|-----------|---------|
| Database | `tests/db/` | Jest + Prisma Client | Schema or migration changes |
| Backend | `tests/server/` | Jest + Supertest | Route, middleware, or service changes |
| Frontend | `tests/client/` | Vitest + React Testing Library | Component or page changes |
| E2E | `tests/e2e/` | Playwright | Any user-facing change; run before ticket completion |

**Key conventions:**
- Database tests use a separate `_test` database; migrations run before the suite
- Backend tests use Supertest against the Express app (no live server needed)
- Frontend tests render components in JSDOM via React Testing Library
- E2E tests run against the full Docker Compose stack
- Tests must be deterministic — no reliance on external services or timing
- Reset state between tests via transaction rollback or table truncation
- The test engineer reviews test coverage before marking any ticket done

**Commands:**

```bash
npm test              # Run all tests
npm run test:db       # Database layer only
npm run test:server   # Backend layer only
npm run test:client   # Frontend layer only
npm run test:e2e      # End-to-end (requires running containers)
```

---

## Agent Interaction Model

During CLASI Stage 3 (ticket execution), agents collaborate as follows:

1. The **project-manager** (CLASI) assigns a ticket
2. The relevant domain agent(s) plan and implement the change
3. The **test engineer** writes or updates tests for the change
4. The **code-reviewer** (CLASI) reviews the implementation
5. The **documentation-expert** (CLASI) updates docs if needed
6. The ticket is marked done

When a ticket spans multiple domains (e.g., a new API endpoint with a
database migration and a frontend page), the agents work sequentially:
Database Engineer → Backend Engineer → Frontend Engineer → Test Engineer.

---

## Developer Documentation

All agents **must** read and follow the guides in `docs/` when performing
setup, deployment, or secrets operations. These docs are the single source
of truth for operational procedures — do not improvise or give ad-hoc
instructions for tasks covered here.

| Guide | Covers |
|-------|--------|
| [`docs/setup.md`](docs/setup.md) | First checkout to running dev server, dev modes, tests, Codespaces notes |
| [`docs/deployment.md`](docs/deployment.md) | Production architecture, deploy steps, rollback, troubleshooting |
| [`docs/secrets.md`](docs/secrets.md) | SOPS + age setup, onboarding, adding/rotating secrets, swarm loading |
| [`docs/template-spec.md`](docs/template-spec.md) | Full template specification, technology decisions, integration guidelines |

---

## npm Scripts Reference

All scripts source `.env` (generated by `scripts/install.sh`) to load Docker
context names, SOPS key paths, database URL, and application secrets. See
[`docs/setup.md`](docs/setup.md) for first-time setup.

### Setup

| Script | Description |
|--------|-------------|
| `./scripts/install.sh` | One-time project setup. Installs npm dependencies for root, server, and client. Detects Docker contexts, locates or generates an age keypair, adds public key to `.sops.yaml`, and generates `.env` from `.env.template` with decrypted secrets. Re-running prompts to overwrite if `.env` already exists. |
| `npm run secrets:add-key` | Onboards a new developer's age public key into `.sops.yaml` and re-encrypts the secret files so the new key can decrypt them. |

### Development

| Script | Description |
|--------|-------------|
| `npm run dev` | **Primary dev command.** Alias for `dev:local`. Starts three processes concurrently: Postgres in Docker, Express backend natively, and Vite frontend natively. Use this for day-to-day development — you get the fastest hot-reload because the server and client run directly on the host. Requires Docker for the database container only. |
| `npm run dev:local` | Same as `dev`. Runs `concurrently` with labelled output (`db`, `server`, `client`) so you can tell which process logged what. |
| `npm run dev:local:db` | Starts only the Postgres container via `docker compose up db`. Useful if you want to manage the server and client processes yourself, or if you're running backend tests that need a live database. |
| `npm run dev:local:server` | Starts the Express backend natively. Waits for the database to be ready, runs `prisma generate` and `prisma migrate dev` (applies any pending migrations), then starts the server with `ts-node-dev` for hot-reload. Listens on port 3000. |
| `npm run dev:local:client` | Starts the Vite dev server natively. Waits for the backend health endpoint (`/api/health`) before starting so the proxy target is available. Listens on port 5173. |
| `npm run dev:docker` | **Full-stack Docker dev.** Builds and starts all three services (db, server, client) inside Docker containers. Use this when you want a completely containerised environment, or when testing on a remote Docker host. Slower to iterate than `dev:local` because code changes require a container rebuild (unless you uncomment the volume mounts in `docker-compose.yml`). |
| `npm run dev:docker:down` | Stops and removes the Docker dev containers. Does not delete the `pgdata` volume, so your database persists across restarts. |
| `npm run dev:docker:migrate` | Runs `prisma migrate dev` inside the running server container. Use this after adding a new migration while the Docker dev stack is running. |

### Build

| Script | Description |
|--------|-------------|
| `npm run build` | Compiles both server (TypeScript → JavaScript via `tsc`) and client (Vite production build). Runs locally without Docker. Use this to check that both projects compile cleanly before committing. |
| `npm run build:docker` | Builds the production Docker image for the server using `docker-compose.prod.yml`. The image uses a multi-stage Dockerfile that compiles TypeScript, then copies only the runtime artifacts into a slim Alpine image. Use this before deploying or to test the production image locally. |

### Secrets

| Script | Description |
|--------|-------------|
| `npm run secrets:dev` | Decrypts `secrets/dev.env` via SOPS and creates Docker Swarm secrets for the dev environment. Each `KEY=value` pair becomes a lowercase swarm secret (e.g., `SESSION_SECRET` → `session_secret`). Only needed if you're running the dev environment in Swarm mode. |
| `npm run secrets:dev:rm` | Removes all Docker Swarm secrets for the dev environment. Run this before `secrets:dev` if you need to update secret values (swarm secrets are immutable — you must remove and recreate them). |
| `npm run secrets:prod` | Same as `secrets:dev` but decrypts `secrets/prod.env` and targets the production Docker context. Run this on initial deployment or whenever production secrets change. See [`docs/secrets.md`](docs/secrets.md). |
| `npm run secrets:prod:rm` | Removes all production Docker Swarm secrets. Use before `secrets:prod` to rotate or update secret values. |

### Deployment

| Script | Description |
|--------|-------------|
| `npm run deploy` | **Production deployment.** Builds the server Docker image via the production Dockerfile, then deploys the full stack to Docker Swarm using `docker stack deploy`. Targets the production Docker context (`PROD_DOCKER_CONTEXT` from `.env`, typically `swarm1`). Swarm performs a rolling update if the stack is already running. See [`docs/deployment.md`](docs/deployment.md) for the full deployment workflow including image tagging, secret loading, and post-deploy migration. |

### Testing

| Script | Description |
|--------|-------------|
| `npm test` | Prints a help message listing the available test suites. Does not run any tests — use the specific commands below. |
| `npm run test:db` | Runs database-layer tests using Jest + Prisma Client against a live Postgres instance. Tests migrations, JSONB queries, constraints, and LISTEN/NOTIFY. Requires the database to be running (`npm run dev:local:db`). |
| `npm run test:server` | Runs backend API tests using Jest + Supertest. Tests route handlers, middleware, and service logic by making HTTP requests against the Express app (no live server needed — Supertest binds internally). |
| `npm run test:client` | Runs frontend component tests using Vitest + React Testing Library in a JSDOM environment. Tests component rendering, hooks, and user interactions. No Docker or running server required. |
| `npm run test:e2e` | Runs end-to-end tests using Playwright through a real browser against the full stack. Requires all services to be running (`npm run dev` or `npm run dev:docker`). Run these before marking any ticket as done. |

---

## Deployment Agent Notes

Deployment is not a separate agent but a shared responsibility. All agents
must understand the deployment workflow documented in
[`docs/deployment.md`](docs/deployment.md) and the secrets lifecycle in
[`docs/secrets.md`](docs/secrets.md). Domain pattern: `<appname>.jtlapp.net`
via Caddy labels.

<!-- CLASI:START -->
## CLASI Software Engineering Process

This project uses the **CLASI** (Claude Agent Skills Instructions)
software engineering process, managed via an MCP server.

**The SE process is the default.** When asked to build a feature, fix a
bug, or make any code change, follow this process unless the stakeholder
explicitly says "out of process" or "direct change".

### Process

Work flows through four stages organized into sprints:

1. **Requirements** — Elicit requirements, produce overview and use cases
2. **Architecture** — Produce technical plan
3. **Ticketing** — Break plan into actionable tickets
4. **Implementation** — Execute tickets

Use `/se` or call `get_se_overview()` for full process details and MCP
tool reference.

### Stakeholder Corrections

When the stakeholder corrects your behavior or expresses frustration
("that's wrong", "why did you do X?", "I told you to..."):

1. Acknowledge the correction immediately.
2. Run `get_skill_definition("self-reflect")` to produce a structured
   reflection in `docs/plans/reflections/`.
3. Continue with the corrected approach.

Do NOT trigger on simple clarifications, new instructions, or questions
about your reasoning.
<!-- CLASI:END -->
