---
description: CLASI Software Engineering process dispatcher
---

# /se

Dispatch to the CLASI SE process. Call the appropriate CLASI MCP tool
based on the argument provided.

## Usage

- `/se` or `/se status` — Run project status report
- `/se next` — Determine and execute the next process step
- `/se todo <description>` — Create a TODO file
- `/se init` — Start a new project with guided interview
- `/se report` — Report a bug with CLASI tools
- `/se ghtodo <description>` — Create a GitHub issue

## How to execute

Parse the argument after `/se` and call the matching MCP tool:

| Argument | MCP call |
|----------|----------|
| *(none)* or `status` | `get_skill_definition("project-status")` |
| `next` | `get_skill_definition("next")` |
| `todo` | `get_skill_definition("todo")` |
| `init` | `get_skill_definition("project-initiation")` |
| `report` | `get_skill_definition("report")` |
| `ghtodo` | `get_skill_definition("ghtodo")` |

Pass any remaining text after the subcommand as the argument to the
skill (e.g., `/se todo fix the login bug` passes "fix the login bug"
to the todo skill).

For general SE process guidance, call `get_se_overview()`.
