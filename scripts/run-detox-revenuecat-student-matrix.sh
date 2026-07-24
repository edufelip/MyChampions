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

validate_customer_id() {
  local variable_name="$1"
  local customer_id="$2"

  if [[ ${#customer_id} -gt 88 || ! "$customer_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]]; then
    echo "${variable_name} must contain 1-88 safe RevenueCat ID characters." >&2
    exit 2
  fi
}

explicit_customers="${REVENUECAT_STUDENT_MATRIX_CUSTOMER_IDS:-}"
if [[ -n "$explicit_customers" ]]; then
  IFS=',' read -r -a customers <<< "$explicit_customers"
  if [[ ${#customers[@]} -ne ${#scenarios[@]} ]]; then
    echo "REVENUECAT_STUDENT_MATRIX_CUSTOMER_IDS must contain exactly ${#scenarios[@]} comma-separated customer IDs." >&2
    exit 2
  fi
else
  run_nonce="$(date -u +%Y%m%d%H%M%S)-${RANDOM}-${RANDOM}"
  customer_prefix="rc-student-v1-${run_nonce}"
  customers=(
    "${customer_prefix}-dismiss"
    "${customer_prefix}-cancel"
    "${customer_prefix}-fail"
    "${customer_prefix}-duplicate"
    "${customer_prefix}-monthly"
    "${customer_prefix}-annual"
    "${customer_prefix}-restore"
    "${customer_prefix}-switch"
    "${customer_prefix}-pro-route"
  )
fi

for index in "${!customers[@]}"; do
  customer="${customers[$index]}"
  validate_customer_id "student matrix customer $((index + 1))" "$customer"

  for previous_index in "${!customers[@]}"; do
    if [[ "$previous_index" -ge "$index" ]]; then
      break
    fi
    if [[ "${customers[$previous_index]}" == "$customer" ]]; then
      echo "REVENUECAT_STUDENT_MATRIX_CUSTOMER_IDS must contain distinct customer IDs." >&2
      exit 2
    fi
  done
done

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
    alternate_customer="${customer}-alt"
  fi
  validate_customer_id "alternate customer for ${scenario}" "$alternate_customer"

  for candidate in "${customers[@]}"; do
    if [[ "$candidate" == "$alternate_customer" ]]; then
      echo "Alternate customer for ${scenario} must be distinct from every primary matrix customer." >&2
      exit 2
    fi
  done

  echo "Running ${scenario} with ${customer}."
  REVENUECAT_LIVE_SCENARIO="$scenario" \
    REVENUECAT_TEST_APP_USER_ID="$customer" \
    REVENUECAT_TEST_ALT_APP_USER_ID="$alternate_customer" \
    DETOX_SKIP_BUILD="$skip_build" \
    bash scripts/run-detox-revenuecat-test-store.sh
done
