# Native E2E gap matrix

**Validated:** 2026-08-08

This matrix records the three highest-value native gaps selected from the
current Detox manifest. The selection prioritizes authentication/data loss,
privacy/permission handling, and deterministic relationship failures. It does
not add push-notification or deep-link scenarios without a documented product
contract and device fixture.

| Priority | Risk boundary          | Gap and deterministic proof                                                                                                                                                                                                                                                  | Platforms     | Fixture phase                                           |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------- |
| P0       | Auth/data loss         | A selected role must survive a fresh app-process launch. The E2E auth harness now uses AsyncStorage only when the dedicated role-persistence phase enables it; the test selects Student, launches with `newInstance: true`, and asserts Student Home without role-selection. | iOS + Android | `auth-role-persistence` / `detox:auth-role-persistence` |
| P0       | Privacy/permission     | Camera denial during custom-meal image selection must stop the native picker, show the localized settings guidance, and leave the draft without a preview.                                                                                                                   | iOS + Android | `image-upload-permission-denied` / `detox:nutrition`    |
| P1       | Relationship integrity | A malformed QR payload must render the inline scanner error, avoid creating a pending connection, and return to manual-entry controls after close.                                                                                                                           | iOS + Android | `qr-invalid-payload` / `detox:connections`              |

## Coverage boundary

- Valid QR scanning remains in the separate `qr-valid` phase, which explicitly
  sets `E2E_QR_INVITE_SCENARIO=valid_payload`; the valid result assertion is
  skipped in the malformed-payload phase and continues to assert the
  pending-connection result only in its own phase.
- Image upload sheet and fixture-success behavior remain separate phases; the
  permission-denied phase intentionally does not set an image fixture. The
  Android phase dismisses the native camera-permission prompt before asserting
  the app's localized denial guidance.
- Deterministic subscription tests cover entitlement and failure UI only.
  Test Store/App Store/Google Play purchase, restore, webhook convergence, and
  account-switch evidence remain in the provider lane and are not counted as
  native deterministic coverage.
- The protected full workflow runs these deterministic profiles manually or on
  a published release. It excludes `detox:revenuecat-live`.

## Evidence requirement

For each phase, record platform, exact commit SHA, fixture environment, test
result, simulator/emulator identity, and failure-only diagnostics. A local
skip because no simulator, emulator, or runner is available is recorded as
unavailable evidence; it is not a passing result.
