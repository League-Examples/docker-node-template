# Flyerbot

Flyerbot is a conversational, AI-driven studio for producing marketing
collateral — flyers, postcards, Facebook posts, logos, email banners — for
The League of Amazing Programmers. Built with Express, React, Prisma, and
SQLite. See `docs/design/overview.md` for the full pitch.

Sign in with Google — no other login method is supported.

## Getting Started

For Codespace users, start the codespace on this repo, then ... wait ... it will
take a while. When it finishes:

```bash
# 1. Start the dev server
npm run dev
```



Then, look at your "Ports" tab and open the proxy for port 5137


For desktop VSCode: 

```bash
# 1. Clone the template
git clone <your-repo-url> my-app
cd my-app

# 2. Run the install script
./scripts/install.sh

# 3. Start the dev server
npm run dev
```

That's it. The app starts with SQLite — no Docker, no database setup required.

- Frontend: http://localhost:5173
- Backend API: http://localhost:3000/api

## Contributing

`master` is auto-generated and read-only. All work happens on `development`:

```bash
git checkout development
```

PRs target `development`. On merge, a GitHub Action strips internal scaffolding (`.claude/`, `.agents/`, `docs/clasi/`, `CLAUDE.md`, `AGENTS.md`, `.template`) and force-pushes the result to `master`.

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | Express + TypeScript |
| Frontend | Vite + React + TypeScript |
| Database | SQLite (dev default) or PostgreSQL (production) |
| ORM | Prisma 7 |
| AI process | [CLASI](https://github.com/ericbusboom/claude-agent-skills) |

## Development

```bash
npm run dev              # SQLite mode (default, no Docker needed)
npm run dev:postgres     # PostgreSQL mode (requires Docker)
npm run dev:docker       # Full stack in Docker
```

To switch to PostgreSQL, edit `DATABASE_URL` in your `.env`:
```
DATABASE_URL=postgresql://app:devpassword@localhost:5433/app
```

## Testing

```bash
npm test              # Combined gate: server + client (Vitest)
npm run test:server   # Backend API (Vitest)
npm run test:client   # Frontend components (Vitest)
npm run test:e2e      # End-to-end (Playwright)
```

## Documentation

| Guide | Contents |
|-------|----------|
| [docs/testing.md](docs/testing.md) | Test strategy and guidelines |
| `.claude/rules/setup.md` | Detailed setup and troubleshooting |
| `.claude/rules/deployment.md` | Production deployment |
| `.claude/rules/template-spec.md` | Architecture and conventions |
