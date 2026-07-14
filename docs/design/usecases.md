# Flyerbot — Use Cases

Derived from `.clasi/design/specification.md`. Each use case traces back to
a specific stakeholder statement in that document (cited by section).
Numbering has no significance beyond identity — use cases are not meant to
be executed in ID order.

---

## UC-001: Google login

- **Actor**: Any user (League staff).
- **Preconditions**: User has a Google/Gmail account. Google OAuth strategy
  is the only enabled auth provider (spec §13, §9 grounding — GitHub,
  Pike13, and username/password strategies are removed or disabled).
- **Main flow**:
  1. User visits Flyerbot and is presented with a "Sign in with Google"
     action (no username/password form).
  2. User completes the Google OAuth consent flow.
  3. Flyerbot receives the OAuth callback, finds or creates a `User` record
     keyed by the Google account, and establishes a session.
  4. User lands on the two-pane main view (left browser, right project/chat
     pane).
- **Postconditions**: User has an authenticated session; if this is the
  user's first login, a `User` record now exists with no separate
  account-creation step required.
- **Error flows**:
  - **E1 — OAuth denied/cancelled**: User is returned to the login screen
    with no session created.
  - **E2 — Google account not recognized/authorized** (if an allowlist is
    enforced): User sees an access-denied message; no session is created.
  - **E3 — Google outage**: Login screen shows a retry-capable error; no
    fallback auth method exists (Google-only per spec §13).

---

## UC-002: Browse the left-pane asset/style/project library

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in (UC-001). Asset/style/project catalog
  data exists (may be empty on a fresh install).
- **Main flow**:
  1. User views the left pane, which lists categories such as assets
     (logos, stock images, prior-art photos), styles (pop art, manga, flat
     poster, etc.), compositions, layouts, and previous projects (spec §3,
     §4).
  2. User searches or filters — "search around in there" (spec §7) — by
     text, tag, style, or category.
  3. User selects an item to preview its image, its associated prompt text,
     or both (spec §3 — "each of these things can have an image, a prompt,
     or both").
- **Postconditions**: User has located an item to reference; no state
  changes. This use case is read-only.
- **Error flows**:
  - **E1 — No results**: Search/filter yields an empty state; user is
    invited to broaden the query or upload something new.
  - **E2 — Catalog index stale or corrupt**: Item preview fails to load;
    user sees an error and the system logs the inconsistency for the agent
    to reconcile (see UC-011).

---

## UC-003: Create a project via chat

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in (UC-001).
- **Main flow**:
  1. User says "I want to start a new project" in chat, or clicks an
     equivalent new-project affordance (spec §7 — both entry points are
     valid).
  2. System presents a blank right-pane view: project-details header at
     top, empty output area below it, chat box at the bottom.
  3. Claude asks clarifying questions as needed — style, target format
     (Facebook image, logo, postcard...), goal — filling in the
     project-details header as "general guidelines" (spec §7).
  4. User continues describing the project in the chat box (e.g. "Hey, I
     want to make a poster. It's got these things in it.").
  5. System creates a persisted project record (config + empty iteration
     history, analogous to the predecessor's `project.json`, per spec §6
     grounding) and a corresponding entry in the left-pane project catalog.
- **Postconditions**: A new project exists, associated with the creating
  user, with a project-details header (possibly partially filled) and an
  empty output list. The project is visible in the left-pane library
  (UC-002) going forward.
- **Error flows**:
  - **E1 — User abandons before any details are given**: An empty or
    minimally-named project may be created as a draft, or creation may be
    deferred until the first substantive chat message — this is an open
    design question (see specification §16, open question 6, for the
    related subproject inheritance question).
  - **E2 — Persistence failure**: Project record fails to save; user sees
    an error in chat and is invited to retry; no partial project appears in
    the catalog.

---

## UC-004: Drag assets into chat as style/composition/template references

- **Actor**: Any authenticated user, within an open project (UC-003).
- **Preconditions**: Project is open in the right pane. At least one asset
  exists in the left-pane library (UC-002).
- **Main flow**:
  1. User drags an item from the left pane — a stock-art picture, a logo
     example, or a bordered postcard template (spec §7) — into the chat
     area or output area.
  2. System records the dragged item as a reference attached to the current
     chat context, tagging its intended role if inferable (style example,
     composition layout, or structural template) or asking the user to
     clarify.
  3. User continues the conversation, referring to the dragged item (e.g.
     "match this layout").
  4. Reference is available to the AI prompt-assembly step (UC-005) for
     this and subsequent generations in the project.
- **Postconditions**: The project's `sources` (spec §6 grounding) now
  includes the dragged reference, associated with a role. The reference
  persists across iterations in the project.
- **Error flows**:
  - **E1 — Unsupported file type dragged**: System rejects the drop with an
    inline message; no reference is recorded.
  - **E2 — Ambiguous role**: System cannot infer whether the drop is a
    style, composition, or template reference and asks the user in chat
    before proceeding.

---

## UC-005: AI prompt assembly from the style/knowledge database

- **Actor**: System (Claude), triggered by user chat activity within a
  project. Indirect actor: the user, via conversation.
- **Preconditions**: Project is open (UC-003). User has described intent
  and/or attached references (UC-004). Style/composition/layout/palette
  knowledge base and any "things people have told the AI to do or not do"
  records exist (spec §8) — possibly empty on a fresh install.
- **Main flow**:
  1. User describes what they want in chat.
  2. Claude does **not** generate an ad hoc prompt from the chat text alone
     (spec §8 — explicit "not ad hoc every time"). Instead, it consults the
     persistent knowledge base: relevant style definition(s), palette,
     composition, layout, and any applicable standing instructions
     ("do/don't" records) and brand guardrails (spec §9 grounding).
  3. Claude concatenates/combines the retrieved knowledge-base text with
     the user's stated intent and any dragged-in references (UC-004),
     analogous to the predecessor's `assemble-prompt` step (spec §8
     grounding).
  4. Claude rewrites the combined material into a single coherent prompt
     voice — not a raw concatenation — before it is used for generation
     (UC-006).
- **Postconditions**: A concrete, assembled prompt exists, ready for image
  generation. The assembly is traceable to which knowledge-base entries it
  drew from (needed to support persistent-learning corrections, UC-007).
- **Error flows**:
  - **E1 — Referenced style/composition/layout not found**: Claude tells
    the user it doesn't recognize the named style and offers to create a
    new knowledge-base entry or use the closest match.
  - **E2 — Conflicting instructions in the knowledge base**: Claude
    surfaces the conflict to the user in chat rather than silently picking
    one side.

---

## UC-006: Generate and iterate images

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: A prompt has been assembled (UC-005) or a prior
  iteration exists to revise.
- **Main flow**:
  1. Claude submits the assembled prompt (plus any attached reference
     images) to the GPT image generator (spec §1, §9 grounding — OpenAI
     `gpt-image-2`, using `/v1/images/edits` when reference images are
     attached).
  2. Generated image is added to the project's output area (top
     three-quarters of the right pane) as a new iteration; prior iterations
     are retained, never overwritten (spec §6 grounding).
  3. User reviews the result and gives feedback in chat ("make the impact
     starburst bigger," "this isn't pop art enough").
  4. Claude re-assembles the prompt incorporating the feedback (looping back
     to UC-005) and generates the next iteration.
  5. Steps 3-4 repeat until the user is satisfied.
- **Postconditions**: One or more image iterations exist in the project's
  history, each addressable individually; the most recent is presented as
  current in the output area.
- **Error flows**:
  - **E1 — Image generation API failure/timeout**: Chat reports the failure;
    no new iteration is added; prior iterations remain intact.
  - **E2 — Generated image violates brand guardrails** (per rubric
    evaluation, spec §9 grounding): System may flag the image, regenerate
    automatically, or surface the concern to the user rather than silently
    accepting it — exact behavior is an implementation decision, not fully
    specified by the stakeholder.
  - **E3 — User feedback doesn't map to a knowledge-base concept**: Claude
    asks a clarifying question rather than guessing.

---

## UC-007: Correct a style definition (persistent learning)

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: A style (or other knowledge-base entry — palette,
  composition, layout) has been used in prompt assembly (UC-005) and
  produced an image the user considers wrong for that style (UC-006).
- **Main flow**:
  1. User tells Claude, in chat, that the style came out wrong (e.g. "pop
     art shouldn't use gradients — it's flat colors and dots").
  2. Claude identifies which knowledge-base entry (e.g. the `pop-art`
     style's positive/negative definition) is responsible for the
     mismatch.
  3. Claude updates that stored definition to reflect the correction — this
     is a **persistent** change to the shared knowledge base, not a
     one-off adjustment scoped to the current image (spec §8, §10).
  4. Claude confirms the change with the user and, optionally, regenerates
     the current image using the corrected definition.
- **Postconditions**: The style/knowledge-base entry is updated for all
  future projects, not just the current one. The change is version-
  controlled (UC-012).
- **Error flows**:
  - **E1 — Correction is project-specific, not general**: If the user's
    feedback is really about this one image rather than the style
    definition itself, Claude should recognize the difference and adjust
    only the current iteration (UC-006) instead of the shared style — this
    distinction is judgment-based and not mechanically specified.
  - **E2 — Conflicting corrections from different users** (multi-user, spec
    §12): Later correction wins, or the conflict is surfaced — exact
    behavior is an open question (specification §16, open question 5).

---

## UC-008: Add an item to a collection

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in. For flow C, an open project with
  chat history exists.
- **Main flow — Flow A (drag to group)**:
  1. User drags an asset (e.g. a found stock photo) directly onto a
     collection group in the left pane (e.g. "stock art") (spec §5).
  2. System adds the asset to that collection and indexes it (metadata,
     tags — see spec §3 grounding on catalog structure).
- **Main flow — Flow B (drag to chat with instruction)**:
  1. User drags an asset into the main/chat window and tells the chat
     session, "go put this in the stock art collection" (spec §5).
  2. Claude interprets the instruction, files the asset into the named
     collection, and confirms in chat.
- **Main flow — Flow C (upload)**:
  1. User uploads a file directly (no drag, no chat instruction — spec §5,
     "maybe they just uploaded it").
  2. System adds it to a default or user-chosen collection.
- **Main flow — Flow D (from project discussion)**:
  1. During an in-project chat discussion, the user says "please add this
     to the collections" about an asset already visible in the project
     (e.g. a generated iteration or a dragged reference) (spec §5).
  2. Claude adds that asset to the appropriate shared collection, outside
     the scope of the single project.
- **Postconditions**: The asset appears in the relevant collection in the
  left-pane library (UC-002) and is available for future projects to
  reference (UC-004). In addition, the commit triggers automatic
  description generation: the asset is run through a vision model that
  produces a classification, a rich textual description, and tags (tag
  vocabulary TBD — spec §5, §16 open question 8, RESOLVED 2026-07-13: tags
  are in scope after all) — covering at minimum whether it's a real
  photograph, whether it's a logo, its style, and whether any people shown
  are real or AI-generated. That description is what powers semantic
  search/filter of the library (UC-014) going forward.
- **Error flows**:
  - **E1 — Duplicate asset**: System detects the asset already exists in
    the collection (e.g. by hash or path) and informs the user rather than
    creating a duplicate entry.
  - **E2 — Unrecognized collection name** (Flow B/D): Claude asks whether to
    create a new collection or use an existing similarly-named one.
  - **E3 — Upload fails / unsupported format** (Flow C): Upload is rejected
    with an inline error; no catalog entry is created.
  - **E4 — Vision model unavailable at commit time**: The asset is still
    added to the collection, but description generation is deferred —
    generated lazily on next access, or queued for a background retry —
    rather than blocking the commit. The asset is searchable by filename/
    path in the interim but not yet by semantic description (see UC-014,
    E3).

---

## UC-009: Create subprojects

- **Actor**: Any authenticated user, within an open project.
- **Preconditions**: A parent project exists (UC-003).
- **Main flow**:
  1. User asks, in chat, to create a subproject of the current project (or
     uses an equivalent affordance) (spec §6 — "you can also create
     subprojects").
  2. System creates a new project record linked to the parent project.
  3. User works within the subproject as a normal project (UC-003 onward):
     describing intent, dragging references, generating/iterating images.
- **Postconditions**: A subproject exists, associated with its parent, and
  is discoverable via the left-pane library, nested under or linked to the
  parent project.
- **Error flows**:
  - **E1 — Ambiguous inheritance**: Whether the subproject starts with the
    parent's project-details header pre-filled, or blank, is unresolved
    (specification §16, open question 6) — implementation should pick one
    and document it, since the stakeholder did not specify.
  - **E2 — Parent project deleted/archived while subproject open**: System
    should prevent orphaning or clearly surface the broken link — not
    explicitly specified by the stakeholder.

---

## UC-010: Postcard text-region editing via an agent-generated form page

- **Actor**: Any authenticated user, within an open postcard-type project.
- **Preconditions**: A postcard project has at least one generated image
  iteration (UC-006) intended as a template with defined text regions (spec
  §9 grounding — chroma-key `#00FF00` content rectangles composited later
  from a sidecar JSON of normalized bounding boxes).
- **Main flow**:
  1. User asks Claude to set up the postcard text (or Claude proactively
     offers this once a template-style image exists) (spec §11 — "for
     postcards there's a JSON file specifying where the bounding boxes for
     text are; the user enters those in a form — the agent makes a web page
     for that").
  2. Claude generates a web page/form with one input per text region (e.g.
     headline, date/location, body copy, call to action — spec §9
     grounding, `postcard-content.json` shape: name, label, style,
     position, font per region), derived from the region-definition JSON
     for this project.
  3. User fills in exact text per region in the generated form.
  4. Claude (or the system) renders the final composited postcard —
     background art plus text regions — to an HTML/PDF output, analogous
     to the predecessor's `postcard.html`/`postcard.pdf` pipeline (spec §9
     grounding, including 1/8in bleed and vendor rotation handling where
     applicable).
- **Postconditions**: A postcard output exists with real, user-authored text
  composited onto the generated art, saved as a project output alongside
  the image iterations.
- **Error flows**:
  - **E1 — Text overflows its defined region**: Form or renderer flags the
    overflow; user is asked to shorten text or the system adjusts font size
    within defined limits — exact behavior not specified by the
    stakeholder, left to implementation.
  - **E2 — No region-definition JSON exists for this image** (image wasn't
    generated as a chroma-key template): Claude explains that this image
    isn't set up for text-region editing and offers to regenerate it as a
    template, or to place text manually.

---

## UC-011: Agent file-system reorganization via MCP

- **Actor**: System (Claude), acting on user chat requests.
- **Preconditions**: User has an active session (UC-001). MCP server is
  running and mediates all file-system access (spec §9).
- **Main flow**:
  1. User asks, in chat, for something beyond image generation — e.g.,
     "let's reorganize the stock photos by event" or "add a new style
     category" (spec §9 — "they'll ask to reorganize directory structures
     and update the database").
  2. Claude plans the filesystem/database changes needed (move files,
     create directories, add catalog/knowledge-base records).
  3. Claude issues the corresponding calls through the MCP server — which
     permits reading and moving files, creating directories, and a limited
     set of stat-type operations, but **not** arbitrary Unix commands (spec
     §9 — explicit constraint).
  4. Claude reports back to the user what was changed, in chat.
- **Postconditions**: The file system and/or database reflect the requested
  reorganization; the catalog index is updated to match (avoiding the
  stale-index failure noted in UC-002/E2). Changes are committed to git
  (UC-012).
- **Error flows**:
  - **E1 — Requested operation exceeds MCP's permitted surface** (e.g. user
    asks the agent to run an arbitrary shell command): Claude explains the
    operation isn't permitted through MCP and either finds an in-scope
    alternative or declines.
  - **E2 — Operation would overwrite or delete referenced assets**: System
    should warn before destructive operations — exact confirmation
    mechanism (chat confirmation vs. hard block) is not specified by the
    stakeholder and is left to implementation judgment, consistent with
    "fairly flexible... not formalizing this too much" (spec §9).
  - **E3 — Concurrent modification by another user's agent session** (spec
    §12): See UC-013.

---

## UC-012: Git/GitHub versioning of assets

- **Actor**: System, on behalf of any user's actions (asset changes, style
  corrections, project outputs, reorganizations).
- **Preconditions**: Repository is configured with a GitHub remote and
  credentials (`GITHUB_TOKEN` / GitHub OAuth per the current template's
  config).
- **Main flow**:
  1. A user action results in a filesystem or database change worth
     versioning — a new asset, a style correction (UC-007), a
     reorganization (UC-011), a new project output (UC-006, UC-010).
  2. System (behind the scenes, or via explicit agent action — spec §9,
     "which may be behind the scenes, or maybe something the agent can
     control") commits the change to git with a descriptive message.
  3. Commit is pushed to GitHub, so **everything commits to GitHub for
     version control** (spec §12).
- **Postconditions**: Every meaningful change to assets, styles, and
  projects has a corresponding git history entry, recoverable and
  auditable. Prior iterations remain retrievable even after further edits.
- **Error flows**:
  - **E1 — GitHub push fails (network/auth)**: Local commit still succeeds;
    system retries or queues the push; user is not blocked from continuing
    to work.
  - **E2 — Merge conflict from concurrent agent sessions** (multi-user,
    spec §12): Exact resolution strategy is unspecified by the stakeholder
    (specification §16, open question 5) — flagged as an open question for
    architecture to resolve.

---

## UC-013: Multi-user concurrent use of the shared environment

- **Actor**: Two or more authenticated users, operating simultaneously.
- **Preconditions**: Multiple users are logged in (UC-001) and each has
  agent sessions (Claude) potentially acting on shared files/database
  concurrently (spec §12 — "all users work in the same environment... other
  agents may be operating on the same file system").
- **Main flow**:
  1. User A is mid-conversation on Project X, with an active Claude session
     reading/writing project and knowledge-base state.
  2. User B, concurrently, browses the shared left-pane library (UC-002),
     adds an asset to a collection (UC-008), or corrects a style definition
     (UC-007) that User A's session also depends on.
  3. Both sessions' changes land in the shared SQLite database and shared
     file system; each user continues to see a consistent (if eventually-
     updated) view of shared resources like the style knowledge base and
     asset catalog.
  4. Git commits from both sessions (UC-012) are recorded, preserving full
     history of who changed what.
- **Postconditions**: Both users' work is preserved; no silent data loss.
  Shared resources (styles, collections, catalogs) reflect the most recent
  committed state.
- **Error flows**:
  - **E1 — Simultaneous write to the same record** (e.g. both users correct
    the same style at the same time): Behavior is not specified by the
    stakeholder — could be last-write-wins, optimistic-lock rejection, or
    surfaced conflict. Flagged as an open question (specification §16,
    open question 5) requiring an architecture decision before
    implementation.
  - **E2 — One user's agent reorganizes a directory (UC-011) that another
    user's active project references mid-edit**: Referencing project should
    not silently break — at minimum, the broken reference should surface
    to the affected user rather than fail silently.

---

## UC-014: Semantic search/filter of the library via chat

- **Actor**: Any authenticated user.
- **Preconditions**: User is logged in (UC-001). At least some assets in the
  left-pane library have been committed into a collection (UC-008) and thus
  carry an auto-generated description; the library may be a mix of
  described and not-yet-described assets (see UC-008 E4).
- **Main flow — conversational (primary)**:
  1. User asks Claude, in chat, for assets by content or feel rather than by
     name or folder — e.g. "show me the assets with robots in them," "show
     me a style that conveys a sense of wonder," or "a young girl looking at
     a computer screen" (spec §3, addition 2026-07-13).
  2. Claude matches the request against the auto-generated descriptions
     (UC-008 postconditions) across the asset library.
  3. The left-pane browser view (UC-002) filters to show the matching
     assets.
  4. User can refine the request conversationally ("just the black-and-white
     ones") and the filtered view updates.
- **Main flow — filter bar (secondary, possible)**:
  1. User types a query into a filter/search bar at the top of the left
     pane, if one is present (spec §3 — the stakeholder called this a
     possible secondary path, with conversational filtering as the expected
     primary path).
  2. Left-pane browser view filters to match, same as the conversational
     flow.
- **Postconditions**: The left-pane library view reflects the semantic
  query; no underlying asset or collection data is changed. This use case
  is read-only, like UC-002, but filters by generated description/meaning
  rather than by category or literal text match.
- **Error flows**:
  - **E1 — No matching assets**: Filtered view is empty; user is invited to
    broaden the query, consistent with UC-002 E1.
  - **E2 — Ambiguous or under-specified query**: Claude asks a clarifying
    question in chat rather than guessing (conversational flow only; the
    filter-bar flow, if present, would instead fall back to a broader
    literal/partial match).
  - **E3 — Asset has no description yet** (vision model was unavailable at
    commit time, or generation is still queued — UC-008 E4): The asset is
    excluded from semantic-search results until its description is
    generated; it remains reachable via ordinary browsing (UC-002) or
    filename search in the meantime. Once description generation completes
    (lazily or via the queued retry), the asset becomes eligible for
    semantic matches on subsequent queries.
