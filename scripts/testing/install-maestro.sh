#!/usr/bin/env bash
# Ensure the pinned Maestro CLI is installed and on PATH (GITHUB_PATH in CI).
#   scripts/testing/install-maestro.sh
set -euo pipefail

version="${MAESTRO_VERSION:-2.6.1}"
bin_dir="$HOME/.maestro/bin"
export PATH="$bin_dir:$PATH"

installed="$(MAESTRO_CLI_NO_ANALYTICS=1 maestro --version 2>/dev/null | tail -n 1 || true)"
if [[ "$installed" != "$version" ]]; then
  echo "Installing Maestro $version (found: ${installed:-none})."
  curl -fsSL "https://get.maestro.mobile.dev" | MAESTRO_VERSION="$version" bash
  installed="$(MAESTRO_CLI_NO_ANALYTICS=1 maestro --version | tail -n 1)"
fi
[[ "$installed" == "$version" ]] || { echo "Expected Maestro $version, found $installed." >&2; exit 1; }
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "$bin_dir" >> "$GITHUB_PATH"
fi
echo "Maestro $installed ready."
