---
id: '011'
title: NewProject page
status: open
use-cases:
- SUC-004
depends-on:
- '006'
- '007'
- '009'
github-issue: ''
issue: real-two-pane-app.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# NewProject page

## Description

Promote `MockupNewProject.tsx` to a real `client/src/pages/NewProject.tsx`.
Two entry points both converge here (UC-003):

- **Button path**: `ProjectList`'s (ticket 008) "New project" button
  calls `POST /api/projects` (ticket 006), then navigates straight to
  `/projects/:id` — the newly-created project's `ProjectDetail` page
  (ticket 009) renders the blank project-details header, empty output
  area, and chat box exactly as the mockup shows, since a fresh project
  has no iterations yet.
- **Chat path**: a user typing "I want to start a new project" in an
  existing chat triggers Claude's own `create_project` MCP tool call
  (Sprint 003, unchanged) — no client-side code needed for this path
  beyond what ticket 009's chat panel already renders.

This ticket's actual client work is smaller than it may look: since both
paths land on `ProjectDetail` (ticket 009) once the project exists, the
main net-new piece is confirming the empty-project rendering (blank
`detailsHeader`, no iterations, chat opens with Claude's clarifying
questions per the mockup's `STUB_NEW_PROJECT_CHAT_MESSAGES` opening
line) works correctly against real data, and wiring `ProjectList`'s
button to `POST /api/projects` + navigation.

`Project.detailsHeader` (style / output type / goal) is filled by Claude
via chat's `create_project` update path (Sprint 003, unchanged) as the
conversation proceeds — not via direct form fields, matching the
stakeholder's own framing ("It might ask you for details... these are
general guidelines").

## Acceptance Criteria

- [ ] "New project" button (`ProjectList`, ticket 008) creates a real
      `Project` row via `POST /api/projects` and navigates to
      `/projects/:id`.
- [ ] A freshly-created project's `ProjectDetail` page renders: blank/
      empty project-details header, empty output area (no iterations),
      chat box.
- [ ] The chat panel's opening state matches the guideline-questions
      framing (style / output type / goal) — either a real Claude-driven
      opening message (if the turn is invoked) or, at minimum, an
      empty-state prompt consistent with the mockup's framing if no turn
      has started yet.
- [ ] As the conversation proceeds and Claude calls `create_project`'s
      update path (Sprint 003, unchanged) to fill `detailsHeader`, the
      header renders the updated values on the next `GET
      /api/projects/:id` refresh.
- [ ] No `mockupStubData.ts` import remains in the promoted page.

## Implementation Plan

**Approach**: Thin — the bulk of the "new project" experience is just
`ProjectDetail` (ticket 009) rendered against a project with zero
iterations and zero chat history. This ticket's own work is the
button-to-navigation wiring plus verifying the empty-state rendering
looks right (no layout breakage when arrays are empty).

**Files to create**:
- `client/src/pages/NewProject.tsx` if a distinct route/component is
  warranted, or confirm `ProjectDetail` already handles the empty-project
  case correctly with no separate component needed (an implementer's
  call — either is acceptable as long as the acceptance criteria pass).
- Component test file.

**Files to modify**:
- `client/src/pages/ProjectList.tsx` (ticket 008) — "New project" button
  handler, if not already wired there.

**Testing plan**: Component test for the empty-project render (no
iterations, no chat history, correct empty-state copy). Integration test
for the button-click → `POST /api/projects` → navigate → empty
`ProjectDetail` renders sequence, mocked network.

**Documentation updates**: None.
