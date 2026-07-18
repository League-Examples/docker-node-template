---
status: done
sprint: '007'
tickets:
- 007-002
- 007-003
---

# Agent asks the end user for internal IDs (ownerUserId) when project tools fail

## Description

Observed live (2026-07-17, project 14): the in-app agent tried to rename
"Untitled project" to "League of Mentors", the `create_project`
update/create call failed (it requires `title` + `ownerUserId` to create,
or `id` + `version` to update), and the agent then asked the end user
"What's the owner user ID?" — an internal database ID no user should
ever see or know.

Two layers to fix:

1. **Context**: the turn already runs on behalf of an authenticated user
   for a specific project. The turn controller / tool layer should
   supply `ownerUserId` (and the current project `version` for updates)
   automatically, so the model never needs to ask for them. Renaming an
   existing project must not require the model to know any ID beyond
   the projectId it is already scoped to.
2. **Prompting/guardrail**: the system prompt should instruct the agent
   never to ask users for internal identifiers; on a tool failure it
   should surface a plain-language error instead of improvising a
   data-collection question.

Also note the failure was silent for a long time — the rename failed on
the first turn but the user only learned of it when asking why the
project name was wrong. Tool failures that change expected user-visible
state should be reported in the moment.
