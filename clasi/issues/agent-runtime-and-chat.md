---
status: pending
sprint: '003'
---

# Agent runtime (Claude Agent SDK) + per-project chat

Architecture-001 §Agent Runtime: Claude Agent SDK loop hosted by the
Express server (NOT Claude Code — stakeholder Q7), stateless between
turns, per-project chat sessions persisted to the DB, streaming
responses to the client chat panel. Prompt assembly consults the
knowledge store (never ad hoc — spec §8) and traces which entries it
drew from. Agent tools connect via the workspace MCP server only.

Refs: architecture-001.md; specification.md §8, §9, §11; UC-003/005/007.
