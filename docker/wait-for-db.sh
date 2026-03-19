#!/bin/sh
# Wait for the database to be ready and accepting connections.
# Usage: ./docker/wait-for-db.sh [timeout_seconds]
# For SQLite: exits immediately (no server to wait for).
# For Postgres: requires DATABASE_URL env var, pg package in server/node_modules.

# SQLite databases are file-based — no server to wait for
case "${DATABASE_URL:-}" in
  file:*) echo "SQLite database — no wait needed."; exit 0 ;;
esac

TIMEOUT="${1:-60}"
ELAPSED=0
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Waiting for database..."
while [ "$ELAPSED" -lt "$TIMEOUT" ]; do
  NODE_PATH="$PROJECT_DIR/server/node_modules" node -e "
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    c.connect().then(() => c.query('SELECT 1')).then(() => { c.end(); process.exit(0); }).catch(() => process.exit(1));
  " 2>/dev/null && echo "Database is ready." && exit 0
  sleep 2
  ELAPSED=$((ELAPSED + 2))
done

echo "Timed out waiting for database after ${TIMEOUT}s"
exit 1
