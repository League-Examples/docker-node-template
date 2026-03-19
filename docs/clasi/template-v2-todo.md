# Template V2: Port Inventory Patterns Back to Template

> **Goal:** Upgrade the docker-node-template with battle-tested patterns from
> the inventory application. The template should provide a rich, opinionated
> starting point so that new projects get a full admin dashboard, service layer,
> MCP server, modern secrets management, and polished UI layout out of the box.

---

## 1. Secrets & Configuration — Migrate from `secrets/` to `config/`

**Current state:** Secrets live in `secrets/` with SOPS+age encrypted
`dev.env` / `prod.env` files. A single flat file per environment.

**Target state:** Adopt the inventory's `config/` directory structure with
split public/secret files per environment.  BUT DONT DELETE THE SECRETS UNTIL I 
HAVE VERIFIED THEY ARE TRANSFERED

### Tasks

- [ ] Create `config/` directory structure using `dotconfig init`:
  ```
  config/
  ├── dev/
  │   ├── public.env      # Non-secret env vars (committed, plaintext)
  │   └── secrets.env     # Encrypted with SOPS+age (committed)
  ├── prod/
  │   ├── public.env
  │   └── secrets.env
  ├── local/              # Developer-specific overrides (gitignored)
  └── sops.yaml           # SOPS encryption policy
  ```
- [ ] Move `.sops.yaml` into `config/sops.yaml` (or update root `.sops.yaml`
  to point at `config/` paths)
- [ ] Split current `secrets/dev.env` into `config/dev/public.env` (non-secret
  values like `APP_DOMAIN`, `DATABASE_URL`, `DEPLOYMENT=dev`, callback URLs)
  and `config/dev/secrets.env` (actual secrets: passwords, tokens, API keys)
- [ ] Same split for `secrets/prod.env` → `config/prod/`
- [ ] Update `.gitignore` to ignore `config/local/` and keep
  `config/dev/secrets.env` + `config/prod/secrets.env` as SOPS-encrypted
  committed files
- [ ] Update `scripts/install.sh` (or equivalent) to source from the new
  `config/` layout instead of `secrets/`
- [ ] Update `docker/entrypoint.sh` if it references `secrets/` paths
- [ ] Remove old `secrets/` directory and references
- [ ] Update documentation (`docs/secrets.md`, `docs/template-spec.md`,
  `AGENTS.md`) to reflect the new config structure

---

## 2. Local Development Environment — Docker & Database

**Current state:** Three compose files — `docker-compose.yml` (dev with all
services), `docker-compose.prod.yml` (Swarm). PostgreSQL runs inside the
same compose file as the app.

**Target state (this section — dev only):** Clean local development setup.
Dev database in its own compose file. `npm run dev` starts everything and
you can test the full app locally. Production Docker work is deferred to
the final sprint (section 13).

### Tasks

- [ ] Create `docker-compose.dev.yml` — PostgreSQL only (port 5433, user
  `app`, password `devpassword`, database `app`, health check via
  `pg_isready`, `pgdata` volume)
- [ ] Keep `docker/Dockerfile.server.dev` for development hot-reload
- [ ] `Dockerfile.client.dev` — not needed (Vite runs natively in dev;
  removed in final sprint along with `Dockerfile.client`)
- [ ] Update `server/src/app.ts` to serve static files from the built
  client directory when `NODE_ENV=production` (SPA fallback) — this is
  needed even in dev for the pattern to be established
- [ ] Update npm scripts in root `package.json`:
  - `dev` — concurrently: `docker compose -f docker-compose.dev.yml up`
    + Express server (ts-node-dev) + Vite client
  - `dev:docker` — full Docker compose with all services containerized
- [ ] Ensure `DATABASE_URL` flows correctly from `config/dev/public.env`
- [ ] Verify Prisma config (`prisma.config.ts`) works with the dev setup
- [ ] Verify: `npm run dev` → DB starts, migrations run, server + client
  start, app is usable at `localhost:5173`

---

## 3. (Merged into section 2 — dev database is part of local dev setup)

---

## 4. Service Layer Architecture

**Current state:** Minimal services — `prisma.ts` (client init), `config.ts`
(config cache), `counter.ts` (demo CRUD), `logBuffer.ts` (log ring buffer).
Routes call services directly with no central registry.

**Target state:** Adopt the ServiceRegistry pattern from inventory. All
business logic lives in services; routes are thin handlers that delegate to
the registry. The registry is the composition root for dependency injection. Service
layer is documented for both humans and agents.

### Tasks

- [ ] Create `server/src/services/service.registry.ts`:
  - Constructor takes `PrismaClient` and optional `source` (for audit trail:
    `'UI'` | `'API'` | `'MCP'` | `'SYSTEM'`)
  - Static `create()` factory method
  - Exposes all service instances as properties
  - `clearAll()` method for test cleanup
- [ ] Refactor existing services to follow the pattern:
  - `ConfigService` — wraps current `config.ts` logic
  - `ChannelService` — channel CRUD (example app)
  - `MessageService` — message CRUD (example app)
  - `LogBufferService` — wraps current `logBuffer.ts`
  - `UserService` — user CRUD + role management (new)
  - `SessionService` — session queries with linked user info (new, S006)
  - `BackupService` — database export/backup (new)
  - `SchedulerService` — scheduled job execution (new)
- [ ] Update all route handlers to receive `ServiceRegistry` and delegate
  to services (no direct Prisma calls from routes)
- [ ] Create `server/src/contracts/` directory for shared types/enums
  (e.g., `user.ts` with roles, `audit.ts` with source types)
- [ ] Write documentation in `docs/template-spec.md` section on the service
  layer pattern, encouraging AI agents and developers to:
  - Always add business logic to services, never to routes
  - Register new services in the ServiceRegistry
  - Use the registry for dependency injection in tests
  - Keep routes as thin request/response adapters

---

## 5. Admin Dashboard — Full Feature Port

**Current state:** Template has a basic admin panel with: Environment info,
Database viewer, Configuration panel, Log viewer, Session viewer. Uses
password-based admin auth. Flat route structure under `/admin`.

**Target state:** Comprehensive admin dashboard matching the inventory app's
feature set (minus inventory-specific features like Categories).

### 5.1 User Management

- [ ] Add `User` model to Prisma schema:
  ```prisma
  enum UserRole {
    USER
    ADMIN
  }
  model User {
    id          Int       @id @default(autoincrement())
    email       String    @unique
    displayName String?
    role        UserRole  @default(USER)
    avatarUrl   String?
    provider    String?   // 'google', 'github', etc.
    providerId  String?
    createdAt   DateTime  @default(now())
    updatedAt   DateTime  @updatedAt
  }
  ```
- [ ] Create `UserService` with CRUD operations (list, create, update, delete)
- [ ] Create admin API routes:
  - `GET /api/admin/users` — list all users
  - `POST /api/admin/users` — create/pre-provision user
  - `PUT /api/admin/users/:id` — update user details/role
  - `DELETE /api/admin/users/:id` — delete user
- [ ] Create `UsersPanel.tsx` admin component:
  - Table of users with email, displayName, role, provider
  - Create new user form (email + role)
  - Edit user inline or modal
  - Toggle admin role
  - Delete user with confirmation
- [ ] Wire OAuth login to create/update User records (upsert on login)

### 5.2 Environment Panel (already exists — enhance)

- [ ] Ensure it shows: version, Node.js version, uptime, memory stats,
  deployment environment, database connection status
- [ ] Add integration configuration status (which OAuth providers and API
  keys are configured)

### 5.3 Configuration Panel (already exists — verify)

- [ ] Verify it supports grouped config keys with metadata
- [ ] Ensure secret masking works
- [ ] Verify `.env` export functionality
- [ ] Add "requires restart" indicators

### 5.4 Log Viewer (already exists — verify)

- [ ] Verify log level filtering (All, Info+, Warn+, Error+)
- [ ] Ensure color-coded log levels
- [ ] Verify timestamp and request details display

### 5.5 Session Viewer (already exists — enhance)

- [ ] Show linked user info (not just raw session data)
- [ ] Highlight sessions expiring soon
- [ ] Add refresh button

### 5.6 Permissions Panel (new)

- [ ] Create permissions model (or adapt the `UserRole` + assignment pattern):
  - Role-based access control with configurable role assignments
  - Email match or regex pattern for auto-role-assignment on OAuth login
- [ ] Create `PermissionsPanel.tsx`:
  - Manage role assignment rules
  - Pattern-based rules (exact email or regex)
  - Changes take effect on next login

### 5.7 Import/Export & Backup (new)

- [ ] Create `BackupService`:
  - Full database export to JSON
  - Database backup (pg_dump wrapper or Prisma-level export)
  - List backups, restore from backup, delete backup
  - Local storage for backups (S3 optional/configurable)
- [ ] Create admin API routes:
  - `POST /api/admin/backups` — create backup
  - `GET /api/admin/backups` — list backups
  - `POST /api/admin/backups/:id/restore` — restore backup
  - `DELETE /api/admin/backups/:id` — delete backup
  - `GET /api/admin/export/json` — export database as JSON
- [ ] Create `ImportExport.tsx` admin component:
  - Export database to JSON download
  - Backup management UI (create, list, restore, delete)
  - File size and timestamp display

### 5.8 Scheduled Jobs (new)

- [ ] Add `ScheduledJob` model to Prisma schema:
  ```prisma
  model ScheduledJob {
    id        Int       @id @default(autoincrement())
    name      String    @unique
    frequency String    // 'daily', 'weekly', 'hourly', etc.
    enabled   Boolean   @default(true)
    lastRun   DateTime?
    nextRun   DateTime?
    lastError String?
    createdAt DateTime  @default(now())
    updatedAt DateTime  @updatedAt
  }
  ```
- [ ] Create `SchedulerService`:
  - `tick()` method — finds due jobs, locks with `FOR UPDATE SKIP LOCKED`,
    executes registered handlers
  - `registerHandler(jobName, handler)` — register job execution logic
  - `runJobNow(id)` — manual execution
  - Automatic next-run calculation
- [ ] Create admin API routes:
  - `GET /api/admin/scheduler/jobs` — list jobs
  - `PUT /api/admin/scheduler/jobs/:id` — enable/disable
  - `POST /api/admin/scheduler/jobs/:id/run` — manual trigger
- [ ] Create `ScheduledJobsPanel.tsx`:
  - List jobs with frequency, last run, next run, last error
  - Enable/disable toggle
  - Run now button
  - Auto-refresh every 30s
- [ ] Seed default jobs: `daily-backup`, `weekly-backup`

### 5.9 Integrations (keep existing)

- [ ] Verify GitHub OAuth, Google OAuth, Pike 13 integrations work
- [ ] Ensure integration status endpoint reports which are configured
- [ ] Keep the integration demo page or move integration testing into
  admin panel

---

## 6. UI Layout — Sidebar + Top Bar + User Menu

**Current state:** Template has a basic `AdminLayout.tsx` with sidebar nav
for admin pages only. No app-wide layout, no search bar, no user dropdown.
The main page is `ExampleIntegrations.tsx`.

**Target state:** Full application shell with sidebar navigation, global
search bar, and user dropdown — matching the inventory app's `AppLayout`.

### Tasks

- [ ] Create `client/src/components/AppLayout.tsx`:
  - **Sidebar:**
    - Top: Logo/flag icon + application name (configurable)
    - Middle: Navigation items with optional children (collapsible)
    - Bottom: "MCP Setup" and "About" links
    - Mobile-responsive with hamburger toggle
    - Role-based visibility on nav items
  - **Top bar:**
    - Search input with debounced search (300ms, min 2 chars)
    - Search results dropdown grouped by type
    - User section (upper right): avatar, display name, role label,
      dropdown menu with Account and Logout
  - **Content area:** Renders child routes
- [ ] Create `client/src/context/AuthContext.tsx`:
  - `useAuth()` hook providing current user, loading state, logout
  - Fetches `/api/auth/me` on mount
  - Provides user info to all child components
- [ ] Create `client/src/lib/roles.ts`:
  - Role constants, labels, short labels
  - `hasAdminAccess(role)` helper
  - Role badge styles for UI
- [ ] Set up default sidebar navigation for the template:
  ```
  ── Home
  ── Admin (admin-only)
      ├── Users
      ├── Environment
      ├── Configuration
      ├── Database
      ├── Logs
      ├── Sessions
      ├── Permissions
      ├── Backups
      ├── Scheduled Jobs
      └── Integrations
  ── MCP Setup
  ── About
  ```
- [ ] Populate user display: "Eric Busboom" / "student" as default placeholder
  content (will be replaced by actual auth in real apps)
- [ ] Create `client/src/pages/Home.tsx` — simple landing/dashboard page
- [ ] Create `client/src/pages/About.tsx` — app info, version display
- [ ] Update `client/src/App.tsx` routing to use `AppLayout` as the
  wrapper for all authenticated routes
- [ ] Remove or repurpose `ExampleIntegrations.tsx` (move to admin or
  delete)
- [ ] Move admin pages under the new layout structure

---

## 7. Application MCP Server

**Current state:** No application-level MCP server. The app has no way for
external AI clients (Claude Desktop, Claude Code, other MCP clients) to
interact with its data and services programmatically.

**Target state:** The template includes a built-in HTTP-based MCP server at
`/api/mcp`, following the inventory app's pattern. This gives every app built
from the template a working MCP integration out of the box — external AI
tools can authenticate with a token and call registered tools that operate
through the service layer.

### Tasks

- [ ] Create `server/src/mcp/` directory:
  - `server.ts` — McpServer creation, tool registration, HTTP transport
    (using `@modelcontextprotocol/sdk` StreamableHTTPServerTransport)
  - `context.ts` — AsyncLocalStorage for `{ user, services }` context,
    so tools can access the ServiceRegistry without passing it explicitly
  - `tools.ts` — Tool definitions (Zod schemas + handlers)
  - `handler.ts` — Express route handler that creates a transport per
    request, wraps execution in the AsyncLocalStorage context
- [ ] Implement token-based authentication middleware for the MCP endpoint:
  - Bearer token validated against `MCP_DEFAULT_TOKEN` env var
  - On valid token, looks up or creates a system user for context
  - Returns 401 on missing/invalid token
- [ ] Create example tools demonstrating the pattern:
  - `get_version` — returns app version (simple, no DB access)
  - `list_users` — demonstrates service layer access from MCP context
  - `list_channels` — list chat channels
  - `get_channel_messages` — read recent messages from a channel
  - `post_message` — send a message as the MCP bot user (demonstrates
    write operations through the service layer)
  - `create_channel` — create a new chat channel
- [ ] Register MCP route in Express app: `POST /api/mcp`
- [ ] Add `MCP_DEFAULT_TOKEN` to `config/dev/secrets.env` and
  `config/prod/secrets.env`
- [ ] Create `client/src/pages/McpSetup.tsx`:
  - Instructions for connecting Claude Desktop or other MCP clients
  - Shows the app's MCP endpoint URL and how to configure the token
  - Example client configuration snippet
- [ ] Document the MCP server architecture in `docs/template-spec.md`:
  - How to add new tools
  - How tools access the ServiceRegistry via AsyncLocalStorage
  - Authentication model
  - How the inventory app scales this to 35+ tools

---

## 8. Auth System Upgrades

**Current state:** Passport OAuth (GitHub + Google) stores profile in
session. Separate admin password auth. No User model in database.

**Target state:** OAuth login creates/updates `User` records in the database.
Role-based access control. Admin access determined by user role, not
separate password (though admin password can remain as a bootstrap
mechanism).

### Tasks

- [ ] Update Passport serialization to create/update `User` records on
  OAuth login (upsert by provider + providerId)
- [ ] Update `GET /api/auth/me` to return full `User` record from database
- [ ] Create auth middleware:
  - `requireAuth()` — checks `req.user` exists
  - `requireAdmin()` — checks user role is ADMIN
- [ ] Keep admin password login as bootstrap mechanism (for initial setup
  before any OAuth users exist)
- [ ] Add `POST /api/auth/test-login` for test environments (bypasses
  OAuth, creates/uses test user)
- [ ] Update session to store user ID, load full user on each request

---

## 9. Documentation Updates

### Tasks

- [ ] Update `docs/template-spec.md`:
  - New config directory structure (section 7)
  - Service layer architecture and conventions (new section)
  - MCP server documentation (new section)
  - Updated Docker architecture (section 6)
  - Updated admin dashboard features (section 9 area)
- [ ] Update `docs/secrets.md` for `config/` migration
- [ ] Update `docs/deployment.md` for new Docker model
- [ ] Update `docs/setup.md` for new first-time setup flow
- [ ] Update `docs/testing.md` if test patterns change
- [ ] Add service layer guidance to `AGENTS.md`:
  - All business logic must go through the ServiceRegistry
  - Routes are thin adapters — validate input, call service, format response
  - New features require: model → service → route → client page
  - Tests should use the ServiceRegistry, not raw Prisma
- [ ] Update `docs/template-spec.md` repository layout diagram

---

## 10. Example Application — Chat

**Current state:** The template's only demo feature is a Counter (increment/
decrement an integer). This doesn't exercise auth, user relationships, or
give the MCP server anything meaningful to interact with.

**Target state:** Replace the Counter demo with a simple chat application.
Users can send messages visible to all users on the same instance. The MCP
server can participate in conversations as a bot — reading messages and
posting replies. This gives template users a real, end-to-end example of
auth → service layer → API routes → React UI → MCP integration.

### Data Model

- [ ] Add Prisma models:
  ```prisma
  model Channel {
    id          Int       @id @default(autoincrement())
    name        String    @unique
    description String?
    createdAt   DateTime  @default(now())
    updatedAt   DateTime  @updatedAt
    messages    Message[]
  }

  model Message {
    id        Int      @id @default(autoincrement())
    content   String
    channelId Int
    channel   Channel  @relation(fields: [channelId], references: [id])
    authorId  Int
    author    User     @relation(fields: [authorId], references: [id])
    createdAt DateTime @default(now())
    updatedAt DateTime @updatedAt
  }
  ```
- [ ] Add `messages Message[]` relation to `User` model
- [ ] Create and apply migration

### Service Layer

- [ ] Create `ChannelService`:
  - `list()` — all channels with message count
  - `get(id)` — channel with recent messages (paginated)
  - `create(name, description)` — new channel
  - `delete(id)` — remove channel (admin only)
- [ ] Create `MessageService`:
  - `list(channelId, { limit, before })` — paginated messages for a channel
  - `create(channelId, authorId, content)` — post a message
  - `delete(id)` — remove a message (author or admin)
- [ ] Register both in ServiceRegistry

### API Routes

- [ ] `GET /api/channels` — list channels
- [ ] `POST /api/channels` — create channel (admin)
- [ ] `GET /api/channels/:id` — get channel with messages
- [ ] `DELETE /api/channels/:id` — delete channel (admin)
- [ ] `POST /api/channels/:id/messages` — post message (authenticated)
- [ ] `DELETE /api/messages/:id` — delete message (author or admin)
- [ ] All routes require authentication; creation routes validate input

### Client UI

- [ ] Create `client/src/pages/Chat.tsx`:
  - Channel list sidebar (within main content area, not the app sidebar)
  - Message feed for selected channel with author name, avatar, timestamp
  - Message input at bottom
  - Auto-scroll to newest messages
  - Polling for new messages (simple interval, no WebSocket needed for
    the template — apps can upgrade to LISTEN/NOTIFY later)
- [ ] Create `client/src/pages/Channels.tsx`:
  - Admin view to create/delete channels
- [ ] Add "Chat" to the sidebar navigation (visible to all authenticated users)
- [ ] Seed a default `#general` channel on first run

### MCP Tools (update section 7)

- [ ] Add chat-related MCP tools:
  - `list_channels` — list all channels
  - `get_channel_messages` — read recent messages from a channel
  - `post_message` — send a message to a channel as the MCP bot user
  - `create_channel` — create a new channel
- [ ] These tools demonstrate real CRUD through the service layer and give
  MCP clients (Claude Desktop, etc.) the ability to participate in
  conversations as a bot

### Remove Counter Demo

- [ ] Remove `Counter` model from Prisma schema
- [ ] Remove `CounterService` and counter routes
- [ ] Remove counter-related client code
- [ ] Update migration to drop counter table

---

## 11. Cleanup & Polish

### Tasks


- [ ] Clean up unused Docker files (`Dockerfile.client` Caddy variant
  if no longer needed)
- [ ] Ensure all npm scripts are correct and documented
- [ ] Run full test suite and fix any breakage
- [ ] Update `package.json` metadata (name, description) to reflect
  template identity
- [ ] Verify dev workflow works end-to-end: `npm run dev` → working app
  with sidebar, admin panel, search, user menu

---

## 12. Testing Plan

Every sprint must include tests for the features it delivers. Tests run
before any ticket is marked done. The existing test infrastructure
(Jest + Supertest for server, Vitest for client) is used throughout.

### Server Tests (`tests/server/`)

- [ ] **Auth tests:**
  - `POST /api/auth/test-login` — creates session, returns user
  - `GET /api/auth/me` — returns authenticated user; 401 when not logged in
  - `POST /api/auth/logout` — clears session
  - Role-based access: admin routes return 403 for non-admin users

- [ ] **Admin API tests:**
  - `GET /api/admin/users` — lists users (admin only)
  - `POST /api/admin/users` — creates user (admin only)
  - `PUT /api/admin/users/:id` — updates user role
  - `DELETE /api/admin/users/:id` — deletes user
  - `GET /api/admin/env` — returns environment info
  - `GET /api/admin/config` — returns config with masked secrets
  - `PUT /api/admin/config` — updates config value
  - `POST /api/admin/backups` — creates backup
  - `GET /api/admin/backups` — lists backups
  - `GET /api/admin/scheduler/jobs` — lists scheduled jobs
  - All admin routes return 403 for non-admin users

- [ ] **Chat API tests:**
  - `GET /api/channels` — lists channels (requires auth)
  - `POST /api/channels` — creates channel (admin only)
  - `GET /api/channels/:id` — returns channel with messages
  - `DELETE /api/channels/:id` — deletes channel (admin only)
  - `POST /api/channels/:id/messages` — posts message (requires auth)
  - `DELETE /api/messages/:id` — author can delete own; admin can delete any
  - Pagination: messages return in order with `before` cursor
  - 401 on all routes when not authenticated

- [ ] **MCP endpoint tests:**
  - `POST /api/mcp` — 401 without token, 401 with bad token
  - Valid token + `list_channels` tool call → returns channels
  - Valid token + `post_message` tool call → creates message in DB
  - Verify MCP bot messages are attributed to the correct system user

- [ ] **Service layer tests:**
  - `ChannelService` — create, list, get, delete
  - `MessageService` — create, list with pagination, delete
  - `UserService` — create, update role, delete
  - `BackupService` — create backup, list, restore, delete
  - `SchedulerService` — register handler, tick executes due jobs,
    manual run
  - `ConfigService` — get, set, env override precedence, secret masking

### Client Tests (`tests/client/`)

- [ ] **AppLayout component:**
  - Renders sidebar with correct nav items
  - Hides admin nav items for non-admin users
  - User dropdown shows name and role
  - Mobile hamburger toggle works

- [ ] **Chat page:**
  - Renders channel list
  - Displays messages for selected channel
  - Message input submits and clears
  - New messages appear after polling

- [ ] **Admin panels:**
  - UsersPanel renders user list, create/edit/delete flows
  - ScheduledJobsPanel renders jobs, toggle enable/disable
  - ImportExport renders backup list, create/download

### Database Tests (`tests/db/`)

- [ ] Migration applies cleanly on empty database
  - All tables created (User, Channel, Message, ScheduledJob, Config,
    Session)
  - Foreign keys and indexes in place
- [ ] Constraints enforced:
  - Unique channel names
  - Unique user emails
  - Message requires valid channelId and authorId
  - Cascade deletes: deleting a channel deletes its messages

### Integration / Smoke Tests (Local Dev — run each sprint)

- [ ] End-to-end dev workflow:
  - `npm run dev` starts DB + server + client without errors
  - Can log in via test-login endpoint
  - Can create a channel and post a message via the UI
  - Admin panel loads and shows environment info
  - MCP endpoint responds to tool calls with valid token

### Production Smoke Tests (Final sprint only)

- [ ] Docker build:
  - `npm run build:docker` succeeds
  - Production image starts and serves both API and client
- [ ] Swarm deployment:
  - `docker stack deploy` succeeds
  - Secrets load correctly from `/run/secrets/*`
  - Migrations run against production database
  - App is accessible through Caddy reverse proxy

### Test Conventions

- Use `POST /api/auth/test-login` for all server tests — never mock
  session middleware or fabricate cookies
- Use `request.agent(app)` (Supertest agent) to maintain session cookies
- Assert both HTTP response AND database state for mutation endpoints
- Each test file resets relevant data (truncate tables or use transactions)
- Tests are independent — no ordering dependencies between files

---

## 13. Production Deployment — Docker & Swarm

**This is the final sprint.** Everything before this runs on local dev only.
This sprint takes the working local app and makes it deployable to
production via Docker Swarm.

### Tasks

- [ ] Repurpose root `docker-compose.yml` as the Production Swarm stack
  (dev database uses `docker-compose.dev.yml` from section 2):
  - Single `server` service (serves API + built client assets)
  - PostgreSQL service (self-hosted, not managed)
  - Swarm secrets mounted for all sensitive config
  - Caddy labels for reverse proxy (`caddy: ${APP_DOMAIN}`,
    `caddy.reverse_proxy: {{upstreams 3000}}`)
- [ ] Create/update `docker/Dockerfile.server` for production:
  - Multi-stage build: compile server TS + build client Vite assets
  - Final image serves both API and static files
  - Entrypoint loads Swarm secrets → env vars
- [ ] Update `docker/entrypoint.sh` for the new secrets mount pattern
  (inventory mounts named secrets like `database_url`, `session_secret`,
  `mcp_default_token`, etc.)
- [ ] Remove `Dockerfile.client` (Caddy static server) — client is served
  by Express in production
- [ ] Clean up unused Docker files
- [ ] Set up `config/prod/public.env` and `config/prod/secrets.env` with
  production values (APP_DOMAIN, callback URLs, Swarm secret names)
- [ ] Add `build:docker` npm script for production image build
- [ ] Update `docs/deployment.md` with the new production workflow:
  - Build image
  - Create/update Swarm secrets from `config/prod/secrets.env`
  - `docker stack deploy`
  - Run migrations
  - Rolling update procedure
- [ ] Verify: production image builds, starts, serves app, loads secrets
- [ ] Verify: `docker stack deploy` works on a Swarm node

---

## Sprint Breakdown (Suggested)

All sprints through S5 run and are verified on local dev (`npm run dev`).
Production deployment is the final sprint.

| Sprint | Scope | Verify Locally |
|--------|-------|---------------|
| **S1** | Infrastructure | Config migration, dev DB compose, service registry. `npm run dev` starts cleanly. |
| **S2** | Auth & Users | User model, OAuth→DB upsert, role-based auth, user management admin panel. Can log in via test-login, manage users in admin. Auth tests pass. |
| **S3** | Admin Dashboard | Permissions, Backup/Export, Scheduled Jobs panels; enhance existing panels. All admin panels load and function. Admin API tests pass. |
| **S4** | UI Shell & Chat App | AppLayout (sidebar, search, user menu), chat example app. Can send messages, see them in channels, search works. Channel/message + client tests pass. |
| **S5** | MCP Server & Docs | Built-in MCP server with chat tools, MCP Setup page, token auth. Can call MCP tools via curl/client. MCP endpoint tests pass. All docs updated. |
| **S6** | Production & Polish | Production Dockerfile, Swarm compose, entrypoint, deployment docs. Image builds and deploys to Swarm. DB + integration smoke tests pass. |

---

## Reference: Inventory App Key Files

These are the source files in the inventory app to reference during
implementation:

| Feature | Inventory File |
|---------|---------------|
| Config directory | `config/dev/public.env`, `config/dev/secrets.env` |
| Docker production | `docker-compose.yml` |
| Docker dev DB | `docker-compose.dev.yml` |
| ServiceRegistry | `server/src/services/service.registry.ts` |
| AppLayout | `client/src/components/AppLayout.tsx` |
| Auth context | `client/src/context/AuthContext.tsx` |
| Roles/contracts | `server/src/contracts/user.ts`, `client/src/lib/roles.ts` |
| MCP server | `server/src/mcp/server.ts`, `tools.ts`, `context.ts` |
| Scheduler | `server/src/services/scheduler.service.ts` |
| Export | `server/src/services/export.service.ts` |
| Backup | `server/src/services/backup.service.ts` |
| Users panel | `client/src/components/admin/UsersPanel.tsx` |
| Permissions | `client/src/components/admin/PermissionsPanel.tsx` |
| Import/Export | `client/src/components/admin/ImportExport.tsx` |
| Scheduled Jobs | `client/src/components/admin/ScheduledJobsPanel.tsx` |
| Auth middleware | `server/src/middleware/requireAuth.ts` |
