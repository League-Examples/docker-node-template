---
status: done
sprint: '004'
tickets:
- 004-003
- 004-004
---

# Auto-generate asset descriptions on collection commit; semantic search/filter of the library

Stakeholder addition (2026-07-13, during initiation-doc review): when an
asset is committed into the collections, run it through a model (vision) to
generate a rich textual description — not tags — covering at least:

- Is it a real photograph?
- Is it a logo?
- What's its style?
- Does it show a real person, or was it AI-generated?

This description powers semantic retrieval so the user can ask things like
"show me the assets with robots in them," "show me a style that conveys a
sense of wonder," or "a young girl looking at a computer screen," and the
left-pane browser view filters accordingly.

## Interaction model

- Primary path is conversational: the user asks the chat to filter the
  browser view.
- Secondary path: possibly a filter/search bar at the top of the left pane.

## Notes / grounding

- Predecessor precedent: `images/catalog.json` in the marketing repo already
  carries per-image `description`, `style`, `people`, `tags`, `role`, and is
  searched by `search-catalog`. This feature formalizes and enriches that:
  generation happens automatically at commit-into-collection time.
- The exact description schema is open — stakeholder: "we'll come up with
  something." Needs design (structured fields vs free text vs both).
- Vision-model choice ties to existing config (OpenRouter / `OPENROUTER_MODEL`,
  predecessor used Gemini-class vision via OpenRouter for rubric evaluation).

## References

- `docs/design/stakeholder-spec-2026-07-13.md` §1 "Asset auto-description on commit"
- `docs/design/specification.md` §5 (collections), §3 (left-pane browser)
