# Pending Wiring Checklist V1

## Purpose
Track intentionally deferred implementation wiring so it is completed before release hardening.

## Status Legend
- `Pending`: not wired yet.
- `In progress`: partially wired.
- `Done`: fully wired and validated.

## Auth Wiring (Current Priority)
- `Pending`: Replace temporary sign-in stub in `app/auth/sign-in.tsx` with Supabase email/password auth.
- `Pending`: Wire Google Sign-In provider to Supabase Auth (including provider-link behavior for existing email).
- `Pending`: Wire Apple Sign-In provider to Supabase Auth (including provider-link behavior for existing email).
- `Pending`: Implement full create-account form in `app/auth/create-account.tsx` with documented password and duplicate-email rules.
- `Pending`: Persist and enforce role-lock flow in `app/auth/role-selection.tsx`.
- `Pending`: Add session/route guard wiring (auth-required routes and wrong-role redirects).
- `Pending`: Emit documented auth/onboarding analytics events in real runtime telemetry.

## Native Bootstrap
- `Done`: One-time `expo prebuild` executed and native directories generated (`ios/`, `android/`) for direct maintenance going forward.

## Billing And Subscription Wiring
- `Pending`: Wire RevenueCat entitlement checks to professional cap-sensitive actions.
- `Pending`: Wire pre-lapse warning data source and lock transitions from live entitlement state.

## Food/Plan/Data Wiring
- `Pending`: Wire fatsecret food lookup to nutrition plan builder and tracking search surfaces.
- `Pending`: Wire predefined plan library persistence and bulk-assignment orchestration APIs.
- `Pending`: Wire water-goal ownership precedence from live assignment + nutritionist override data.

## Media Wiring
- `Pending`: Wire image compression + upload pipeline to Supabase Storage in production flow.
- `Pending`: Wire upload progress/retry state to real network/upload events.

## Validation Gate Before Release
- Every item in this checklist must be either `Done` or explicitly deferred in a release decision note.
