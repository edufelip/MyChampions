# Pending Wiring Checklist V1

## Purpose
Track intentionally deferred implementation wiring so it is completed before release hardening.

## Status Legend
- `Pending`: not wired yet.
- `In progress`: partially wired.
- `Done`: fully wired and validated.

## Auth Wiring (Current Priority)
- `Done`: Sign-in uses Firebase Auth email/password in `app/auth/sign-in.tsx`.
- `Done`: Create-account submit uses Firebase Auth email/password sign-up with backend reason mapping in `app/auth/create-account.tsx`.
- `Done`: Google Sign-In provider is wired to Firebase Auth in auth entry flows.
- `Done`: Apple Sign-In provider is wired to Firebase Auth in auth entry flows.
- `In progress`: Replace local persisted auth session/role source with Firebase Auth session + Data Connect profile source of truth.
  - Done: Firebase Auth session state drives `isAuthenticated`.
  - Done: Role-lock reads/writes pass through Data Connect profile-source boundary (`hydrateProfileFromSource`, `lockRoleInSource`) with remote-only persistence (no local fallback path).
- `Done`: Full create-account form implemented in `app/auth/create-account.tsx` with documented password and duplicate-email validation rules.
- `Done`: Full role-selection UX implemented in `app/auth/role-selection.tsx` with role cards, required-selection validation, and quick self-guided CTA.
- `Done`: Persist and enforce role-lock flow using Data Connect-backed profile source in `features/auth/profile-source.ts`, `features/auth/auth-session.tsx`, and `app/auth/role-selection.tsx`.
- `Done`: Session/route guard wiring implemented in `app/_layout.tsx` with auth-required routing and wrong-role redirects.
- `Pending`: Emit documented auth/onboarding analytics events in real runtime telemetry.

## Native Bootstrap
- `Done`: One-time `expo prebuild` executed and native directories generated (`ios/`, `android/`) for direct maintenance going forward.
- `Done`: Environment-aware Firebase config wiring aligned with native flavors and build phases:
  - Android `dev` / `production` flavors consume `android/app/src/dev/google-services.json` and `android/app/src/production/google-services.json`.
  - iOS build phase `[Firebase] Select GoogleService plist` copies `GoogleService-Info-Dev.plist` or `GoogleService-Info-Prod.plist`/`GoogleService-Info.plist` based on `EXPO_PUBLIC_ENV` (with Debug->dev and Release->production fallback).

## E2E Wiring
- `Done`: Detox project scaffolding added (`.detoxrc.js`, `e2e/jest.config.js`, auth smoke specs, Android instrumentation wiring, auth screen `testID` selectors).
- `Pending`: Wire Detox build/test commands into CI workflows for pull requests and release hardening gates.
- `Pending`: Expand Detox smoke coverage from auth into onboarding role-lock, invite entry, and wrong-role redirect flows.

## CI/CD Wiring
- `Done`: GitHub Actions workflow baseline copied/adapted from `meer` into `.github/workflows/` with Android/iOS PR checks, Firebase App Distribution flows, and release pipelines.
- `Done`: Workflows were adapted to this repository conventions (`npm ci`, `mychampions` iOS workspace/scheme, and `com.edufelip.mychampions` package identifiers).
- `Done`: CI secret inventory documented in `docs/discovery/ci-secrets-matrix-v1.md` with required/optional scope per workflow.

## Billing And Subscription Wiring
- `Pending`: Wire RevenueCat entitlement checks to professional cap-sensitive actions.
- `Pending`: Wire pre-lapse warning data source and lock transitions from live entitlement state.

## Food/Plan/Data Wiring
- `In progress`: Implement Firebase Data Connect profile connector contract (`getMyProfile`, `upsertUserProfile`, `setLockedRole`) and switch auth route-guard profile source to Data Connect.
  - Done: App-side profile source abstraction created in `features/auth/profile-source.ts` and integrated into auth session provider.
  - Done: Live endpoint contract validator added at `scripts/validate-data-connect-profile-ops.mjs` (`npm run validate:data-connect:profile`).
  - Pending: Finalize production Data Connect connector schema/operation compatibility and environment endpoint provisioning.
- `Pending`: Implement Data Connect connection lifecycle connectors for invite submit/confirm/end and code rotation cancellation semantics.
- `Pending`: Wire fatsecret food lookup to nutrition plan builder and tracking search surfaces.
- `Pending`: Wire predefined plan library persistence and bulk-assignment orchestration APIs.
- `Pending`: Wire water-goal ownership precedence from live assignment + nutritionist override data.

## Media Wiring
- `Pending`: Wire image compression + upload pipeline to Firebase Cloud Storage in production flow.
- `Pending`: Wire upload progress/retry state to real network/upload events.

## Validation Gate Before Release
- Every item in this checklist must be either `Done` or explicitly deferred in a release decision note.
