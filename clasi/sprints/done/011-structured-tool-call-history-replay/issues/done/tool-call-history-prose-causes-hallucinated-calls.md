---
status: done
sprint: '011'
tickets:
- 011-001
- 011-002
---

# Model hallucinates tool calls because tool history is replayed as prose

## Symptom (live, project 14 "League of Mentors", 2026-07-19)

User asked for image edits several times. The chat says it's sending the
request to the image generator, but no new iteration appears — stuck on
iteration 4 across four edit requests. The agent even narrates a
successful result (`iter-9.png`) that does not exist.

## Diagnosis (confirmed at data + code level)

- DB: project 14 has exactly 4 iterations (max seq 4); no iter-5..9 on
  disk or in the `Iteration` table.
- The failing assistant chat messages (ChatMessage id 72, 74) contain
  the text `Called tool "generate_image" with args {...} -> result
  {"imagePath":"projects/14/iterations/iter-9.png",...}` in their
  **content**, while their **`toolCalls` column is empty**. Real tool
  rounds DO populate `toolCalls` (9 such rows exist in the DB), so an
  empty `toolCalls` + prose "Called tool …" content means the model
  wrote the tool-call narration as plain text and never emitted a real
  function call. `iter-9` is fabricated — impossible with only 4 real
  iterations.
- Root cause: `chatMessageToProviderMessage` in
  `server/src/agent/turn.ts` replays each past assistant tool round to
  the model as free-form assistant TEXT:
  `Called tool "<name>" with args <json> -> result <json>` — deliberately
  NOT as structured tool_use / tool_result provider content (there's a
  doc comment defending this: live provider-call ids "no longer exist
  once a turn is over"). Once several of these accumulate in a long
  conversation, the model imitates the format and emits the sentence
  itself instead of calling the tool. No call → no image → no iteration.

This is why it surfaced now: project 14 is a long, edit-heavy
conversation, so many prose-rendered tool rounds had accumulated in the
replayed history. It is not specific to the sprint-010 edit path — any
generation would hallucinate once the prose pattern dominates history.

## Fix direction

Reconstruct past tool rounds as proper structured provider messages —
an assistant `tool_use` block plus a matching `tool_result` block —
minting fresh synthetic call ids at replay time, instead of the
"Called tool …" prose. The persisted `toolCalls` JSON already carries
`{name, args, result}` per call, so the structured history can be
rebuilt from it. Verify the `ProviderAdapter`/`ProviderMessage` contract
supports tool_use/tool_result in replayed history (the live in-turn
round already uses this shape), and that the Anthropic adapter accepts
reconstructed ids.

## Acceptance criteria

- After multiple prior tool rounds in a conversation, a new
  image/edit request emits a REAL `generate_image` tool call (the
  `toolCalls` column is populated) and creates a new Iteration — no
  fabricated "Called tool … -> result …" prose in assistant content.
- A regression test reproduces the failure: given a history containing
  several past tool rounds, the provider receives them as structured
  tool_use/tool_result content and the model's next turn issues a real
  tool call (assert against a mock provider that inspects the replayed
  message shape).
- Existing turn/history tests still pass.

## Note

Knowledge-worthy: this is a non-obvious failure mode of replaying tool
history as prose. Capture via project-knowledge when fixed.
