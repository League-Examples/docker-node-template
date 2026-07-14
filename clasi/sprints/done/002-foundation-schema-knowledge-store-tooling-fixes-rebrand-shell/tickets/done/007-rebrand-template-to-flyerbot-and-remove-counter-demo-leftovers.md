---
id: '007'
title: Rebrand template to Flyerbot and remove Counter demo leftovers
status: done
use-cases:
- SUC-007
depends-on:
- '003'
github-issue: ''
issue: rebrand-to-flyerbot.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Rebrand template to Flyerbot and remove Counter demo leftovers

## Description

The repo still carries template identity: `package.json` name
`docker-nodeapp`, `APP_NAME`/`APP_SLUG` set to "League Web App"/
"join-the-web-app", page titles, and the demo `Counter` feature (API
route, seed entries, and any remaining UI reference) now that ticket 003
has removed the `Counter` Prisma model. This ticket also confirms the
GitHub/password Passport auth strategies are fully removed per spec §13
(Sprint 001 scope) rather than re-litigating that removal — a
verification pass, not new work, unless something was missed. Depends on
ticket 003 because `Counter`'s Prisma model must already be gone before
this ticket removes the route/seed code that referenced it (otherwise
this ticket would be deleting code against a schema that still has the
model, producing a confusing intermediate state).

## Acceptance Criteria

- [x] `package.json` (root and `client`/`server` as applicable) `name`
      field no longer reads `docker-nodeapp` (or equivalent template
      name) — set to a Flyerbot-appropriate value.
- [x] `APP_NAME`/`APP_SLUG` config values no longer read "League Web
      App"/"join-the-web-app" — updated to Flyerbot branding across
      `config/{dev,prod}` and any hardcoded fallback default in code.
- [x] All page `<title>` values (client routes, `index.html`) reflect
      Flyerbot branding, not the template's.
- [x] `Counter` API route (`server/src/routes/*counter*` or equivalent)
      is deleted.
- [x] `Counter` seed entries in `server/prisma/seed.ts` are removed.
- [x] No client component imports or references a `Counter`
      route/hook/type (grep confirms zero remaining references).
- [x] GitHub and username/password Passport strategies are confirmed
      absent (not just disabled) from `server/src/`, matching spec §13 —
      if Sprint 001 already fully removed these, this criterion is a
      verification pass with no code change; if any leftover reference
      is found, remove it here.
- [x] `npm test` passes with no test referencing `Counter` remaining
      (delete or update any such test).

## Implementation Plan

### Approach

1. Grep the repo for `docker-nodeapp`, `League Web App`,
   `join-the-web-app`, and `Counter` (case-sensitive and
   case-insensitive) to build a complete worklist before editing —
   this is explicitly called out as "a real, multi-file removal, not a
   single flag flip" in the spec's Pike13-removal grounding, and the
   same discipline applies here.
2. Update naming/branding strings file by file.
3. Delete the `Counter` route file, its mount point in
   `server/src/app.ts`, its seed entries, and any client-side
   references (hook, component, test).
4. Grep for `github`/`Passport` strategy registration and
   username/password demo-user logic to confirm Sprint 001's removal was
   complete; remove any straggler found.
5. Run the full test suite; update or delete any test that referenced
   `Counter` directly.

### Files to Create/Modify

- `package.json` (root, `client/`, `server/` as applicable).
- `config/dev/public.env`, `config/prod/public.env` (or wherever
  `APP_NAME`/`APP_SLUG` are actually defined — confirm exact location
  first).
- `client/index.html`, any route-level `<title>` setting code.
- `server/src/routes/*counter*` (delete), `server/src/app.ts` (remove
  mount point).
- `server/prisma/seed.ts` (remove `Counter` seed entries).
- Any client component/hook referencing `Counter` (delete).
- Test files referencing `Counter` (delete or update).

### Testing Plan

- **Existing tests to run**: `npm test` (full suite).
- **New tests to write**: none expected — this is removal/rename work;
  if any test specifically asserted `Counter` API behavior, delete it
  rather than replace it with something else.
- **Verification command**: `npm test`, plus a final grep pass for the
  four search terms above to confirm zero remaining hits (excluding this
  ticket's own file and the sprint/issue planning docs, which
  legitimately reference the old names for historical/planning context).

### Documentation Updates

None beyond this ticket's own record — no architectural decision is
being made, only cleanup of already-flagged template debris
(architecture-001 Migration Concerns explicitly called out `Counter`
removal as expected future-sprint work).

## Testing

- **Existing tests to run**: `npm test`.
- **New tests to write**: none (deletion/rename ticket).
- **Verification command**: `npm test` + grep verification pass.

### Results

- `npm test` (repo root): exit 0. Server: 17 files / 133 tests passing
  (was 191 passing with 5 failing counters.test.ts tests before this
  ticket — net count differs because `counters.test.ts`,
  `auth-login.test.ts`, `auth-register.test.ts`,
  `user-service-password.test.ts`, `auth-schemas.test.ts`, and
  `github.test.ts` were deleted outright, and several other files had
  GitHub/password-specific cases removed). Client: 12 files / 91 tests
  passing (unchanged file count; `RegisterPage.test.tsx` deleted since
  `Register.tsx` depended entirely on the removed
  `/api/auth/register` endpoint).
- `tsc --noEmit` clean in `server/`; `tsc -b` clean in `client/`.
- Grep verification pass: zero remaining hits for `docker-nodeapp`,
  "League Web App", "join-the-web-app" outside of `clasi/sprints/`
  planning docs (which legitimately retain the old names for
  historical context) — one additional hardcoded fallback found and
  fixed beyond the ticket's initial file list:
  `docker-compose.yml`'s `${APP_SLUG:-docker-nodeapp}` default. Zero
  remaining `Counter` model/route/service references outside of a
  removal-context comment in `server/prisma/seed.ts`.

### Scope note: GitHub/password auth removal (AC 7)

Investigation before editing found that Sprint 001 ticket 002's
`architecture-update.md` Decision 1 had *deliberately* kept the GitHub
Passport strategy and the password register/login endpoints live
server-side, flagging their removal as "Open Question 1 for the
stakeholder" — this ticket's premise ("if Sprint 001 already fully
removed these, this criterion is a verification pass") was incorrect;
Sprint 001 explicitly did not remove them. Proceeded per this ticket's
explicit direction ("if any leftover reference is found, remove it
here") and the team-lead's task-brief instruction to follow the
ticket's boundary on this topic, treating that as the resolution of
the open question. Removed: the GitHub Passport strategy and OAuth
routes (`server/src/routes/auth.ts`, deleted
`server/src/routes/github.ts`), the password
register/login routes and their supporting `server/src/auth/password.ts`
and `server/src/auth/schemas.ts` (both deleted), `UserService
.createPasswordUser`/`.findByUsername`, the `GITHUB_CLIENT_ID`/
`GITHUB_CLIENT_SECRET` config keys and env values (dev/prod, via
`dotconfig load`/`save` to preserve SOPS encryption), and the
env-seeded demo-user password logic in `server/prisma/seed.ts`. Left
untouched (out of this criterion's scope, confirmed by grep/read
before deciding): `GITHUB_TOKEN`/`GITHUB_STORAGE_REPO` (an unrelated
"GitHub API" personal-access-token integration, not a login strategy);
`/api/auth/test-login` (test-only bypass used by ~10 test files, not a
Passport strategy or real password login); `/api/admin/login` (a
separate `ADMIN_PASSWORD`-gated admin-panel session flag, unrelated to
user Passport strategies); the `User.username`/`passwordHash` Prisma
schema fields (this sprint's architecture-update.md explicitly lists
`User`/`UserProvider` as "untouched" this sprint — left in place as
inert columns rather than opening a migration outside that boundary);
and `Account.tsx`/`UsersPanel.tsx`'s cosmetic `github` label/logo
mappings (harmless legacy-display code for any pre-existing
GitHub-linked accounts; the "Add GitHub" affordance itself already
disappears automatically since `useProviderStatus` no longer reports a
`github` key).
