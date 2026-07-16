---
id: '011'
title: NewProject page
status: done
use-cases:
- SUC-004
depends-on:
- '006'
- '007'
- 009
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

- [x] "New project" button (`ProjectList`, ticket 008) creates a real
      `Project` row via `POST /api/projects` and navigates to
      `/projects/:id`.
- [x] A freshly-created project's `ProjectDetail` page renders: blank/
      empty project-details header, empty output area (no iterations),
      chat box.
- [x] The chat panel's opening state matches the guideline-questions
      framing (style / output type / goal) — either a real Claude-driven
      opening message (if the turn is invoked) or, at minimum, an
      empty-state prompt consistent with the mockup's framing if no turn
      has started yet.
- [x] As the conversation proceeds and Claude calls `create_project`'s
      update path (Sprint 003, unchanged) to fill `detailsHeader`, the
      header renders the updated values on the next `GET
      /api/projects/:id` refresh.
- [x] No `mockupStubData.ts` import remains in the promoted page.

## Implementation Notes (deviation from the stated files-to-modify)

The "New project" button was already wired to `POST /api/projects` +
navigation in ticket 008 (`ProjectList.tsx`'s `handleNewProject`) -- no
change needed there this ticket. `ProjectDetail/index.tsx` (ticket 009)
already rendered correctly for zero iterations/references/chat history,
confirming the "thin" approach the Implementation Plan anticipated.

The one genuinely net-new piece: `ProjectDetail/index.tsx` had no
project-details header at all yet (style / output type / goal). Added:

- `client/src/pages/ProjectDetail/ProjectDetailsHeader.tsx` (new) --
  promoted from `MockupNewProject.tsx`'s disabled style/output-type/goal
  form fields into a *read-only* summary of `project.detailsHeader`
  (`data-testid="project-details-header"`). Renders a single blank-state
  line when no field is set yet; once any field is present, renders all
  three with "Not set yet" placeholders for whichever are still missing.
  Wired into `ProjectDetail/index.tsx` above `ReferenceStrip`.
- `client/src/pages/ProjectDetail/ChatPanel.tsx` (modified) -- added a
  static, non-persisted `data-testid="chat-empty-state"` bubble (the same
  copy as `mockupStubData.ts`'s `STUB_NEW_PROJECT_CHAT_MESSAGES`) shown
  whenever `initialMessages` produces zero bubbles, satisfying the
  "empty-state prompt consistent with the mockup's framing" AC without
  auto-invoking a real turn on mount.
- No separate `client/src/pages/NewProject.tsx` file was created --
  per the ticket's Description, both entry points converge on
  `ProjectDetail` once the `Project` row exists, and `ProjectDetail`
  already renders the mockup's blank-project layout end to end (header +
  empty outputs + chat) once the header piece above was added. This is
  the "confirm ProjectDetail already handles the empty-project case"
  branch the Implementation Plan explicitly allowed.
- `tests/client/NewProject.test.tsx` (new) -- component coverage for the
  blank/partial/filled details-header states and the chat empty-state
  prompt, plus an integration test for the full button-click -> POST ->
  navigate -> empty-`ProjectDetail`-renders sequence (mocked network).

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
