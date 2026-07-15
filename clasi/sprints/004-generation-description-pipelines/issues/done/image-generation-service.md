---
status: done
sprint: '004'
tickets:
- 004-001
- 004-002
---

# Image generation service: gpt-image-2 direct, iterations never overwritten

Architecture-001 §Image & Vision Service: OpenAI direct generation
(`/v1/images/generations`, `/v1/images/edits` with reference images),
model from `IMAGE_MODEL` (gpt-image-2), keys via dotconfig. Each result
lands as a new project iteration (never overwritten), shown in the
iterations view. OpenRouter path reserved for vision evaluation (see
asset-auto-description issue). Spend logging, no caps for now (Q&A).

Refs: architecture-001.md; specification.md §9 grounding, §14.
