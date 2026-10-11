#!/usr/bin/env bash
# run-db-scripts.sh — Kör reset-db och/eller migrate-from-firestore i app-containern.
#
# Användning:
#   ./scripts/run-db-scripts.sh reset              # Töm databasen
#   ./scripts/run-db-scripts.sh migrate            # Migrera från Firestore
#   ./scripts/run-db-scripts.sh reset migrate      # Töm och migrera direkt efter
#
# Kräver: docker eller podman, samt att app-containern körs.
# Migrering kräver att serviceAccount.json finns under packages/backend/.
# COMPOSE_PROJECT_NAME väljer projekt; CONTAINER_NAME kan ange en container explicit.

set -euo pipefail

# ---------------------------------------------------------------------------
# Konfiguration
# ---------------------------------------------------------------------------

CONTAINER_NAME="${CONTAINER_NAME:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-$(basename "$REPO_ROOT")}"
BACKEND_DIR="$REPO_ROOT/packages/backend"
SERVICE_ACCOUNT_LOCAL="${SERVICE_ACCOUNT_LOCAL:-$BACKEND_DIR/serviceAccount.json}"
SERVICE_ACCOUNT_REMOTE=""
CREDENTIAL_COPIED=false

# ---------------------------------------------------------------------------
# Avgör om docker eller podman ska användas
# ---------------------------------------------------------------------------

if command -v docker &>/dev/null && docker ps --no-trunc &>/dev/null 2>&1; then
  RUNTIME="docker"
elif command -v podman &>/dev/null; then
  RUNTIME="podman"
elif command -v podman-remote &>/dev/null; then
  RUNTIME="podman-remote"
else
  echo "FEL: Varken docker eller podman hittades." >&2
  exit 1
fi

if [[ -z "$CONTAINER_NAME" ]]; then
  mapfile -t app_containers < <(
    "$RUNTIME" ps \
      --filter "label=com.docker.compose.project=$PROJECT_NAME" \
      --filter "label=com.docker.compose.service=app" --format '{{.Names}}'
  )
  if [[ "${#app_containers[@]}" -ne 1 ]]; then
    echo "FEL: Förväntade en körande app-container i projekt '$PROJECT_NAME'; hittade ${#app_containers[@]}." >&2
    echo "Ange CONTAINER_NAME explicit om stacken inte använder Compose-labels." >&2
    exit 1
  fi
  CONTAINER_NAME="${app_containers[0]}"
fi

cleanup() {
  local status=$?
  trap - EXIT
  if [[ "$CREDENTIAL_COPIED" == true ]]; then
    if ! "$RUNTIME" exec --user 0 "$CONTAINER_NAME" rm -f "$SERVICE_ACCOUNT_REMOTE"; then
      echo "FEL: Kunde inte ta bort den temporära service account-filen i '$CONTAINER_NAME'." >&2
      exit 1
    fi
  fi
  exit "$status"
}
trap cleanup EXIT

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

  echo "Kör reset-db..."
  exec_in_container "cd /app/packages/backend && node dist/scripts/reset-db.js"
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

  if ! "$RUNTIME" exec "$CONTAINER_NAME" test -f /app/packages/backend/scripts/migrate-from-firestore.ts; then
    echo "FEL: App-imaget saknar migreringsverktyget. Bygg och starta aktuell app-version först." >&2
    exit 1
  fi
  echo "Kopierar temporär service account-fil till containern..."
  SERVICE_ACCOUNT_REMOTE=$("$RUNTIME" exec "$CONTAINER_NAME" mktemp /tmp/ghcarpool-service-account.XXXXXX)
  if [[ ! "$SERVICE_ACCOUNT_REMOTE" =~ ^/tmp/ghcarpool-service-account\.[a-zA-Z0-9]{6}$ ]]; then
    echo "FEL: Containern returnerade en ogiltig temporär credential-sökväg." >&2
    exit 1
  fi
  CREDENTIAL_COPIED=true
  "$RUNTIME" cp "$SERVICE_ACCOUNT_LOCAL" "$CONTAINER_NAME:$SERVICE_ACCOUNT_REMOTE"
  "$RUNTIME" exec --user 0 "$CONTAINER_NAME" sh -c \
    "chown node:node '$SERVICE_ACCOUNT_REMOTE' && chmod 600 '$SERVICE_ACCOUNT_REMOTE'"

  echo "Kör migrate-from-firestore.ts..."
  exec_in_container "
    cd /app/packages/backend &&
    SERVICE_ACCOUNT='$SERVICE_ACCOUNT_REMOTE' \
    ./node_modules/.bin/tsx scripts/migrate-from-firestore.ts
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
