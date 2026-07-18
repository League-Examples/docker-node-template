---
status: done
sprint: 008
tickets:
- 008-002
- 008-003
---

# Chat box: render Markdown and auto-scroll to new responses

## Description

Two problems with the chat box UI:

1. **Markdown not rendered.** The agent returns Markdown in its
   responses, but the chat box displays it as raw markup instead of
   rendering it (headings, lists, bold, code blocks, etc.).

2. **No auto-scroll on response.** After the user hits Return and the
   agent's response arrives, the chat view does not scroll down, so
   the new message is not visible without manually scrolling.

## Acceptance criteria

- Agent responses containing Markdown are rendered as formatted HTML
  in the chat box.
- When a new message (user or agent) is appended, the chat view
  scrolls so the new message is visible.
