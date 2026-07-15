---
id: '007'
title: 'Client shell: AppLayout full-bleed mode + admin-console link + routing scaffold'
status: open
use-cases:
- SUC-001
- SUC-012
depends-on:
- '006'
github-issue: ''
issue:
- real-two-pane-app.md
- account-menu-first-user-admin.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client shell: AppLayout full-bleed mode + admin-console link + routing scaffold

## Description

Foundation work all later page tickets depend on. Three parts:

**1. `AppLayout` full-bleed mode (SUC-001).** `client/src/pages/mockups/
MockupMain.tsx`/`MockupNewProject.tsx`/`MockupPostcardEdit.tsx` each
currently render their own duplicate top bar (a hamburger with
hardcoded, non-functional "Home/Account/About/Log out" labels — see
`MockupMain.tsx` lines ~49-63) outside `AppLayout` entirely (Sprint 001's
Decision 4: mockups render standalone). architecture-001's Web App
Structure section already says `AppLayout`'s top bar "does not disappear
entirely... it no longer carries a `MAIN_NAV` product sidebar" — one
shared shell, not two. Give `client/src/components/AppLayout.tsx` a
route-conditional full-bleed `<main>` mode for `/projects/*` (no `p-6
overflow-auto`, since the two-pane view is `h-screen`-based with its own
internal scroll regions and the drawer needs an `absolute inset-y-0`
positioning ancestor with zero padding). Follow the existing
`isAdminSection`-conditional pattern already in `AppLayout.tsx` — this is
a second, similarly narrow route condition, not a new mechanism. See
architecture-update.md Design Rationale **R2**.

**2. Admin-console link (SUC-012, closes `account-menu-first-user-admin.md`
item 2).** `AppLayout.tsx` already has an `isAdmin && !isAdminSection`
conditional `Admin` link in its *hamburger* menu (verified in code) — but
the issue is specifically about the *username-click* dropdown/Account
surface, which today offers only `Account`/`Log out`. Add a conditional
Admin-console link (`hasAdminAccess(role)`, the same helper both surfaces
already import from `client/src/lib/roles.ts`) to **both**:
- `AppLayout.tsx`'s account dropdown (the one that opens on clicking the
  username/avatar).
- `client/src/pages/Account.tsx` (the page that dropdown's "Account"
  button navigates to — currently has no admin link at all, so a user
  landing there directly via a bookmark/deep link has no path to `/admin`
  without going back to the hamburger).

Leave the pre-existing hamburger-menu admin link in place (no
regression) — see **R3** for why both surfaces get the link.

**3. Routing scaffold.** In `client/src/App.tsx`, remove the `/mockups/*`
route block (all six routes plus `/mockups`), and add `/`,
`/projects/:id`, `/projects/:id/postcard` inside the existing
`AppLayout`-wrapped route group. This ticket adds the routes and mounts
placeholder/skeleton page components (real page content is tickets
008-012) — the goal here is the shell and navigation working end-to-end,
not the pages' content.

## Acceptance Criteria

- [ ] `AppLayout`'s `<main>` renders full-bleed (no padding, no
      `overflow-auto`) on `/projects/*` routes only; every other route's
      existing padding/scroll behavior is unchanged (regression test).
- [ ] `AppLayout`'s account dropdown shows an Admin-console link
      (navigating to `/admin/users`) only when `hasAdminAccess(role)` is
      true — a `USER`-role component test confirms the link is absent.
- [ ] `Account.tsx` shows the same conditional Admin-console link.
- [ ] The pre-existing hamburger-menu admin link still works (no
      regression).
- [ ] `App.tsx` no longer registers any `/mockups/*` route; `/`,
      `/projects/:id`, `/projects/:id/postcard` are registered inside the
      `AppLayout` route group.
- [ ] `AppLayout.test.tsx` is updated with new test cases for both
      additions (full-bleed branch, admin-link visibility) — existing
      test cases for unaffected routes still pass.

## Implementation Plan

**Approach**: Extend `AppLayout.tsx`'s existing conditional-rendering
pattern (it already branches on `isAdminSection`) with two more
conditions; add three new route entries to `App.tsx`, initially pointing
at minimal placeholder components that later tickets replace with real
content. Do not remove `pages/mockups/*` in this ticket — that's ticket
013's cleanup pass, after every page has a real replacement.

**Files to modify**:
- `client/src/components/AppLayout.tsx` — full-bleed `<main>` branch,
  admin-console link in the account dropdown.
- `client/src/pages/Account.tsx` — admin-console link.
- `client/src/App.tsx` — remove `/mockups/*` routes, add `/`,
  `/projects/:id`, `/projects/:id/postcard`.
- `client/src/components/AppLayout.test.tsx` — new test cases.

**Files to create**:
- Minimal placeholder components for `/`, `/projects/:id`,
  `/projects/:id/postcard` if tickets 008/009/012 don't land first (an
  implementer's call on sequencing — the important thing is `App.tsx`'s
  route table is correct and tested here, regardless of placeholder
  vs. real content).

**Testing plan**: `AppLayout.test.tsx` cases for the full-bleed branch
(assert on the `<main>` element's class list per route) and admin-link
visibility (USER vs ADMIN role fixtures). A routing smoke test confirming
`/mockups/*` 404s (or no longer exists) and the three new routes resolve.

**Documentation updates**: None.
