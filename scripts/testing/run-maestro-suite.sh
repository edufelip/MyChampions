#!/usr/bin/env bash
# Run Maestro native suites through the selective executor: one debug build,
# one device preparation, then each fixture phase against its own fresh Metro.
#
#   scripts/testing/run-maestro-suite.sh --platform ios|android [SUITE_ID ...]
#
# With no SUITE_ID every CI Maestro suite in config/test-impact.json runs.
# NATIVE_SKIP_BUILD=true reuses an existing build; NATIVE_METRO_PORT picks the
# Metro port (it is compiled into the app, so build and run must agree).
set -euo pipefail

platform=""
suites=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --platform) platform="$2"; shift 2 ;;
    -*) echo "Unknown option: $1" >&2; exit 2 ;;
    *) suites+=("$1"); shift ;;
  esac
done
[[ "$platform" == ios || "$platform" == android ]] || {
  echo "Usage: $0 --platform ios|android [SUITE_ID ...]" >&2
  exit 2
}

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$project_root"

if [[ ${#suites[@]} -eq 0 ]]; then
  selected="$(node -e '
const { suites } = require("./config/test-impact.json");
const ids = Object.entries(suites)
  .filter(([, suite]) => suite.runner === "maestro" && suite.ci && suite.platforms.includes(process.argv[1]))
  .map(([id]) => id);
process.stdout.write(JSON.stringify(ids));
' "$platform")"
else
  selected="$(node -e 'process.stdout.write(JSON.stringify(process.argv.slice(1)))' "${suites[@]}")"
fi

bash scripts/testing/install-maestro.sh
SELECTED_SUITES_JSON="$selected" yarn test:impact:execute --platform "$platform"
