---
status: in-progress
sprint: '007'
tickets:
- 007-001
---

# New iterations don't appear in the UI until a full page reload

## Description

When the agent generates an image mid-conversation, the `Iteration` row
and the PNG land correctly on the server, but the ProjectDetail page
never refreshes its `iterations` state. `handleToolCallFinished` in
`client/src/pages/ProjectDetail/index.tsx` only reacts to
`search_catalog` results; `generate_image` completions are ignored, so
the OutputPane keeps rendering the iteration list fetched at page load.

Observed live (2026-07-17, project 14 "League of Mentors"): iteration 2
existed on disk (`server/workspace/projects/14/iterations/iter-2.png`)
and in the DB, but the user saw only iteration 1 and concluded the
generation had failed.

## Fix direction

On a successful `generate_image` `tool_call_finished` event (or at turn
end), refetch the project (or apply the new iteration from the tool
result / a turn event) so the new image appears in the active face's
stream immediately, without a manual reload.
