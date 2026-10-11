#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="$(mktemp -d)"
mkdir "$WORK/bin"
cp "$ROOT/scripts/tests/fake-container-runtime.sh" "$WORK/bin/docker"
chmod +x "$WORK/bin/docker"
printf '{}\n' > "$WORK/serviceAccount.json"
export PATH="$WORK/bin:$PATH" FAKE_RUNTIME_LOG="$WORK/runtime.log"
export SERVICE_ACCOUNT_LOCAL="$WORK/serviceAccount.json"
unset CONTAINER_NAME COMPOSE_PROJECT_NAME
cleanup() {
  rm -f "$WORK/bin/docker" "$WORK/serviceAccount.json" "$WORK/runtime.log" "$WORK/output"
  rmdir "$WORK/bin" "$WORK"
}
trap cleanup EXIT

expect_failure() {
  local expected=$1
  shift
  if "$@" > "$WORK/output" 2>&1; then
    echo "Expected failure $expected" >&2
    exit 1
  else
    local actual=$?
    test "$actual" -eq "$expected"
  fi
}

bash "$ROOT/scripts/run-db-scripts.sh" reset > "$WORK/output"
grep -q 'com.docker.compose.service=app' "$FAKE_RUNTIME_LOG"
grep -q 'node dist/scripts/reset-db.js' "$FAKE_RUNTIME_LOG"
! grep -q '^cp ' "$FAKE_RUNTIME_LOG"

: > "$FAKE_RUNTIME_LOG"
CONTAINER_NAME=custom-app bash "$ROOT/scripts/run-db-scripts.sh" reset > "$WORK/output"
grep -q 'exec custom-app' "$FAKE_RUNTIME_LOG"
! grep -q 'com.docker.compose.service=app' "$FAKE_RUNTIME_LOG"

FAKE_APP_COUNT=0 expect_failure 1 bash "$ROOT/scripts/run-db-scripts.sh" reset
grep -q 'hittade 0' "$WORK/output"
FAKE_APP_COUNT=2 expect_failure 1 bash "$ROOT/scripts/run-db-scripts.sh" reset
grep -q 'hittade 2' "$WORK/output"

: > "$FAKE_RUNTIME_LOG"
bash "$ROOT/scripts/run-db-scripts.sh" migrate > "$WORK/output"
grep -q './node_modules/.bin/tsx scripts/migrate-from-firestore.ts' "$FAKE_RUNTIME_LOG"
grep -q 'chmod 600' "$FAKE_RUNTIME_LOG"
grep -q 'rm -f /tmp/ghcarpool-service-account.abc123' "$FAKE_RUNTIME_LOG"
! grep -q 'npm install' "$FAKE_RUNTIME_LOG"

: > "$FAKE_RUNTIME_LOG"
FAKE_MIGRATION_FAILURE=true expect_failure 7 bash "$ROOT/scripts/run-db-scripts.sh" migrate
grep -q 'rm -f /tmp/ghcarpool-service-account.abc123' "$FAKE_RUNTIME_LOG"
echo 'PASS: app discovery, explicit override, ambiguity rejection, reset and migration cleanup'
