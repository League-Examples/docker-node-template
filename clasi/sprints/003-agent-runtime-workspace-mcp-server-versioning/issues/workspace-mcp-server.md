---
status: in-progress
sprint: '003'
tickets:
- 003-002
- 003-003
---

# Workspace MCP server: moderated fs + typed catalog tools + locks

Architecture-001 §Workspace MCP Server: in-process MCP server exposing
file read/move/create-directory/stat (no shell), typed catalog
operations (create/update knowledge entries, propose-correction,
add-to-collection), and the Lock table for file edits / per-project turn
serialization. Reads unmoderated by design. This is the only path by
which the agent touches the workspace.

Refs: architecture-001.md; specification.md §9; stakeholder Q&A (Q4, Q5).
