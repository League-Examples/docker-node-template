---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 003 -- Use Cases

Sprint-level use cases (SUC-NNN), each tracing to a parent use case in
`docs/design/usecases.md` and to architecture-001's module design. Sprint
003 delivers the moderated write path (Workspace MCP Server), the
conversational agent loop (Agent Runtime, provider-neutral per D10), and
git versioning (Versioning Service) that Sprint 002's schema and
filesystem scaffold were built for. It is demoable as a backend
capability only -- a scripted/admin-only chat turn, not the real chat UI
(Sprint 005 wires `MockupChatPanel.tsx` to this sprint's SSE endpoint).

---

## SUC-001: Moderated filesystem access through the Workspace MCP Server

Parent: UC-011 (agent file-system reorganization via MCP)

- **Actor**: System (Agent Runtime), via the Workspace MCP Server.
- **Preconditions**: `workspace/` tree exists (Sprint 002). No shell tool
  exists at any layer.
- **Main Flow**:
  1. The Agent Runtime calls one of the Workspace MCP Server's filesystem
     tools: `read_file`, `move_file`, `create_directory`, `stat`.
  2. The MCP server resolves the requested path against `workspace/` as
     an enforced root, reusing `resolveWorkspacePath` from Sprint 002's
     `workspaceDirectorySync.ts` (architecture-001 Security
     Considerations -- path containment).
  3. The MCP server acquires a `Lock` row keyed by `(resourceType:
     'directory', resourceKey: <path>)` before any mutating operation
     (`move_file`, `create_directory`), executes it, then releases the
     lock.
  4. On success, the MCP server hands off to the Versioning Service
     (SUC-005) for a batched commit.
- **Postconditions**: The requested filesystem change is applied (or
  rejected) and, for mutations, a `Lock` row briefly existed and was
  released. No shell command was ever issued.
- **Acceptance Criteria**:
  - [ ] `read_file`/`stat` against a path inside `workspace/` succeeds
        and returns content/metadata.
  - [ ] `move_file`/`create_directory` against a path inside `workspace/`
        succeeds, acquires and releases a `Lock` row, and triggers a
        versioning commit.
  - [ ] Any filesystem tool call whose resolved path (including via a
        crafted `move_file` destination) escapes `workspace/` is rejected
        before any I/O occurs.
  - [ ] No generic shell/command-execution tool is registered on the
        Workspace MCP Server or reachable from the Agent Runtime.

## SUC-002: Typed catalog writes and correction-diff proposals through the Workspace MCP Server

Parent: UC-005 (prompt assembly consults the knowledge base), UC-007
(persistent style correction), UC-008 (add item to collection, catalog
side only -- vision description is Sprint 004)

- **Actor**: System (Agent Runtime), via the Workspace MCP Server.
- **Preconditions**: SUC-001's tool-dispatch and locking mechanics exist.
  `KnowledgeEntry`/`Collection`/`Asset`/`Project`/`Iteration` models exist
  (Sprint 002).
- **Main Flow**:
  1. The Agent Runtime calls a catalog tool: `create_knowledge_entry`,
     `propose_correction`, `resolve_correction`, `add_asset_to_collection`,
     `create_project`, `create_iteration`, or `create_agent_page`.
  2. For writes to `Project` or `KnowledgeEntry`, the tool call includes
     the row's currently-read `version`; the MCP server rejects the write
     with a surfaced conflict if the stored `version` has since moved
     (architecture-001 Locking/Concurrency Model, Open Question 2 default:
     reject-and-surface, not last-write-wins).
  3. `propose_correction` creates a `KnowledgeCorrection` row (`status:
     pending`) with a unified diff against the entry's current `bodyText`
     -- `bodyText` and `version` are **not** touched.
  4. `resolve_correction` (accept path) applies the diff to `bodyText`,
     bumps `KnowledgeEntry.version`, and sets the correction's `status` to
     `accepted`; the reject path sets `status: rejected` and changes
     nothing else.
  5. Every successful write hands off to the Versioning Service (SUC-005).
- **Postconditions**: The catalog reflects the typed write (or a
  correction proposal awaiting resolution); no `bodyText` was ever
  overwritten directly from chat.
- **Acceptance Criteria**:
  - [ ] `propose_correction` followed by a read of the entry shows
        unchanged `bodyText` and `version`.
  - [ ] `resolve_correction` (accept) changes `bodyText` to match the
        diff's result and bumps `version` by exactly 1.
  - [ ] A `create_knowledge_entry`/`create_project`-family write carrying
        a stale `version` is rejected with a surfaced conflict, not
        silently overwritten.
  - [ ] `add_asset_to_collection` creates an `Asset` row under the named
        `Collection` (no vision-model description generation this sprint
        -- `AssetDescription` may remain null, per Sprint 004 scope).

## SUC-003: Provider-neutral agent loop with an Anthropic default adapter

Parent: UC-005 (AI prompt assembly), UC-006 (generate and iterate images
-- loop mechanics only; image calls are stubbed, per sprint Out of
Scope)

- **Actor**: System (Agent Runtime).
- **Preconditions**: A `Project` exists (Sprint 002 schema). SUC-001/
  SUC-002's tool surface exists for the loop to call into.
- **Main Flow**:
  1. A caller starts or continues a turn for a `Project` (chat message
     in).
  2. The Agent Runtime's turn controller reconstructs context from
     `ChatMessage` history plus a fresh, unmoderated knowledge-retrieval
     read (architecture-001 D8/D9) -- no session store.
  3. The turn controller calls the active `ProviderAdapter`'s chat-
     completions-plus-tool-use interface. The Anthropic adapter (Claude
     Agent SDK) is the default and only adapter wired into the running
     app this sprint.
  4. Tool-use responses are dispatched to the Workspace MCP Server
     (SUC-001/SUC-002); results are fed back to the provider adapter
     until the turn produces a final assistant message.
  5. The turn is persisted as `ChatMessage` rows (`role`, `content`,
     `toolCalls` in a provider-neutral shape -- tool name plus structured
     args/results, not a raw SDK wire-format copy, per D10 Consequences).
  6. A second, minimal mock provider adapter exists, implementing the
     same `ProviderAdapter` interface against a scripted/canned response
     instead of a real API call, and is exercised by a test that runs one
     full turn through it -- proving the loop, tool dispatch, and storage
     are unchanged when the adapter is swapped (architecture-001 D10
     acceptance).
- **Postconditions**: One turn's `ChatMessage` history (user + assistant
  + any tool-call records) is persisted; the `ProviderAdapter` boundary is
  the only place that changed between the Anthropic and mock adapter
  runs.
- **Acceptance Criteria**:
  - [ ] A scripted/mocked provider client drives one full turn: chat
        message in, a `create_knowledge_entry` or
        `add_asset_to_collection` tool call out, resulting row exists in
        the DB with a corresponding `ChatMessage` history entry.
  - [ ] Restarting the process (simulated: dropping any in-memory state
        and re-deriving context from `ChatMessage` + knowledge retrieval
        only) reproduces the same context for a continued turn --
        confirms statelessness (D8).
  - [ ] The mock second adapter completes the same scripted turn as the
        Anthropic adapter without any change to the turn controller, tool
        dispatch code, or `ChatMessage` schema -- only the adapter
        implementation differs.
  - [ ] `ChatMessage.toolCalls` is stored as `{ name, args, result }`-
        shaped JSON, not a raw Anthropic SDK object.

## SUC-004: Per-project turn serialization

Parent: UC-013 (multi-user concurrent use of the shared environment)

- **Actor**: System (Agent Runtime + Workspace MCP Server), two or more
  concurrent callers.
- **Preconditions**: SUC-003's turn controller exists. `Lock` model
  exists (Sprint 002).
- **Main Flow**:
  1. A message arrives for `Project` P while no turn is active -- the
     Agent Runtime acquires a `Lock` row `(resourceType: 'project_turn',
     resourceKey: P.id)` and proceeds.
  2. A second message arrives for the same `Project` P while the first
     turn's lock is still held -- the second request queues (waits for
     the lock) rather than starting a second, interleaved turn.
  3. When the first turn completes, its lock is released and the queued
     second turn proceeds.
  4. A message for a different project, or a read-only browse/search
     request, proceeds immediately, unaffected by P's lock (D9 -- reads
     are never moderated or locked).
- **Postconditions**: At most one active turn per project at any time;
  no interleaved tool calls from two turns on the same project are ever
  observed.
- **Acceptance Criteria**:
  - [ ] Two simulated concurrent turn-start requests on the same project
        serialize -- the second observably waits for the first to
        release the `project_turn` lock rather than running concurrently.
  - [ ] A concurrent turn-start request on a *different* project, or a
        read-only catalog query, is not blocked by another project's
        in-flight turn.

## SUC-005: Batched, config-gated git versioning of workspace content

Parent: UC-012 (git/GitHub versioning of assets)

- **Actor**: System (Versioning Service), invoked by the Workspace MCP
  Server after successful writes (SUC-001/SUC-002).
- **Preconditions**: `workspace/` tree exists (Sprint 002) inside the app
  repo's own git working tree (this sprint's default -- see
  architecture-update.md's revision of architecture-001 D7 below; no new
  GitHub remote is created this sprint).
- **Main Flow**:
  1. Over the course of one agent turn, the Workspace MCP Server records
     which filesystem paths changed and which catalog rows were written.
  2. At the end of the turn (or on an explicit flush), the Versioning
     Service stages and commits `workspace/`'s changed paths plus a fresh
     JSON export snapshot of `KnowledgeEntry`/`Collection` rows into
     `workspace/exports/` -- never the live `.db` file (D7).
  3. If a git remote is configured for the workspace path (a new,
     optional config value, unset by default this sprint), the
     Versioning Service pushes after committing.
  4. If no remote is configured, or the push fails (network/auth), the
     local commit still stands; the failure (or the absence of a
     configured remote) does not block the turn from completing.
- **Postconditions**: Every agent turn that wrote to `workspace/` or the
  catalog produces exactly one batched local commit; a push additionally
  occurs only when a remote is configured.
- **Acceptance Criteria**:
  - [ ] A turn that performs two Workspace MCP Server writes (e.g. one
        `move_file`, one `create_knowledge_entry`) produces exactly one
        git commit, not two.
  - [ ] With no git remote configured (this sprint's default), the commit
        succeeds locally and no push is attempted.
  - [ ] With a git remote configured (test-only, a throwaway local bare
        repo standing in for GitHub), the commit is pushed; a forced push
        failure does not raise past the turn boundary or block the user's
        turn from completing (architecture-001 UC-012 E1).
  - [ ] The live `.db` file is never staged or committed by the
        Versioning Service.

---

## Coverage Summary

| SUC | Parent UC(s) | Delivered by issue |
|---|---|---|
| SUC-001 | UC-011 | `workspace-mcp-server.md` |
| SUC-002 | UC-005, UC-007, UC-008 | `workspace-mcp-server.md` |
| SUC-003 | UC-005, UC-006 (loop only) | `agent-runtime-and-chat.md` |
| SUC-004 | UC-013 | `agent-runtime-and-chat.md` |
| SUC-005 | UC-012 | `workspace-git-versioning.md` |

UC-011, UC-012, and UC-013 are fully enabled (mechanism-complete) by this
sprint, though UC-011/UC-013's user-visible surface still requires
Sprint 005's chat UI to be reachable by an actual user. UC-005 and UC-007
are mechanism-complete for correction/retrieval but remain partially open
until Sprint 004 (auto-description feeding richer retrieval) and Sprint
005 (chat UI) land. UC-006, UC-008, UC-010 remain open pending Sprint 004
(image generation, auto-description) and Sprint 005 (UI). This is
expected and tracked, not a gap in this sprint's scope.
