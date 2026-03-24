# Testing Rules

When writing or modifying tests, follow these rules.

## Authentication in Tests

The server exposes `POST /api/auth/test-login` (test/dev only) to bypass
OAuth. Always use this — never mock session middleware or fabricate cookies.

```typescript
const agent = request.agent(app);   // maintains cookies
await agent
  .post('/api/auth/test-login')
  .send({ email: 'user@test.com', displayName: 'Test User', role: 'USER' })
  .expect(200);
```

Use `request.agent(app)` (not `request(app)`) so session cookies persist
across requests within a test suite.

## Database Assertions

When a route modifies data, assert both the HTTP response AND the database
state via Prisma queries — not raw SQL or pg.Pool:

```typescript
await agent.post('/api/items').send({ name: 'Test' }).expect(201);
const item = await prisma.item.findFirst({ where: { name: 'Test' } });
expect(item).not.toBeNull();
```

## Layer Separation

| Layer | Directory | Framework |
|-------|-----------|-----------|
| Server | `tests/server/` | Vitest + Supertest |
| Client | `tests/client/` | Vitest + RTL |
| E2E | `tests/e2e/` | Playwright |

Never co-locate tests with source code.

## File Naming

- Server: `tests/server/<feature>.test.ts`
- Client: `tests/client/<Component>.test.tsx`
- E2E: `tests/e2e/<flow>.spec.ts`

## Coverage Requirements

- Every new API route gets at least a happy-path test and an auth/error test.
- Run `npm run test:server` after backend changes, `npm run test:client`
  after frontend changes. All must pass before a ticket is marked done.

## SQLite in Tests

Tests default to SQLite (`file:./data/test.db`). File parallelism is
disabled in vitest.config.ts because SQLite's single-writer lock causes
flaky failures under concurrency. Do not re-enable it without switching
to an in-memory session store.
