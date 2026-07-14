---
id: '001'
title: Remove Pike13 server-side integration
status: done
use-cases:
- SUC-001
depends-on: []
github-issue: ''
issue: remove-pike13-google-only-auth.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Remove Pike13 server-side integration

## Description

Pike13 is confirmed unneeded (stakeholder: "I want you to clean out
Pike13, which I don't think we need"). This ticket removes its entire
server-side footprint: the route module, its mount in `app.ts`, its
fields in the integrations-status and admin-env endpoints, its recognized
config keys, its env vars in tracked config files, and its server-side
test coverage. This is foundation work — Ticket 002 (client-side cleanup)
depends on the narrowed `/api/integrations/status` response shape this
ticket produces.

`completes_issue: false` — this ticket only partially addresses
`remove-pike13-google-only-auth.md` (Ticket 002 covers the client half);
the issue is archived once both tickets are done.

See `architecture-update.md` §"1. Auth Module (server)" for full detail.

## Acceptance Criteria

- [x] `server/src/routes/pike13.ts` is deleted.
- [x] `server/src/app.ts` no longer imports or mounts `pike13Router`.
- [x] `server/src/routes/integrations.ts`'s `GET /api/integrations/status`
      response no longer includes a `pike13` field.
- [x] `server/src/routes/admin/env.ts`'s `GET /api/admin/env` response no
      longer includes a `pike13` field under `integrations`.
- [x] `server/src/services/config.ts`'s `CONFIG_KEYS` no longer includes
      `PIKE13_CLIENT_ID`, `PIKE13_CLIENT_SECRET`, or `PIKE13_API_BASE`.
- [x] `PIKE13_*` lines are removed from `config/dev/public.env`,
      `config/dev/secrets.env`, `config/prod/public.env`,
      `config/prod/secrets.env`, and `config/env.template`.
- [x] `tests/server/pike13.test.ts` is deleted.
- [x] Pike13 references/assertions are removed from
      `tests/server/integrations.test.ts`,
      `tests/server/admin-environment.test.ts`,
      `tests/server/account-linking.test.ts`, and
      `tests/server/auth-linkedproviders.test.ts` (each test file
      otherwise keeps its non-Pike13 coverage intact).
- [x] No `pike13`/`Pike13`/`PIKE13` string remains anywhere under
      `server/`, `config/`, or `tests/server/` (grep-verifiable).
- [x] The Google and GitHub Passport strategies, and the password-based
      auth endpoints, are untouched by this ticket (out of scope — see
      architecture-update.md Decision 1).
- [x] Full server test suite passes.

## Testing

- **Existing tests to run**: `tests/server/` full suite (run via the
  project's server test command, e.g. `npm run test:server` or the
  Vitest config in `tests/server/`), specifically
  `integrations.test.ts`, `admin-environment.test.ts`,
  `account-linking.test.ts`, `auth-linkedproviders.test.ts`, `app.test.ts`
  (to confirm the app still boots and mounts routes correctly with
  `pike13Router` removed), and `auth-oauth.test.ts` (to confirm Google/
  GitHub strategy registration is unaffected).
- **New tests to write**: none required — this is a removal; existing
  test files are edited in place to drop Pike13-specific
  cases/assertions, not extended.
- **Verification command**: run the server test suite from the repo root
  (check `package.json` scripts, e.g. `npm run test:server` or
  equivalent) and confirm `grep -ril pike13 server/ config/ tests/server/`
  returns no results.

### Notes (as executed)

- `npm run test:server`: 178/178 passing (195 baseline minus the 17 tests
  in the deleted `pike13.test.ts`; also removed one pike13-specific case
  each from `integrations.test.ts` and `auth-linkedproviders.test.ts`,
  and one pike13-only assertion each from `admin-environment.test.ts`
  and the changelog comment in `account-linking.test.ts`).
- `npm run test:client`: 69/69 passing, unaffected (client-side Pike13
  cleanup is ticket 002's scope).
- `npx tsc --noEmit` in `server/` passes with no errors.
- `grep -ril pike13 server/ config/ tests/server/` (case-insensitive)
  returns no matches outside of a stale Vitest cache file under
  `server/node_modules/.vite/` (untracked, not part of this ticket's
  scope).
- `config/dev/secrets.env` and `config/prod/secrets.env` are SOPS-encrypted
  dotenv files with a document-level MAC; hand-editing them with a text
  tool would invalidate that MAC. Used the repo's `dotconfig` tool instead:
  `dotconfig load dev` / `dotconfig load prod` to decrypt+assemble into a
  scratch `.env`, removed the `PIKE13_*` lines, then `dotconfig save`
  to re-encrypt and write back to `config/dev/` and `config/prod/`.
  Verified both files still decrypt cleanly with `sops -d` afterward.
  `config/prod/secrets.env.example` and `config/env.template` are plain
  text (not SOPS-encrypted) and were edited directly.
- `auth-linkedproviders.test.ts`'s "returns the updated linkedProviders
  list on success" test used a three-provider fixture
  (github/google/pike13) to exercise `unlink/pike13`; rewritten as a
  two-provider (github/google) fixture exercising `unlink/google` so the
  same "list still returns the *other* providers" behavior stays covered
  without a Pike13 reference.
