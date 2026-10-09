#!/usr/bin/env bash
# Ensure the Maestro CLI pinned for the native suite is installed, then print
# its binary path on stdout (progress goes to stderr).
#   maestro_bin="$(bash scripts/testing/install-maestro.sh)"
#
# The suite's Maestro lives in its own versioned folder, separate from the
# ~/.maestro install the native pilot pins (2.6.1), so both can share a host.
# It is unpacked from the GitHub release zip rather than the get.maestro.mobile.dev
# installer, which also edits shell profiles.
set -euo pipefail

version="${MAESTRO_VERSION:-2.10.0}"
root="${MAESTRO_SUITE_HOME:-$HOME/.cache/mychampions/maestro}/$version"
bin="$root/maestro/bin/maestro"

installed_version() {
  MAESTRO_CLI_NO_ANALYTICS=1 "$bin" --version 2>/dev/null | tail -n 1 || true
}

if [[ ! -x "$bin" || "$(installed_version)" != "$version" ]]; then
  echo "Installing Maestro $version into $root." >&2
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/maestro.zip" \
    "https://github.com/mobile-dev-inc/maestro/releases/download/cli-$version/maestro.zip"
  rm -rf "$root"
  mkdir -p "$root"
  unzip -q "$tmp/maestro.zip" -d "$root"
fi
installed="$(installed_version)"
[[ "$installed" == "$version" ]] || { echo "Expected Maestro $version, found ${installed:-none}." >&2; exit 1; }
echo "Maestro $installed ready." >&2
printf '%s\n' "$bin"
