#!/usr/bin/env bash
# Ensure the Maestro CLI pinned for the native suite is installed, then print
# its binary path on stdout (progress goes to stderr).
#   maestro_bin="$(bash scripts/testing/install-maestro.sh)"
#
# The suite's Maestro lives in its own versioned folder, separate from the
# ~/.maestro install the native pilot pins (2.6.1), so both can share a host.
# It is unpacked from the GitHub release zip rather than the get.maestro.mobile.dev
# installer, which also edits shell profiles. The zip must match the pinned
# SHA-256 before it is unpacked, and a cached install is reused only when it
# recorded that same hash at install time; anything else is reinstalled.
set -euo pipefail

# Bump both together. The hash is the GitHub release asset digest of
# cli-2.10.0/maestro.zip, confirmed by hashing a fresh download.
version=2.10.0
zip_sha256=29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991
root="${MAESTRO_SUITE_HOME:-$HOME/.cache/mychampions/maestro}/$version"
bin="$root/maestro/bin/maestro"
marker="$root/maestro.zip.sha256"

installed_version() {
  MAESTRO_CLI_NO_ANALYTICS=1 "$bin" --version 2>/dev/null | tail -n 1 || true
}

# The recorded hash is checked first, so an unverified cached binary never runs.
if [[ ! -x "$bin" || "$(cat "$marker" 2>/dev/null || true)" != "$zip_sha256" ||
  "$(installed_version)" != "$version" ]]; then
  echo "Installing Maestro $version into $root." >&2
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  curl -fsSL -o "$tmp/maestro.zip" \
    "https://github.com/mobile-dev-inc/maestro/releases/download/cli-$version/maestro.zip"
  actual_sha256="$(shasum -a 256 "$tmp/maestro.zip" | awk '{ print $1 }')"
  [[ "$actual_sha256" == "$zip_sha256" ]] || {
    echo "Maestro $version zip SHA-256 mismatch: expected $zip_sha256, got $actual_sha256." >&2
    exit 1
  }
  rm -rf "$root"
  mkdir -p "$root"
  unzip -q "$tmp/maestro.zip" -d "$root"
  # Written last, so an interrupted unzip is never reused.
  printf '%s\n' "$zip_sha256" > "$marker"
fi
installed="$(installed_version)"
[[ "$installed" == "$version" ]] || { echo "Expected Maestro $version, found ${installed:-none}." >&2; exit 1; }
echo "Maestro $installed ready." >&2
printf '%s\n' "$bin"
