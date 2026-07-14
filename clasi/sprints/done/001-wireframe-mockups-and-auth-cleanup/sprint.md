---
id: '001'
title: Wireframe Mockups and Auth Cleanup
status: done
branch: sprint/001-wireframe-mockups-and-auth-cleanup
use-cases: []
issues:
- wireframe-mockups.md
- remove-pike13-google-only-auth.md
- test-db-provisioning-broken.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 001: Wireframe Mockups and Auth Cleanup

## Goals

1. Remove Pike13 entirely from the codebase (server routes, client UI,
   config, tests) — it is confirmed unneeded.
2. Reduce the login page to a single Google sign-in affordance, consistent
   with "no managing or creating accounts other than in Google."
3. Build four static, wireframe-fidelity mockup pages inside the existing
   React client, reachable as real dev-app routes, previewing the future
   two-pane product UI: main layout, new-project flow, postcard
   text-region edit form, and Google-only login.

## Problem

Flyerbot's current repo template still carries Pike13 (a prior-project
integration the stakeholder does not need) across server routes, client
UI, config, and tests, and its login page offers GitHub, Pike13, and a
demo username/password form alongside Google — none of which match the
stakeholder's stated target ("Login with Google/Gmail only"). Separately,
before any real project/asset/style domain work can be designed, the
stakeholder needs to see and react to concrete, structural previews of the
two-pane UI described in the spec — not a full build, just real wireframe
pages.

## Solution

Two sequenced clusters of work. First, an auth-cleanup pass: delete
Pike13's server footprint (route module, app mount, config keys,
integration-status fields, env vars), then rework the client login/account
surface to Google-only and strip remaining Pike13 references. Second, a
wireframe pass: add a new, self-contained `client/src/pages/mockups/`
module with four static pages plus an index, routed outside `AppLayout` so
they don't visually compete with the sidebar they are meant to eventually
replace. See `architecture-update.md` for full module design, diagrams,
and the design-rationale decisions bounding this sprint's scope (notably:
GitHub/password auth backend is retained, not deleted, this sprint).

## Success Criteria

- No `pike13`/`Pike13`/`PIKE13` string remains anywhere in `server/`,
  `client/`, `config/`, or `tests/`.
- `/login` renders only a Google sign-in affordance (or a not-configured
  message) — no GitHub, no Pike13, no password form, no Register link.
- Four mockup pages plus an index are reachable under `/mockups/*` in the
  running dev app, each matching its use case's acceptance criteria in
  `usecases.md`.
- Full test suite (`server` + `client`) passes.

## Scope

### In Scope

- Pike13 removal: server route/mount/config/env, client references, test
  coverage.
- Login page reduced to Google-only; `/register` route removed from
  `App.tsx`.
- Four wireframe mockup pages + index, static/stubbed, no backend calls.

### Out of Scope

- Any real project/asset/style/collection/knowledge-base domain design or
  implementation (deferred until the stakeholder reviews the wireframes
  built here — see `overview.md` phase ordering).
- The agent/MCP/image-generation architecture.
- Deleting the GitHub OAuth backend strategy/routes or the password-based
  `/api/auth/register` / `/api/auth/login` / `/api/auth/test-login`
  endpoints — retained this sprint (see architecture-update.md Design
  Rationale, Decisions 1-2). Flagged as an open question for a future
  sprint.
- Any change to `AppLayout.tsx`'s real sidebar/topbar — the mockups
  preview a future layout but do not replace the current one yet.
- Visual design polish on the mockups (wireframe fidelity only, per the
  issue).

## Test Strategy

- Server: existing Vitest suite in `tests/server/` must pass with Pike13
  coverage removed and no new gaps — `pike13.test.ts` deleted, Pike13
  assertions stripped from `integrations.test.ts`,
  `admin-environment.test.ts`, `account-linking.test.ts`,
  `auth-linkedproviders.test.ts`.
- Client: `tests/client/LoginPage.test.tsx` rewritten for the Google-only
  UI; `tests/client/Account.test.tsx` loses its Pike13 cases only
  (GitHub cases unchanged, per scope decision). New lightweight smoke
  tests added for the four mockup pages (each renders, matches its
  acceptance criteria, makes no network calls).
- No new integration/system-level test infra needed — mockups are static
  and auth changes are covered by existing patterns (mocked
  `useProviderStatus`/`AuthContext`).

## Architecture Notes

See `architecture-update.md` for full module design, Mermaid diagrams, and
design rationale. Key constraints carried into tickets:
- Pike13/auth backend cleanup must land before the client login rework
  (client relies on the narrowed `/api/integrations/status` shape).
- Mockups are a new, dependency-free module (`client/src/pages/mockups/`)
  routed outside `AppLayout`, not gated by `ProtectedRoute`.
- GitHub OAuth backend and `Account.tsx` GitHub linking are explicitly
  out of scope for removal this sprint.

## GitHub Issues

None. This sprint is driven entirely by CLASI issues
(`wireframe-mockups.md`, `remove-pike13-google-only-auth.md`); no GitHub
issues are linked.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 007 | Fix test-DB provisioning so a pristine checkout passes `npm run test:server` | (none — sequenced first; every other ticket's commit requires a passing suite per `.claude/rules/git-commits.md`) |
| 001 | Remove Pike13 server-side integration | (none) |
| 002 | Reduce login to Google-only and strip remaining client Pike13 references | (none) |
| 003 | Mockup shell and two-pane main layout wireframe | (none) |
| 004 | New-project flow wireframe | (none) |
| 005 | Postcard text-region edit form wireframe | (none) |
| 006 | Google-only login page wireframe | (none) |

Tickets execute serially in the order listed. Ticket 007 was added after
initial ticketing (see `clasi/issues/test-db-provisioning-broken.md`) and
is sequenced ahead of 001-006 for the reason given in its own Description;
it is listed first in execution order despite its higher number so the
existing 001-006 tickets did not need to be renumbered.
