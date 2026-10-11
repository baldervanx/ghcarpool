#!/bin/sh
set -e

cd /app/packages/backend

if [ "$#" -eq 0 ]; then
  set -- node dist/server.js
fi

case "${RUN_MIGRATIONS:-false}" in
  true)
    echo "[entrypoint] Running Prisma migrations..."
    ./node_modules/.bin/prisma migrate deploy
    ;;
  false)
    echo "[entrypoint] Startup migrations disabled; deploy migrations before serving traffic."
    ;;
  *)
    echo "[entrypoint] RUN_MIGRATIONS must be true or false." >&2
    exit 1
    ;;
esac

echo "[entrypoint] Executing $1"
exec "$@"
