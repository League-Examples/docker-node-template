---
status: pending
---

# Move the app-shell sidebar (AppLayout) to a top menu / hamburger

Stakeholder (2026-07-14, wireframe review): "The original application,
the template we're using, has a sidebar menu. We're going to move that
to a top menu, or hamburger menu, whichever."

## Scope

- Rework `client/src/components/AppLayout.tsx`: drop the fixed 240px
  dark sidebar; move MAIN_NAV / ADMIN_NAV / BOTTOM_NAV entries into a
  top bar with a hamburger (or visible top menu), keeping the user
  dropdown (Account / Log out / impersonation) and the mobile behavior.
- Update `tests/client/AppLayout.test.tsx` accordingly.
- The pattern to follow is demonstrated in the `/mockups/main` wireframe
  top bar (hamburger stub added 2026-07-14).

## Notes

- This frees the left edge of the real app for the collapsible asset
  browser overlay (see stakeholder-spec wireframe-review feedback: the
  browser is collapsed by default, opens over ~7/8 of the content, and
  auto-closes when an item is double-clicked into the project).
