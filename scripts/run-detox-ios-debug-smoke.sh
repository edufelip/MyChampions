#!/usr/bin/env bash
set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "${script_directory}/.." && pwd)"

cd "$project_root"

echo 'Running unauthenticated auth-entry Detox smoke.'
EXPO_PUBLIC_E2E_AUTH_SESSION='' \
  EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=true \
  EXPO_PUBLIC_E2E_CREATE_ACCOUNT=true \
  EXPO_PUBLIC_E2E_SOCIAL_AUTH=true \
  EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE='' \
  EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE='' \
  EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD='' \
  yarn test:e2e:build:ios:debug
E2E_AUTH_SESSION='' \
  E2E_AUTH_SIGN_IN=true \
  E2E_AUTH_CREATE_ACCOUNT=true \
  E2E_AUTH_SOCIAL=true \
  EXPO_PUBLIC_E2E_AUTH_SESSION='' \
  EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=true \
  EXPO_PUBLIC_E2E_CREATE_ACCOUNT=true \
  EXPO_PUBLIC_E2E_SOCIAL_AUTH=true \
  EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE='' \
  EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE='' \
  EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD='' \
  DETOX_JEST_CONFIG=e2e/jest.auth-entry.config.js \
  bash scripts/run-detox-ios-debug.sh --headless

echo 'Running authenticated role and connection Detox smoke.'
EXPO_PUBLIC_E2E_AUTH_SESSION=true \
  EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN='' \
  EXPO_PUBLIC_E2E_CREATE_ACCOUNT='' \
  EXPO_PUBLIC_E2E_SOCIAL_AUTH='' \
  EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE=success \
  EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=assigned \
  EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD=NUT123 \
  yarn test:e2e:build:ios:debug
E2E_AUTH_SESSION=true \
  E2E_AUTH_SIGN_IN='' \
  E2E_AUTH_CREATE_ACCOUNT='' \
  E2E_AUTH_SOCIAL='' \
  EXPO_PUBLIC_E2E_AUTH_SESSION=true \
  EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN='' \
  EXPO_PUBLIC_E2E_CREATE_ACCOUNT='' \
  EXPO_PUBLIC_E2E_SOCIAL_AUTH='' \
  EXPO_PUBLIC_E2E_INVITE_SUBMIT_FIXTURE=success \
  EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE=assigned \
  EXPO_PUBLIC_E2E_QR_INVITE_PAYLOAD=NUT123 \
  DETOX_JEST_CONFIG=e2e/jest.authenticated.config.js \
  bash scripts/run-detox-ios-debug.sh --headless
