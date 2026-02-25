# Developer Setup

## Prerequisites

- **Node.js 20** (LTS)
- **Docker** with a local daemon (e.g., OrbStack, Docker Desktop)
- **SOPS** — `brew install sops`
- **age** — `brew install age`
- An age keypair (see [Secrets Management](secrets.md) for setup)

## 1. Clone and Configure Docker Contexts

Edit `.dev.env` to match your local setup:

```bash
# Docker context for local development
DEV_DOCKER_CONTEXT=orbstack

# Docker context for production deployment
PROD_DOCKER_CONTEXT=swarm1

# Production domain
APP_DOMAIN=myapp.jtlapp.net
```

Verify your Docker contexts exist:

```bash
docker context ls
```

## 2. Set Up Secrets

Generate an age keypair if you don't have one:

```bash
age-keygen -o ~/.config/sops/age/keys.txt
```

Add your public key (`age1...`) to `.sops.yaml`, then decrypt dev secrets:

```bash
sops -d secrets/dev.env > .env
```

See [Secrets Management](secrets.md) for full details on key onboarding
and secret rotation.

## 3. Install Dependencies

```bash
npm install
cd server && npm install
cd ../client && npm install
```

## 4. Start Development

There are two development modes:

### Local Native (recommended)

Database runs in Docker; server and client run natively on your host with
hot-reload.

```bash
npm run dev
```

| Service  | URL                        | Hot-reload |
|----------|----------------------------|------------|
| Frontend | http://localhost:5173       | Yes (Vite HMR) |
| Backend  | http://localhost:3000/api   | Yes (ts-node-dev) |
| Database | localhost:5433              | N/A |

### Docker Development

All three services run in Docker on the dev context.

```bash
npm run dev:docker
```

| Service  | URL                        | Hot-reload |
|----------|----------------------------|------------|
| Frontend | http://localhost:5173       | Rebuild required |
| Backend  | http://localhost:3000/api   | Rebuild required |
| Database | Internal (port 5432)       | N/A |

Stop with:

```bash
npm run dev:docker:down
```

## 5. Run Tests

```bash
npm run test:db       # Database layer (Jest + Prisma)
npm run test:server   # Backend API (Jest + Supertest)
npm run test:client   # Frontend components (Vitest + RTL)
npm run test:e2e      # End-to-end (Playwright, requires running containers)
```

## 6. Common Tasks

| Task | Command |
|------|---------|
| Run Prisma migrations (Docker dev) | `npm run dev:docker:migrate` |
| Run Prisma migrations (local) | `cd server && npx prisma migrate dev` |
| Open Prisma Studio | `cd server && npx prisma studio` |
| Build for production | `npm run build:docker` |
| Deploy to production | See [Deployment Guide](deployment.md) |
