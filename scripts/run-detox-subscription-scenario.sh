#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_directory}/.." && pwd)"
scenario="${1:-success}"

case "$scenario" in
  success|cancelled|network|store_problem)
    test_file="e2e/professional-subscription-actions.e2e.test.js"
    entitlement_status="lapsed"
    active_student_count="3"
    renewal_risk="false"
    action_outcome="$scenario"
    subscription_scenario="actions"
    ;;
  warning)
    test_file="e2e/professional-subscription-cap.e2e.test.js"
    entitlement_status="active"
    active_student_count="10"
    renewal_risk="true"
    action_outcome="success"
    subscription_scenario="warning"
    ;;
  locked)
    test_file="e2e/professional-subscription-cap.e2e.test.js"
    entitlement_status="lapsed"
    active_student_count="11"
    renewal_risk="false"
    action_outcome="success"
    subscription_scenario="locked"
    ;;
  unknown)
    test_file="e2e/professional-subscription-cap.e2e.test.js"
    entitlement_status="unknown"
    active_student_count="11"
    renewal_risk="false"
    action_outcome="success"
    subscription_scenario="unknown"
    ;;
  *)
    echo "Unknown subscription scenario: $scenario" >&2
    echo "Expected success, cancelled, network, store_problem, warning, locked, or unknown." >&2
    exit 2
    ;;
esac

cd "$project_root"

export EXPO_PUBLIC_E2E_AUTH_SESSION=true
export EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS="$entitlement_status"
export EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=unknown
export EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT="$active_student_count"
export EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK="$renewal_risk"
export EXPO_PUBLIC_E2E_PRO_ACTION_OUTCOME="$action_outcome"
export DETOX_METRO_CLEAR_CACHE=true

if [[ "${DETOX_SKIP_BUILD:-false}" != "true" ]]; then
  yarn test:e2e:build:ios:debug
fi

E2E_AUTH_SESSION=true \
  E2E_SUBSCRIPTION_ACTION_OUTCOME="$action_outcome" \
  E2E_SUBSCRIPTION_SCENARIO="$subscription_scenario" \
  DETOX_JEST_CONFIG=e2e/jest.subscription.config.js \
  bash scripts/run-detox-ios-debug.sh --headless "$test_file"
