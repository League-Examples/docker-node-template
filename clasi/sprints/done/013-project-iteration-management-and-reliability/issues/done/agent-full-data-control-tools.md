---
status: done
sprint: '013'
tickets:
- 013-004
- 013-005
---

# Give the agent full data-control tools (projects and iterations)

## Description

The chat agent should be able to manage project and iteration data
directly through its tools. Required capabilities:

- **Delete a project**
- **Archive a project** (soft state, not deletion)
- **Rename a project** (change its title)
- **Delete an iteration**
- **Move an iteration between the front and back streams**

## Notes on current state (to scope, not prescribe)

Some of these already have partial infrastructure — the sprint should
audit `WORKSPACE_TOOL_DEFINITIONS`/`DEFAULT_TOOL_HANDLERS` in
`server/src/agent/turn.ts` and `server/src/agent-mcp/catalogTools.ts`
before adding anything:

- **Rename**: `create_project` already supports updating an existing
  project's title (id + version), and sprint 007 auto-injects
  `ownerUserId`/`version`. This may just need to be reliably reachable /
  named as a rename action (see also
  agent-falsely-refuses-rename-parrots-history.md — the agent currently
  won't call it).
- **Move front/back**: `update_iteration` already sets an iteration's
  `role` — moving between streams is a role change. Confirm it's exposed
  and works for reassigning role (not only `accepted`).
- **Delete iteration**: a REST route exists
  (`DELETE /api/projects/:id/iterations/:iterId`) but there may be no
  agent tool for it — likely needs a new `delete_iteration` tool.
- **Delete / archive project**: `Project.status` exists (e.g. `active`)
  — archive = a status change; deletion likely needs a new tool and a
  decision on cascade (iterations, chat, assets) and whether the
  workspace files are removed.

## Design considerations

- Destructive actions (delete project, delete iteration) should be
  guarded — confirm intent, and decide whether deletes are soft
  (archive/tombstone) or hard (row + workspace files removed).
- Keep the internal-ID guardrail (sprint 007): the agent must resolve
  targets from context (project it's scoped to, iteration seq numbers
  per agent-iteration-number-grounding.md), never ask the user for DB
  IDs.
- Scope actions to the authenticated user's own projects.

## Acceptance criteria

- The agent has working tools to: rename a project, archive a project,
  delete a project, delete an iteration, and move an iteration between
  the front and back streams.
- Destructive tools confirm/guard intent and are scoped to the caller's
  own data.
- Each new/exposed tool has test coverage; the agent references
  iterations by their UI seq number and never asks for internal IDs.
