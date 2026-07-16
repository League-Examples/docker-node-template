---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 005 Use Cases

Each SUC promotes one wireframe surface (or closes one auth/account gap)
to live data, and traces to a project-level UC in `docs/design/usecases.md`
and, where applicable, to the specific stakeholder wireframe-review round
in `docs/design/stakeholder-spec-2026-07-13.md`.

---

## SUC-001: Authenticated two-pane app shell
Parent: UC-001, UC-002, UC-006

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in. A project exists (or is created via
  SUC-004) to open.
- **Main Flow**:
  1. User navigates to `/projects/:id`.
  2. `AppLayout`'s existing top bar (hamburger menu, account menu) renders
     as the single shell for the page — no second, duplicate header is
     rendered by the two-pane view itself.
  3. `AppLayout` recognizes the two-pane route and switches its `<main>`
     region to full-bleed (no padding, internal scroll regions owned by
     the two-pane view) instead of its default padded/scrolling mode.
  4. The two-pane view renders: output pane (iteration gallery) over the
     chat panel on the right; the asset-browser drawer is collapsed by
     default, opened by a vertical pull-out tab on the left edge (round 5).
- **Postconditions**: The two-pane app is the sole authenticated
  project-detail route; no second/duplicate hamburger or account menu
  exists anywhere in the promoted UI.
- **Acceptance Criteria**:
  - [ ] `/projects/:id` renders inside `AppLayout`, not a standalone shell.
  - [ ] `AppLayout`'s `<main>` is full-bleed (no `p-6`/`overflow-auto`) on
        this route only; every other route's padding/scroll is unchanged.
  - [ ] No hardcoded, non-functional menu labels (the mockup's static
        "Home / Account / About / Log out" list) remain anywhere.
  - [ ] Component test covers the full-bleed vs. padded `<main>` branching.

---

## SUC-002: Browse and filter the asset library drawer
Parent: UC-002, UC-014 (filter-bar path)

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: SUC-001. Catalog data exists (may be empty).
- **Main Flow**:
  1. User clicks the vertical pull-out tab; the drawer slides over ~7/8 of
     the iterations list and chat window (round 5).
  2. Drawer lists real categories backed by `WorkspaceDirectory`/
     `Collection`/`KnowledgeEntry` (assets, examples, styles, projects),
     fetched from `GET /api/catalog/tree` (unmoderated read, D9), and
     renders real thumbnails via `GET /api/files/*` (SUC-014).
  3. User types in the literal filter bar; results narrow via
     `GET /api/catalog/search?q=` (FTS5 `keywordSearch`, the secondary
     path per UC-014).
  4. The primary, conversational path (UC-014 step 1) is SUC-015: asking
     Claude in chat filters this same view.
  5. User double-clicks an item; it's added as a project `Reference` (see
     SUC-003) and the drawer auto-closes.
- **Postconditions**: Read-only browsing/filtering; no catalog data
  changes. Double-click is the only mutating action, delegated to SUC-003.
- **Acceptance Criteria**:
  - [ ] Drawer renders real `WorkspaceDirectory`/`Collection`/
        `KnowledgeEntry`/`Project` data and real thumbnails, no
        `mockupStubData.ts` import.
  - [ ] Filter bar narrows results via the real FTS5 endpoint.
  - [ ] Double-click closes the drawer (round 5 regression test).
  - [ ] Empty-catalog state renders without error (UC-002 E1).

---

## SUC-003: Attach a library item as a project reference
Parent: UC-004

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: SUC-002 drawer open, or an asset dragged directly onto
  the chat/output area.
- **Main Flow**:
  1. User double-clicks (drawer) or drags an asset onto the chat/output
     area.
  2. Client calls `POST /api/projects/:id/references` `{ assetId, role }`.
  3. Server (new `add_reference` catalog tool, in-process, same
     lock/versioning pattern as `create_iteration`) creates a `Reference`
     row.
  4. Reference renders as a small image thumbnail with an X in the upper
     corner (round 8) — not a text lozenge — in the project's reference
     strip.
  5. User clicks the X; client calls `DELETE
     /api/projects/:id/references/:refId` (new `remove_reference` tool);
     the thumbnail is removed.
- **Postconditions**: The project's references persist across reloads and
  are available to the Agent Runtime's prompt assembly (UC-005) on the
  next chat turn.
- **Acceptance Criteria**:
  - [ ] Reference persists (survives a page reload), unlike the current
        mockup's in-memory-only `references` state.
  - [ ] Reference renders as an image-with-X, never a text lozenge.
  - [ ] Removing a reference deletes its `Reference` row.

---

## SUC-004: Create a new project
Parent: UC-003

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in.
- **Main Flow**:
  1. User clicks "New project" (project-list page) or types "I want to
     start a new project" in an existing chat.
  2. Button path: client calls `POST /api/projects` (new route, calls the
     existing `create_project` catalog tool in-process); server returns
     the new project id; client navigates to `/projects/:id`.
  3. Chat path: Claude calls the existing `create_project` MCP tool itself
     during the turn.
  4. The new project route renders: project-details header (blank),
     empty output area, chat box. Claude asks clarifying questions
     (style, output type, goal) and fills `Project.detailsHeader` via the
     existing `create_project` update path as the conversation proceeds.
- **Postconditions**: A new `Project` row exists, visible in the
  project-list page (SUC-010) going forward.
- **Acceptance Criteria**:
  - [ ] "New project" button creates a real `Project` row and navigates to
        its detail route.
  - [ ] New-project chat opening message matches the guideline questions
        (style / output type / goal).
  - [ ] No `mockupStubData.ts` import remains in the promoted page.

---

## SUC-005: Chat with Claude in a project (SSE)
Parent: UC-005, UC-006

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: SUC-001 or SUC-004.
- **Main Flow**:
  1. User types a message and submits.
  2. Client POSTs to `/api/projects/:id/chat` and consumes the response
     body's SSE-formatted stream via `fetch()` + a `ReadableStream`
     reader, parsing `data: ...\n\n` frames itself — the native
     `EventSource` API is GET-only and cannot be used against this `POST`
     endpoint.
  3. Client renders `TurnEvent`s as they arrive (`status`,
     `knowledge_consulted`, `tool_call_started/finished`, `message`,
     `error`) — at minimum the final `message` renders as a chat bubble;
     tool-call events render as lightweight status text ("generating
     image…", "saving to library…", "searching the library…" for
     `search_catalog`, SUC-015).
  4. `requireAdmin` is dropped from this route's gate (it becomes
     `requireAuth`-only) so a normal project owner, not just an admin, can
     chat — see architecture-update.md Step 5.
  5. On page load/reopen, `GET /api/projects/:id`'s `chatMessages` field
     rehydrates the panel's history — the chat panel is never blank for a
     project that already has a conversation.
- **Postconditions**: `ChatMessage` rows persist per SUC-005's normal
  turn lifecycle (unchanged from Sprint 003/004).
- **Acceptance Criteria**:
  - [ ] Chat panel is wired to the real SSE endpoint via a fetch-stream
        reader, no `STUB_CHAT_MESSAGES`, no `EventSource`.
  - [ ] A non-admin authenticated user can start and continue a turn.
  - [ ] Reopening a project with prior chat history renders it immediately
        (from `GET /api/projects/:id`, not re-fetched separately).
  - [ ] A turn-lock-timeout or provider error surfaces in the chat panel,
        not silently (sprint.md Success Criteria: "no unhandled
        agent-runtime failure surfaced silently").

---

## SUC-006: View and iterate generated images
Parent: UC-006

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: SUC-005 has produced at least one `Iteration`.
- **Main Flow**:
  1. Output pane lists `Iteration` rows for the project, oldest first,
     never overwritten.
  2. Each iteration's media is scaled to at most 800x800 (aspect
     preserved) and centered (round 9).
  3. Iterations render vertically, one per row — never side-by-side or
     doubled up (round 1).
- **Postconditions**: Read-only; no state changes beyond what SUC-005/
  SUC-007 produce.
- **Acceptance Criteria**:
  - [ ] Real `Iteration` rows render, no `STUB_OUTPUT_ITERATIONS`.
  - [ ] Media respects the 800x800 max-and-centered rule (component test).
  - [ ] Vertical, one-per-row layout (component test).

---

## SUC-007: Mark an iteration accepted / front / back
Parent: UC-006 (round 6-7 interaction rules)

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: SUC-006.
- **Main Flow**:
  1. User checks "Accepted" on an iteration. Client calls
     `PATCH /api/projects/:id/iterations/:iterId` `{ accepted: true }`
     (new `set_iteration_state` catalog tool, in-process). Server clears
     `accepted` on whichever other iteration in the project previously
     held it (exclusive).
  2. User selects Front or Back from an iteration's pulldown. Same PATCH
     with `{ role: 'front' | 'back' }`; server clears that role from
     whichever other iteration previously held it (exclusive).
  3. "Working from" label reflects: the accepted iteration if one exists,
     else the last iteration, unless the user explicitly names a
     different one in chat (unchanged UC-006 rule, chat-side).
- **Postconditions**: `Iteration.accepted`/`Iteration.role` persist (new
  columns — see architecture-update.md Step 5 addendum, resolving Sprint
  004's Open Question 2).
- **Acceptance Criteria**:
  - [ ] Checking Accepted on one iteration unchecks any other in the same
        project (exclusive).
  - [ ] Setting Front on one iteration clears Front from whichever other
        iteration held it (exclusive); same for Back.
  - [ ] State persists across reload (unlike the current mockup's
        component-local `useState`).

---

## SUC-008: Generate a postcard PDF from the iterations view
Parent: UC-006, UC-010

- **Actor**: Any authenticated user, within an open postcard project.
- **Preconditions**: SUC-007 has at least one accepted/marked side.
- **Main Flow**:
  1. User clicks PDF on the iterations view.
  2. Client resolves the current front/back image paths from
     `Iteration.role` (SUC-007) and, if the project's
     `postcard-content.json` doesn't already reference them, submits a
     `PUT /api/postcards/:id` first to bring it up to date, then calls
     `POST /api/postcards/:id/pdf` (existing Sprint 004 endpoints, auth
     gate relaxed to `requireAuth`).
  3. Returned PDF bytes open in a new window/tab (matching the wireframe's
     "pops it up in a viewer window" behavior).
- **Postconditions**: `postcard.pdf` persists as an `Iteration`/output row
  (unchanged Sprint 004 behavior).
- **Acceptance Criteria**:
  - [ ] PDF button is disabled until at least one side is marked
        front/back (unchanged mockup rule, now backed by real state).
  - [ ] PDF includes only marked/accepted sides — front-only or front+back.
  - [ ] A non-admin authenticated project owner can generate a PDF.

---

## SUC-009: Edit postcard text regions
Parent: UC-010 (rounds 2, 4, 7, 8, 10)

- **Actor**: Any authenticated user, within an open postcard project.
- **Preconditions**: The project has a front and/or back iteration marked
  via SUC-007.
- **Main Flow**:
  1. User reaches the text editor from the iterations view's "Text Entry"
     button.
  2. Front/back tabs show one side's postcard preview at a time, sourced
     from `Iteration.role` (SUC-007), not a hardcoded stub image path.
  3. Clicking an existing text region opens a popup sized to fit its text;
     Return commits, the popup also carries a Delete button.
  4. Dragging on the postcard background rubber-bands a new box from the
     anchor corner; on release, a naming popup creates it at the exact
     drawn size (overflow clipped, not shown).
  5. Move handles on the bottom-left/top-right corners reposition a box.
  6. Clicking the QR overlay prompts for the URL it encodes.
  7. Saving persists via the existing `PUT /api/postcards/:id` endpoint
     (content-JSON shape unchanged from Sprint 004); chat box below is
     wired to SUC-005 (instructions here are not limited to text edits).
  8. No left-pane asset browser renders on this page (explicit stakeholder
     rule, unchanged from the mockup).
- **Postconditions**: `postcard-content.json`/`postcard.html` persist via
  the unchanged Sprint 004 pipeline.
- **Acceptance Criteria**:
  - [ ] All six interaction rules (click-to-edit, delete, draw, clip
        overflow, move handles, QR popup) have a passing component test.
  - [ ] Front/back preview images come from `Iteration.role`, not a
        hardcoded `/mockup-assets/...` path.
  - [ ] Asset browser never renders on this route.
  - [ ] Text-region list section (removed round 10) does not reappear.

---

## SUC-010: Project-list home page with view buttons and hero images
Parent: UC-002, UC-013 (view partitioning)

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in.
- **Main Flow**:
  1. User lands on `/` after login; it renders the project list (no
     counter demo).
  2. My / All / Archive buttons filter `GET /api/projects?view=` by
     owner/status; Library switches to the catalog-asset view (SUC-011).
  3. Each project card's hero image is the most recently accepted
     iteration; if the project has any accepted iteration marked `role:
     'back'` and a separate accepted iteration marked `role: 'front'` (or
     unmarked), the front (or unmarked-but-accepted) one wins over the
     back — a postcard's hero is never its back (round 6). Falls back to
     the last iteration overall if nothing is accepted.
- **Postconditions**: Read-only.
- **Acceptance Criteria**:
  - [ ] `/` renders the real project list, not `HomePage.tsx`'s prior
        content.
  - [ ] My/All/Archive are real, data-backed views (not navigation-only
        stubs).
  - [ ] Hero-image selection rule (accepted, front-over-back for
        postcards) has a passing component test.

---

## SUC-011: Library-asset-to-project flow
Parent: UC-002, UC-004 (round 12)

- **Actor**: Any authenticated user.
- **Preconditions**: SUC-010, Library view selected.
- **Main Flow**:
  1. User clicks Library among the project-list view buttons; the view
     shows catalog assets (via `GET /api/catalog/tree`), not projects.
  2. User clicks an asset.
  3. Client calls `POST /api/projects` with `{ sourceAssetId }`; server
     creates the project (`create_project` tool) then immediately calls
     the new `add_reference` tool to attach that asset as the project's
     first reference.
  4. Client navigates to `/projects/:id`; the user manipulates the asset
     as a normal project (SUC-001 onward) and later puts it back into the
     library (typically by asking Claude, UC-008).
- **Postconditions**: A new project exists, pre-seeded with one
  `Reference` pointing at the clicked asset.
- **Acceptance Criteria**:
  - [ ] Clicking a Library asset creates a project and navigates into it.
  - [ ] The created project's reference strip (SUC-003) already shows the
        source asset without any further action.

---

## SUC-012: Account menu — admin console link and log out
Parent: UC-001 grounding (spec §13, §9); `account-menu-first-user-admin.md`

- **Actor**: Any authenticated user (admin-console link only visible to
  `ADMIN`).
- **Preconditions**: User is logged in.
- **Main Flow**:
  1. User clicks their username in the app chrome (`AppLayout`'s existing
     dropdown trigger).
  2. Dropdown/Account view shows: a link to `/admin/users` when
     `hasAdminAccess(role)` is true, and a Log out action.
  3. Clicking the admin link navigates into the already-built `/admin`
     console (`client/src/pages/admin/*`, unmodified by this sprint).
  4. Clicking Log out calls the existing `AuthContext.logout()` and
     redirects to `/login`.
- **Postconditions**: A `USER`-role user never sees the admin link; an
  `ADMIN`-role user can always reach `/admin` from the account surface.
- **Acceptance Criteria**:
  - [ ] `Account.tsx` (or the dropdown, whichever this ticket picks — see
        architecture-update.md Step 5) renders an Admin-console link only
        for `ADMIN` role.
  - [ ] Log out is reachable from the same surface.
  - [ ] A `USER`-role component test confirms the admin link is absent.

---

## SUC-013: First user becomes admin, race-safe
Parent: UC-001 grounding; `account-menu-first-user-admin.md`

- **Actor**: System, triggered by the first-ever OAuth login.
- **Preconditions**: The `User` table is empty.
- **Main Flow**:
  1. Two users complete Google OAuth at nearly the same time, both
     racing to be "the first user."
  2. `findOrCreateOAuthUser`'s create-new-user path (already implemented,
     `server/src/routes/auth.ts`) is wrapped in a single serializable
     write transaction, so SQLite's own single-writer guarantee makes the
     count-check-then-create sequence atomic across the two concurrent
     requests.
  3. Exactly one of the two becomes `ADMIN`; the other becomes `USER`.
- **Postconditions**: Exactly one `ADMIN` user results from any number of
  concurrent first-time logins; every subsequent login gets `USER`.
- **Acceptance Criteria**:
  - [ ] A concurrency test (two simultaneous `findOrCreateOAuthUser` calls
        against an empty `User` table) yields exactly one `ADMIN` and one
        `USER`.
  - [ ] Existing single-user-at-a-time behavior (already covered by
        current tests) is unchanged.

---

## SUC-014: Serve workspace image bytes to the browser
Parent: UC-002, UC-006, UC-010 grounding (no promoted page can render a
real image without this)

- **Actor**: Any authenticated user (indirect — every page that shows an
  image depends on this).
- **Preconditions**: User is logged in. An `Asset`/`Iteration` row with a
  workspace-relative `path`/`imagePath` exists.
- **Main Flow**:
  1. A promoted page renders `<img src="/api/files/{path}">` for an asset
     thumbnail, an iteration, a postcard preview background, or a
     project's hero image.
  2. `GET /api/files/*` resolves the wildcard suffix via the existing
     `resolveWorkspacePath` containment helper, confirms it's inside
     `workspace/`, and streams the file with a content-type inferred
     from its extension.
  3. A path that resolves outside `workspace/` (containment violation) or
     doesn't exist returns 404/400, never a directory listing or an
     escape.
- **Postconditions**: Read-only; no state changes.
- **Acceptance Criteria**:
  - [ ] A valid asset/iteration path returns the correct bytes and
        content-type.
  - [ ] A path-traversal attempt (`../../etc/passwd`-style) is rejected,
        not resolved.
  - [ ] An unauthenticated request is rejected (`requireAuth`).
  - [ ] Every promoted page's real images (drawer thumbnails, iteration
        gallery, postcard preview, project hero) render through this
        route in at least one component/integration test.

---

## SUC-015: Conversational (chat-driven) semantic filtering of the library
Parent: UC-014 (primary path)

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: SUC-002 drawer is reachable (need not be open). At
  least some assets carry an `AssetDescription`/`Embedding` (UC-008
  postconditions).
- **Main Flow**:
  1. User asks Claude in chat, e.g. "show me the assets with robots in
     them" (the product pitch's own headline example,
     `docs/design/overview.md`).
  2. During the turn, Claude calls the new `search_catalog` tool with the
     query text. The tool embeds the query via the existing `embedText`,
     runs `nearestNeighbors` against it, runs `keywordSearch` against the
     same text, and returns merged/deduped `(ownerType, ownerId)` matches
     with enough denormalized fields to render.
  3. The client observes this call's `tool_call_finished` SSE event (the
     same event stream the chat panel already renders, SUC-005) and
     updates the drawer's visible filtered set to the matched items —
     opening the drawer if it was closed.
  4. User refines conversationally ("just the black-and-white ones");
     the drawer's filtered view updates again on the next matching tool
     call.
- **Postconditions**: Read-only; no catalog data changes. The drawer's
  filtered view reflects the most recent `search_catalog` result for this
  project's chat.
- **Acceptance Criteria**:
  - [ ] Asking Claude to filter by content (not by category/filename)
        results in a `search_catalog` tool call, observable in the SSE
        stream.
  - [ ] The drawer's visible item set updates to the tool call's result
        without a page reload.
  - [ ] No matching assets → drawer shows an empty/broaden-your-query
        state (UC-014 E1), not an error.
  - [ ] `search_catalog` reuses `embedText`/`nearestNeighbors`/
        `keywordSearch` — no new external embedding-API call is
        introduced by this ticket.
