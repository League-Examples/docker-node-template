---
id: '002'
title: Render assistant chat bubbles as Markdown (react-markdown)
status: done
use-cases:
- SUC-017
depends-on: []
github-issue: ''
issue: chat-box-markdown-rendering-and-scroll.md
completes_issue: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Render assistant chat bubbles as Markdown (react-markdown)

## Description

`ChatPanel.tsx` currently renders every bubble's `message.text` as a
literal string (`{message.text}`), so agent responses containing
Markdown (headings, lists, bold, code blocks) show up as raw
`#`/`*`/backtick characters instead of formatted HTML
(`clasi/issues/chat-box-markdown-rendering-and-scroll.md`, criterion 1).
No Markdown-rendering or sanitization dependency exists in
`client/package.json` today.

Per sprint 008's Architecture (Design Rationale, "react-markdown for
Markdown rendering"): add `react-markdown` as a client dependency and
use it to render **assistant bubbles only** — user-authored messages
stay plain text, since the issue and this sprint's Use Cases (SUC-017)
only call out agent responses. `react-markdown` parses Markdown directly
into React elements; it never touches `innerHTML` and does not render
raw HTML embedded in the Markdown source by default (no rehype-raw
plugin is added), so no separate sanitizer dependency (e.g. DOMPurify)
is needed — this is the deliberate, safer default for model-generated
text discussed in the architecture rationale.

**Explicitly out of scope for this ticket**: GFM extensions (tables,
strikethrough via `remark-gfm`) — the issue's acceptance criteria only
call out headings/lists/bold/code, which `react-markdown`'s default
commonmark parsing already covers; Markdown rendering for user messages;
the auto-scroll behavior (ticket 003, same issue, separate concern).

## Acceptance Criteria

- [x] `react-markdown` is added to `client/package.json` dependencies.
- [x] Assistant (`from === 'assistant'`) bubble text renders through
      `react-markdown` instead of the literal `{message.text}` string.
- [x] Headings, lists, bold/italic text, and fenced code blocks in an
      assistant response render as the corresponding formatted HTML
      elements (e.g. `<h1>`/`<ul>`/`<strong>`/`<pre><code>`), not literal
      Markdown syntax characters.
- [x] Plain-text (non-Markdown) assistant responses continue to render
      correctly with no literal formatting artifacts introduced (e.g. a
      response with no Markdown syntax reads exactly as before).
- [x] User bubbles are unaffected — still rendered as plain text, not
      passed through `react-markdown`.
- [x] No raw HTML embedded in agent-authored Markdown text is rendered
      as live markup (e.g. a response containing a literal `<script>` or
      `<img onerror=...>` string renders as inert text, not executed
      markup) — verifies the "no rehype-raw, no dangerouslySetInnerHTML"
      safety property from the architecture rationale.
- [x] Existing bubble styling (Tailwind classes for the message pill,
      `max-w-[80%]`, background/text color per sender) is preserved —
      `react-markdown`'s rendered elements sit inside the existing
      bubble wrapper, not replace it.

## Testing

- **Existing tests to run**: `client`'s Vitest suite covering
  `ChatPanel.tsx`, including message-history rehydration
  (`chatMessagesToBubbles`) and the SSE `message` event handling
  (`appendBubble`) — confirm they still pass with bubbles now routed
  through a Markdown renderer.
- **New tests to write**:
  - An assistant message containing `**bold**`, a `- list item`, a `#
    Heading`, and a fenced code block renders the corresponding DOM
    elements (query by role/tag, not by literal text match on the
    Markdown syntax characters).
  - A plain-text assistant message (no Markdown syntax) renders
    identically to before (no stray formatting).
  - A user message containing Markdown-like syntax (e.g. `**not bold**`)
    renders as literal text, confirming user bubbles are not passed
    through the renderer.
  - An assistant message containing a raw HTML-like string (e.g.
    `<img src=x onerror=alert(1)>`) renders as inert text, not an
    executed `<img>` tag — asserts no script/handler execution and no
    `dangerouslySetInnerHTML` path was introduced.
- **Verification command**: `npm run test` (or the client's existing
  Vitest script) from `client/`; `npm run build` to confirm the new
  dependency doesn't break the production build.
