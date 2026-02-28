# SC-217 Auth Sign-In (V2)

## Route
- `/auth/sign-in`

## Objective
- Authenticate returning users with email/password, Google, or Apple, and continue to role-aware routing.

## User Actions
- Primary:
  - Sign in with email and password.
  - Sign in with Google.
  - Sign in with Apple.
- Secondary:
  - Navigate to create-account screen.
  - Reveal/hide password field value.

## States
- Loading: auth providers initialize and sign-in request is processing.
- Empty: idle form state.
- Error: auth provider failure, invalid credentials, or network error.
- Success: authenticated session created and routing continues.

## Validation Rules
- Email/password path requires non-empty email and password.
- Password field supports reveal/hide toggle.
- Social sign-in with existing email must link to existing account instead of creating duplicate account.
- Known sign-in failures must show reason-specific actionable copy.
- Accessibility baseline applies for text scaling, contrast, focus order, and control labels.

## Data Contract
- Inputs:
  - Email/password credentials.
  - Google/Apple identity tokens.
- Outputs:
  - Authenticated session.
  - Linked social identity (when matching existing account email).
  - Redirect to role selection or role home depending on account state.

## Edge Cases
- Existing email/password account + social login with same email links provider into existing account.
- Locked-role account routes directly to role home after sign-in.
- Wrong-role route attempts after sign-in are redirected to role home by route guard.

## Copy Draft (Initial)
- Title: `Welcome back`
- CTA email sign-in: `Sign in`
- CTA create account: `Create account`
- Divider text: `or continue with`
- Invalid credentials error: `Email or password is incorrect. Try again or reset your password.`
- Network error: `Couldn't connect right now. Check your connection and try again.`

## Implementation Snapshot (2026-02-28)
- Implemented in code with route and UI scaffold:
  - `app/auth/sign-in.tsx`
- Current implemented behavior:
  - Email/password inputs with non-empty validation.
  - Password reveal/hide control.
  - Contextual error copy mapping for `invalid_credentials` and `network`.
  - Social buttons currently route to role-selection placeholder until provider wiring lands.
  - Email/password sign-in uses temporary deterministic stub outcomes (`invalid@example.com`, `network@example.com`) pending backend auth integration.

## Links
- Functional requirement: FR-101, FR-163, FR-164, FR-169, FR-171, FR-172, FR-173, FR-182, FR-205, FR-206, FR-207, FR-208, FR-217
- Use case: UC-002.0, UC-002.1, UC-002.10, UC-002.11, UC-002.18
- Acceptance criteria: AC-227, AC-231, AC-232, AC-233, AC-239, AC-244, AC-250, AC-251, AC-252, AC-512
- Business rules: BR-232, BR-234, BR-235, BR-236, BR-244, BR-264, BR-265, BR-266, BR-275
- Test cases: TC-228, TC-233, TC-234, TC-235, TC-242, TC-252, TC-254, TC-255, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
