# Docker Node Application Template

## Key Documentation

Refer to these docs before performing setup, deployment, secrets, or
integration work. They are the single source of truth — do not improvise
procedures that are already documented here.

| Guide | When to consult |
|-------|-----------------|
| [docs/setup.md](docs/setup.md) | First-time checkout, running the install script, starting the dev server, running tests |
| [docs/template-spec.md](docs/template-spec.md) | Technology decisions, project structure, backend/frontend/database conventions, Docker architecture |
| [docs/deployment.md](docs/deployment.md) | Production builds, Swarm deployment, rolling updates, rollback |
| [docs/secrets.md](docs/secrets.md) | SOPS + age setup, onboarding new developers, adding/rotating secrets, Swarm secret loading |
| [docs/api-integrations.md](docs/api-integrations.md) | GitHub OAuth, Google OAuth, Pike 13 API — setup, endpoints, callback URLs |
| [docs/testing.md](docs/testing.md) | Test strategy, auth bypass for tests, server/client/E2E conventions, agent test guidelines |

## MANDATORY: Service Layer Architecture

All business logic MUST live in service classes, not in route handlers.
Routes are thin adapters: validate input, call a service method, format
the response. This keeps logic testable and reusable across both the web
UI and the MCP server.

**Key rules:**

1. **Use ServiceRegistry.** Create an instance via
   `ServiceRegistry.create('UI')` (or `'MCP'` for MCP tool handlers).
   Access services through the registry: `services.users.list()`,
   `services.channels.create(name)`, etc.

2. **Never put business logic in routes.** If a route handler has more
   than input validation + a service call + response formatting, the
   logic belongs in a service class.

3. **Adding a new service:**
   - Create `server/src/services/<name>.service.ts` with a class that
     accepts a Prisma client in its constructor.
   - Add a readonly property and instantiation in `ServiceRegistry`.
   - Import and use from routes or MCP tools via the registry.

4. **Service classes receive Prisma via constructor injection.** This
   makes them testable with mock clients when needed.

See `server/src/services/service.registry.ts` for the current registry
and [docs/template-spec.md](docs/template-spec.md) section 3.4 for
full documentation.

## MANDATORY: Testing Requirements

**Read [docs/testing.md](docs/testing.md) before writing any tests.**

Key rules that agents must follow:

1. **Test-login endpoint.** The server exposes `POST /api/auth/test-login`
   (test/dev environment only) to bypass OAuth. Use this — never mock
   session middleware or fabricate cookies.
2. **Supertest agents.** Use `request.agent(app)` to maintain session
   cookies across requests within a test suite.
3. **Assert the database.** When a route modifies data, assert both the
   HTTP response AND the database state via Prisma queries.
4. **Layer separation.** Server tests go in `tests/server/`, client tests
   in `tests/client/`, E2E in `tests/e2e/`. Never co-locate tests with
   source code.
5. **Every new route gets tests.** No API route ships without at least a
   happy-path test and an auth/error test.
6. **Run before closing.** `npm run test:server` after backend changes,
   `npm run test:client` after frontend changes. All must pass before a
   ticket is marked done.
