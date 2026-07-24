#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_directory}/.." && pwd)"

if [[ "${REVENUECAT_LIVE_E2E:-false}" != "true" ]]; then
  echo "Refusing to run the live student matrix without REVENUECAT_LIVE_E2E=true." >&2
  exit 2
fi

scenarios=(
  "student-dismiss"
  "student-cancel"
  "student-fail"
  "student-duplicate"
  "student-monthly"
  "student-annual"
  "student-restore"
  "student-switch"
  "professional-route"
)

customers=(
  "rc-student-v1-dismiss"
  "rc-student-v1-cancel"
  "rc-student-v1-fail"
  "rc-student-v1-duplicate"
  "rc-student-v1-monthly"
  "rc-student-v1-annual"
  "rc-student-v1-restore"
  "rc-student-v1-switch"
  "rc-student-v1-pro-route"
)

cd "$project_root"

for index in "${!scenarios[@]}"; do
  scenario="${scenarios[$index]}"
  customer="${customers[$index]}"
  skip_build=true
  if [[ "$index" -eq 0 && "${DETOX_SKIP_BUILD:-false}" != "true" ]]; then
    skip_build=false
  fi

  alternate_customer="${customer}-google"
  if [[ "$scenario" == "student-switch" ]]; then
    alternate_customer="rc-student-v1-switch-alt"
  fi

  echo "Running ${scenario} with ${customer}."
  REVENUECAT_LIVE_SCENARIO="$scenario" \
    REVENUECAT_TEST_APP_USER_ID="$customer" \
    REVENUECAT_TEST_ALT_APP_USER_ID="$alternate_customer" \
    DETOX_SKIP_BUILD="$skip_build" \
    bash scripts/run-detox-revenuecat-test-store.sh
done
