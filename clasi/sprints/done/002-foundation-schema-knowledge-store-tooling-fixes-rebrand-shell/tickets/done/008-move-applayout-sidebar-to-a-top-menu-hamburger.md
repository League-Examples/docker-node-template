---
id: 008
title: Move AppLayout sidebar to a top menu / hamburger
status: done
use-cases:
- SUC-007
depends-on:
- '007'
github-issue: ''
issue: move-app-shell-sidebar-to-top-menu.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Move AppLayout sidebar to a top menu / hamburger

## Description

Per the stakeholder (2026-07-14, wireframe review): "The original
application, the template we're using, has a sidebar menu. We're going
to move that to a top menu, or hamburger menu, whichever." This frees the
left edge of the real app for Sprint 005's collapsible asset-browser
overlay (opens over ~7/8 of the content, per the wireframe review's round
5). This ticket reworks `client/src/components/AppLayout.tsx`: drops the
fixed 240px dark sidebar, moves `MAIN_NAV`/`ADMIN_NAV`/`BOTTOM_NAV`
entries into a top bar with a hamburger (or visible top menu), keeping
the user dropdown (Account / Log out / impersonation banner) and mobile
behavior. The pattern to follow is demonstrated in the `/mockups/main`
wireframe's top bar (hamburger stub added 2026-07-14). Depends on ticket
007 so the top bar's app-name/branding display uses the already-rebranded
`APP_NAME` value rather than the old template name.

Landing this now (rather than deferred to Sprint 005) isolates
shell-navigation regression risk from Sprint 005's new-feature risk — see
architecture-update.md's Design Rationale R3.

## Acceptance Criteria

- [x] `AppLayout.tsx` no longer renders a fixed 240px sidebar.
- [x] A top bar (with a hamburger menu or a visible horizontal nav —
      implementer's call, following the `/mockups/main` wireframe's
      pattern) hosts the same set of entries previously in
      `MAIN_NAV`/`ADMIN_NAV`/`BOTTOM_NAV`.
- [x] The account dropdown (Account / Log out) is present and functional
      in the new top bar.
- [x] The impersonation banner (if an admin is impersonating another
      user) still renders correctly in the new layout.
- [x] `AdminLayout.tsx` (nested for `/admin`) still renders correctly
      inside the reworked `AppLayout` shell — no broken nesting.
- [x] Mobile behavior (whatever the sidebar's existing responsive
      behavior was) has an equivalent in the top-bar/hamburger version —
      not a regression to a broken or non-collapsing mobile nav.
- [x] `tests/client/AppLayout.test.tsx` is updated to test the new
      top-bar markup and passes.
- [x] The top bar displays the rebranded app name (ticket 007's
      `APP_NAME` value), not the old template name.
- [x] No other page's layout assumes a fixed-width sidebar exists
      (e.g. no hardcoded `margin-left: 240px` or similar elsewhere in
      `client/src/`) — grep for sidebar-width assumptions and update any
      found.

## Implementation Plan

### Approach

1. Review the `/mockups/main` wireframe's top-bar/hamburger
   implementation (`client/src/pages/mockups/MockupMain.tsx`) as the
   pattern reference — this ticket makes `AppLayout.tsx` match that
   established pattern, not invent a new one.
2. Remove the fixed sidebar markup/styles from `AppLayout.tsx`.
3. Build the top bar: app name/logo, nav entries (as a hamburger dropdown
   on narrow viewports, inline on wide viewports, or fully hamburger —
   match the mockup), account dropdown, admin link (role-gated),
   impersonation banner.
4. Update any layout CSS elsewhere in `client/src/` that assumed a fixed
   sidebar width.
5. Update `tests/client/AppLayout.test.tsx` for the new markup/behavior.

### Files to Create/Modify

- `client/src/components/AppLayout.tsx` — primary rework.
- `client/src/components/AdminLayout.tsx` — verify nesting still works,
  adjust only if broken.
- `tests/client/AppLayout.test.tsx` — update test assertions for new
  markup.
- Any other client file with a hardcoded sidebar-width assumption (found
  via grep during implementation).

### Testing Plan

- **Existing tests to run**: `npm test` (full suite), with particular
  attention to any test that renders a page inside `AppLayout` and
  asserts on layout structure.
- **New tests to write**: `AppLayout.test.tsx` coverage for the top-bar/
  hamburger rendering, nav-entry presence, account dropdown, and
  impersonation-banner rendering in the new shell.
- **Verification command**: `npm test`

### Documentation Updates

None beyond this ticket's own record — this implements an
already-specified wireframe pattern, not a new design decision.

## Testing

- **Existing tests to run**: `npm test` — full suite ran clean:
  158 server tests / 94 client tests (was 91; +3 net new AppLayout
  cases replacing/extending the old sidebar-oriented assertions).
- **New tests to write**: `AppLayout.test.tsx` was reworked around the
  hamburger-menu shell — nav entries are asserted closed by default and
  present after clicking the "Menu" button (`aria-label="Menu"`), the
  menu closes on nav-entry click, the account dropdown now opens via a
  `data-testid="user-menu-trigger"` element (replacing the old
  `div[style]` selector), and a new test asserts the rebranded
  "Flyerbot" app name renders in the top bar. Existing impersonation-
  banner and admin-role tests were kept, adjusted only where they needed
  to open the hamburger menu first.
- **Verification command**: `npm test` — exit 0. Also ran `npx tsc -b`
  and `npx eslint src/components/AppLayout.tsx` in `client/` — both
  clean.

### Implementation notes

- `AppLayout.tsx` was rewritten from inline-style, `isMobile`-branching
  sidebar/topbar markup to a single Tailwind-classed top bar (matching
  the `/mockups/main` wireframe pattern and the Tailwind conventions
  already used by `HomePage.tsx`/`Login.tsx`). The hamburger menu
  behaves identically at every viewport width — it collapses the nav
  behind a button on both mobile and desktop, which is the mobile-
  equivalent behavior required by the acceptance criteria (no separate
  mobile/desktop code path needed, since the collapsed-by-default
  hamburger *is* the mobile behavior, now applied universally).
- `AdminLayout.tsx` (`client/src/pages/admin/AdminLayout.tsx`) needed no
  changes — it only renders an `<Outlet />` after an auth check and has
  no layout assumptions of its own.
- Grepped `client/src` for `240`/`sidebar` width assumptions outside
  `AppLayout.tsx`; found none. Updated one stale comment in `App.tsx`
  ("AppLayout (sidebar + topbar)" -> "AppLayout (top bar + hamburger
  menu)").
