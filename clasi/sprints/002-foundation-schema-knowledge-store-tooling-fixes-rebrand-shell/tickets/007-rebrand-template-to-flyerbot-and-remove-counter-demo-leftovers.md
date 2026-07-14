---
id: '007'
title: Rebrand template to Flyerbot and remove Counter demo leftovers
status: open
use-cases: [SUC-007]
depends-on: ['003']
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

- [ ] `package.json` (root and `client`/`server` as applicable) `name`
      field no longer reads `docker-nodeapp` (or equivalent template
      name) — set to a Flyerbot-appropriate value.
- [ ] `APP_NAME`/`APP_SLUG` config values no longer read "League Web
      App"/"join-the-web-app" — updated to Flyerbot branding across
      `config/{dev,prod}` and any hardcoded fallback default in code.
- [ ] All page `<title>` values (client routes, `index.html`) reflect
      Flyerbot branding, not the template's.
- [ ] `Counter` API route (`server/src/routes/*counter*` or equivalent)
      is deleted.
- [ ] `Counter` seed entries in `server/prisma/seed.ts` are removed.
- [ ] No client component imports or references a `Counter`
      route/hook/type (grep confirms zero remaining references).
- [ ] GitHub and username/password Passport strategies are confirmed
      absent (not just disabled) from `server/src/`, matching spec §13 —
      if Sprint 001 already fully removed these, this criterion is a
      verification pass with no code change; if any leftover reference
      is found, remove it here.
- [ ] `npm test` passes with no test referencing `Counter` remaining
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
