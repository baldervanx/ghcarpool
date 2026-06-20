#!/bin/sh
set -e

cd /app/packages/backend

echo "[entrypoint] Running Prisma migrations..."
npx prisma migrate deploy

echo "[entrypoint] Starting backend..."
exec node dist/server.js
