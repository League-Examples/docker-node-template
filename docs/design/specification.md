# Flyerbot — Feature Specification

Source: stakeholder verbal specification, 2026-07-13 (see
`.clasi/design/stakeholder-spec-2026-07-13.md` for the near-verbatim
transcript this document is built from). This document reorganizes that
transcript for clarity and grounds it in facts about the predecessor
`marketing` app and the current `flyerbot` repo template. It preserves every
behavior, edge case, and philosophy statement the stakeholder gave — nothing
here should read as a summary or a softened paraphrase of the original.

Process note (stakeholder's own words): *"we're going to talk about what the
application is, build a spec for it, then design it, then build it."* This
document is the "build a spec" step. Next come wireframe mockups (real,
simple web pages — just mockups), then design, then the build on the
existing React site structure in this repo.

---

## 1. Vision

Flyerbot is a web application for creating flyers and other marketing
content using AI, modeled closely on an existing application at
`/Volumes/Proj/proj/league-projects/infrastructure/marketing`. The core idea:
you create a **project**, and the project is for building marketing
collateral with AI — primarily, overwhelmingly, using **Claude to drive the
system**, and the **GPT image generator** to create the images.

**The majority of the interface is the user just talking to Claude. There's
not a whole lot of clicking to do things.**

## 2. Screen layout — two panes

- **Left side**: a browser for assets, examples, styles, and previous
  projects.
- **Right side**: a view of the project outputs on the top three-quarters;
  below that is a chat window.

A portion of the UI is fairly fixed: the left-side browser window and the
right-side chat box and view. Beyond that fixed frame, **most of it should
be driven by conversation, not buttons.**

The current repo's sidebar (`client/src/components/AppLayout.tsx`, a fixed
240px dark sidebar with `MAIN_NAV` currently holding just "Home") is
expected to be rejiggered — the stakeholder does not expect much of a
sidebar menu to survive; the two-pane layout replaces most of that role.

## 3. Left-side browser

In the marketing directory you see past projects, logos, images, stock
images, prior-art photographs, all sorts of stuff. The left pane lets the
user browse through that, **because these are the things used to tailor the
assets being created.**

When the user wants to create a flyer, they might bring in an image that:

- specifies the style, or
- is an example of a style, or
- is an example of a set scene they want to replicate in the image, or
- is a template from a flyer.

**Each of these things can have an image, a prompt, or both.** For some of
the prompts you might generate an example image; the prompt is a portion of
a prompt that describes a style.

### Grounding: what the predecessor's asset library actually looks like

The `marketing` repo's `images/` directory is a shared asset library (logos,
components, examples, photos, stock_images, prior-art), indexed by
`images/catalog.json`. Each entry carries a description, style, people
count, "about programming" / "about robotics" flags, a `ai_altered` flag,
free-text tags, its path, mtime, and a `role` (e.g. `"final"`). This
catalog structure — descriptive metadata per asset, not just a filename —
is the kind of thing the left-side browser needs to expose and search
against; Flyerbot should carry the concept forward, likely backed by SQLite
rather than a flat JSON catalog.

### Semantic search and conversational filtering (addition, 2026-07-13, during doc review)

The auto-generated commit-time descriptions (§5) power semantic retrieval
over the left-pane library. The **primary** interaction is conversational:
the user asks Claude, in chat, things like "show me the assets with robots
in them," "show me a style that conveys a sense of wonder," or "a young
girl looking at a computer screen," and the left-pane browser view filters
to match. A filter/search bar at the top of the left pane, like a
conventional search box, is a **possible secondary path** — most of the
time the stakeholder expects users to just talk to the AI rather than type
into a search field, consistent with §11's "conversation, not buttons"
philosophy.

## 4. Styles

When we talk about **pop art, flats, poster, or manga**, we're talking about
an **art style**. An art style has associated text that the AI can use to
generate the image.

### Grounding: predecessor style library

The `marketing` repo defines styles as `app/prompts/styles/<style>/` folders,
each holding a `positive.md` and a `negative.md`. Ten styles exist today:
`pop-art`, `comic-book`, `manga`, `dragon-ball-z`, `technical-blueprint`,
`8bit-video-game`, `flat-poster`, `graphic-novel`, `type-sample`,
`type-sample-8bit`. A style's positive prompt is real, opinionated prose —
e.g. pop-art's positive.md specifies Ben-Day dot halftones, a narrow flat
primary palette, brand guardrails about how the League's robots and student
"heroes" must be rendered, and lettering rules (at most one burst balloon,
at most one comic sound effect). This is the shape of "associated text that
the AI can use to generate the image" the stakeholder is describing — it is
not a one-line keyword, it is a structured brief.

The predecessor also has parallel libraries the stakeholder's spec implies
Flyerbot should carry forward as siblings of "style":

- `app/prompts/palettes/` — named color-palette prompt files with a swatch
  viewer.
- `app/prompts/compositions/` — roughly 25 camera/staging prompt files
  (e.g. `arena-action`, `hero-pose`, `character-portrait`, `multi-panel`).
- `app/layouts/` — output-format prompt files (`postcard-4x6`,
  `full-page-flyer`, `business-card`, `single-event-facebook`,
  `peachjar-multi-event-flyer`, `template-content-areas`) plus SVG zone maps
  used as image-to-image layout guides.
- `app/rubrics/` — per-style and per-layout evaluation checklists (used to
  score generated images against the brief).

## 5. Collections

There is a **collection**: things get into the collection of examples for
several distinct reasons, all of which the system must support:

1. Somebody added them directly.
2. They found some stock art they want to use — they **drag it into the
   stock-art group**, or they **drag it into the main window and tell the
   chat session "go put this in the stock art collection."**
3. Maybe they **just uploaded it**.
4. A lot of things get in there because **there was a discussion in a
   project and the user said "please add this to the collections."**

All four intake paths (drag-to-group, drag-to-chat-with-instruction, direct
upload, and agent-initiated add-from-project-discussion) are first-class,
not just the obvious upload button.

### Automatic description on commit (addition, 2026-07-13, during doc review)

Whenever an asset is committed into a collection — through any of the four
intake paths above — it is run through a vision model to generate a
**classification, a rich textual description, and tags**. This reverses
the original text of this section: the stakeholder had initially ruled out
tags as the format, but on resolving §16 open question 8 (2026-07-13)
clarified that tags are in scope after all — "you can use tags. You're
going to classify the image, produce a description, and then there are
tags." The tag vocabulary itself is still to-be-determined. At minimum,
the classification/description must cover:

- Is it a real photograph?
- Is it a logo?
- What's its style?
- Is any person shown real, or was it generated by AI?

The point of the description is retrieval: the user should be able to ask,
in chat, things like "show me the assets with robots in them," "show me a
style that conveys a sense of wonder," or "a young girl looking at a
computer screen," and get back matching assets rather than having to browse
folders by hand. See §3's "Semantic search and conversational filtering"
subsection for the consumption side of this same feature.

### Grounding: predecessor precedent and where this formalizes it

The predecessor's `images/catalog.json` already carries per-image
`description`, `style`, `people`, `tags`, and `role`, searched via the
`search-catalog` CLI subcommand (see §3 grounding above). This feature
formalizes and extends that existing mechanism: description generation
becomes **automatic and mandatory at commit-into-collection time** — driven
by a vision model rather than hand-maintained — instead of a manually
curated flat-JSON catalog field.

## 6. Projects

A **project** is an effort to create specific outputs. Examples the
stakeholder gave: a flyer for a Facebook post, a template for postcards, or
just a logo.

- You can also create **subprojects**.
- A project produces one or more images — **usually at most two** (front and
  back of a postcard). Most of the time it's just one: a Facebook post, a
  flyer, or a logo.
- The project is created through **a series of updates on the right side.**

### Grounding: predecessor project structure

The `marketing` repo's `projects/<slug>/` folders hold: `project.json`
(full config plus the complete iteration history — style, composition,
palette, layout, theme, scene description, model, negative prompt, etc.),
`state.json` (a version counter driving gallery live-reload), an
auto-reloading `index.html` gallery, a `sources/` folder for
dragged-in reference material, and `iterations/iter-NNN.png` files that are
**never overwritten** — every iteration is kept. Postcard-type projects add
`postcard-content.json`, `postcard.html`, and `postcard.pdf`. A
`projects/catalog.json` indexes all projects, mirroring the images catalog.
Flyerbot's project model should preserve the "never overwrite an iteration"
guarantee and the config-plus-history shape of `project.json`, moved onto
SQLite rather than flat files where that helps multi-user concurrency (see
§11).

## 7. New-project flow (right pane)

You say **"I want to start a new project"** — either told to Claude in chat
or via a new-project button somewhere — and you get a blank view laid out,
top to bottom, as:

1. **At the very top, project details.** It might ask you for details about
   what the project is: What style do you want? What are you trying to
   create? Is this a Facebook image? Is this going to be a logo? Is it going
   to be pop art? Comic book? What are you trying to achieve? **These are
   general guidelines for what you're doing.**
2. **Below that is empty space** (no outputs created yet).
3. **Below that is the chat text box**: e.g. "Hey, I want to make a poster.
   It's got these things in it."

Once outputs exist, they populate the space between the project-details
header and the chat box (the "top three-quarters" view described in §2).

### Dragging in references

You drag things in from the left side — search around in there. Concretely:

- You might drag in a **stock-art picture that lays out the composition**
  of the image you're trying to create.
- Maybe you pull in an **example of the logo** you want.
- Or a **template that has borders and text spaces around the edge of the
  postcard**.

Each dragged-in item is a reference the chat/agent can reason about — as
style, as composition, or as a structural template — consistent with §3's
"each of these things can have an image, a prompt, or both."

## 8. Prompt assembly & the knowledge database

You chat with the AI, and **the AI assembles a prompt based on your input —
but not ad hoc every time.** It takes what you've talked about and consults
its library of:

- things that the user has updated,
- additional knowledge the system has gained, and
- things that have been added.

**Users make requests, so there might be a database of things people have
told the AI to do or not do.**

There's also a **database of prompts** answering questions like:

- What does it mean to be a postcard?
- What does it mean to be pop-art style?
- What does it mean to be 1940s Max Fleischer style?

**Resolved (2026-07-13, §16 open question 2)**: these are **one knowledge
store**, not separate mechanisms — "there's basically one knowledge store,
but you've got to be smart about how to find things — good indexing." The
lightweight vector search called out in §12/§16 open question 1 is aimed at
this same retrieval problem.

### Persistent learning (style correction)

**If the AI gets a style wrong, the user corrects it, and the AI updates
that style to be more correct.** This is explicit persistent learning, not
a one-off in-conversation fix: the correction must change the stored style
definition so future projects benefit, not just the current image.

### Grounding: prompt-as-data mechanism to carry forward

The predecessor's central mechanism, worth preserving deliberately:
**prompt-as-data**. Prompt text lives only in `.md` files (or
`project.json`), never hardcoded in application logic, and those files are
re-read on every call — there is no compiled or cached copy that could go
stale relative to what a user edited. An `assemble-prompt` step concatenates
style + palette + composition + layout text, and then **the agent rewrites
that concatenation into one voice** rather than shipping the raw
concatenation to the image model. Flyerbot's "database of prompts" and
"database of things people have told the AI to do or not do" are natural
extensions of this same pattern — structured, editable, agent-legible
records. Note one deliberate departure from the predecessor for Flyerbot
itself, per §16 open questions 1 and 3 (resolved 2026-07-13): this content
lives **in the database**, not `.md` files, and style corrections are
proposed as a diff against the stored record rather than a hand-edited
file.

## 9. Agent capabilities & moderation

The agent has **fairly complete control over the file system** for this
system, and also a database — **a local database, probably SQLite**.
**Everything is version-controlled (git)**, which may be behind the scenes,
or maybe something the agent can control.

The existing app in the marketing directory is largely driven by Claude Code
and is **very ad hoc. We're going to keep that. We're not formalizing this
too much.**

**Resolved (2026-07-13, §16 open question 7)**: "ad hoc" describes the
*workflow philosophy* to keep, not the runtime. Flyerbot is **not using
Claude Code** as its own runtime — "we are not using Claude Code anymore."
Its agent runtime is an **agent loop built on the Claude Agent SDK**,
distinct from the Claude Code sessions used to build Flyerbot itself.

Users won't just ask to create a new image. They'll ask to:

- **reorganize directory structures**, and
- **update the database** ("hey, let's go add a new style").

**It's fairly flexible about what the agent is allowed to do** — but **that
should be moderated by an MCP server**, so the agent can't do everything.
The MCP server will allow:

- reading and moving files,
- creating directories,
- maybe a few other stat operations,

but **probably not running full Unix commands** on the container.

**Resolved (2026-07-13, §16 open question 4)**: within the style
collection, the agent may freely create and reorganize entirely new
things — not limited to predefined categories. Directories are expected to
carry a JSON file describing their contents, or a corresponding database
entry; either way, the agent's reorganization of that structure should be
accommodated ("that whole thing can get reorganized by an agent. It should
play just fine").

**Resolved (2026-07-13, §16 open question 5)**: locking focuses on two
surfaces — the database, and this MCP server (the file-editing surface).
The exact conflict-resolution mechanism (last-write-wins, optimistic-lock
rejection, surfaced conflict) is still an implementation decision within
that scope.

### Grounding: predecessor's MCP shape

The predecessor deliberately keeps its MCP surface thin: the MCP server
exposes only `restart_web_server` and a generic `run_cli(args)`, with all
real logic living in an editable `cli.py` (~1600 lines, ~23 subcommands) —
so behavior can be changed by editing a file rather than reconnecting MCP. A
separate static web-server daemon (port 31337) serves the live-reloading
project galleries outside of MCP entirely.

The stakeholder's description of Flyerbot's MCP surface is narrower and more
explicit than the predecessor's `run_cli` escape hatch: read/move files,
create directories, "a few other stat operations" — and **explicitly not**
arbitrary Unix commands. This is a tightening relative to the predecessor,
not a straight carry-forward, and should be treated as the binding
constraint for Flyerbot's MCP moderation layer.

### Grounding: predecessor image generation and evaluation

- Image generation is direct to OpenAI (`/v1/images/generations`, and
  `/v1/images/edits` when reference images are attached), model
  `gpt-image-2`, quality `high`, sizes 1536x1024 / 1024x1536 / 1024x1024.
- OpenRouter is used for **vision evaluation** — scoring generated images
  against the per-style/per-layout rubrics in `app/rubrics/`. (An older
  `SKILL.md` claims OpenRouter does generation; `CLAUDE.md`, `PROCESS.md`,
  and `cli.py` are authoritative and say otherwise — generation is OpenAI
  direct, OpenRouter is evaluation only.)
- Config values pulled from the marketing repo's dotconfig-managed
  `.env` (secret values are never to be copied into docs — only the
  variable names): secrets `OPENROUTER_API`, `OPENAI_API_KEY`; public
  `IMAGE_MODEL=gpt-image-2`, `OPENROUTER_MODEL=deepseek/deepseek-v4-pro`.
  See §12 for how these map onto Flyerbot's own dotconfig cascade.

### Grounding: chroma-key template pipeline

For template-driven outputs (e.g. postcards), the predecessor's model paints
the art plus flat `#00FF00` content rectangles marking where real text/QR
content will go; the actual text and QR codes are composited later in
HTML/CSS from a sidecar JSON describing normalized `[0,1]` bounding boxes, a
safe region, output crops, and zones with roles. SVG zone maps guide the
image-to-image layout. This chroma-key-plus-sidecar-JSON approach is the
concrete mechanism behind §11's "webpage the user can edit things on" for
postcard text regions, and is worth carrying forward rather than
reinventing.

### Grounding: brand guardrails

The predecessor's `CLAUDE.md` encodes hard brand rules that any style or
composition prompt must respect: real student robots must be rendered
faithfully; kids are the heroes; no outside branding or incidental wall
text; no chibi/Pixar/CGI/photoreal rendering; flat solid color only (at most
7, max 9, colors), zero texture; exact slogan spelling; "no other lettering
anywhere" beyond what the style explicitly allows; approved campaign copy
lives in a `League_Campaign_Slogans.md` reference file. These guardrails are
part of what "the AI's library of things people have told it to do or not
do" (§8) already covers in the predecessor, and Flyerbot's knowledge
database should be able to hold and enforce this same category of rule.

## 10. Styles as a persistent, correctable knowledge base

(See §8 for the correction mechanism itself.) The point worth stating
plainly on its own: the style/knowledge database is not static reference
material shipped once — it is a live, editable store that the agent both
reads from (to assemble prompts) and writes to (when the user corrects it).
This read-write, self-updating loop is the "persistent learning" the
stakeholder called out explicitly, and it is a first-class product
requirement, not an implementation detail.

## 11. UI philosophy and agent-authored surfaces

Most of it should be driven by **conversation, not buttons**. Beyond the
fixed left-browser/right-chat frame (§2), the agent should also be able to:

- **Do updates to webpages.**
- **Write Python code and attach those scripts to the web browser to show
  things off.**
- **Definitely make a webpage the user can edit things on.** The concrete
  example given: for postcards there's a JSON file specifying where the
  bounding boxes for text are; the user enters those in a form — **the
  agent makes a web page for that.**

This is a broader capability than a fixed "edit postcard text" feature: the
agent is expected to generate ad hoc UI surfaces (forms, demo pages, small
tools) as needed in the course of a conversation, not just the one postcard
example. The postcard text-region form is the concrete, must-have instance
of this capability; the Python-script and general webpage-update
capabilities are the same mechanism applied more broadly, and should be
designed as one general capability rather than three separate features.

## 12. Multi-user & infrastructure

- **Multi-user system, but all users work in the same environment.** The
  agent should expect other agents may be operating on the same file
  system. **Resolved (2026-07-13, §16 open question 5)**: locking scope is
  the database and the MCP file-editing server (see §9); the exact
  conflict-resolution mechanism is an implementation decision.
- **SQLite database.** **Resolved (2026-07-13, §16 open question 1)**: firm
  decision — no Postgres. Lightweight vector search is expected to live
  inside SQLite itself rather than a separate vector database, to support
  the single knowledge store's retrieval needs (§8).
- **GitHub connection** so everything commits to GitHub for version control.

### Grounding: predecessor has no real database today

The predecessor keeps state entirely on disk as JSON (`project.json`,
`state.json`, and the two `catalog.json` files) with no database at all.
Flyerbot's move to SQLite (explicitly called out by the stakeholder) is a
deliberate change from the predecessor, motivated by the multi-user,
concurrent-agent requirement above — flat JSON files invite write races when
multiple users' agents can touch the same project simultaneously; SQLite
gives Flyerbot transactional writes the predecessor never needed. The
predecessor also has a known print gap (crop marks not yet implemented) that
is out of scope for this document but worth carrying as a known follow-up.

### Grounding: current repo's persistence layer

The `flyerbot` template already has a Prisma 7 schema (SQLite in dev via
`better-sqlite3`, Postgres possible) with `Config`, `User`, `UserProvider`,
`ScheduledJob`, `Counter` (a demo model, to be replaced), and `Session`
models, three migrations, and a seed script that creates demo users from
env vars. This is the SQLite foundation the stakeholder's spec builds on;
the asset/style/project/collection domain models are new additions to this
schema, not a replacement of it.

## 13. Process directives (from the stakeholder, verbatim intent)

1. **Write this up** — this is the initial documentation for the system
   (CLASI process starting now). *(This document, plus `overview.md` and
   `usecases.md`, is that write-up.)*
2. After that: **wireframe mockups** — real simple, real web pages, real
   applications, but just mockups. *(Not in scope for this document — noted
   as the next phase only.)*
3. **Build on the existing React site structure** in this repo.
4. **Clean out Pike13 — not needed.**
5. **Login with Google/Gmail only.** No managing or creating accounts other
   than in Google.
6. **The sidebar: probably not much of a sidebar menu** — there might be
   some rejiggering there.

### Grounding: Pike13 removal footprint

Pike13 currently touches: `server/src/routes/pike13.ts`; mount points in
`server/src/app.ts` (import at line 15, mount at line 96);
`server/src/routes/integrations.ts`; `server/src/routes/admin/env.ts`;
`server/src/services/config.ts`; client-side
`useProviderStatus.ts`, `Login.tsx`, `Account.tsx`,
`admin/UsersPanel.tsx`, `admin/EnvironmentInfo.tsx`; `PIKE13_*` env vars in
`config/{dev,prod}`; and tests in `tests/server/pike13.test.ts` plus
references in five other test files. This is a real, multi-file removal,
not a single flag flip.

### Grounding: auth target state

The current template conditionally registers GitHub, Google, Pike13, and
username/password (demo users seeded from env) Passport strategies, with
provider linking via a `UserProvider` model. `GOOGLE_CLIENT_ID` /
`GOOGLE_CLIENT_SECRET` / `GOOGLE_CALLBACK_URL` are already present in
config. Target state per the stakeholder: **Google only** — GitHub, Pike13,
and username/password strategies should be removed or disabled, not just
deprioritized.

## 14. Configuration (follow-up instruction)

**dotconfig is set up.** Pull the OpenRouter keys from the marketing
directory's dotconfig `.env` file to be able to process images. Per the
project's secret-handling rule, **only environment variable names are
recorded here — never secret values**:

- Secrets to bring over from the marketing repo's dotconfig: `OPENROUTER_API`,
  `OPENAI_API_KEY`.
- Public config to bring over: `IMAGE_MODEL=gpt-image-2`,
  `OPENROUTER_MODEL=deepseek/deepseek-v4-pro`.

The flyerbot repo's own dotconfig cascade (`config/dev/secrets.env`,
`config/dev/public.env`, etc.) already defines `ANTHROPIC_API_KEY`,
`OPENAI_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`,
`GITHUB_TOKEN`, and others, but does **not** yet define `OPENROUTER_API` /
`OPENROUTER_MODEL` or `IMAGE_MODEL` — these need to be added to the
flyerbot cascade as part of implementation. `OPENAI_API_KEY` already exists
in both places and should be reconciled rather than duplicated.

## 15. Explicitly out of scope for this document

Per the stakeholder's own phase ordering (§13), the following are known
upcoming work and are **not** to be planned as part of this specification:

- Wireframe mockups (simple, real web pages — just mockups).
- Visual design.
- The actual build against the React/Express template.

## 16. Open questions

These are ambiguities noticed while writing this document, not decisions —
flagged for the stakeholder or for architecture review to resolve before or
during implementation:

1. **"Probably SQLite"** and **"maybe something the agent can control"**
   (git) are both hedged in the original spec. Is SQLite a firm decision, or
   should the architecture leave room for Postgres (already supported by the
   current Prisma setup)? Is git version control fully automatic, or should
   the agent be able to choose when to commit?

   **RESOLVED (2026-07-13)**: SQLite is a firm decision — "we're not going
   to need Postgres." The stakeholder wants lightweight vector-search
   capability and expects it can be done inside SQLite itself rather than a
   separate heavyweight vector database ("I think we can do that in
   SQLite... it's not a heavyweight usage of vector DB"); good indexing is
   the point. The git-automation-timing half of this question (fully
   automatic commits vs. agent-controlled) was not addressed in this round
   of answers and remains open.
2. The stakeholder describes a "database of things people have told the AI
   to do or not do" and a separate "database of prompts" (style/layout/
   composition definitions). Are these one knowledge store with categories,
   or genuinely separate mechanisms?

   **RESOLVED (2026-07-13)**: One knowledge store, not separate mechanisms
   — "there's basically one knowledge store, but you've got to be smart
   about how to find things — good indexing." This is the retrieval problem
   the SQLite-based vector search in Q1 is meant to help with.
3. Persistent style correction ("the AI updates that style to be more
   correct") — does this mean the agent edits the style text directly and
   autonomously, or does it propose a diff for the user to confirm? The
   predecessor has no such mechanism at all (styles are hand-edited `.md`
   files); this is new ground.

   **RESOLVED (2026-07-13)**: Corrections are proposed as a diff, not
   applied autonomously — "I think you're proposing a diff." Style/prompt
   content does not need to live in `.md` files the way the predecessor's
   does; it lives "in a database that you know how to read." This is a
   deliberate departure from the predecessor's file-based style storage,
   not just a grounding note (see §8, §10).
4. "Fairly flexible about what the agent is allowed to do" is explicitly in
   tension with "moderated by an MCP server... not running full Unix
   commands." Where exactly is that line — e.g., can the agent create
   arbitrary new style/collection folders, or only within predefined
   categories?

   **RESOLVED (2026-07-13)**: The agent can create entirely new things
   within the style collection — not limited to predefined categories.
   Directories are expected to carry a JSON file describing what's in them,
   or a corresponding database entry; either way, the agent may reorganize
   that structure and the system should accommodate it ("that whole thing
   can get reorganized by an agent. It should play just fine").
5. Multi-user concurrency: "other agents may be operating on the same file
   system" is called out as an expectation, but no locking, conflict, or
   ownership model is specified. Does this need explicit handling (e.g.
   optimistic locking on project records), or is loose, ad hoc coexistence
   (consistent with "not formalizing this too much") acceptable for v1?

   **RESOLVED (2026-07-13)**: Locking focuses on two surfaces — the
   database, and the MCP server used for editing files ("locking is going
   to focus probably on the database and the MCP server for editing
   files"). The exact conflict-resolution mechanism (last-write-wins,
   optimistic-lock rejection, surfaced conflict) was not specified and
   remains an implementation decision within that scope.
6. Subprojects are mentioned once ("you can also create subprojects") with
   no further detail on their relationship to the parent project's outputs,
   knowledge, or chat history. Does a subproject inherit the parent's
   project-details header, or start blank?

   **RESOLVED (2026-07-13)**: Illustrative example given — a subproject is
   for something like making a logo needed for a postcard project ("you're
   doing a postcard, and then you have to make a logo for the postcard").
   Whether it inherits or starts blank relative to the parent's
   project-details header was not directly addressed and remains an
   implementation decision.
7. The Claude Agent API/SDK is mentioned as a possibility "for persistence"
   — is this meant to replace the predecessor's Claude-Code-driven,
   file-based approach, or run alongside it as the app's own agent runtime
   distinct from the Claude Code sessions used to build Flyerbot itself?

   **RESOLVED (2026-07-13)**: Not Claude Code — "we are not using Claude
   Code anymore." Flyerbot's own runtime is an agent loop built on the
   Claude Agent SDK, distinct from the Claude Code sessions used to build
   Flyerbot itself.

   **Addendum (2026-07-14, build planning)**: the agent loop is the hard
   requirement; the provider is explicitly not — "the Anthropic SDK would
   be fine, probably very helpful — but we don't really care. It could be
   some third party. We wouldn't mind changing to another provider; in
   fact, if the software is going to be distributed, it probably needs to
   work with a provider other than Anthropic." Flyerbot's agent runtime is
   therefore specified against a provider-neutral LLM interface (chat
   completions + tool use), with the Anthropic Claude Agent SDK as the
   first/default provider implementation — swapping providers must not
   require changes to the loop contract, the Workspace MCP tool surface,
   or chat/session storage. See `docs/architecture/architecture-001.md`,
   **Amendment (2026-07-14): Provider-Neutral LLM Interface for the Agent
   Runtime** and **Design Rationale D10** for the architectural detail.
8. The asset auto-description schema (§3, §5) is explicitly undecided. The
   stakeholder specified required content (real-photograph flag, logo flag,
   style, real-vs-AI-generated people) but explicitly ruled out tags as the
   format — "not tags... we'll come up with something." Is this structured
   fields, free text, or a hybrid (e.g. a few structured flags plus a free-
   text description for semantic embedding/search)? This needs a design
   decision before the commit-time generation step can be built.

   **RESOLVED (2026-07-13)**: Reversed from the original spec text — tags
   are in scope after all: "you can use tags. You're going to classify the
   image, produce a description, and then there are tags." The schema is
   classification + description + tags; the tag vocabulary itself is still
   to-be-determined ("I just don't know what the tags are yet").
