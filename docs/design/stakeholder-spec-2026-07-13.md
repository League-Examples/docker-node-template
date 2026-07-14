# Flyerbot — Stakeholder Specification (verbal, transcribed)

Stakeholder: Eric Busboom (eric.busboom@jointheleague.org)
Date: 2026-07-13
Captured by: team-lead, transcribed near-verbatim from the stakeholder's spoken
specification in session. Section 1 is the stakeholder's own content; Section 2
is supplementary factual context gathered by exploration agents the same day.

---

## 1. Stakeholder specification (verbatim intent)

This web application is going to be an AI system for creating flyers and other
content for marketing, using AI, based on an existing application in
`/Volumes/Proj/proj/league-projects/infrastructure/marketing`.

Process: we're going to talk about what the application is, build a spec for
it, then design it, then build it.

### Core concept

The initial application is a lot like the existing marketing app. The basic
idea: you create a **project**. The project is for building some marketing
collateral with AI — primarily, overwhelmingly, using **Claude to drive the
system**, and the **GPT image generator** to create the images.

The majority of the interface is the user just talking to Claude. There's not
a whole lot of clicking to do things.

### Screen layout — two panes

- **Left side**: a browser for assets, examples, styles, and previous projects.
- **Right side**: a view of the project outputs on the top three-quarters;
  below that is a chat window.

### Left-side browser

In the marketing directory you'll see past projects, logos, images, stock
images, prior-art photographs, all sorts of stuff. We want to browse through
that, because these are the things used to tailor the assets being created.

When the user wants to create a flyer, they might bring in an image that
specifies the style, or is an example of a style, or is an example of a set
scene they want to replicate in the image, or a template from a flyer. Each of
these things can have **an image, a prompt, or both**. For some of the prompts
you might generate an example image; the prompt is a portion of a prompt that
describes a style.

### Styles

When we talk about pop art, flats, poster, or manga, we're talking about an
**art style**. An art style has associated text that the AI can use to
generate the image.

### Collections

There is a **collection**: things get into the collection of examples either
because somebody added them, or because they found some stock art they want to
use — they drag it into the stock-art group, or they drag it into the main
window and tell the chat session "go put this in the stock art collection."
Maybe they just uploaded it. A lot of things get in there because there was a
discussion in a project and the user said "please add this to the collections."

### Projects

A **project** is an effort to create specific outputs. Examples: a flyer for a
Facebook post, a template for postcards, or just a logo.

- You can also create **subprojects**.
- A project produces one or more images — usually **at most two** (front and
  back of a postcard). Most of the time it's just one: a Facebook post, a
  flyer, or a logo.
- The project is created through a series of updates on the right side.

### New-project flow (right pane)

You say "I want to start a new project" — either told to Claude in chat or via
a new-project button somewhere — and you get a blank view:

- A text box at the bottom (chat).
- The list of outputs at the top.
- At the very top, project details. It might ask you for details about what
  the project is: What style do you want? What are you trying to create? Is
  this a Facebook image? Is this going to be a logo? Is it going to be pop
  art? Comic book? What are you trying to achieve? These are general
  guidelines for what you're doing.
- Below that is empty space (no outputs created yet).
- Below that is the chat text box: "Hey, I want to make a poster. It's got
  these things in it."

You drag things in from the left side — search around in there. You might drag
in a stock-art picture that lays out the **composition** of the image you're
trying to create. Maybe you pull in an example of the logo you want, or a
template that has borders and text spaces around the edge of the postcard.

### Prompt assembly & the knowledge database

You chat with the AI, and the AI assembles a prompt based on your input — but
**not ad hoc every time**. It takes what you've talked about and consults its
library of things that the user has updated, additional knowledge we've
gained, or things we've added. Users make requests, so there might be a
database of things people have told the AI to do or not do.

There's also a database of prompts:
- What does it mean to be a postcard?
- What does it mean to be pop-art style?
- What does it mean to be 1940s Max Fleischer style?

If the AI gets a style wrong, the user corrects it, and the AI **updates that
style to be more correct** (persistent learning).

### Agent capabilities & moderation

The agent has fairly complete control over the file system for this system,
and also a database — a local database, probably **SQLite**. Everything is
**version-controlled** (git), which may be behind the scenes, or maybe
something the agent can control.

The existing app in the marketing directory is largely driven by Claude Code
and is very ad hoc. **We're going to keep that.** We're not formalizing this
too much. Use the Claude agent structure — possibly the **Claude Agent
API/SDK** for persistence.

Users won't just ask to create a new image. They'll ask to reorganize
directory structures and update the database ("hey, let's go add a new
style"). It's fairly flexible about what the agent is allowed to do.

That should be **moderated by an MCP server**, so the agent can't do
everything. The MCP server will allow reading and moving files, creating
directories, maybe a few other stat operations — but probably **not running
full Unix commands** on the container.

### UI philosophy

Most of it should be driven by **conversation, not buttons**. A portion of the
UI is fairly fixed: the left-side browser window and the right-side chat box
and view.

The agent should also be able to:
- Do updates to webpages.
- Write Python code and attach those scripts to the web browser to show
  things off.
- **Definitely** make a webpage the user can edit things on. For postcards
  there's a JSON file specifying where the bounding boxes for text are; the
  user enters those in a form — the agent makes a web page for that.

### Multi-user & infrastructure

- Multi-user system, but all users work in the **same environment**. The
  agent should expect other agents may be operating on the same file system.
- SQLite database.
- GitHub connection so everything commits to GitHub for version control.

### Process directives

1. Write this up — this is the initial documentation for the system (CLASI
   process starting now).
2. After that: **wireframe mockups** — real simple, real web pages, real
   applications, but just mockups.
3. Build on the existing React site structure in this repo.
4. **Clean out Pike13** — not needed.
5. Login with **Google/Gmail only**. No managing or creating accounts other
   than in Google.
6. The sidebar: probably not much of a sidebar menu — there might be some
   rejiggering there.

### Configuration (follow-up instruction)

dotconfig is set up. Pull the OpenRouter keys from the marketing directory's
dotconfig/.env file to be able to process images. From
`/Volumes/Proj/proj/league-projects/infrastructure/marketing/.env`
(dotconfig-managed; secret values must never be copied into docs):
- Secrets: `OPENROUTER_API`, `OPENAI_API_KEY`
- Public: `IMAGE_MODEL=gpt-image-2`, `OPENROUTER_MODEL=deepseek/deepseek-v4-pro`

### Asset auto-description on commit (addition, 2026-07-13, during doc review)

One thing we're going to do: when you commit something into the collections —
the assets, whatever — you run it through a model to generate a
**description** of what it is, and text. Not tags — we'll come up with
something. It should cover:

- Is it a real photograph?
- Is it a logo?
- What's its style?
- Is it a real person, or was it generated by AI?

The point is so the user can go ask: "Show me the assets with robots in
them." "Show me a style that conveys a sense of wonder." "A young girl
looking at a computer screen."

And then you can **filter that view**. Maybe there's a filter bar up top,
like a search bar — but most of the time they're just going to talk to the
AI and filter it conversationally.

### Answers to the open questions (2026-07-13, end of doc review)

Responding to `specification.md` §16:

- **Database (Q1)**: It's probably SQLite. I would like to have a vector
  database in here, maybe, but I think we can do that in SQLite. It's not a
  heavyweight usage of vector DB, so that'll probably work. **We're not
  going to need Postgres.**
- **Knowledge store (Q2)**: No, there's basically **one knowledge store**,
  but you've got to be smart about how to find things — good indexing.
  That's where the vector DB might be beneficial.
- **Style corrections / storage format (Q3)**: I think you're proposing a
  diff, and they don't need to be .md files. They just need to be **in a
  database that you know how to read**.
- **MCP flexibility line (Q4)**: The agent can absolutely create entirely
  new things within the style collection folder. Your view of that and the
  way you access it should be pretty flexible. Directories probably have
  JSON files that describe what's going on there, or there's a database
  entry — but that whole thing can get reorganized by an agent. It should
  play just fine.
- **Locking (Q5)**: Locking is going to focus probably on **the database and
  the MCP server for editing files**.
- **Subprojects (Q6)**: The subproject is like: you're doing a postcard, and
  then you have to make a logo for the postcard.
- **Agent runtime (Q7)**: We are **not using Claude Code anymore** — that's
  probably where you need to have the **agent loop** (Agent SDK).
- **Description schema (Q8)**: No — you **can use tags**. You're going to
  classify the image, produce a description, and then there are tags — I
  just don't know what the tags are yet (vocabulary TBD).

### Wireframe review feedback (2026-07-14)

- Main two-pane layout: the iterations are vertically oriented — not back
  and forth, not doubled up. One pane should be about half the screen; the
  other is the assets. Asset tiles more rectangular and/or doubled up —
  maybe two columns there.
- Postcard editor: show both the front and the back as previews, **side by
  side** (front, then back), with the text fields below. The page needs a
  PDF button that creates a PDF and pops it up in a viewer window preview
  on the Mac.
- **Explicit**: when showing the postcard view, the asset browser is NOT
  shown. (It already isn't — the stakeholder wants this recorded as a
  deliberate rule, not an accident: agent-authored editing surfaces are
  full-width.)
- Home page: no counter demo; after login the user lands on something
  useful — links to the wireframes (later, the real app).
- Postcard editor, revision (2026-07-14, later): go with the front/back
  **tabs** version after all — show just either the front or the back
  (side-by-side is out). And the page should also have the **chat box**,
  since the user will have instructions that are not for the text — the
  user can instruct about almost anything.
- Postcard editor, revision 3 (2026-07-14): vertical stack — the screen
  has the postcard with the tabs for the front and back; below that a
  **scrollable box with the text fields** in it; below that the chat
  session.
- Postcard editor, revision 4 (2026-07-14): the text regions on the
  postcard are **clickable** — click one, get a pop-up, edit there, hit
  Return, and the text changes. The pop-up must be **large enough to fit
  all the text** (the fields themselves are short, but the pop-up should
  expand). And the **QR code box**: clicking it prompts for a **URL** that
  sets what the QR code encodes.
- Round 5 (2026-07-14): make the **asset browser collapsible**. The
  template's sidebar menu moves to a **top menu or hamburger**. The asset
  browser is an occasional-use surface: click to open it, and it can
  obscure the screen — expanding over ~7/8 of the iterations list and
  chat window — then collapse it again. When you **double-click an item
  to add it to the project, it closes automatically**. (Follow-up: open it
  with a **vertical pull-out tab** that slides over, not a button.)
- Round 6 (2026-07-14): the **home page is a list of all the projects**.
  Each project shows a **hero image** = whatever was most recently
  **accepted** — usually the last one. For a postcard it's the **front**,
  not the back.
  - Postcards make two images, so iterations get a control (little
    button or **pull-down**) marking **front or back**. Pulling down to
    set something as the front **unselects whatever was previously the
    front** — make a new revision, and if you like it, mark it the front;
    that clears the previous one.
  - Iterations have an **"accepted" checkbox** — that's the one you're
    working with. Updates always work off the accepted one; **if nothing
    is accepted, work off the last one**, unless the user explicitly says
    to work off a different version.
- Round 7 (2026-07-14): on the iterations page — a **back arrow** to the
  projects list; a **PDF button** showing the accepted/marked pages (just
  the front if only a front; front and back if both); a **"Text Entry"
  button** forward to the postcard/text-boxes view.
  - On the text-boxes view: **drag on the postcard to draw a new text
    box** — it rubber-bands from the anchor corner, then pops up asking
    for a name; the name shows in the box just like existing ones.
  - **Click a created text box** → a **delete button** off to the side
    (in its popup) removes it.

---

## 2. Exploration findings (context for the spec author)

### 2.1 Predecessor: the marketing app

Root: `/Volumes/Proj/proj/league-projects/infrastructure/marketing`. Entirely
Claude-Code/MCP-driven; the designer is art director in chat, the agent is
production artist.

Structure:
- `app/prompts/styles/<style>/` — `positive.md` + `negative.md` per style
  (10 styles: pop-art, comic-book, manga, dragon-ball-z, technical-blueprint,
  8bit-video-game, flat-poster, graphic-novel, type-sample, type-sample-8bit)
- `app/prompts/palettes/` — color palette prompt files + swatch viewer
- `app/prompts/compositions/` — ~25 camera/staging prompt files
- `app/layouts/` — output-format prompt files (postcard-4x6, full-page-flyer,
  business-card, single-event-facebook, peachjar-multi-event-flyer,
  template-content-areas) + SVG zone maps
- `app/rubrics/` — per-style and per-layout evaluation checklists
- `app/fonts/` — brand display fonts
- `images/` — shared asset library (logos, components, examples, photos,
  stock_images, prior-art) indexed by `images/catalog.json` with per-image
  description/style/people/tags/role
- `projects/<slug>/` — per-deliverable folders: `project.json` (config + full
  iteration history), `state.json` (version counter for gallery live-reload),
  `index.html` (auto-reloading gallery), `sources/`, `iterations/iter-NNN.png`
  (never overwritten); postcards add `postcard-content.json`, `postcard.html`,
  `postcard.pdf`. Indexed by `projects/catalog.json`.

Key mechanisms:
- **Prompt-as-data**: prompt text lives only in .md files / project.json,
  never hardcoded; files re-read on every call. `assemble-prompt` concatenates
  style+palette+composition+layout, then the agent rewrites into one voice.
- **Thin MCP + editable CLI**: MCP server exposes only `restart_web_server`
  and generic `run_cli(args)`; all logic in `cli.py` (~1600 lines, ~23
  subcommands) so it can be edited without MCP reconnect. Separate static
  web-server daemon (port 31337) serves live-reloading galleries.
- **Image generation**: OpenAI direct (`/v1/images/generations`, and
  `/v1/images/edits` when reference images attached), model `gpt-image-2`,
  quality=high, sizes 1536x1024 / 1024x1536 / 1024x1024. OpenRouter used for
  **vision evaluation** (rubric scoring). (Older SKILL.md doc drift says
  OpenRouter generates — CLAUDE.md/PROCESS.md/cli.py are authoritative.)
- **Postcard content JSON**: front/back images + text regions with position
  (inches), font, style, exact text, `extra_html` QR overlays. Rendered to
  postcard.html then PDF with 1/8in bleed + vendor 90° rotation.
- **Chroma-key template pipeline**: model paints art + flat #00FF00 content
  rectangles; real text/QR composited later in HTML/CSS from a sidecar JSON
  (normalized [0,1] bboxes, safe_region, outputs[] crops, zones[] with roles);
  SVG zone maps used as image-to-image layout guides.
- **Brand guardrails** (CLAUDE.md): real student robots rendered faithfully;
  kids are heroes; no outside branding/wall text; no chibi/Pixar/CGI/photoreal;
  flat solid color (≤7, max 9), zero texture; exact slogan spelling; "no other
  lettering anywhere"; approved campaign copy in League_Campaign_Slogans.md.
- No real database — state is on-disk JSON (project.json, state.json, two
  catalog.json files). Flyerbot moves this toward SQLite.
- Print gap flagged: crop marks not yet implemented.

### 2.2 Current repo (flyerbot template)

Generic "Docker Node Application Template" with CLASI scaffolding; not yet
rebranded.

- Frontend `client/`: Vite + React 19 + TypeScript, React Router v7, TanStack
  Query, react-hook-form + zod, Tailwind CSS v4, lucide-react.
- Backend `server/`: Express + TypeScript, Prisma 7 (SQLite dev via
  better-sqlite3 adapter; Postgres possible), Passport auth, pino, sessions in
  Prisma store, an MCP endpoint. Serves built SPA in prod.
- Auth: conditionally-registered Passport strategies — GitHub, Google
  (`GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL` already in config), Pike13, and
  username/password with demo users seeded from env. Provider linking via
  `UserProvider` model. Target state: Google only.
- Pike13 removal footprint: `server/src/routes/pike13.ts`; mounts in
  `server/src/app.ts` (import line 15, mount line 96);
  `server/src/routes/integrations.ts`; `server/src/routes/admin/env.ts`;
  `server/src/services/config.ts`; client `useProviderStatus.ts`, `Login.tsx`,
  `Account.tsx`, `admin/UsersPanel.tsx`, `admin/EnvironmentInfo.tsx`; PIKE13_*
  env vars in config/{dev,prod}; tests in tests/server/pike13.test.ts and
  references in 5 other test files.
- Layout: `client/src/components/AppLayout.tsx` — fixed 240px dark sidebar
  (MAIN_NAV currently just "Home"), top bar, user dropdown, impersonation
  banner; `AdminLayout.tsx` nested for /admin. Stakeholder expects sidebar
  rejiggering (two-pane layout replaces most of it).
- DB: `server/prisma/schema.prisma` — Config, User, UserProvider,
  ScheduledJob, Counter (demo, to replace), Session; 3 migrations; seed.ts
  creates demo users from env. Backup service (BACKUP_DIR, optional DO Spaces).
- Tooling: root scripts dev/test/docker:*; SOPS-encrypted dotconfig cascade in
  `config/` (dev/prod/local-eric); Dockerfile + docker-compose (app-data
  volume); devcontainer; GitHub Action strips scaffolding and force-pushes
  master from development.
- CLASI: `clasi/` artifact dirs empty (issues/reflections/sprints .gitkeep
  only); `.claude/` has team-lead/sprint-planner/programmer agents, ~26
  skills, rules. `docs/design/` and `docs/architecture/` empty.
