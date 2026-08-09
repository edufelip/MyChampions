# Provider subscription validation

Provider validation is an explicit, credential-gated lane outside pull-request
CI. It uses the RevenueCat Test Store only from the development app variant,
isolates every run with unique App User IDs, and removes deterministic
entitlement overrides before Detox starts.

## Commands

- `bash scripts/verify-revenuecat-test-store-preflight.sh` validates the
  `test_*` SDK key, `test_student`/`test_professional` offerings, development
  guards, distinct safe App User IDs, and absence of deterministic entitlement
  overrides.
- `bash scripts/run-detox-revenuecat-test-store.sh` runs the professional
  Test Store lifecycle, account switching, restore/failure states, and optional
  read-only server reconciliation.
- `bash scripts/run-detox-revenuecat-student-matrix.sh` runs isolated student
  purchase, cancel, failure, duplicate, monthly/annual, restore, switch, and
  professional-route cases.
- `.github/workflows/provider-validation.yml` is the manual protected iOS
  workflow. It can run only from the protected `main` ref, checks out and
  verifies the exact protected SHA before secrets are materialized, shares the
  native iOS host lock with protected Detox, and retains diagnostics only on
  failure for one day. Release-branch validation remains blocked until branch
  protection and environment restrictions are independently established.

The current provider workflow is iOS-only because the available Test Store
catalog and device-runner evidence do not establish an Android app/product
configuration. Android provider validation remains **Blocked** until those
provider-console and runner prerequisites exist; deterministic Android
subscription fixtures remain separate and do not count as provider evidence.

## Evidence contract

The provider lane must record the exact SHA, platform, Test Store environment,
primary and alternate App User IDs, offering, scenario, purchase/cancel/failure
result, restore result, account-switch result, and webhook/server convergence
result. The server verifier is read-only and must be invoked with
`REVENUECAT_VERIFY_SERVER_EVIDENCE=true` plus `MYCHAMPIONS_SERVER_ROOT`; it
must never be replaced with a mocked reconciliation pass.

Production purchases, production mutations, secret `sk_*` keys, and provider
credentials in logs are prohibited. Missing credentials, unavailable runner
capacity, missing server verifier, or unavailable provider access are recorded
as **Blocked** with the missing evidence; they are not reported as zero,
passing, or mocked success.
