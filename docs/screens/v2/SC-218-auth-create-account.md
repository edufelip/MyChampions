# SC-218 Auth Create Account (V2)

## Route
- `/auth/create-account`

## Objective
- Create new accounts with email/password or social providers, enforcing password and duplicate-account rules.

## User Actions
- Primary:
  - Create account with name, email, password, and password confirmation.
  - Create/sign in with Google.
  - Create/sign in with Apple.
- Secondary:
  - Reveal/hide password and password-confirmation values.
  - Navigate back to sign-in screen.

## States
- Loading: account creation or provider auth in progress.
- Empty: idle form state.
- Error: validation failure, duplicate email, provider/network error.
- Success: account created and routed into role-selection flow.

## Validation Rules
- `name`, `email`, `password`, and `password_confirmation` are required.
- Password must be min 8 chars with at least one uppercase letter, one number, and one special character.
- Password must not contain emoji.
- Special character validation uses ASCII punctuation symbols only.
- Password confirmation must exactly match password.
- Duplicate email account creation is blocked.
- Social login with existing email must link to existing account.
- Known sign-up failures must show reason-specific actionable copy.
- Accessibility baseline applies for text scaling, contrast, focus order, and control labels.

## Data Contract
- Inputs:
  - Name, email, password, password-confirmation values.
  - Google/Apple identity tokens.
- Outputs:
  - Newly created account or linked existing account session.
  - Validation feedback map by field.
  - Redirect to role selection for unlocked-role accounts.

## Edge Cases
- Email already used by existing account blocks duplicate creation.
- Social provider with existing email links provider into existing account.
- Password reveal toggle must not alter stored field value.

## Copy Draft (Initial)
- Title: `Create your account`
- CTA create account: `Create account`
- CTA back sign-in: `Back to sign in`
- Password helper: `Use at least 8 characters, including uppercase, number, and a symbol (e.g., ! @ #).`
- Duplicate email error: `This email is already in use. Sign in to continue.`

## Implementation Snapshot (2026-02-28)
- Route scaffold is present in code:
  - `app/auth/create-account.tsx`
- Current implementation status:
  - Placeholder screen only (navigation path exists).
  - Full create-account form, validation rules, and provider wiring are pending next implementation slice.

## Links
- Functional requirement: FR-101, FR-163, FR-164, FR-165, FR-166, FR-167, FR-168, FR-169, FR-171, FR-172, FR-182, FR-190, FR-205, FR-206, FR-207, FR-208, FR-217
- Use case: UC-002.0, UC-002.10, UC-002.11, UC-002.18
- Acceptance criteria: AC-227, AC-228, AC-229, AC-230, AC-231, AC-232, AC-239, AC-244, AC-246, AC-250, AC-251, AC-252, AC-512
- Business rules: BR-232, BR-233, BR-234, BR-235, BR-244, BR-251, BR-264, BR-265, BR-266, BR-275
- Test cases: TC-228, TC-229, TC-230, TC-231, TC-232, TC-233, TC-234, TC-242, TC-247, TC-252, TC-254, TC-255, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
