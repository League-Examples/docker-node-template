# Deployment Guide

## Architecture

Production runs on Docker Swarm. A single server image contains both the
Express backend and the built React frontend (served via `express.static`
in production mode). An external Caddy reverse proxy reads Docker Swarm
labels for automatic HTTPS and domain routing.

```
Internet → Caddy (*.jtlapp.net) → server:3000 → Express (API + static files)
                                 → db:5432    → PostgreSQL
```

## Prerequisites

- Docker context `swarm1` (or your prod context) configured and reachable
- SOPS access to decrypt `secrets/prod.env`
- Swarm initialized on the target host (`docker swarm init`)

## First-Time Setup

### 1. Create Swarm Secrets

Secrets must exist in the swarm before the stack can deploy:

```bash
npm run secrets:prod
```

This decrypts `secrets/prod.env` via SOPS and creates each key as a Docker
Swarm secret on the production context. See [Secrets Management](secrets.md)
for details.

### 2. Deploy

```bash
npm run deploy
```

This does two things:
1. Builds the server image on the prod context (`docker compose build`)
2. Deploys the stack (`docker stack deploy`)

### 3. Run Migrations

After the first deploy, run Prisma migrations:

```bash
DOCKER_CONTEXT=swarm1 docker exec $(DOCKER_CONTEXT=swarm1 docker ps -q -f name=myapp_server) npx prisma migrate deploy
```

## Subsequent Deployments

```bash
npm run deploy
```

Docker Swarm performs rolling updates by default — new containers start
before old ones are drained. Run migrations if the schema changed.

## Caddy Labels

The external Caddy reverse proxy reads labels from the `deploy` block in
`docker-compose.prod.yml`:

```yaml
deploy:
  labels:
    caddy: ${APP_DOMAIN:-myapp.jtlapp.net}
    caddy.reverse_proxy: "{{upstreams 3000}}"
```

`APP_DOMAIN` is set in `deploy.env` and sourced by the deploy script.

## Rollback

To roll back to a previous image, re-deploy with the previous tag:

```bash
set -a && . deploy.env && set +a
DOCKER_CONTEXT=$PROD_DOCKER_CONTEXT TAG=v1 docker stack deploy -c docker-compose.prod.yml myapp
```

## npm Script Reference

| Script | What It Does |
|--------|-------------|
| `npm run secrets:prod` | Create swarm secrets from `secrets/prod.env` |
| `npm run secrets:prod:rm` | Remove existing swarm secrets (needed before updating) |
| `npm run build:docker` | Build prod image on the dev Docker context |
| `npm run deploy` | Build on prod context + deploy stack |

## Troubleshooting

**`secret not found: db_password`**
Swarm secrets haven't been created. Run `npm run secrets:prod` first.

**`image not found`**
The build step failed or hasn't run. `deploy` builds automatically,
but check the build output for errors.

**Container won't start**
Check logs: `DOCKER_CONTEXT=swarm1 docker service logs myapp_server`

**Migration failures**
Connect to the database and check state:
`DOCKER_CONTEXT=swarm1 docker exec -it $(docker ps -q -f name=myapp_db) psql -U app`
