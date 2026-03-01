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

## Offline Banner + Write-Lock (BL-008)
- `Done`: `features/offline/offline.logic.ts` — pure functions: `resolveCacheFreshness`, `checkWriteLock`, `resolveOfflineDisplayState`, `buildStaleElapsed`, `isDefinitelyOffline`. Unit tests in `offline.logic.test.ts` (included in 301-test suite, TC-261).
- `Done`: `features/offline/use-network-status.ts` — React hook `useNetworkStatus` wiring `@react-native-community/netinfo`; returns `'online' | 'offline' | 'unknown'`.
- `Done`: `@react-native-community/netinfo` installed (v12.0.1).
- `Done`: `app/student/home.tsx` (SC-203) — `useNetworkStatus` replaces `networkStatus: 'online'` stub; offline banner + write-lock shown on all section cards and hydration card.
- `Done`: `app/student/nutrition.tsx` (SC-209) — `useNetworkStatus` replaces stub; offline banner + write-lock on water widget and plan-change form.
- `Done`: `app/student/training.tsx` (SC-210) — `useNetworkStatus` replaces stub; offline banner + write-lock on plan-change form.
- `Done`: `app/professional/home.tsx` (SC-204) — `useNetworkStatus` replaces stub; offline banner + write-lock on invite-code and roster CTAs.
- `Done`: All `offline.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Pending`: Wire `lastSyncedAtIso` from real data-layer sync timestamps (currently `null` — stale indicator never shown). Deferred until Data Connect cache layer is implemented.
- `Pending`: Wire offline banner + write-lock into remaining screens not yet wired: `pro/students.tsx`, `pro/student-profile.tsx`, `pro/specialty.tsx`, `pro/pending.tsx`, `pro/subscription.tsx`, `settings/account.tsx`, `nutrition/custom-meals/index.tsx`, `nutrition/custom-meals/[mealId].tsx`, `shared/recipes/[shareToken].tsx`.

## Plan Change Request Flow (BL-005)
- `Done`: `features/plans/plan-change-request.logic.ts` — pure functions: `validatePlanChangeRequestInput`, `normalizePlanChangeRequestStatus`, `normalizePlanType`, `normalizePlanChangeRequestError`. Unit tests in `plan-change-request.logic.test.ts` (11 tests, TC-259).
- `Done`: `features/plans/plan-source.ts` — Data Connect stub surface: `submitPlanChangeRequest`, `reviewPlanChangeRequest`, `getStudentPlanChangeRequests`.
- `Done`: `features/plans/use-plans.ts` — React hook `usePlans` with `submitChangeRequest`, `validateChangeRequest`, `reviewChangeRequest`, `getChangeRequestsForStudent`.
- `Done`: `app/student/nutrition.tsx` (SC-209) — `PlanChangeRequestForm` wired to `usePlans`; full validation + error handling with all error branches and write-lock guard.
- `Done`: `app/student/training.tsx` (SC-210) — `PlanChangeRequestForm` wired to `usePlans`; full validation + error handling with improved error branches (plan_not_found, no_active_assignment, network) and write-lock guard.
- `Done`: `app/professional/student-profile.tsx` (SC-206) — `PlanChangeRequestsCard` wired to `usePlans.getChangeRequestsForStudent`; lists pending requests from specific student with review/dismiss actions via `reviewChangeRequest`; loads change requests on mount, shows load/action errors, optimistically removes reviewed/dismissed requests.
- `Done`: All `student.nutrition.plan_change.*`, `student.training.plan_change.*`, and `pro.student_profile.plan_change_requests.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: All plan-change keys tracked in `localized-copy-table-v2.md` with correct screen-specific key names.
- `Pending`: Wire `submitPlanChangeRequest`, `reviewPlanChangeRequest`, and `getStudentPlanChangeRequests` to real Data Connect connector endpoints replacing GraphQL stubs in `plan-source.ts`.
- `Pending`: Professional notification surface when student submits a change request (UC-002.13 step 3 — system notifies professional). Deferred until push notification infrastructure is provisioned.

## Water Tracking (BL-104)
- `Done`: `features/nutrition/water-tracking.logic.ts` — pure functions: `resolveEffectiveWaterGoal`, `resolveWaterDayStatus`, `calculateWaterStreak`, `validateWaterGoalInput`, `validateWaterIntakeInput`, `normalizeWaterTrackingError`.
- `Done`: `features/nutrition/water-tracking.logic.test.ts` — unit tests included in 301-test suite (TC-264–TC-267).
- `Done`: `features/nutrition/water-tracking-source.ts` — Data Connect stub surface: `getMyWaterLogs`, `logWaterIntake`, `setStudentWaterGoal`, `getMyWaterGoalContext`, `setNutritionistWaterGoalForStudent`.
- `Done`: `features/nutrition/use-water-tracking.ts` — React hook with `idle/loading/ready/error` state machine, `logIntake`, `setGoal`, `validateGoal`, `validateIntake`.
- `Done`: `HydrationCard` in `app/student/home.tsx` (SC-203) — wired to `useWaterTracking`; shows progress, streak, goal ownership label.
- `Done`: `WaterWidget` in `app/student/nutrition.tsx` (SC-209) — intake log form + personal goal form wired to `useWaterTracking`.
- `Done`: Nutritionist water goal form in `app/professional/student-profile.tsx` (SC-206) — `setNutritionistWaterGoalForStudent` wired via `useWaterTracking.setGoal`.
- `Done`: All localization keys present in `en-US`, `pt-BR`, and `es-ES` (`student.hydration.*`, `student.home.hydration.*`, `student.nutrition.water.*`, `pro.student_profile.water_goal.*`).
- `Done`: Screen spec created at `docs/screens/v2/SC-220-water-tracker.md`.
- `Pending`: Wire Data Connect endpoints for water tracking (`getMyWaterLogs`, `logWaterIntake`, `setStudentWaterGoal`, `getMyWaterGoalContext`, `setNutritionistWaterGoalForStudent`) replacing stubs in `water-tracking-source.ts`.
- `Pending`: Wire water-goal ownership precedence from live assignment + nutritionist override data (tracked in Food/Plan/Data Wiring section below).

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

## Bottom Navigation Shell (Phase 7)
- `Done`: `app/(tabs)/_layout.tsx` replaced with role-aware tab layout (D-045):
  - Professional: Dashboard / Students / Nutrition / Training / Account
  - Student: Home / Nutrition / Training / Recipes / Account
  - Tabs not belonging to the current role are hidden via `href: null`.
- `Done`: `IconSymbol` MAPPING expanded with tab bar icon pairs (SF Symbols + Material Icons).
- `Done`: `shell.tabs.*` and `shell.placeholder.coming_soon` localization keys added to en-US, pt-BR, es-ES.
- `Done`: Tab screens created: `(tabs)/index.tsx`, `(tabs)/students.tsx`, `(tabs)/nutrition.tsx`, `(tabs)/training.tsx`, `(tabs)/recipes.tsx`, `(tabs)/account.tsx`.
- `Done`: Professional nutrition placeholder (`app/professional/nutrition.tsx`) and training placeholder (`app/professional/training.tsx`) created for SC-207/SC-208 (not yet implemented).
- `Done`: SC-207 Nutrition Plan Builder implemented at `app/professional/nutrition/plans/[planId].tsx`; `app/professional/nutrition.tsx` converted to predefined plan library list screen.
- `Done`: SC-208 Training Plan Builder implemented at `app/professional/training/plans/[planId].tsx`; `app/professional/training.tsx` converted to predefined plan library list screen.
- `Done`: Routes `professional/nutrition/plans/[planId]` and `professional/training/plans/[planId]` registered in `app/_layout.tsx`.

## Plan Builder (BL-106 — SC-207, SC-208)
- `Done`: `features/plans/plan-builder.logic.ts` — pure functions: `validateNutritionPlanInput`, `validateTrainingPlanInput`, `validateTrainingSessionItemInput`, `calculateNutritionTotals`, `isStarterTemplate`, `normalizePlanBuilderError`.
- `Done`: `features/plans/plan-builder.logic.test.ts` — unit tests included in 301-test suite (TC-275–TC-280).
- `Done`: `features/plans/plan-builder-source.ts` — Data Connect stub surface for nutrition CRUD (`createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, `addNutritionMealItem`, `removeNutritionMealItem`) and training CRUD (`createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, `addTrainingSession`, `removeTrainingSession`, `addTrainingSessionItem`, `removeTrainingSessionItem`), plus `getStarterTemplates`, `cloneStarterTemplate`, `searchFoods`.
- `Done`: `features/plans/use-plan-builder.ts` — `useNutritionPlanBuilder` and `useTrainingPlanBuilder` hooks with `idle/loading/ready/saving/error` state machines.
- `Done`: `app/professional/nutrition.tsx` — plan library list screen (SC-207 lib).
- `Done`: `app/professional/nutrition/plans/[planId].tsx` — nutrition plan builder screen (SC-207).
- `Done`: `app/professional/training.tsx` — plan library list screen (SC-208 lib).
- `Done`: `app/professional/training/plans/[planId].tsx` — training plan builder screen (SC-208).
- `Done`: All `pro.plan.*`, `pro.library.*`, `pro.predefined_plan.*`, `pro.template_library.*`, `pro.template.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: SC-207 and SC-208 screen specs updated to reflect actual implementation.
- `Pending`: Wire Data Connect endpoints for plan CRUD (`createNutritionPlan`, `updateNutritionPlan`, `addNutritionMealItem`, `removeNutritionMealItem`, `createTrainingPlan`, `updateTrainingPlan`, `addTrainingSession`, `removeTrainingSession`, `addTrainingSessionItem`, `removeTrainingSessionItem`) replacing stubs in `plan-builder-source.ts`.
- `Pending`: Wire fatsecret food lookup into `searchFoods` in `plan-builder-source.ts`; requires fatsecret API key provisioned server-side (D-113).
- `Pending`: Wire `getStarterTemplates` and `cloneStarterTemplate` to real Data Connect starter template operations (D-114).

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

## Analytics Event Emission (Phase 9 — BL-012)
- `Done`: `features/analytics/analytics.logic.ts` — pure event builder functions for all Milestone A events (auth entry viewed, sign-in submitted/failed, sign-up submitted/failed, role selected, self-guided start clicked, invite submit requested/failed/pending-created/pending-canceled) with `redactEventProperties` guard. 146 unit tests cover all builders and redaction (TC-254, TC-255).
- `Done`: `features/analytics/use-analytics.ts` — React hook wrapping `transportEvent` stub (console.log in `__DEV__`, no-op otherwise). Real SDK transport deferred (tracked below).
- `Done`: `app/auth/sign-in.tsx` — emits `auth.entry.viewed` on mount; `auth.sign_in.submitted` before each channel attempt; `auth.sign_in.failed` with `reason_code` on failure for email/password, Google, and Apple channels.
- `Done`: `app/auth/create-account.tsx` — emits `auth.entry.viewed` on mount; `auth.sign_up.submitted`/`auth.sign_up.failed` for email/password, Google, and Apple channels.
- `Done`: `app/auth/role-selection.tsx` — emits `auth.entry.viewed` on mount; `onboarding.role.selected` with `role_context` on continue; `onboarding.self_guided_start.clicked` on quick-start shortcut.
- `Done`: `app/student/professionals.tsx` — emits `invite.submit.requested` on manual code submit; `invite.pending.created` on success; `invite.submit.failed` with `reason_code` on failure; `invite.pending.canceled` (once, via ref guard) when `canceled_code_rotated` connections surface.
- `Pending`: Wire real analytics SDK transport (Firebase Analytics, Amplitude, or equivalent) in `features/analytics/use-analytics.ts` to replace `console.log` stub. Update `pending-wiring-checklist-v1.md` when complete.
- `Pending`: Emit analytics events for professional-side Milestone A actions (pending queue confirm/deny) when SC-204/SC-205 Data Connect wiring is complete.

## Accessibility Baseline (Phase 8 — BL-013)
- `Done`: All auth screens (`sign-in.tsx`, `create-account.tsx`, `role-selection.tsx`) annotated with `accessibilityLabel`, `accessibilityRole`, `accessibilityState`, and live-region wrappers on error messages.
- `Done`: All student screens (`home.tsx`, `nutrition.tsx`, `training.tsx`, `professionals.tsx`) annotated with `accessibilityLabel` on `ActivityIndicator` loading states and `accessibilityLiveRegion="polite"` on error messages.
- `Done`: All professional screens (`home.tsx`, `students.tsx`, `student-profile.tsx`, `specialty.tsx`, `subscription.tsx`, `pending.tsx`) annotated — composite `accessibilityLabel` on stat/row cards, `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}` on pending-queue selection, live-region error wrappers.
- `Done`: Phase 6 screens (`settings/account.tsx`, `nutrition/custom-meals/index.tsx`, `nutrition/custom-meals/[mealId].tsx`, `shared/recipes/[shareToken].tsx`) annotated — contextual action button labels (`"Log <name>"`, `"Edit <name>"`, `"Share <name>"`), `accessibilityRole="alert"` on error views, live-region error wrappers.
- `Done`: 7 `a11y.*` localization keys added to all three locale bundles (`en-US`, `pt-BR`, `es-ES`) and tracked in `localized-copy-table-v2.md`.
- `Done`: Accessibility baseline approach documented in `decisions-log-v1.md` as D-105 (React Native core a11y props only, no external a11y library).
- `Pending`: Screen-reader end-to-end smoke test via Detox (deferred — requires Detox CI wiring).
- `Pending`: Color-contrast audit with automated tool (deferred — requires design token finalization).

## Media Wiring
- `Pending`: Wire image compression + upload pipeline to Firebase Cloud Storage in production flow.
- `Pending`: Wire upload progress/retry state to real network/upload events.

## AI Meal Photo Analysis (BL-108)
- `Done`: `features/nutrition/meal-photo-analysis.logic.ts` — pure functions: `isValidMacroEstimate`, `parseMacroEstimateFromResponse`, `mapMacroEstimateToMealInput`, `normalizePhotoAnalysisError`, `buildAnalysisSystemPrompt`, `buildAnalysisUserPrompt`.
- `Done`: `features/nutrition/meal-photo-analysis.logic.test.ts` — unit tests included in 301-test suite (TC-271–TC-274).
- `Done`: `features/nutrition/meal-photo-analysis-source.ts` — HTTP source `analyzeMealPhoto`: Firebase ID token header, typed `PhotoAnalysisSourceError`, full response/error mapping.
- `Done`: `features/nutrition/use-meal-photo-analysis.ts` — React hook `useMealPhotoAnalysis` with `idle/capturing/compressing/analyzing/done/error` state machine; `startCapture` (stub), `analyze`, `reset`, `preFillMealInput`.
- `Done`: SC-214 and SC-215 wired to `useMealPhotoAnalysis` — camera CTA, result pre-fill, attach-photo toggle (SC-214 only).
- `Done`: All `meal.photo_analysis.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: SC-219 screen spec updated to reflect actual implementation.
- `Pending`: Provision Firebase Cloud Function `analyzeMealPhoto` with the following contract:
  ```
  POST /analyzeMealPhoto
  Headers: Authorization: Bearer <Firebase Auth ID token>
  Body:    { image: string (base64, JPEG), mimeType: 'image/jpeg' }
  Response 200: { calories: number, carbs: number, proteins: number, fats: number, totalGrams: number, confidence: 'high' | 'medium' | 'low' }
  Response 400: { error: 'unrecognizable_image' }
  Response 429: { error: 'quota_exceeded' }
  Response 401: { error: 'unauthenticated' }
  Response 500: { error: 'unknown' }
  ```
  - Cloud Function must validate Firebase Auth ID token before proxying to OpenAI (BR-288).
  - OpenAI API key must be stored as a Cloud Function secret/env var only — never in client binary (D-106, BR-289).
  - Function URL must be provided via `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` env var.
- `Pending`: Wire `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` env var in `.env.dev` and `.env.production` with deployed Cloud Function URL.
- `Pending`: Wire real camera capture / image picker (Expo Camera or `expo-image-picker`) into `use-meal-photo-analysis.ts` (currently deferred — hook uses stub capture state).
- `Pending`: Wire `expo-image-manipulator` (or equivalent) for client-side compression in the `compressing` state of `use-meal-photo-analysis.ts`.
- `Pending`: Wire SC-214 photo attachment toggle into existing Cloud Storage image upload pipeline once that pipeline is implemented (D-109).

## Validation Gate Before Release
- Every item in this checklist must be either `Done` or explicitly deferred in a release decision note.

## BL-002 QR Invite Scan (SC-211)
- `Done`: `expo-camera@~16.0.18` installed and `CameraView` + `useCameraPermissions` wired into `app/student/professionals.tsx`.
- `Done`: `parseQrInvitePayload` pure logic in `features/connections/qr-invite.logic.ts` handles bare codes, custom-scheme deep links, and HTTPS deep links (query-param and path-segment forms).
- `Done`: QR and manual entry paths converge at `onSubmitCode(code, surface)` — same `submitCode` hook call, same analytics events, same error branches (BR-263).
- `Done`: Camera permission denial shows inline error with fallback instruction to use manual entry (AC-249).
- `Done`: Invalid QR payload shows actionable inline error within the modal; close button allows switch to manual entry (TC-251).
- `Done`: iOS `NSCameraUsageDescription` added to `app.config.ts` `ios.infoPlist` and `expo-camera` plugin registered with `microphonePermission: false` (camera-only, no audio). Requires `expo prebuild` to propagate to native `Info.plist`.
