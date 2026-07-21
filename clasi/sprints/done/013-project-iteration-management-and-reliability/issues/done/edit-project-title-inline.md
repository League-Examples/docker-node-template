---
status: done
sprint: '013'
tickets:
- 013-003
---

# Click the project title in the iteration view to edit it

## Description

In the iteration/project-detail view, the project title should be
clickable and editable inline. Clicking the title (in the header,
`client/src/pages/ProjectDetail/ProjectDetailsHeader.tsx`) turns it into
an editable field; saving persists the new title via the existing
project-update path.

## Acceptance criteria

- Clicking the project title in the iteration view makes it editable.
- Editing and confirming saves the new title (persists to the server and
  updates the header without a full reload).
- Canceling/escaping leaves the title unchanged.
