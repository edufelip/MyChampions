#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_directory}/.." && pwd)"
metro_port="${DETOX_METRO_PORT:-8081}"
metro_log="${TMPDIR:-/tmp}/mychampions-detox-metro-${metro_port}.log"
metro_pid=""

cd "$project_root"

cleanup() {
  local exit_code=$?

  if [[ -n "$metro_pid" ]] && kill -0 "$metro_pid" >/dev/null 2>&1; then
    kill "$metro_pid" >/dev/null 2>&1 || true
    wait "$metro_pid" >/dev/null 2>&1 || true
  fi

  exit "$exit_code"
}

trap cleanup EXIT

metro_status_url="http://localhost:${metro_port}/status"

if lsof -nP -iTCP:"$metro_port" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Reusing Metro on port ${metro_port}."
else
  echo "Starting Metro on port ${metro_port}."
  "$project_root/node_modules/.bin/expo" start --dev-client --localhost --port "$metro_port" >"$metro_log" 2>&1 &
  metro_pid=$!
fi

for _ in $(seq 1 60); do
  if curl --fail --silent --show-error "$metro_status_url" | grep -qx 'packager-status:running'; then
    yarn detox test -c ios.sim.debug "$@"
    exit $?
  fi

  if [[ -n "$metro_pid" ]] && ! kill -0 "$metro_pid" >/dev/null 2>&1; then
    echo "Metro exited before it became ready."
    cat "$metro_log" >&2 || true
    exit 1
  fi

  sleep 1
done

echo "Metro did not become ready at ${metro_status_url}."
if [[ -n "$metro_pid" ]]; then
  cat "$metro_log" >&2 || true
fi
exit 1
