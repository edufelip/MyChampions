#!/usr/bin/env bash
set -euo pipefail

if [[ -n "${MYCHAMPIONS_NATIVE_STATE_ROOT:-}" ]]; then
  exec bash scripts/ci/run-with-native-host-lock.sh \
    node --import tsx scripts/testing/run-native-pilot.ts "$@"
fi

# Selection/preflight remains usable without a configured native host.
exec node --import tsx scripts/testing/run-native-pilot.ts "$@"
