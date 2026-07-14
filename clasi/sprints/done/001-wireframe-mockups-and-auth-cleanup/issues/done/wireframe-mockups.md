---
status: done
sprint: '001'
tickets:
- '003'
- '004'
- '005'
- '006'
---

# Wireframe mockups for the Flyerbot two-pane UI

Build wireframe mockups for Flyerbot as simple, real web pages — "real web
pages and real applications, but just mockups" (stakeholder) — inside the
existing React repo structure (`client/`). No backend logic; static/stub data
is fine.

## Scope

Mockup pages for:

1. **Two-pane main layout** — left pane: browser for assets, examples,
   styles, and previous projects; right pane: project-output view in the top
   three-quarters, chat window below.
2. **New-project flow** — blank right pane with project-details header (the
   guideline questions: what style, what output type, what are you trying to
   achieve), empty outputs area, chat text box at bottom.
3. **Postcard text-region edit form** — the agent-generated web page where
   the user enters text for JSON-specified bounding-box regions.
4. **Google-only login page** — replacing the current multi-provider login.

## Constraints

- Follow the stakeholder's UI philosophy: conversation, not buttons; the
  fixed portion of the UI is the two-pane structure.
- Sidebar largely goes away ("not much of a sidebar menu... some rejiggering
  there").
- Wireframe fidelity: simple, structural, not visual design (design is a
  later phase).

## References

- `docs/design/specification.md` (esp. §2 layout, §7 new-project flow,
  §11 agent-authored surfaces, §13 process directives)
- `docs/design/usecases.md`
- Predecessor galleries in `/Volumes/Proj/proj/league-projects/infrastructure/marketing/projects/`
