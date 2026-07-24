#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_directory}/.." && pwd)"
server_evidence_runner="${project_root}/../server/infra/scripts/verify-revenuecat-live-evidence.sh"

if [[ "${REVENUECAT_LIVE_E2E:-false}" != "true" ]]; then
  echo "Refusing to run live RevenueCat tests without REVENUECAT_LIVE_E2E=true." >&2
  exit 2
fi

test_store_key="${EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE:-}"
if [[ "$test_store_key" != test_* ]]; then
  echo "EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE must contain a RevenueCat test_* SDK key." >&2
  exit 2
fi

run_uid="${REVENUECAT_TEST_APP_USER_ID:-}"
if [[ -z "$run_uid" ]]; then
  run_uid="rc-live-$(date -u +%Y%m%d%H%M%S)-${RANDOM}"
fi

if [[ ${#run_uid} -gt 88 || ! "$run_uid" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]]; then
  echo "REVENUECAT_TEST_APP_USER_ID must be 1-88 safe RevenueCat ID characters." >&2
  exit 2
fi

live_scenario="${REVENUECAT_LIVE_SCENARIO:-all}"
alternate_uid="${REVENUECAT_TEST_ALT_APP_USER_ID:-${run_uid}-google}"

if [[ ${#alternate_uid} -gt 88 || ! "$alternate_uid" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]]; then
  echo "REVENUECAT_TEST_ALT_APP_USER_ID must be 1-88 safe RevenueCat ID characters." >&2
  exit 2
fi

cd "$project_root"

export APP_VARIANT=dev
export EXPO_PUBLIC_ENV=dev
export EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED=true
export EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID=test_student
export EXPO_PUBLIC_E2E_AUTH_SESSION=true
export EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=true
export EXPO_PUBLIC_E2E_CREATE_ACCOUNT=true
export EXPO_PUBLIC_E2E_SOCIAL_AUTH=true
export EXPO_PUBLIC_E2E_AUTH_UID="$run_uid"
export EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID="$alternate_uid"
export EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic
export DETOX_METRO_CLEAR_CACHE=true

# A live run must resolve privileges from RevenueCat, never the deterministic
# subscription scenarios used by the regular Detox matrix.
unset EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS
unset EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS
unset EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT
unset EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK
unset EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME

echo "RevenueCat Test Store App User ID: ${run_uid}"
echo "RevenueCat Test Store alternate App User ID: ${alternate_uid}"
echo "RevenueCat live scenario: ${live_scenario}"
echo "This run uses the dev-only Test Store configuration; the SDK key is not printed."

if [[ "${DETOX_SKIP_BUILD:-false}" != "true" ]]; then
  yarn test:e2e:build:ios:debug
fi

E2E_AUTH_SESSION=true \
  REVENUECAT_LIVE_E2E=true \
  REVENUECAT_LIVE_SCENARIO="$live_scenario" \
  REVENUECAT_LIVE_MONITOR_EXPIRATION="${REVENUECAT_LIVE_MONITOR_EXPIRATION:-false}" \
  DETOX_JEST_CONFIG=e2e/jest.revenuecat-live.config.js \
  bash scripts/run-detox-ios-debug.sh --headless e2e/revenuecat-test-store.e2e.test.js

if [[ "${REVENUECAT_VERIFY_SERVER_EVIDENCE:-false}" == "true" ]]; then
  if [[ ! -f "$server_evidence_runner" ]]; then
    echo "Server RevenueCat evidence verifier is unavailable: ${server_evidence_runner}" >&2
    exit 1
  fi

  if [[ "${REVENUECAT_LIVE_MONITOR_EXPIRATION:-false}" == "true" ]]; then
    primary_professional_status=lapsed
    created_ai_status=lapsed
  else
    primary_professional_status=active
    created_ai_status=active
  fi

  REVENUECAT_TEST_APP_USER_ID="$run_uid" \
    EXPECTED_PROFESSIONAL_STATUS="$primary_professional_status" \
    EXPECTED_AI_STATUS=lapsed \
    bash "$server_evidence_runner" --verify

  REVENUECAT_TEST_APP_USER_ID="${run_uid}-created" \
    EXPECTED_PROFESSIONAL_STATUS=lapsed \
    EXPECTED_AI_STATUS="$created_ai_status" \
    bash "$server_evidence_runner" --verify
fi
