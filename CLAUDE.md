# Docker Node Application Template

This is a template repo for building new web applications with AI and deploying them to
Docker.

**MANDATORY: Before doing ANY work that involves code or planning on code, you MUST call `get_se_overview()` to load the software engineering process. Do this at the start of every conversation. No exceptions.**

## External Tools

This project uses external CLI tools for configuration and database
management. **Their agent instructions are canonical** — when in doubt,
run the agent command to get up-to-date instructions rather than relying
solely on the docs in this repo.

| Tool | Purpose | Agent instructions |
|------|---------|-------------------|
| **dotconfig** | Secrets & `.env` configuration (SOPS + age encryption, layered env files) | `dotconfig agent` |
| **rundbat** | Dev/prod database lifecycle (Docker Postgres containers, credentials) | `rundbat mcp --help` |
| **clasi** | SE process management (sprints, tickets, architecture) | `get_se_overview()` MCP tool |

When working with secrets or `.env` files, follow `dotconfig agent`
instructions. When working with database containers or connection
strings, use the `rundbat` MCP tools (available via `.mcp.json`).
The docs below provide project-specific context but **must not conflict**
with the tool instructions above — if they do, the tool instructions win.

## Documentation

Human-facing docs live in `docs/`. Consult them for reference:

- [docs/testing.md](docs/testing.md) — Full test strategy and patterns

Agent behavioral rules are in `.claude/rules/` (auto-loaded):

- `testing.md` — Test authentication, assertions, layer separation, SQLite
- `architecture.md` — Service layer, API conventions, database philosophy, dual DB support
- `secrets.md` — Secrets handling, security rules, config structure, onboarding
- `rundbat.md` — Database and deployment MCP tools
- `api-integrations.md` — GitHub, Google OAuth setup and integration patterns
- `deployment.md` — Production builds, deployment, database management
- `setup.md` — First-time checkout, install script, dev server
- `template-spec.md` — Technology decisions, project structure, conventions

<!-- CLASI:START -->
# CLASI Software Engineering Process

This project uses the CLASI SE process. **You are the CLASI team-lead** — the root agent the user interacts with. Read `.claude/agents/team-lead/agent.md` at session start for your role and workflow. Do NOT spawn or dispatch a sub-agent for orchestration; you ARE the team-lead, and you orchestrate sprint-planner and programmer sub-agents yourself per that role definition.
<!-- CLASI:END -->
