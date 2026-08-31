# SC-217 Auth Sign-In (V2)

## Route

- `/auth/sign-in`

## Objective

- Authenticate returning users with email/password, Google, or Apple, and continue to role-aware routing.

## User Actions

- Primary:
  - Sign in with email and password.
  - Submit the completed form from the password field's Done/Return key or the primary sign-in CTA.
  - Sign in with Google.
  - Sign in with Apple.
- Secondary:
  - Navigate to create-account screen.
  - Reveal/hide password field value.
  - Navigate to the forgot-password (request password reset) screen.

## States

- Loading: auth providers initialize and sign-in request is processing.
- Empty: idle form state.
- Error: auth provider failure, invalid credentials, or network error.
- Success: authenticated session created and routing continues.

## Validation Rules

- Email/password path requires non-empty email and password.
- Done/Return-key and primary-CTA submission must validate and submit the latest displayed credential values, even when submission immediately follows text replacement.
- Password field supports reveal/hide toggle.
- Social sign-in with existing email must link to existing account instead of creating duplicate account.
- Known sign-in failures must show reason-specific actionable copy.
- Accessibility baseline applies for text scaling, contrast, focus order, and control labels.
- Browser auth uses cookie session mode: the access token stays in memory and the rotating refresh token is HttpOnly. Reload restoration never reads browser storage.
- All three submission paths (email/password, Google, Apple) are guarded against duplicate concurrent submits by a synchronous client-side submission gate (`createAuthSubmissionGate` in `features/auth/auth-submission-gate.ts`) acquired before any network call and released in a `finally` block: a rapid multi-click on the primary CTA fires exactly one request per provider path, even though the button's DOM `disabled` attribute (driven by React state) can still read `false` in the instant right after the clicks land — ET-162. Covered by `features/auth/auth-submission-gate.test.ts` (gate unit semantics) and `e2e/web-server/sign-in-double-submit.spec.ts` (end-to-end request-count proof against the real server).

## Data Contract

- Inputs:
  - Email/password credentials.
  - Google/Apple identity tokens.
- Outputs:
  - Authenticated session.
  - Linked social identity (when matching existing account email).
  - Redirect to terms acceptance gate (`/auth/accept-terms`) before role selection/role home.

## Edge Cases

- Existing email/password account + social login with same email links provider into existing account.
- Immediate submission after editing an email/password credential must not validate a stale rendered value or surface a false required-field error.
- Locked-role account routes directly to role home after sign-in.
- Wrong-role route attempts after sign-in are redirected to role home by route guard.
- On web, a dismissed Google Identity Services prompt returns the screen to a settled cancellation state; skipped or undisplayable prompts fail closed through the configured fallback/error path rather than leaving the action pending.

## Copy Draft (Initial)

- Title: `Welcome, Champion`
- Subtitle: `Ready to crush your goals today?`
- Email label: `Email Address`
- Email placeholder: `champion@example.com`
- Password placeholder: `••••••••`
- CTA email sign-in: `Sign In`
- CTA create account: `Create an account`
- Divider text: `Or continue with`
- New-account helper: `New here?`
- Invalid credentials error: `Email or password is incorrect. Try again or reset your password.`
- Network error: `Couldn't connect right now. Check your connection and try again.`

## Implementation Snapshot (2026-08-12)

- Implemented in code with route and UI scaffold:
  - `app/auth/sign-in.tsx`
- Current implemented behavior:
  - No back button in header; sign-in is treated as the primary auth entry state.
  - Email/password inputs with non-empty validation.
  - Email and password changes are mirrored synchronously for CTA submission, while Done/Return submission also supplies the native password snapshot; validation, the E2E fixture, and the server request consume one immutable submission input.
  - Password reveal/hide eye toggle embedded inside the password input field.
  - Contextual error copy mapping for `invalid_credentials`, `network`, `provider_conflict`, and `configuration`.
  - Email/password sign-in is wired to the MyChampions server auth boundary for native and browser runtimes.
  - Google social sign-in shows the approved E2E fixture path in test mode, then uses `@react-native-google-signin/google-signin` to capture a native Google ID token and posts it to the MyChampions server `POST /auth/social/sign-in` boundary. The server directly verifies configured issuer and audience claims; explicit provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `google` IDs only when the app variant is unset, blank, or `dev`.
  - Apple social sign-in shows the approved E2E fixture path in test mode, then tries native Apple identity-token capture and posts the token plus nonce to the MyChampions server `POST /auth/social/sign-in` boundary. The server directly verifies configured issuer, audience, and nonce claims; explicit provider-token configuration gaps fall back to deterministic local MyChampions server sessions with provider-neutral `apple` IDs only when the app variant is unset, blank, or `dev`.
  - On web, Google uses Google Identity Services and Apple uses Sign in with Apple JS. Both adapters forward ID tokens to the same server endpoint; missing browser client/redirect configuration fails closed, and every dismissed, skipped, or undisplayable Google prompt moment settles the active request. Skipped moments enter the configured fallback/error path because Google may have failed to issue a credential.
  - Browser requests include credentials and `sessionMode: cookie`; native requests preserve bearer response-body refresh sessions.
  - Successful sign-in is driven by the MyChampions server auth session for route-guard enforcement.
  - Durable device session persistence is owned by the MyChampions server auth bridge instead of native provider config.
  - Successful sign-in routes to `/auth/accept-terms`; global guard then routes to role-selection or role home depending on terms + role state.
  - Locked-role users are auto-bypassed from auth routes by global guard to role home placeholder routes after terms acceptance.
  - Visual treatment follows the shared mobile auth shell: a calm design-system canvas, compact branded mark, left-aligned title/subtitle hierarchy, labeled 52dp fields with token-based borders, and consistent 52dp primary/social actions. Decorative blobs and oversized pill controls are not used on the auth entry surfaces.
  - The brand logo is an `expo-image` `<Image>` rendering `assets/images/logo.svg` (`contentFit="contain"`) inside a compact `accentPrimarySoft` brand mark. Accessibility label uses key `a11y.brand_logo`.
  - Text inputs expose a visible design-system border, accent focus state, and danger state for field validation. The password reveal action is an icon-only 44dp control with the existing localized accessible show/hide label.
  - Password validation is rendered immediately below the password field and before the primary action so the error remains associated with the input that needs correction.
  - Email/password Return, primary CTA, and Google/Apple provider actions share one serialized submission gate; a second auth request is ignored until the active request settles.
  - Social actions use explicit surface/border/disabled tokens, Google/Apple provider icons, explicit localized provider accessible names, and a rule divider so the provider choices remain visually secondary to email/password.
  - The mobile layout includes safe-area padding and a narrow-viewport regression check at 320×720 to prevent horizontal overflow or clipped auth hierarchy.
  - Primary email sign-in button uses light foreground (label, icon, and loading spinner) for contrast against the accent background.
  - A "Forgot password?" text link is anchored below the password field, styled to match the shared mobile auth shell (`testID: auth.signIn.forgotPasswordLink`), and pushes to `/auth/forgot-password` (SC-226). See SC-226 and SC-227 below for the full request/confirm reset flow, including the `/auth/password-reset` deep-link landing screen that consumes the server's `mychampions://auth/password-reset?token=...&email=...` local-dev debug-outbox link.

## Forgot / Reset Password (SC-226, SC-227)

### SC-226 Forgot Password (request)
- Route: `/auth/forgot-password`
- Implemented in code: `app/auth/forgot-password.tsx`.
- Objective: let an unauthenticated user request a password-reset email by submitting their account email to the MyChampions server `POST /auth/password-reset` endpoint (`requestPasswordResetFromSource()`, unchanged from the existing SC-213 "change password" implementation).
- States: idle form → submitting → success banner (privacy-preserving copy: shown identically whether or not the email is registered, matching the server's enumeration-resistant `202 accepted` response) → generic error banner on network/server failure.
- Validation: email required and format-checked (client-side, `validateForgotPasswordEmail()` in `features/auth/forgot-password.logic.ts`); server-side `invalid_email` rejection surfaces as a generic submit error, matching the existing account-settings reset request's error handling.
- Links back to `/auth/sign-in`.

### SC-227 Reset Password (confirm)
- Route: `/auth/password-reset` — intentionally matches the path segment the server's local-dev debug-outbox deep link (`mychampions://auth/password-reset?token=...&email=...`) resolves to via Expo Router's default file-based linking (`app.json` `scheme: "mychampions"`); no custom `Linking` listener is needed since Expo Router already handles inbound links for routes that exist.
- Implemented in code: `app/auth/password-reset.tsx`.
- Objective: consume a reset token (from a deep link's `token`/`email` query params, pre-filled, or pasted manually as a fallback) plus a new password, and call the MyChampions server `POST /auth/password-reset/confirm` endpoint (`confirmPasswordResetFromSource()`).
- Fields: email, reset code (token), new password, confirm new password. Email/token are pre-filled from `useLocalSearchParams()` when present but remain editable so a user who received the link on another device can paste the code manually.
- Email validation reuses the same format check as SC-226 (`isValidEmailFormat` from `forgot-password.logic.ts`), in addition to the token-required check. New-password validation reuses the same policy as account creation (`isPasswordPolicySatisfied` from `create-account.logic.ts`): 8+ characters, uppercase, number, ASCII symbol, no emoji.
- Error taxonomy (`reset-password.logic.ts`): `invalid_or_expired_token` (token wrong/expired/already consumed), `invalid_email`, `account_not_found`, `network`, `configuration`, each with distinct copy.
- Success: server returns `{ status: "reset" }`, revokes every existing session for the account server-side, and the screen shows a success banner with a CTA back to `/auth/sign-in`.
- Both SC-226 and SC-227 are added to `isPublicAuthEntry` in `features/auth/auth-route-guard.logic.ts` so the global auth guard does not bounce an unauthenticated visitor away before they can complete the flow (and, critically, does not strip the `token`/`email` query params off an incoming deep link by redirecting to `/auth/sign-in`).

## Links

- Functional requirement: FR-101, FR-163, FR-164, FR-164A, FR-169, FR-171, FR-172, FR-173, FR-182, FR-205, FR-206, FR-207, FR-208, FR-217, FR-249
- Use case: UC-002.0, UC-002.1, UC-002.10, UC-002.11, UC-002.18, UC-002.21
- Acceptance criteria: AC-227, AC-227A, AC-231, AC-232, AC-233, AC-239, AC-244, AC-250, AC-251, AC-252, AC-266, AC-512
- Business rules: BR-232, BR-234, BR-235, BR-236, BR-244, BR-264, BR-265, BR-266, BR-275, BR-297
- Test cases: TC-228, TC-228A, TC-233, TC-234, TC-235, TC-242, TC-252, TC-254, TC-255, TC-288, TC-330, TC-512
- Diagram: docs/diagrams/role-journey-flow.md
- Diagram: docs/diagrams/screen-state-flows-v2-batch1.md
