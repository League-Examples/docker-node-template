#!/bin/sh
set -e

echo "Waiting for database..."
npx wait-on tcp:db:5432 --timeout 30000

echo "Running migrations..."
npx prisma migrate dev --name auto 2>/dev/null || npx prisma migrate deploy

echo "Starting dev server..."
exec npx tsx watch src/index.ts
