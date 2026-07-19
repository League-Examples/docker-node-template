---
status: in-progress
sprint: '012'
tickets:
- 012-001
---

# Agent must trust the UI iteration number and know each iteration's content

## Problem (live, project 14, 2026-07-19)

When the user references "iteration 3," the agent hedges that "the file
names and the count you see may not line up cleanly" and then fabricates
a description of iteration 3's content ("seven kids, shoulder-to-shoulder
lineup"). The user wants a guarantee: "when I say iteration 3, it is the
one labeled iteration 3."

## Findings (verified against the DB and code)

The numbering is ACTUALLY consistent — the agent's hedge is a
hallucination:

- The UI labels each iteration `Iteration {seq}`
  (client/src/pages/ProjectDetail/OutputPane.tsx line ~193), using the DB
  `Iteration.seq`.
- The agent resolves a numeric `editSourceIteration` by exact seq match:
  `findFirst({ projectId, seq })` in `resolveEditSourceIteration`
  (server/src/agent/turn.ts). Same field, same value.
- Project 14 data is clean: iterations seq 1..5, all role `front`, no
  gaps, no duplicate seqs. "Iteration 3" in the UI === the row the agent
  edits for `editSourceIteration: 3`.

Two real gaps drive the bad behavior:

1. **No content grounding.** The agent's PROJECT CONTEXT
   (`buildProjectContextBlock` / `summarizeStream` in turn.ts) gives the
   model only bare seq numbers plus `accepted`/`most recent` tags — and
   the model cannot see the images. With nothing to anchor a number to,
   it invents descriptions of what each iteration contains, eroding trust
   in the numbering.
2. **No authoritative statement that the UI number IS the seq.** Nothing
   in the system prompt tells the model that the number the user says is
   exactly the "Iteration N" badge in the UI and equals the seq it
   resolves against — so it hedges about filenames/counts not lining up.

## Desired behavior

- When the user says "iteration N," the agent treats N as the seq shown
  as the "Iteration N" badge in the UI and acts on that exact iteration —
  no hedging about mismatched filenames or counts.
- The agent has enough per-iteration grounding to know which image each
  number refers to, so it can confirm ("iteration 3 is the one where …")
  without fabricating.

## Fix direction

- Surface per-iteration content into PROJECT CONTEXT keyed by seq. The
  DB already stores `Iteration.promptUsed` (the prompt that created each
  iteration, incl. edit instructions) — include a short form per seq so
  the model can ground each number. (Optional/heavier alternative: a
  stored vision description via the existing `classifyAndDescribe` in
  imaging.ts; weigh cost/latency in planning. promptUsed is the cheap
  default and is already persisted.)
- Add a system-prompt statement: the iteration number the user
  references is the `Iteration N` seq shown in the web UI; resolve
  directly to it via `editSourceIteration`, and never claim the UI
  numbering and the internal numbering diverge (they don't). If the model
  genuinely cannot identify an iteration, it should say so plainly rather
  than fabricate a description.
- `promptUsed` must actually be populated for edit-created iterations
  too — verify `create_iteration`/realImageVisionClient records it for
  the sprint-010 edit path, not just fresh generations.

## Acceptance criteria

- PROJECT CONTEXT lists each iteration by its seq with a short,
  accurate content hint (from `promptUsed`), for the active stream.
- A regression/unit test asserts the context block ties each seq to its
  stored prompt summary, and that "iteration N" maps to seq N.
- The system prompt instructs the model to treat the user's iteration
  number as the UI seq and not to fabricate iteration content or hedge
  about numbering divergence.
- Existing turn/context tests still pass.
