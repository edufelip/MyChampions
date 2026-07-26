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

## Browser Behavior

- Google Identity Services and Sign in with Apple JS capture browser provider tokens and keep the server token-exchange contract.
- Email and social account creation selects cookie session mode on web. Refresh credentials remain HttpOnly and are never persisted in browser storage.
- Missing provider identifiers, cancellation, and network failures keep the localized provider-neutral error behavior. Dismissed Google Identity Services prompt moments settle as cancellation, while skipped or undisplayable moments fail closed through the configured fallback/error path.
- At 390x844 and similarly compact phone viewports, the complete idle form—including provider actions and the return-to-sign-in action—fits inside the initial viewport while remaining scrollable for text scaling and validation messages.
- Tablet and desktop forms are centered at a readable 560px maximum width.

## Data Contract
- Inputs:
  - Name, email, password, password-confirmation values.
  - Google/Apple identity tokens.
- Outputs:
  - Newly created account or linked existing account session.
  - Validation feedback map by field.
  - Redirect to terms acceptance gate (`/auth/accept-terms`) before role selection/role home routing.

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

## Implementation Snapshot (2026-03-04)
- Implemented in code:
  - `app/auth/create-account.tsx`
  - `features/auth/create-account.logic.ts`
  - `features/auth/create-account.logic.test.ts`
- Current implementation status:
  - Full create-account form is implemented with localized fields for `name`, `email`, `password`, and `password_confirmation`.
  - Password and password-confirmation reveal/hide toggles are implemented.
  - Validation rules are enforced in tested domain logic (`required`, password policy, no emoji, ASCII symbol, password confirmation match).
  - Contextual submit error mapping is implemented for `duplicate_email`, `network`, `provider_conflict`, and `configuration`.
  - Email/password sign-up is wired to the MyChampions server auth boundary for native and browser runtimes.
  - Google social auth shows the approved E2E fixture path in test mode, then uses `@react-native-google-signin/google-signin` to capture a native Google ID token and posts it to the MyChampions server `POST /auth/social/sign-in` boundary. The server directly verifies configured issuer and audience claims; explicit provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `google` IDs only when the app variant is unset, blank, or `dev`.
  - Apple social auth shows the approved E2E fixture path in test mode, then tries native Apple identity-token capture and posts the token plus nonce to the MyChampions server `POST /auth/social/sign-in` boundary. The server directly verifies configured issuer, audience, and nonce claims; explicit provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `apple` IDs only when the app variant is unset, blank, or `dev`.
  - Successful sign-up routes to `/auth/accept-terms`; the MyChampions server auth session + guard then continue to role-selection or role home when terms are accepted.
  - Visual layout is aligned with Stitch reference `Playful Sign In Variant 1` using the same playful auth system used by SC-217:
    - Soft peach background with decorative blobs.
    - Rounded hero badge and rounded-full field/button controls.
    - Footer helper + CTA pair (`Already have an account?` + `Back to sign in`).

## Design Reference Assets
- `docs/design-assets/stitch/13906080126528974652/da61e892eaf34516b83086d64e163b23.html`
- `docs/design-assets/stitch/13906080126528974652/da61e892eaf34516b83086d64e163b23.png`

## Links
- Functional requirement: FR-101, FR-163, FR-164, FR-165, FR-166, FR-167, FR-168, FR-169, FR-171, FR-172, FR-182, FR-190, FR-205, FR-206, FR-207, FR-208, FR-217, FR-249
- Use case: UC-002.0, UC-002.10, UC-002.11, UC-002.18, UC-002.21
- Acceptance criteria: AC-227, AC-228, AC-229, AC-230, AC-231, AC-232, AC-239, AC-244, AC-246, AC-250, AC-251, AC-252, AC-266, AC-512
- Business rules: BR-232, BR-233, BR-234, BR-235, BR-244, BR-251, BR-264, BR-265, BR-266, BR-275, BR-297
- Test cases: TC-228, TC-229, TC-230, TC-231, TC-232, TC-233, TC-234, TC-242, TC-247, TC-252, TC-254, TC-255, TC-288, TC-330, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
