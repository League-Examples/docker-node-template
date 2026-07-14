---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 001 Use Cases

This sprint has two clusters: (1) reduce the existing auth surface to
Google-only and remove Pike13, and (2) build static wireframe previews of
the future two-pane product UI. The wireframes are previews, not the real
feature — SUC-002 through SUC-005 describe *looking at a mockup*, not the
real behavior described by their parent use case, which remains future
work.

---

## SUC-001: Sign in with Google only

Parent: UC-001

- **Actor**: Any user (League staff).
- **Preconditions**: Google OAuth strategy is configured
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). Pike13 is no longer present
  anywhere in the codebase or config. GitHub and the username/password form
  are no longer reachable from the login page.
- **Main Flow**:
  1. User visits `/login` and sees a single "Sign in with Google" action
     (shown only when Google is configured; otherwise a not-configured
     message, consistent with the existing defensive pattern).
  2. User completes Google OAuth and lands on the app.
- **Postconditions**: Session established via Google. No Pike13 route,
  strategy, config key, or UI element exists anywhere in the app.
- **Acceptance Criteria**:
  - [ ] `/login` renders no GitHub button, no Pike13 button, no
        username/password form, and no "Register" link.
  - [ ] `/api/auth/pike13*` routes no longer exist (404, not 501).
  - [ ] No `PIKE13_*` key is read, written, or referenced anywhere in
        `server/`, `client/`, `config/`, or `tests/`.
  - [ ] Google sign-in continues to work end-to-end (existing OAuth flow
        untouched).

---

## SUC-002: Preview the two-pane main layout wireframe

Parent: UC-002 (structural preview only — no real browsing/search)

- **Actor**: Any developer or stakeholder reviewing the design.
- **Preconditions**: Dev server running. No login required (wireframes
  carry no real data).
- **Main Flow**:
  1. User navigates to the mockups index and opens the main-layout mockup.
  2. User sees a left pane (stubbed categories: assets, styles,
     compositions, layouts, projects, each with a few static stub items)
     and a right pane split into an output area (top ~75%) and a chat box
     (bottom).
  3. No item is clickable in a functional sense; the page demonstrates
     structure and proportion only.
- **Postconditions**: None — read-only, static page.
- **Acceptance Criteria**:
  - [ ] Page is reachable at a stable route under `/mockups`.
  - [ ] Left pane and right pane are both present; right pane visually
        divides into a top output area (~75% height) and a bottom chat
        box, matching spec §2.
  - [ ] No fetch/XHR calls to the backend; all content is static/stubbed.

---

## SUC-003: Preview the new-project flow wireframe

Parent: UC-003 (structural preview only — no real project creation)

- **Actor**: Any developer or stakeholder reviewing the design.
- **Preconditions**: Dev server running. No login required.
- **Main Flow**:
  1. User opens the new-project mockup from the mockups index.
  2. User sees, top to bottom: a project-details header (stub fields for
     style / output type / goal), an empty output area, and a chat text
     box at the bottom (spec §7).
- **Postconditions**: None — read-only, static page.
- **Acceptance Criteria**:
  - [ ] Page is reachable at a stable route under `/mockups`.
  - [ ] Vertical order matches spec §7: header, then empty space, then
        chat box.
  - [ ] No fetch/XHR calls to the backend; all content is static/stubbed.

---

## SUC-004: Preview the postcard text-region edit form wireframe

Parent: UC-010 (structural preview only — no real region JSON, no render)

- **Actor**: Any developer or stakeholder reviewing the design.
- **Preconditions**: Dev server running. No login required.
- **Main Flow**:
  1. User opens the postcard-edit mockup from the mockups index.
  2. User sees a form with one labeled text input per stub text region
     (e.g. headline, date/location, body copy, call to action), reflecting
     the shape described in spec §9/§11 grounding
     (`postcard-content.json` region fields).
  3. Typing in a field updates only local component state (no save, no
     backend).
- **Postconditions**: None — local-only form state.
- **Acceptance Criteria**:
  - [ ] Page is reachable at a stable route under `/mockups`.
  - [ ] At least 3 distinct labeled text-region inputs are present.
  - [ ] No fetch/XHR calls to the backend; submitting (if a submit
        control exists) does not call any API.

---

## SUC-005: Preview the Google-only login page wireframe

Parent: UC-001 (structural preview only — separate from the real `/login`
page reworked in SUC-001)

- **Actor**: Any developer or stakeholder reviewing the design.
- **Preconditions**: Dev server running. No login required to view the
  mockup itself.
- **Main Flow**:
  1. User opens the login mockup from the mockups index.
  2. User sees a single "Sign in with Google" affordance and no other
     provider or credential form, at wireframe fidelity (structure, not
     visual polish).
- **Postconditions**: None — static page, the button is not wired to a
  real OAuth call.
- **Acceptance Criteria**:
  - [ ] Page is reachable at a stable route under `/mockups`.
  - [ ] Only a Google sign-in affordance is shown; no other provider or
        form is present.
  - [ ] Page is visually/structurally consistent with the real, reworked
        `/login` page from SUC-001 (same information, wireframe fidelity).

---

## Coverage note

SUC-001 is delivered by the auth-cleanup tickets (backend + client).
SUC-002 through SUC-005 are each delivered by one wireframe-mockup ticket.
The mockup shell/index and its routing convention are foundational work
shared by SUC-002 through SUC-005 and are ticketed alongside SUC-002 (the
first, anchor mockup).
