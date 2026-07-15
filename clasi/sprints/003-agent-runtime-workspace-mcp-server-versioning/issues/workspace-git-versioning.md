---
status: in-progress
sprint: '003'
tickets:
- 003-001
---

# Workspace git versioning + GitHub

Architecture-001 §Versioning Service: the shared workspace (assets,
projects, knowledge-store JSON export snapshots) lives in its own git
repo; commits auto-batched per chat turn (proposed default, Q&A #3
git-timing still open); GitHub push. Ops precondition: the app repo's
own remote still points at the docker-node-template — needs a flyerbot
repo (stakeholder action) before pushes.

Refs: architecture-001.md; specification.md §12.
