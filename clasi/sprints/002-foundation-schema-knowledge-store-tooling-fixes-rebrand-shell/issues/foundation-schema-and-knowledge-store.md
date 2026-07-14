---
status: in-progress
sprint: '002'
tickets:
- 002-003
- 002-004
- 002-005
- 002-006
---

# Foundation: Prisma/SQLite schema, one knowledge store, vector search, workspace layout

Implement architecture-001 §Data Model: projects/subprojects, iterations
(with exclusive `accepted` flag and exclusive front/back roles — see
stakeholder wireframe rounds 6-7), assets/collections with
classification+description+tags, the single polymorphic `KnowledgeEntry`
store (styles/palettes/compositions/layouts/rules) with
`KnowledgeCorrection` diff rows, chat transcripts, and locking columns
(optimistic version). sqlite-vec + FTS5 indexes with brute-force-cosine
fallback. Workspace filesystem layout with `_dir.json` descriptors
(DB-canonical). Seed styles/layouts from the predecessor marketing repo.

Refs: docs/architecture/architecture-001.md; specification.md §5, §8, §10, §12.
