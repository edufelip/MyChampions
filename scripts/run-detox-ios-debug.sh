#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_directory}/.." && pwd)"
metro_port="${DETOX_METRO_PORT:-8081}"
metro_log="${TMPDIR:-/tmp}/mychampions-detox-metro-${metro_port}.log"
metro_pid=""
metro_process_group="false"

cd "$project_root"

cleanup() {
  local exit_code=$?

  if [[ -n "$metro_pid" ]] && kill -0 "$metro_pid" >/dev/null 2>&1; then
    if [[ "$metro_process_group" == "true" ]]; then
      kill -TERM "-$metro_pid" >/dev/null 2>&1 || true
    else
      terminate_process_tree "$metro_pid"
    fi
    wait "$metro_pid" >/dev/null 2>&1 || true
  fi

  if [[ -n "$metro_pid" ]]; then
    for _ in $(seq 1 50); do
      if ! lsof -nP -iTCP:"$metro_port" -sTCP:LISTEN >/dev/null 2>&1; then
        break
      fi
      sleep 0.1
    done
    if lsof -nP -iTCP:"$metro_port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Metro port ${metro_port} remained occupied after cleanup." >&2
      exit_code=1
    fi
  fi

  exit "$exit_code"
}

terminate_process_tree() {
  local parent_pid="$1"
  local child_pid
  local child_pids

  # Signal the owned supervisor before its descendants. A descendant can
  # terminate a set -e shell while it is handling the signal, preventing the
  # supervisor's own cleanup trap from running. Capture the direct children
  # first, then let the parent perform its normal shutdown before cascading.
  child_pids="$(pgrep -P "$parent_pid" 2>/dev/null || true)"
  kill -TERM "$parent_pid" >/dev/null 2>&1 || true
  for child_pid in $child_pids; do
    terminate_process_tree "$child_pid"
  done
}

trap cleanup EXIT

metro_status_url="http://localhost:${metro_port}/status"

if lsof -nP -iTCP:"$metro_port" -sTCP:LISTEN >/dev/null 2>&1; then
  if [[ "${DETOX_REQUIRE_FRESH_METRO:-false}" == "true" ]]; then
    echo "Refusing to reuse the process on Metro port ${metro_port}; this run requires a freshly owned Metro process." >&2
    exit 2
  fi
  echo "Reusing Metro on port ${metro_port}."
else
  echo "Starting Metro on port ${metro_port}."
  if [[ "${DETOX_METRO_PROCESS_GROUP:-false}" == "true" ]] && command -v setsid >/dev/null 2>&1; then
    setsid_command=(setsid)
    metro_process_group="true"
  else
    setsid_command=(command)
  fi
  if [[ "${DETOX_METRO_CLEAR_CACHE:-false}" == "true" ]]; then
    "${setsid_command[@]}" "$project_root/node_modules/.bin/expo" start --dev-client --localhost --port "$metro_port" --clear >"$metro_log" 2>&1 &
  else
    "${setsid_command[@]}" "$project_root/node_modules/.bin/expo" start --dev-client --localhost --port "$metro_port" >"$metro_log" 2>&1 &
  fi
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
