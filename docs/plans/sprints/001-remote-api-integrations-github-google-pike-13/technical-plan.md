---
status: draft
---

# Sprint 001 Technical Plan

## Architecture Overview

This sprint adds three layers to the existing Express + React stack:

```
┌─────────────────────────────────────────────────┐
│  ExampleIntegrations.tsx (DISPOSABLE)            │
│  Single-file React page — delete when done       │
│  Calls: /api/integrations/status                 │
│         /api/auth/me, /api/auth/logout           │
│         /api/auth/github, /api/auth/google       │
│         /api/github/repos                        │
│         /api/pike13/events                       │
└────────────────────┬────────────────────────────┘
                     │ fetch()
┌────────────────────▼────────────────────────────┐
│  Express Backend (PERMANENT)                     │
│                                                  │
│  Middleware:                                     │
│    express-session → Passport.js                 │
│                                                  │
│  Routes:                                         │
│    /api/integrations/status  (integrations.ts)   │
│    /api/auth/*               (auth.ts)           │
│    /api/github/*             (github.ts)         │
│    /api/pike13/*             (pike13.ts)         │
│    /api/health               (health.ts)  ←exist │
│    /api/counter/*            (counter.ts) ←exist │
└────────────────────┬────────────────────────────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
   GitHub API   Google API   Pike 13 API
```

## Component Design

### Component: Session & Passport Middleware

**Use Cases**: SUC-002, SUC-003

Added to `server/src/index.ts`:

- `express-session` with in-memory store, `SESSION_SECRET` from env
- `passport.initialize()` and `passport.session()`
- Passport `serializeUser` / `deserializeUser` — store full user object
  in session (no database user table in this sprint)

**Dependencies:** `express-session`, `passport`

### Component: Integration Status Route (`server/src/routes/integrations.ts`)

**Use Cases**: SUC-005

Single endpoint:
- `GET /api/integrations/status` — checks which env vars are set

```typescript
// Returns:
{
  github:  { configured: boolean },
  google:  { configured: boolean },
  pike13:  { configured: boolean }
}
```

Checks:
- GitHub: `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` both non-empty
- Google: `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` both non-empty
- Pike 13: `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET` both non-empty
  (or `PIKE13_ACCESS_TOKEN` non-empty)

### Component: Auth Routes (`server/src/routes/auth.ts`)

**Use Cases**: SUC-002, SUC-003

Routes:
- `GET /api/auth/github` — `passport.authenticate('github', { scope: [...] })`
- `GET /api/auth/github/callback` — callback handler, redirects to `/`
- `GET /api/auth/google` — `passport.authenticate('google', { scope: [...] })`
- `GET /api/auth/google/callback` — callback handler, redirects to `/`
- `GET /api/auth/me` — returns `req.user` or 401
- `POST /api/auth/logout` — `req.logout()`, destroy session, return 200

**Conditional strategy registration:**
- If `GITHUB_CLIENT_ID` is set → register `passport-github2` strategy
- If `GOOGLE_CLIENT_ID` is set → register `passport-google-oauth20` strategy
- Routes are always registered. If a strategy is missing, the route
  returns `501 { error: "GitHub OAuth not configured", docs: "https://..." }`

**Session data stored on login:**
```typescript
{
  provider: 'github' | 'google',
  id: string,
  displayName: string,
  email: string,
  avatar: string,
  accessToken: string  // stored for API calls (e.g., GitHub repos)
}
```

### Component: GitHub API Route (`server/src/routes/github.ts`)

**Use Cases**: SUC-002

Routes:
- `GET /api/github/repos` — calls `https://api.github.com/user/repos`
  with the session's GitHub access token

Returns array of `{ name, description, url, stars, language }`.
Returns 401 if not logged in via GitHub.

### Component: Pike 13 API Route (`server/src/routes/pike13.ts`)

**Use Cases**: SUC-004

Routes:
- `GET /api/pike13/events` — calls Pike 13 Core API v2
  `GET /api/v2/desk/event_occurrences` with date range for current week
- `GET /api/pike13/people` — calls Pike 13 Core API v2
  `GET /api/v2/desk/people` (first page)

**Authentication:** Pike 13 uses OAuth2 authorization code flow. Access
tokens don't expire. For template purposes, the developer obtains a token
through Pike 13's OAuth flow manually and stores it as
`PIKE13_ACCESS_TOKEN`. The route sends `Authorization: Bearer <token>`.

If credentials are missing, returns
`501 { error: "Pike 13 not configured", docs: "https://..." }`.

**API base URL:** `https://pike13.com/api/v2/desk/` (or subdomain-specific).

### Component: Example Page (`client/src/pages/ExampleIntegrations.tsx`)

**Use Cases**: SUC-001, SUC-002, SUC-003, SUC-004, SUC-005

**DISPOSABLE** — this file is deleted when the developer builds their app.

Single React component with:
1. `useEffect` on mount: fetch `/api/integrations/status` and `/api/auth/me`
2. Counter section (existing counter increment demo, inlined)
3. Three integration cards, each showing either:
   - Active state with action button → shows results after interaction
   - "Not configured" muted state with link to docs

All logic is self-contained. No imports from other app-specific modules.
Uses only `react`, `react-dom`, and plain `fetch()`.

### Component: Documentation (`docs/api-integrations.md`)

**Use Cases**: SUC-001

Structured as:
1. Overview — what integrations are available, architecture summary
2. GitHub section — upstream links, env var names, callback URL
3. Google section — upstream links, consent screen note, env var names
4. Pike 13 section — upstream links, token acquisition, env var names
5. Secrets flow — brief explanation linking to `docs/secrets.md`

**Style:** Link to upstream docs, don't paraphrase provider UIs.

### Component: Secret Examples

**Use Cases**: SUC-001

Update `secrets/dev.env.example` and `secrets/prod.env.example`:

```
# --- GitHub OAuth ---
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# --- Google OAuth ---
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# --- Pike 13 API ---
PIKE13_CLIENT_ID=your-pike13-client-id
PIKE13_CLIENT_SECRET=your-pike13-client-secret
PIKE13_ACCESS_TOKEN=your-pike13-access-token
```

## New Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `express-session` | latest | Session middleware |
| `passport` | 0.7.x | Authentication framework |
| `passport-github2` | latest | GitHub OAuth2 strategy |
| `passport-google-oauth20` | latest | Google OAuth2 strategy |
| `@types/express-session` | latest | TypeScript types |
| `@types/passport` | latest | TypeScript types |
| `@types/passport-github2` | latest | TypeScript types |
| `@types/passport-google-oauth20` | latest | TypeScript types |

All installed in `server/package.json`.

No new client dependencies (React Router not needed — single page).

## File Changes Summary

| File | Action | Permanent? |
|------|--------|------------|
| `server/package.json` | Add dependencies | Yes |
| `server/src/index.ts` | Add session + Passport middleware, register new routes | Yes |
| `server/src/routes/integrations.ts` | New file | Yes |
| `server/src/routes/auth.ts` | New file | Yes |
| `server/src/routes/github.ts` | New file | Yes |
| `server/src/routes/pike13.ts` | New file | Yes |
| `client/src/pages/ExampleIntegrations.tsx` | New file | **No** (disposable) |
| `client/src/App.tsx` | Import/render example page | Revert when deleting example |
| `docs/api-integrations.md` | New file | Yes |
| `secrets/dev.env.example` | Add entries | Yes |
| `secrets/prod.env.example` | Add entries | Yes |
| `docs/secrets.md` | Update required secrets table | Yes |

## Open Questions

1. **Pike 13 token acquisition:** Pike 13 uses authorization code flow
   (no client credentials grant). Should we store a pre-obtained
   `PIKE13_ACCESS_TOKEN` directly, or implement the full OAuth redirect
   flow for Pike 13 as well? (Tokens don't expire per their docs.)

2. **Session store:** In-memory session store loses sessions on server
   restart. Should we add `connect-pg-simple` now (Postgres-backed
   sessions) or defer to a future sprint?
