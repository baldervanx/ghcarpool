#!/usr/bin/env bash
set -euo pipefail
printf '%s ' "$@" >> "$FAKE_RUNTIME_LOG"
printf '\n' >> "$FAKE_RUNTIME_LOG"
case "$1" in
  ps)
    if [[ "$*" == *"--no-trunc"* ]]; then exit 0; fi
    if [[ "$*" == *"--filter"* ]]; then
      case "${FAKE_APP_COUNT:-1}" in
        0) ;;
        1) echo "ghcarpool-app-1" ;;
        2) printf 'ghcarpool-app-1\nghcarpool-app-2\n' ;;
      esac
    else
      printf 'ghcarpool-app-1\ncustom-app\n'
    fi
    ;;
  exec)
    if [[ "$*" == *"mktemp /tmp/ghcarpool-service-account.XXXXXX"* ]]; then
      echo '/tmp/ghcarpool-service-account.abc123'
    fi
    if [[ "${FAKE_MIGRATION_FAILURE:-false}" == true && "$*" == *"./node_modules/.bin/tsx scripts/migrate-from-firestore.ts"* ]]; then
      exit 7
    fi
    ;;
  cp) ;;
  *) echo "Unexpected fake runtime command: $*" >&2; exit 1 ;;
esac
