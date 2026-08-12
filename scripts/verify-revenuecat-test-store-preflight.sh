#!/usr/bin/env bash
set -euo pipefail

fail() {
  echo "RevenueCat Test Store preflight blocked: $1" >&2
  exit 2
}

[[ "${REVENUECAT_LIVE_E2E:-false}" == "true" ]] || fail 'REVENUECAT_LIVE_E2E=true is required.'
[[ "${APP_VARIANT:-}" == 'dev' ]] || fail 'APP_VARIANT=dev is required.'
[[ "${EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED:-false}" == 'true' ]] || \
  fail 'EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED=true is required.'

test_store_key="${EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE:-}"
[[ "$test_store_key" == test_* ]] || \
  fail 'EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE must be a test_* SDK key.'
[[ "${EXPO_PUBLIC_REVENUECAT_STUDENT_OFFERING_ID:-}" == 'test_student' ]] || \
  fail 'the live lane must select test_student.'
[[ "${EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID:-}" == 'test_professional' ]] || \
  fail 'the live lane must select test_professional.'

validate_id() {
  local name="$1"
  local value="$2"
  [[ -n "$value" && ${#value} -le 88 && "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]*$ ]] || \
    fail "$name must be a unique 1-88 character RevenueCat App User ID."
}

primary_uid="${REVENUECAT_TEST_APP_USER_ID:-}"
alternate_uid="${REVENUECAT_TEST_ALT_APP_USER_ID:-}"
validate_id REVENUECAT_TEST_APP_USER_ID "$primary_uid"
validate_id REVENUECAT_TEST_ALT_APP_USER_ID "$alternate_uid"
[[ "$primary_uid" != "$alternate_uid" ]] || fail 'primary and alternate App User IDs must differ.'

for variable in \
  EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS \
  EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS \
  EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT \
  EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK \
  EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME; do
  [[ -z "${!variable:-}" ]] || fail "$variable must be unset for provider-backed validation."
done

echo "RevenueCat Test Store preflight passed for isolated App User IDs: ${primary_uid}, ${alternate_uid}."
