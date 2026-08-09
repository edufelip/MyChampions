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
if [[ "$(uname -s)" == 'Darwin' ]]; then
  recovery_mode="$(stat -f '%Lp' "$recovery_root")"
else
  recovery_mode="$(stat -c '%a' "$recovery_root")"
fi
[[ "$recovery_mode" == '700' ]] || {
  echo 'MYCHAMPIONS_NATIVE_STATE_ROOT must have mode 0700.' >&2
  exit 1
}

lock_file="$recovery_root/mychampions-native-host.lock"
wrapper_pid="${BASHPID:-$$}"
ready_file="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/mychampions-native-host-${wrapper_pid}.ready"
: > "$lock_file"
chmod 600 "$lock_file"

lock_pid=
command_pid=
cleanup() {
  local status=$?
  trap - EXIT
  trap - INT TERM
  if [[ -n "${command_pid:-}" ]] && kill -0 "$command_pid" 2>/dev/null; then
    kill -TERM "$command_pid" 2>/dev/null || true
    wait "$command_pid" 2>/dev/null || true
  fi
  if [[ -n "${lock_pid:-}" ]]; then
    kill "$lock_pid" 2>/dev/null || true
    wait "$lock_pid" 2>/dev/null || true
  fi
  rm -f "$ready_file"
  exit "$status"
}
trap cleanup EXIT

forward_signal() {
  local signal="$1"
  local exit_code=143
  [[ "$signal" == 'INT' ]] && exit_code=130
  if [[ -n "${command_pid:-}" ]] && kill -0 "$command_pid" 2>/dev/null; then
    kill -"$signal" "$command_pid" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap 'forward_signal INT' INT
trap 'forward_signal TERM' TERM

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

"$@" &
command_pid=$!
set +e
wait "$command_pid"
command_status=$?
set -e
command_pid=
exit "$command_status"
