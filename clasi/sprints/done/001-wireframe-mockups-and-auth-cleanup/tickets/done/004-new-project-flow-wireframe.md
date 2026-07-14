---
id: '004'
title: New-project flow wireframe
status: done
use-cases:
- SUC-003
depends-on:
- '003'
github-issue: ''
issue: wireframe-mockups.md
completes_issue: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# New-project flow wireframe

## Description

Build the third of the four planned wireframe mockups
(architecture-update.md, "Wireframe Mockup Module"): `/mockups/new-project`,
previewing the blank right-pane new-project flow. Per spec §7 and
UC-003/SUC-003, the flow shown top-to-bottom is: a project-details header
carrying the guideline questions (what style? what output type — Facebook
image, logo, or postcard? what are you trying to achieve?), empty space
where outputs will eventually appear, and a chat text box at the bottom
showing an opening exchange in which the assistant asks those same
guideline questions. This ticket builds on the `client/src/pages/mockups/`
module and stub-data conventions ticket 003 established — reuse where the
shapes line up, add new stub data where the new-project content differs
from the main-layout mockup's.

`completes_issue: false` — this is the third of four mockups tracked by
`wireframe-mockups.md` (ticket 003 built the shell/index/main-layout
mockup; tickets 005 and 006 still owe the postcard-edit and login
mockups). The issue is archived once ticket 006 is done.

## Acceptance Criteria

- [x] `client/src/pages/mockups/MockupNewProject.tsx` renders at
      `/mockups/new-project`, registered as a sibling route of `/mockups`
      and `/mockups/main` in `App.tsx` (outside `AppLayout`, no
      sidebar/topbar, not auth-gated).
- [x] Page renders, top to bottom: the project-details header, an
      empty-output-area placeholder, then the chat panel — matching spec
      §7's vertical order.
- [x] The project-details header shows three labeled fields covering
      style, output type (with Facebook image / Logo / Postcard as visible
      options), and goal ("what are you trying to achieve") — all
      empty/unfilled, consistent with the blank-project state, and all
      non-functional (disabled) at this wireframe-fidelity stage.
- [x] The empty-output area clearly reads as "no outputs yet," not as a
      blank or broken layout region.
- [x] The chat panel shows an opening exchange in which the assistant asks
      about style, output type, and goal (one assistant message covering
      all three, or a short multi-message exchange) — implemented by
      generalizing `MockupChatPanel` to accept an optional `messages` prop
      (defaulting to `STUB_CHAT_MESSAGES`, so `/mockups/main` keeps
      rendering its original thread unchanged) and passing it a new
      `STUB_NEW_PROJECT_CHAT_MESSAGES` array.
- [x] `client/src/pages/mockups/MockupsIndex.tsx`'s new-project entry is
      now a live `<Link to="/mockups/new-project">` instead of a disabled
      placeholder.
- [x] No page in `client/src/pages/mockups/` (including this one) makes a
      `fetch`/XHR call or imports anything from outside
      `client/src/pages/mockups/` (module's zero-fan-out constraint,
      architecture-update.md).
- [x] `npm run test:client` and `npm run test:server` pass; `tsc -b
      --noEmit` is clean in both `client/` and `server/`.

## Testing

- **Existing tests to run**: `npm run test:server` (178 tests, untouched
  by this ticket); `npm run test:client` (baseline 66 tests from ticket
  003 must keep passing).
- **Existing test to update**:
  `tests/client/MockupsIndex.test.tsx`'s `'shows not-yet-built mockups as
  non-navigable placeholders'` case currently asserts the new-project
  entry has no `role=link`. Since this ticket flips that entry to a live
  link, split the assertion: add a positive
  `getByRole('link', { name: /new-project flow/i })` check (mirroring the
  existing `/mockups/main` link assertion) and keep the not-yet-built
  assertions for postcard-edit and Google-only login only.
- **New tests to write**: `tests/client/MockupNewProject.test.tsx`
  (pattern from `tests/client/MockupMain.test.tsx`):
  - renders the three project-details header fields (style, output type
    with its three options, goal) and asserts they render disabled/empty;
  - renders the empty-output-area placeholder text;
  - renders the chat panel with the new opening exchange (assistant
    message text asking about style/output type/goal) plus the existing
    disabled message input/send button;
  - a quick regression check that `MockupMain.test.tsx` still passes
    unmodified, confirming the `MockupChatPanel` generalization didn't
    change its default (no-prop) behavior.
- **Verification command**: `npm run test:client` (from repo root; also
  run `npm run test:server` to confirm no regressions in the untouched
  server suite).

### Results

- `npm run test:client`: 10 files, 70 passed (baseline 66 + 1 new
  `MockupsIndex` link assertion + 3 new `MockupNewProject` tests).
- `npm run test:server`: 22 files, 178 passed, unchanged.
- `tsc -b --noEmit` clean in both `client/` and `server/`.
- `MockupMain.test.tsx` passes unmodified (5/5), confirming the
  `MockupChatPanel` `messages` prop generalization preserves its
  no-prop default behavior.
