# Architecture Rules

## Service Layer Pattern

Business logic lives in service classes, not in route handlers. Routes
are thin adapters: validate input, call a service method, format the
response.

Access services through `ServiceRegistry`:

```typescript
const services = ServiceRegistry.create('UI');  // or 'MCP'
const users = await services.users.list();
```

**Adding a new service:**

1. Create `server/src/services/<name>.service.ts` with a class that
   accepts a Prisma client in its constructor.
2. Add a property and instantiation in `ServiceRegistry`.
3. Use it from routes via `ServiceRegistry.create('UI')`.

## API Conventions

- All API routes are prefixed with `/api`
- JSON request/response bodies
- Standard HTTP status codes
- Centralized error handler returns `{ error: string, detail?: string }`
- Typed errors via `ServiceError` class hierarchy in
  `server/src/errors/`

## Database Philosophy

This project uses PostgreSQL as the single data store. Before reaching
for additional services:

- Need document/schemaless data? Use **JSONB** columns.
- Need key-value cache? Use a JSONB table or `UNLOGGED` tables.
- Need pub/sub? Use **LISTEN/NOTIFY**.
- Need job queues? Use LISTEN/NOTIFY + a jobs table with `FOR UPDATE SKIP LOCKED`.
- Need full-text search? Use `tsvector`/`tsquery`.

**Do not add MongoDB or Redis.** If a use case seems to require them,
demonstrate the PostgreSQL equivalent first. Only add them after
discussion with the stakeholder.

## Dual Database Support

The project supports both SQLite (dev default) and PostgreSQL (production).
The Prisma client is initialized lazily in `server/src/services/prisma.ts`
based on the `DATABASE_URL` format:

- `file:...` → SQLite via `@prisma/adapter-better-sqlite3`
- `postgresql://...` → PostgreSQL via `@prisma/adapter-pg`

When writing database code, avoid PostgreSQL-specific SQL. Use Prisma ORM
methods. If you must use raw SQL, check `isSqlite()` and branch accordingly.

SQLite schema is generated from the PostgreSQL schema by `server/prisma/sqlite-push.sh`,
which strips `@db.*` annotations and swaps the provider.

## Integrations Degrade Gracefully

All OAuth integrations (GitHub, Google, Pike 13) are optional. The server
starts cleanly without credentials — unconfigured integrations return
**501** with setup instructions. Never make the app fail to start because
an integration secret is missing.
