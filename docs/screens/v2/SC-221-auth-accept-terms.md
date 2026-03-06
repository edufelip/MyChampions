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
- Accept button remains disabled until checkbox is checked.
- Route guard forces authenticated users with pending acceptance to `/auth/accept-terms`.
- Route guard redirects away from `/auth/accept-terms` once required version is accepted.
- Terms URL and required version are read from expo `extra.terms` config with documented fallback values.

## Data Contract
- Inputs:
  - Terms required version from config (`EXPO_PUBLIC_TERMS_REQUIRED_VERSION`, fallback `v1`).
  - Terms URL from config (`EXPO_PUBLIC_TERMS_URL`, fallback `https://google.com`).
  - Checkbox state.
- Outputs:
  - Firestore persisted acceptance version on `userProfiles/{uid}.acceptedTermsVersion`.
  - Updated auth session state (`needsTermsAcceptance=false` when versions match).

## Edge Cases
- If legal URL cannot be opened, user sees recoverable link error and can retry.
- If profile hydration fails, session keeps terms gate locked (safe default) until retry/refresh succeeds.
- If accepted version differs from newly required version, gate is shown again.

## Implementation Snapshot (2026-03-06)
- Implemented in code:
  - `app/auth/accept-terms.tsx`
  - `features/auth/terms.logic.ts`
  - `features/auth/terms-config.ts`
  - `features/auth/auth-session.tsx`
  - `features/auth/profile-source.ts`
  - `features/auth/auth-route-guard.logic.ts`
- Current implementation status:
  - Acceptance happens after sign-in/create-account and before role-selection.
  - Sign-in and create-account success paths now route to `/auth/accept-terms`.
  - Terms acceptance persistence is Firestore-backed (`acceptedTermsVersion` in profile source).
  - Route guard enforces terms gate globally for authenticated sessions.
  - Primary accept pill button uses light foreground for label/loading contrast over the accent background.

## Links
- Functional requirement: FR-101, FR-164, FR-249
- Use case: UC-002.0, UC-002.21
- Acceptance criteria: AC-227, AC-266
- Business rules: BR-232, BR-297, BR-298
- Test cases: TC-228, TC-288, TC-289
- Diagram: docs/diagrams/role-journey-flow.md
