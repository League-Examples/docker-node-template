# Flyerbot — Overview

**Flyerbot is a conversational, AI-driven studio for producing marketing
collateral** — flyers, postcards, Facebook posts, logos, email banners — for
The League of Amazing Programmers. It replaces the ad hoc, Claude-Code-driven
`marketing` repo with a proper web application, but keeps its spirit: the
designer talks, the agent produces.

## The pitch

You open Flyerbot and see two panes. On the left, a browser of everything
that has ever gone into a League marketing asset: logos, stock photos,
prior-art photographs, past projects, named art styles (pop art, manga,
flat poster...), compositions, and layout templates. On the right, a mostly
empty canvas with a chat box at the bottom.

You type: *"I want to make a postcard for Robot Riot, pop-art style, arena
action."* You drag in a reference photo of the robots and an example
postcard template from the left pane. Claude — the system's brain — reads
the project's chat, consults a persistent knowledge base of style and
composition prompts, assembles a prompt, and calls the GPT image generator
to produce the artwork. You look at it, say "make the impact starburst
bigger," and it iterates. When you're happy, Claude generates a small
web form so you can type the exact postcard headline and body copy into
labeled text-region boxes, and the system composites the final piece.

There are almost no buttons. **The interface is a conversation.** The agent
has real authority — it can reorganize the asset library, update the style
knowledge base when you correct it ("no, pop art doesn't use gradients"),
write one-off Python or web-page helpers, and commit everything to git — but
its filesystem and process access is moderated through an MCP server rather
than a raw shell, and its habits stay deliberately informal: this is "not
formalizing this too much," the same loose, prompt-as-data, agent-first
mechanism the predecessor `marketing` app already proved out.

## Who it's for

League staff producing marketing materials, working concurrently in a
single shared environment, authenticating with their Google/Gmail accounts
only. It runs on the flyerbot repo's existing React + Express + Prisma/SQLite
template, replacing the Pike13 integration and most of the current sidebar
with the two-pane chat-first layout described above.

## What this document is not

This is a one-page companion for orientation. It does not replace
`specification.md`, which preserves the full stakeholder detail, or
`usecases.md`, which enumerates the concrete user-facing flows. Read those
for anything beyond a first impression.

## Phases (context, not yet planned)

1. This specification (current).
2. Wireframe mockups — simple, real web pages, not full builds.
3. Visual design.
4. Build on the existing React/Express template.

Only phase 1 is in scope for this sprint cycle of planning.
