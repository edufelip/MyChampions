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

## Professional Screen Wiring (Phase 5)
- `Done`: SC-202 Specialty screen (`app/professional/specialty.tsx`) implemented — add/remove specialties and upsert credentials via `useSpecialties` hook stub; Data Connect endpoint wiring deferred.
- `Done`: SC-204 Professional Home (`app/professional/home.tsx`) implemented — invite code display via `useInviteCode`, subscription state via `resolveSubscriptionState`; RevenueCat entitlement wired as stub `'unknown'`.
- `Done`: SC-205 Student Roster (`app/professional/students.tsx`) implemented — search + filter chip UI, FlatList with stub empty data; Data Connect student-roster endpoint wiring deferred.
- `Done`: SC-206 Student Profile Professional View (`app/professional/student-profile.tsx`) implemented — assignment status cards, unbind CTA, plan-change requests, water goal form; Data Connect endpoint wiring deferred.
- `Done`: SC-212 Professional Subscription Gate (`app/professional/subscription.tsx`) implemented — entitlement status display, cap usage, purchase/restore/refresh CTAs; RevenueCat SDK wiring deferred.
- `Done`: Stack.Screen route registrations added in `app/_layout.tsx` for all 5 new professional screens.
- `Pending`: Wire professional-source Data Connect endpoints for student roster, assignment status, and unbind operations into SC-205, SC-206.
- `Pending`: Wire RevenueCat entitlement live state into SC-204, SC-206, SC-212 (replacing `useState<EntitlementStatus>('unknown')` stubs).

## Localization
- `Done`: All `pro.home.*`, `pro.specialty.*`, `pro.students.*`, `pro.student_profile.*`, `pro.subscription.*` keys synced across `en-US.ts`, `pt-BR.ts`, `es-ES.ts`.
- `Done`: All `settings.account.*`, `meal.builder.*`, `meal.library.*`, `shared_recipe.*` keys synced across `en-US.ts`, `pt-BR.ts`, `es-ES.ts` (Phase 6).

- `Pending`: Wire RevenueCat entitlement checks to professional cap-sensitive actions.
- `Pending`: Wire pre-lapse warning data source and lock transitions from live entitlement state.

## Food/Plan/Data Wiring
- `In progress`: Implement Firebase Data Connect profile connector contract (`getMyProfile`, `upsertUserProfile`, `setLockedRole`) and switch auth route-guard profile source to Data Connect.
  - Done: App-side profile source abstraction created in `features/auth/profile-source.ts` and integrated into auth session provider.
  - Done: Live endpoint contract validator added at `scripts/validate-data-connect-profile-ops.mjs` (`npm run validate:data-connect:profile`).
  - Pending: Finalize production Data Connect connector schema/operation compatibility and environment endpoint provisioning.
- `In progress`: Implement Data Connect connection lifecycle connectors for invite submit/confirm/end and code rotation cancellation semantics.
  - Done: Pure connection logic module created in `features/connections/connection.logic.ts` (status/reason normalization, display state resolution, error mapping).
  - Done: Data Connect source module created in `features/connections/connection-source.ts` (`submitInviteCode`, `confirmPendingConnection`, `endConnection`, `getMyConnections`).
  - Done: Wire connection-source operations into app screens:
    - `app/student/professionals.tsx` (SC-211): invite code entry → `submitInviteCode`, connection list → `getMyConnections` + `resolveConnectionDisplayState`, unbind → `endConnection`. Surfaces `canceled_code_rotated` state (BL-003 / D-069).
    - `app/professional/pending.tsx` (SC-204/SC-205 subset): pending queue → `getMyConnections` (pending_confirmation filter), accept → `confirmPendingConnection`, deny/bulk deny → `endConnection`.
    - `features/connections/use-connections.ts`: React hook wrapping connection-source for UI consumption.
    - Route guard extended to block student from `/professional/*` and professional from `/student/*`.
  - Pending: Live endpoint compatibility validation for connection operations against deployed connector.
- `Pending`: Wire fatsecret food lookup to nutrition plan builder and tracking search surfaces.
- `Pending`: Wire predefined plan library persistence and bulk-assignment orchestration APIs.
- `Pending`: Wire water-goal ownership precedence from live assignment + nutritionist override data.

## Account Settings & Custom Meal Screens (Phase 6)
- `Done`: SC-213 Account & Privacy Settings (`app/settings/account.tsx`) implemented — privacy policy link and account deletion confirmation flow; Data Connect profile-delete wiring deferred.
- `Done`: SC-214 Custom Meal Builder (`app/nutrition/custom-meals/[mealId].tsx`) implemented — create/edit form with all 7 fields, image upload stub, share CTA; Data Connect and Cloud Storage wiring deferred.
- `Done`: SC-215 Custom Meal Library & Quick Log (`app/nutrition/custom-meals/index.tsx`) implemented — FlatList of meals, quick-log grams input with nutrition preview; Data Connect and portion-log persistence deferred.
- `Done`: SC-216 Shared Recipe Save Confirmation (`app/shared/recipes/[shareToken].tsx`) implemented — token preview, ownership note, import; Data Connect share endpoint wiring deferred.
- `Done`: Stack.Screen route registrations added in `app/_layout.tsx` for all 4 new Phase 6 screens.
- `Pending`: Wire Data Connect profile-delete operation into SC-213 account deletion flow.
- `Pending`: Wire Data Connect custom-meal CRUD operations into SC-214 and SC-215 (replacing stub source layer).
- `Pending`: Wire Data Connect share-link generation (`createMealShareLink`) and import (`importSharedMeal`, `previewSharedMeal`) endpoints into SC-214, SC-215, SC-216.
- `Pending`: Wire Firebase Cloud Storage image upload pipeline into SC-214 image upload stub.
- `Pending`: Wire portion-log persistence (Data Connect) into SC-215 quick-log confirm action.
- `Pending`: Wire deep-link resume (post-auth redirect back to `/shared/recipes/:shareToken`) for unauthenticated share link recipients in SC-216.

## Media Wiring
- `Pending`: Wire image compression + upload pipeline to Firebase Cloud Storage in production flow.
- `Pending`: Wire upload progress/retry state to real network/upload events.

## Validation Gate Before Release
- Every item in this checklist must be either `Done` or explicitly deferred in a release decision note.
