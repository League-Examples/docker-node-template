---
status: draft
from-architecture-version: null
to-architecture-version: null
---

# Sprint 003 Technical Plan

## Architecture Version

- **From version**: no change (infrastructure upgrade)
- **To version**: no change

## Architecture Overview

This is a dependency upgrade sprint. The component architecture stays
the same — Express backend, React frontend, PostgreSQL database. The
changes are to the Prisma layer and the server's module system.

```
Before:
  server (CJS) → @prisma/client (6.x, generated in node_modules)

After:
  server (ESM) → generated prisma client (7.x, local output)
                → @prisma/adapter-pg → pg Pool → PostgreSQL
```

## Component Design

### Component: Prisma Schema & Config

**Use Cases**: SUC-001, SUC-002, SUC-003

Update `server/prisma/schema.prisma`:
- Change generator provider from `prisma-client-js` to `prisma-client`
- Add `output` field pointing to `../src/generated/prisma`

Create `server/prisma.config.ts`:
- Configure schema path, migration output, env loading

### Component: Prisma Client Singleton

**Use Cases**: SUC-001, SUC-002, SUC-003

Update `server/src/services/prisma.ts`:
- Import PrismaClient from the new generated output path
- Import `@prisma/adapter-pg` and `pg`
- Create a `pg.Pool` with the DATABASE_URL
- Pass the adapter to PrismaClient constructor

### Component: Server ESM Migration

**Use Cases**: SUC-001, SUC-002, SUC-003

Update `server/package.json`:
- Add `"type": "module"`
- Replace `ts-node-dev` with `tsx` in dev script

Update `server/tsconfig.json`:
- Change `"module": "commonjs"` → `"module": "ESNext"` (or `"NodeNext"`)
- Change `"moduleResolution"` to `"bundler"` (or `"NodeNext"`)

Update all relative imports in `server/src/` to include `.js` extensions
(required for ESM with TypeScript's NodeNext resolution), OR use
`"moduleResolution": "bundler"` which allows extensionless imports.

### Component: Docker Build Updates

**Use Cases**: SUC-002

Update `docker/Dockerfile.server`:
- `npx prisma generate` → may need schema path flag
- Ensure generated client directory is copied to runtime stage

Update `docker/Dockerfile.server.dev`:
- Replace `ts-node-dev` invocation with `tsx watch`
- Ensure `npx prisma generate` runs correctly

Update `docker/dev-server-start.sh`:
- Verify migration commands work with Prisma 7 CLI

### Component: Root Script Updates

**Use Cases**: SUC-001

Update `package.json` (root):
- `dev:local:server` script: replace `npx prisma generate && npx prisma migrate dev` with Prisma 7 equivalents (CLI commands likely unchanged, but verify)
- `dev:docker:migrate` script: verify compatibility

## Open Questions

1. **ESM module resolution strategy**: Should we use `"moduleResolution":
   "NodeNext"` (requires `.js` extensions on all relative imports) or
   `"moduleResolution": "bundler"` (allows extensionless imports, simpler
   migration)? NodeNext is stricter and more correct for Node.js; bundler
   is more pragmatic and requires fewer file changes.

2. **Prisma client output location**: Should the generated client go in
   `server/src/generated/prisma/` (Prisma's recommended convention) or
   somewhere else? The generated directory should be gitignored.
