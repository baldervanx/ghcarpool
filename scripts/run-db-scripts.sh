#!/usr/bin/env bash
# run-db-scripts.sh — Kör reset-db och/eller migrate-from-firestore i backend-containern.
#
# Användning:
#   ./scripts/run-db-scripts.sh reset              # Töm databasen
#   ./scripts/run-db-scripts.sh migrate            # Migrera från Firestore
#   ./scripts/run-db-scripts.sh reset migrate      # Töm och migrera direkt efter
#
# Kräver: docker eller podman, samt att backend-containern körs.
# Migrering kräver att serviceAccount.json finns under packages/backend/.

set -euo pipefail

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

CONTAINER_NAME="ghcarpool_backend_1"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$REPO_ROOT/packages/backend"
SERVICE_ACCOUNT_LOCAL="$BACKEND_DIR/serviceAccount.json"
SERVICE_ACCOUNT_REMOTE="/tmp/serviceAccount.json"
RESET_SCRIPT_LOCAL="$BACKEND_DIR/src/scripts/reset-db.ts"
MIGRATE_SCRIPT_LOCAL="$BACKEND_DIR/scripts/migrate-from-firestore.ts"

# ---------------------------------------------------------------------------
# Avgör om docker eller podman ska användas
# ---------------------------------------------------------------------------

if command -v docker &>/dev/null && docker ps --no-trunc &>/dev/null 2>&1; then
  RUNTIME="docker"
elif command -v podman &>/dev/null; then
  RUNTIME="podman"
else
  echo "FEL: Varken docker eller podman hittades." >&2
  exit 1
fi

echo "Använder container-runtime: $RUNTIME"
echo "Container: $CONTAINER_NAME"
echo ""

# ---------------------------------------------------------------------------
# Hjälpfunktioner
# ---------------------------------------------------------------------------

container_running() {
  $RUNTIME ps --format '{{.Names}}' 2>/dev/null | grep -qx "$CONTAINER_NAME"
}

ensure_running() {
  if ! container_running; then
    echo "FEL: Containern '$CONTAINER_NAME' körs inte." >&2
    echo "Starta stacken med: docker compose up -d  (eller podman compose up -d)" >&2
    exit 1
  fi
}

exec_in_container() {
  $RUNTIME exec "$CONTAINER_NAME" sh -c "$1"
}

# ---------------------------------------------------------------------------
# Åtgärd: reset
# ---------------------------------------------------------------------------

do_reset() {
  echo "=== RESET-DB ==="
  ensure_running

  echo "Kopierar reset-db.ts till containern..."
  $RUNTIME cp "$RESET_SCRIPT_LOCAL" "$CONTAINER_NAME:/tmp/reset-db.ts"

  echo "Kör reset-db.ts..."
  exec_in_container "cd /app/packages/backend && npx tsx /tmp/reset-db.ts"
  echo ""
}

# ---------------------------------------------------------------------------
# Åtgärd: migrate
# ---------------------------------------------------------------------------

do_migrate() {
  echo "=== MIGRATE-FROM-FIRESTORE ==="
  ensure_running

  # Kontrollera serviceAccount.json
  if [[ ! -f "$SERVICE_ACCOUNT_LOCAL" ]]; then
    echo "FEL: Hittade inte $SERVICE_ACCOUNT_LOCAL" >&2
    echo "Lägg serviceAccount.json i packages/backend/ och försök igen." >&2
    exit 1
  fi

  echo "Kopierar serviceAccount.json och migreringsscript till containern..."
  $RUNTIME cp "$SERVICE_ACCOUNT_LOCAL"  "$CONTAINER_NAME:$SERVICE_ACCOUNT_REMOTE"
  $RUNTIME cp "$MIGRATE_SCRIPT_LOCAL"   "$CONTAINER_NAME:/tmp/migrate-from-firestore.ts"

  # Installera firebase-admin@11 i isolerad tmp-katalog med npm (undviker pnpm-konflikt).
  # Alltid ren installation för att undvika felaktig version från tidigare körning.
  echo "Installerar firebase-admin@11 i /tmp/fa-deps via npm..."
  exec_in_container "rm -rf /tmp/fa-deps && mkdir -p /tmp/fa-deps && cd /tmp/fa-deps && npm install --save firebase-admin@11 --loglevel=error"
  echo "firebase-admin installerat."

  echo "Kör migrate-from-firestore.ts..."
  exec_in_container "
    cd /app/packages/backend &&
    SERVICE_ACCOUNT=$SERVICE_ACCOUNT_REMOTE \
    npx tsx /tmp/migrate-from-firestore.ts
  "
  echo ""
}

# ---------------------------------------------------------------------------
# Argument-hantering
# ---------------------------------------------------------------------------

if [[ $# -eq 0 ]]; then
  echo "Användning: $0 reset | migrate | reset migrate"
  exit 1
fi

for arg in "$@"; do
  case "$arg" in
    reset)   do_reset ;;
    migrate) do_migrate ;;
    *)
      echo "Okänt argument: $arg  (tillåtna: reset, migrate)" >&2
      exit 1
      ;;
  esac
done

echo "Klart."
