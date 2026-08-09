#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -eq 0 ]]; then
  echo 'Usage: run-with-native-host-lock.sh command [args...]' >&2
  exit 2
fi

recovery_root="${MYCHAMPIONS_NATIVE_STATE_ROOT:-}"
[[ "$recovery_root" == /* && -d "$recovery_root" && ! -L "$recovery_root" ]] || {
  echo 'MYCHAMPIONS_NATIVE_STATE_ROOT must be an existing non-symlink absolute directory.' >&2
  exit 1
}
[[ "$(stat -f '%Lp' "$recovery_root")" == '700' ]] || {
  echo 'MYCHAMPIONS_NATIVE_STATE_ROOT must have mode 0700.' >&2
  exit 1
}

lock_file="$recovery_root/mychampions-native-host.lock"
ready_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mychampions-native-host-${BASHPID}.ready"
: > "$lock_file"
chmod 600 "$lock_file"

lock_pid=
cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "${lock_pid:-}" ]]; then
    kill "$lock_pid" 2>/dev/null || true
    wait "$lock_pid" 2>/dev/null || true
  fi
  rm -f "$ready_file"
  exit "$status"
}
trap cleanup EXIT

/usr/bin/python3 - "$lock_file" "$ready_file" <<'PY' &
import fcntl
import os
import signal
import sys

lock_path, ready_path = sys.argv[1:]
lock_handle = open(lock_path, 'a+', encoding='utf-8')
fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
open(ready_path, 'a', encoding='utf-8').close()
signal.pause()
PY
lock_pid=$!

for _ in $(seq 1 60); do
  [[ -f "$ready_file" ]] && break
  kill -0 "$lock_pid" 2>/dev/null || {
    echo 'Native host lock process exited before acquiring the lock.' >&2
    exit 1
  }
  sleep 1
done
[[ -f "$ready_file" ]] || {
  echo 'Timed out waiting for the shared native host lock.' >&2
  exit 1
}

exec "$@"
