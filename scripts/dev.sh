#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

# Prisma, tsx, and Vite each load .env themselves — no shell sourcing needed.
# (Sourcing is fragile when values contain spaces or shell metacharacters.)

# SQLite mode — no Docker needed
exec npx concurrently -n server,client -c green,magenta \
  "cd server && npx prisma generate && npx prisma migrate dev && npm run dev" \
  "cd client && npx wait-on http://localhost:3000/api/health && npx vite --host"
