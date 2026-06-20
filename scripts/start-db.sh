#!/usr/bin/env bash
# Startar en lokal PostgreSQL-instans (utan Docker/root)
# Kör: ./scripts/start-db.sh

set -e

export PGROOT=/opt/data/home/pgroot
export PGBIN="$PGROOT/usr/lib/postgresql/17/bin"
export LD_LIBRARY_PATH="$PGROOT/usr/lib/x86_64-linux-gnu"
export PGDATA=/opt/data/home/pgdata

if "$PGBIN/pg_isready" -h 127.0.0.1 -p 5432 -U ghcarpool -q 2>/dev/null; then
  echo "PostgreSQL körs redan på port 5432"
  exit 0
fi

echo "Startar PostgreSQL..."
"$PGBIN/postgres" -D "$PGDATA" \
  -k "$PGDATA" \
  -c listen_addresses='127.0.0.1' \
  -c port=5432 \
  > /opt/data/home/pgdata/postgres.log 2>&1 &

# Vänta tills klar
for i in $(seq 1 20); do
  if "$PGBIN/pg_isready" -h 127.0.0.1 -p 5432 -U ghcarpool -q 2>/dev/null; then
    echo "PostgreSQL klar (port 5432)"
    exit 0
  fi
  sleep 0.5
done

echo "ERROR: PostgreSQL startade inte inom 10 sekunder" >&2
exit 1
