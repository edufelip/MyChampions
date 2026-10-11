#!/usr/bin/env bash
# Run the unit suite with TMPDIR set to a private directory under $HOME.
#
#   scripts/testing/run-unit-tests.sh TEST_FILE ...
#
# The native harness refuses any temp path with an ancestor that another
# account could write to, and its unit tests create fixtures under
# os.tmpdir(). Shared temp roots such as /tmp or a group-writable runner
# TMPDIR fail that rule, so each run gets its own 0700 directory, removed
# on exit.
set -euo pipefail

root="${HOME:?HOME is required}/.mychampions-unit-tmp"
mkdir -p "$root"
chmod 700 "$root"
run_dir="$(mktemp -d "$root/run.XXXXXX")"
trap 'rm -rf "$run_dir"' EXIT
export TMPDIR="$run_dir"

tsx --test "$@"
