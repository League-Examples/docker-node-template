#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Prisma, tsx, and Vite each load .env themselves — no shell sourcing needed.
# (Sourcing is fragile when values contain spaces or shell metacharacters.)

# Dev ports are read from .env (dotconfig-managed) so multiple template-derived
# apps can run side by side; only PORT and CLIENT_PORT lines are extracted —
# full sourcing stays off for the fragility reasons above.
PORT=$(grep -E '^PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
CLIENT_PORT=$(grep -E '^CLIENT_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)
export PORT="${PORT:-3000}"
export CLIENT_PORT="${CLIENT_PORT:-5173}"
export VITE_API_URL="${VITE_API_URL:-http://localhost:$PORT}"

# Clear anything squatting on the dev ports so `npm run dev` always works.
./scripts/nuke3000.sh "$PORT" "$CLIENT_PORT"

# SQLite mode — no Docker needed
exec npx concurrently --kill-others-on-fail -n server,client -c green,magenta \
  "cd server && npx prisma generate && npx prisma migrate dev && npx prisma db seed && npm run dev" \
  "cd client && npx wait-on http://localhost:$PORT/api/health && npx vite --host --port $CLIENT_PORT"
