# SC-221 Auth Accept Terms (V2)

## Route
- `/auth/accept-terms`

## Objective
- Require authenticated users to accept the current terms version before role-selection or role-home access.

## User Actions
- Primary:
  - Open the legal terms link.
  - Check acceptance checkbox.
  - Confirm acceptance and continue.
- Secondary:
  - Retry opening link when unavailable.

## States
- Loading: acceptance submit in progress.
- Empty: waiting for user checkbox confirmation.
- Error: link open failure or acceptance save failure.
- Success: acceptance stored for current required version; user proceeds to role-selection or role-home by guard.

## Validation Rules
- Accept button remains disabled until checkbox is checked and uses the shared explicit disabled-control tokens.
- The consent checkbox exposes its localized accessible name and checked state in native and mobile-web accessibility trees (`aria-checked` on web).
- Route guard forces authenticated users with pending acceptance to `/auth/accept-terms`.
- Route guard redirects away from `/auth/accept-terms` once required version is accepted.
- Terms URL and required version are read from expo `extra.terms` config with documented fallback values.
- Structural surfaces use the shared radius vocabulary: 16px card, 12px link control, compact checkbox radius, and pill treatment only for the primary CTA.
- The terms block is centered and capped at 520px on larger screens.

## Data Contract
- Inputs:
  - Terms required version from config (`EXPO_PUBLIC_TERMS_REQUIRED_VERSION`, fallback `v1`).
  - Terms URL from config (`EXPO_PUBLIC_TERMS_URL`, fallback `https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use`).
  - Checkbox state.
- Outputs:
  - MyChampions server profile persisted acceptance version on `acceptedTermsVersion`.
  - Updated auth session state (`needsTermsAcceptance=false` when versions match).

## Edge Cases
- If legal URL cannot be opened, user sees recoverable link error and can retry.
- The controlled `/shared/webview` legal handoff remains reachable while the terms gate is pending; returning from it preserves the consent screen state.
- If profile hydration fails, session keeps terms gate locked (safe default) until retry/refresh succeeds.
- If accepted version differs from newly required version, gate is shown again.

## Implementation Snapshot (2026-03-06)
- Implemented in code:
  - `app/auth/accept-terms.tsx`
  - `features/auth/terms.logic.ts`
  - `features/auth/terms-config.ts`
  - `features/auth/auth-terms-runtime.test.ts`
  - `features/auth/auth-session.tsx`
  - `features/auth/profile-source.ts`
  - `features/auth/auth-route-guard.logic.ts`
- Current implementation status:
  - Acceptance happens after sign-in/create-account and before role-selection.
  - Sign-in and create-account success paths now route to `/auth/accept-terms`.
  - Terms acceptance persistence is MyChampions server-backed (`acceptedTermsVersion` in profile source).
  - Route guard enforces terms gate globally for authenticated sessions.
  - Primary accept action uses `DsPillButton`; foreground and disabled colors are scheme-aware and covered by contrast tests.
  - Consent checkbox keeps native `accessibilityState` behavior and explicitly serializes its localized label and checked state for React Native Web.
  - The auth guard allows only the controlled legal webview route during pending acceptance; role-selection and role-home routes remain blocked.
  - Native E2E launches a fresh app instance with Detox synchronization disabled in the launch arguments before each terms case; it does not use `reloadReactNative` across the idling-registry boundary because that corrupts the Android Detox/Espresso registry, and startup analytics cannot block a later synchronization transition.

## Links
- Functional requirement: FR-101, FR-164, FR-249
- Use case: UC-002.0, UC-002.21
- Acceptance criteria: AC-227, AC-266
- Business rules: BR-232, BR-297, BR-298
- Test cases: TC-228, TC-288, TC-289
- Diagram: docs/diagrams/role-journey-flow.md
