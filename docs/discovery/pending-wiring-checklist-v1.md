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
- `In progress`: Replace local persisted auth session/role source with Firebase Auth session + Firestore profile source of truth.
  - Done: Firebase Auth session state drives `isAuthenticated`.
  - Done: Firebase Auth now initializes with React Native AsyncStorage persistence in `features/auth/firebase.ts` (no memory-only session warning on startup).
  - Done: Role-lock reads/writes pass through Firestore profile-source boundary (`hydrateProfileFromSource`, `lockRoleInSource`) with remote-only persistence (no local fallback path).
- `Done`: Full create-account form implemented in `app/auth/create-account.tsx` with documented password and duplicate-email validation rules.
- `Done`: Full role-selection UX implemented in `app/auth/role-selection.tsx` with role cards, required-selection validation, and self-guided Student+Continue path (no standalone quick-start button).
- `Done`: Persist and enforce role-lock flow using Firestore-backed profile source in `features/auth/profile-source.ts`, `features/auth/auth-session.tsx`, and `app/auth/role-selection.tsx`.
- `Done`: Session/route guard wiring implemented in `app/_layout.tsx` with auth-required routing and wrong-role redirects.
- `In progress`: Terms acceptance gate wiring after authentication:
  - Done: `/auth/accept-terms` route implemented; sign-in/create-account success now route to terms screen.
  - Done: Global auth guard blocks role-selection/role-home when terms acceptance is pending.
  - Done: Root auth guard path normalization + redirect de-duplication prevent replace-loop churn (fixes max update depth during terms transitions).
  - Done: Runtime terms config is environment-driven (`EXPO_PUBLIC_TERMS_REQUIRED_VERSION`, `EXPO_PUBLIC_TERMS_URL`) with fallback (`v1`, `https://google.com`).
  - Done: Accepted terms version is persisted in Firestore profile (`userProfiles/{uid}.acceptedTermsVersion`) via `setAcceptedTermsVersionInSource`; AsyncStorage fallback removed from auth-session terms flow.
- `Pending`: Emit documented auth/onboarding analytics events in real runtime telemetry.

## Native Bootstrap
- `Done`: One-time `expo prebuild` executed and native directories generated (`ios/`, `android/`) for direct maintenance going forward.
- `Done`: Native permissions policy — all native permission strings and manifest entries are applied directly to `ios/mychampions/Info.plist` and `android/app/src/main/AndroidManifest.xml`. Expo config plugins for packages with native side-effects (`expo-camera`, `expo-image-picker`) are **not** listed in `app.config.ts` plugins array to prevent accidental overwrite on any future `expo prebuild`. New packages requiring native permissions must add them directly to the native files (D-129).
- `Done`: Native app-identity drift cleanup — iOS URL schemes and Android source packages are aligned with the documented Expo/native identifiers (`com.edufelip.mychampions`, `com.edufelip.mychampions.dev`, `mychampions`), removing the legacy `com.eduardo880.mychampions` runtime reference that could break Expo dev-client launches.
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
- `Done`: SC-202 Specialty screen (`app/professional/specialty.tsx`) implemented — add/remove specialties and upsert credentials via `useSpecialties` hook stub; Firestore endpoint wiring deferred.
- `Done`: SC-204 Professional Home (`app/professional/home.tsx`) implemented — invite code display via `useInviteCode`, subscription state via `resolveSubscriptionState`; RevenueCat entitlement wired as stub `'unknown'`.
- `Done`: SC-205 Student Roster (`app/professional/students.tsx`) implemented — search + filter chip UI, FlatList with stub empty data; Firestore student-roster endpoint wiring deferred.
- `Done`: DS shell virtualization fix for list screens — `DsScreen` now supports `scrollable={false}` (non-ScrollView mode) and is applied to FlatList-backed routes (`SC-205`, `/professional/nutrition`, `/professional/training`, `SC-215`) to avoid nested VirtualizedList warnings in runtime logs.
- `Done`: SC-206 Student Profile Professional View (`app/professional/student-profile.tsx`) implemented — assignment status cards, unbind CTA, plan-change requests, water goal form; Firestore endpoint wiring deferred.
- `Done`: SC-212 Professional Subscription Gate (`app/professional/subscription.tsx`) implemented — entitlement status display, cap usage, purchase/restore/refresh CTAs; RevenueCat SDK wiring deferred.
- `Done`: Stack.Screen route registrations added in `app/_layout.tsx` for all 5 new professional screens.
- `Done`: SC-205/SC-206 now consume professional-source Firestore reads/mutations for student roster, assignment-status hydration, and unbind (`getProfessionalStudentRoster`, `getProfessionalStudentAssignmentSnapshot`, `unbindStudentConnections`).
- `Done`: SC-205 roster state arbitration hardened — initial loading and empty hero are mutually exclusive, preventing loading/empty flicker overlap.
- `Done`: Wire RevenueCat entitlement live state into SC-204, SC-206, SC-212 (replaced `useState<EntitlementStatus>('unknown')` stubs with `useSubscription()` hook; `features/subscription/subscription-source.ts` source layer with full injectable deps + 35 unit tests (TC-286); `features/subscription/use-subscription.ts` hook with lazy SDK configuration via module-level singleton guard (D-130)).

## Localization
- `Done`: All `pro.home.*`, `pro.specialty.*`, `pro.students.*`, `pro.student_profile.*`, `pro.subscription.*` keys synced across `en-US.ts`, `pt-BR.ts`, `es-ES.ts`.
- `Done`: All `settings.account.*`, `meal.builder.*`, `meal.library.*`, `shared_recipe.*` keys synced across `en-US.ts`, `pt-BR.ts`, `es-ES.ts` (Phase 6).
- `Done`: `useTranslation()` returns a locale-stable `t` function reference, reducing effect-churn re-fetch loops tied to translation callback identity.
- `Done`: Language override (`app.language.override` AsyncStorage key) is now wired into `useTranslation()` via `LocaleContext`. `LocaleProvider` wraps the app root; `useTranslation()` reads `activeLocale` from context so all components re-render immediately when the language changes. The gap where the stored override was never fed into the translation hook is resolved (D-155, SC-222).
- `Pending`: Bundle and load Manrope font assets natively (Android/iOS) so DS typography intent is guaranteed beyond platform fallback font resolution.

- `Pending`: Wire RevenueCat entitlement checks to professional cap-sensitive actions.
- `Done`: BL-009 pre-lapse warning UI implemented in `app/professional/subscription.tsx` — `pre_lapse.title`, `pre_lapse.body`, `pre_lapse.cta_renew` locale keys; renew CTA Pressable gated with `isWriteLocked`; purchase/restore CTAs also gated. Live entitlement state now wired to RevenueCat via `useSubscription()` (tracked in Professional Screen Wiring section above).

## Offline Banner + Write-Lock (BL-008)
- `Done`: `features/offline/offline.logic.ts` — pure functions: `resolveCacheFreshness`, `checkWriteLock`, `resolveOfflineDisplayState`, `buildStaleElapsed`, `isDefinitelyOffline`. Unit tests in `offline.logic.test.ts` (included in 301-test suite, TC-261).
- `Done`: `features/offline/use-network-status.ts` — React hook `useNetworkStatus` wiring `@react-native-community/netinfo`; returns `'online' | 'offline' | 'unknown'`.
- `Done`: `@react-native-community/netinfo` installed (v12.0.1).
- `Done`: `app/student/home.tsx` (SC-203) — `useNetworkStatus` replaces `networkStatus: 'online'` stub; offline banner + write-lock shown on all section cards and hydration card.
- `Done`: `app/student/nutrition.tsx` (SC-209) — `useNetworkStatus` replaces stub; offline banner + write-lock on water widget and plan-change form.
- `Done`: `app/student/training.tsx` (SC-210) — `useNetworkStatus` replaces stub; offline banner + write-lock on plan-change form.
- `Done`: `app/professional/home.tsx` (SC-204) — `useNetworkStatus` replaces stub; offline banner + write-lock on invite-code and roster CTAs.
- `Done`: All `offline.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: `app/professional/students.tsx` (SC-205) — offline banner + write-lock wired.
- `Done`: `app/professional/student-profile.tsx` (SC-206) — offline banner + write-lock wired.
- `Done`: `app/professional/specialty.tsx` (SC-202) — offline banner + write-lock wired.
- `Done`: `app/professional/pending.tsx` (SC-204/SC-205) — offline banner + write-lock wired; Accept/Deny Pressables gated.
- `Done`: `app/professional/subscription.tsx` (SC-212) — offline banner + write-lock wired; purchase/restore/renew CTAs gated.
- `Done`: `app/settings/account.tsx` (SC-213) — offline banner + write-lock wired; delete CTA gated.
- `Done`: `app/(tabs)/nutrition/custom-meals/index.tsx` (SC-215) — offline banner + write-lock wired; MealRow log+share and QuickLogPanel confirm gated.
- `Done`: `app/(tabs)/nutrition/custom-meals/[mealId].tsx` (SC-214) — offline banner + write-lock wired; Save+Share CTAs gated.
- `Done`: `app/shared/recipes/[shareToken].tsx` (SC-216) — offline banner + write-lock wired; Save CTA in PreviewView gated.
- `Pending`: Wire `lastSyncedAtIso` from real data-layer sync timestamps (currently `null` — stale indicator never shown). Deferred until Firestore cache layer is implemented.

## Professional Pending Queue Tools (BL-004)
- `Done`: `features/connections/pending-queue.logic.ts` — pure functions: `filterPendingQueue`, `canBulkDeny`, `validateBulkDeny`, `buildBulkDenyConfirmationMessage`, `formatSearchResultsSummary`. Supports search by student UID, specialty filtering, and bulk deny validation.
- `Done`: `features/connections/pending-queue.logic.test.ts` — comprehensive unit tests (26 tests, TC-257, TC-258) covering filter combinations, bulk deny validation, confirmation messaging, and edge cases.
- `Done`: `app/professional/pending.tsx` (SC-204/SC-205) — Pending connection queue fully wired with:
  * Search bar filtering by student ID (substring match, case-insensitive)
  * Row-based selection for bulk operations
  * Individual confirm/deny actions per pending request
  * Bulk deny with confirmation alert showing count and specialty distribution
  * Optimistic removal after successful bulk deny
  * Error handling with retry CTA
  * Empty state and loading indicators
- `Done`: All `pro.pending.*` localization keys present in `en-US`, `pt-BR`, and `es-ES` (`search.placeholder`, `filter.label`, `bulk_deny.cta`, `bulk_deny.confirm_title`, `bulk_deny.confirm_body`, `bulk_deny.success`, `confirm.cta`, `deny.cta`, `empty`, `error`).
- `Done`: `confirmPendingConnection` and `endConnection` are wired to Firestore in `features/connections/connection-source.ts` and consumed by `useConnections` in `app/professional/pending.tsx`.

## Professional Specialty Removal Assist (BL-011)
- `Done`: `features/professional/specialty-removal-assist.logic.ts` — pure functions: `resolveRemovalAssistState`, `buildActionMetadata`, `filterBlockersBySpecialty`, `countBlockers`, `canRemovalProceedNow`, `formatRemovalBlockedMessage`, `shouldShowBlockers`. Provides direct navigation/actions to resolve blocking conditions (active/pending students, last specialty).
- `Done`: `features/professional/specialty-removal-assist.logic.test.ts` — comprehensive unit tests (34 tests, TC-262, TC-263) covering:
  * Assist state resolution: no blockers, active students, pending students, last specialty priority order
  * Action metadata: navigation targets, labels, descriptions, priority levels
  * Blocker filtering by specialty and status
  * Blocker counting (active vs pending)
  * Removal proceed validation after assist actions
  * Blocked message formatting with proper singularization
  * Edge cases: zero total specialties, large blocker counts, mixed statuses
- `Done`: `app/professional/specialty.tsx` (SC-202) — Specialty removal flow with blocking reason display (already implemented, awaiting assist action wiring).
- `Done`: All `pro.specialty.removal_assist.*` localization keys present in `en-US`, `pt-BR`, and `es-ES` (8 keys: view_active, view_active_desc, view_pending, view_pending_desc, bulk_deny, bulk_deny_desc, add_specialty, add_specialty_desc).
- `Done`: Wire assist actions into SC-202 removal blocked state — `RemovalAssistCard` renders inline with title/body from `getRemovalBlockedMessageKeys`, action buttons from `buildActionMetadata`, and `useRouter.push` navigation to students roster, pending queue, or specialty setup; dismiss CTA clears blocked state. `pro.specialty.remove_blocked.dismiss` key added to all 3 locale bundles (D-124).
- `Done`: SC-202 specialty removal now resolves active/pending blocker counts from Firestore (`getSpecialtyBlockerCounts`) before calling `checkRemoval`; remove CTA shows assist flow from real blocker state instead of stubbed `0/0` counts.

## Plan Change Request Flow (BL-005)
- `Done`: `features/plans/plan-change-request.logic.ts` — pure functions: `validatePlanChangeRequestInput`, `normalizePlanChangeRequestStatus`, `normalizePlanType`, `normalizePlanChangeRequestError`. Unit tests in `plan-change-request.logic.test.ts` (11 tests, TC-259).
- `Done`: `features/plans/plan-source.ts` — Firestore stub surface: `submitPlanChangeRequest`, `reviewPlanChangeRequest`, `getStudentPlanChangeRequests`.
- `Done`: `features/plans/use-plans.ts` — React hook `usePlans` with `submitChangeRequest`, `validateChangeRequest`, `reviewChangeRequest`, `getChangeRequestsForStudent`.
- `Done`: `app/student/nutrition.tsx` (SC-209) — `PlanChangeRequestForm` wired to `usePlans`; full validation + error handling with all error branches and write-lock guard.
- `Done`: `app/student/training.tsx` (SC-210) — `PlanChangeRequestForm` wired to `usePlans`; full validation + error handling with improved error branches (plan_not_found, no_active_assignment, network) and write-lock guard.
- `Done`: `app/professional/student-profile.tsx` (SC-206) — `PlanChangeRequestsCard` wired to `usePlans.getChangeRequestsForStudent`; lists pending requests from specific student with review/dismiss actions via `reviewChangeRequest`; loads change requests on mount, shows load/action errors, optimistically removes reviewed/dismissed requests.
- `Done`: All `student.nutrition.plan_change.*`, `student.training.plan_change.*`, and `pro.student_profile.plan_change_requests.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: All plan-change keys tracked in `localized-copy-table-v2.md` with correct screen-specific key names.
- `Done`: Wire `submitPlanChangeRequest`, `reviewPlanChangeRequest`, and `getStudentPlanChangeRequests` to real Firestore connector endpoints replacing GraphQL stubs in `plan-source.ts` (D-126 batch).
- `Pending`: Professional notification surface when student submits a change request (UC-002.13 step 3 — system notifies professional). Deferred until push notification infrastructure is provisioned.

## Water Tracking (BL-104)
- `Done`: `features/nutrition/water-tracking.logic.ts` — pure functions: `resolveEffectiveWaterGoal`, `resolveWaterDayStatus`, `calculateWaterStreak`, `validateWaterGoalInput`, `validateWaterIntakeInput`, `normalizeWaterTrackingError`.
- `Done`: `features/nutrition/water-tracking.logic.test.ts` — unit tests included in 301-test suite (TC-264–TC-267).
- `Done`: `features/nutrition/water-tracking-source.ts` — Firestore source surface: `getMyWaterLogs`, `logWaterIntake`, `setStudentWaterGoal`, `getMyWaterGoalContext`, `setNutritionistWaterGoalForStudent`.
- `Done`: `features/nutrition/use-water-tracking.ts` — React hook with `idle/loading/ready/error` state machine, `logIntake`, `setGoal`, `validateGoal`, `validateIntake`.
- `Done`: `HydrationCard` in `app/student/home.tsx` (SC-203) — wired to `useWaterTracking`; shows progress, streak, goal ownership label.
- `Done`: `WaterWidget` in `app/student/nutrition.tsx` (SC-209) — intake log form + personal goal form wired to `useWaterTracking`.
- `Done`: Nutritionist water goal form in `app/professional/student-profile.tsx` (SC-206) — `setNutritionistWaterGoalForStudent` wired via `useWaterTracking.setGoal`.
- `Done`: All localization keys present in `en-US`, `pt-BR`, and `es-ES` (`student.hydration.*`, `student.home.hydration.*`, `student.nutrition.water.*`, `pro.student_profile.water_goal.*`).
- `Done`: Screen spec created at `docs/screens/v2/SC-220-water-tracker.md`.
- `Done`: Wire Firestore endpoints for water tracking (`getMyWaterLogs`, `logWaterIntake`, `setStudentWaterGoal`, `getMyWaterGoalContext`, `setNutritionistWaterGoalForStudent`) replacing stubs in `water-tracking-source.ts` (D-126 batch).

## Food/Plan/Data Wiring
- `In progress`: Implement Firebase Firestore profile connector contract (`getMyProfile`, `upsertUserProfile`, `setLockedRole`) and switch auth route-guard profile source to Firestore.
  - Done: App-side profile source abstraction created in `features/auth/profile-source.ts` and integrated into auth session provider.
  - Done: Firestore smoke validator added at `scripts/validate-firestore-smoke.mjs` (`npm run validate:firestore:smoke`).
  - Done: `userProfiles/{uid}` role-lock/profile hydration wiring is active with Firebase JS SDK and source-layer dependency injection.
  - Done: Client role-lock confirmation is strict-confirm only with multi-read server-only retries in `features/auth/profile-source.ts`; unconfirmed writes now throw typed diagnostics (`role_update_not_persisted`, `profile_row_not_found_after_upsert`) and do not route forward.
  - Done: TC-301 unit tests added in `features/auth/profile-source.test.ts` (Firestore-backed deps fakes).
  - In progress: Validate production Firebase project Firestore security rules and indexes.
- `In progress`: Implement Firestore connection lifecycle connectors for invite submit/confirm/end and code rotation cancellation semantics.
  - Done: Pure connection logic module created in `features/connections/connection.logic.ts` (status/reason normalization, display state resolution, error mapping).
  - Done: Firestore source module created in `features/connections/connection-source.ts` (`submitInviteCode`, `confirmPendingConnection`, `endConnection`, `getMyConnections`).
  - Done: Wire connection-source operations into app screens:
    - `app/student/professionals.tsx` (SC-211): invite code entry → `submitInviteCode`, connection list → `getMyConnections` + `resolveConnectionDisplayState`, unbind → `endConnection`. Surfaces `canceled_code_rotated` state (BL-003 / D-069).
    - `app/professional/pending.tsx` (SC-204/SC-205 subset): pending queue → `getMyConnections` (pending_confirmation filter), accept → `confirmPendingConnection`, deny/bulk deny → `endConnection`.
    - `features/connections/use-connections.ts`: React hook wrapping connection-source for UI consumption.
    - Route guard extended to block student from `/professional/*` and professional from `/student/*`.
  - Done: `scripts/validate-firestore-smoke.mjs` now validates connection lifecycle transitions (`pending_confirmation` → `active` → `ended`) and includes plan collection read/write checks under authenticated Firestore REST access.
  - Pending: Live endpoint compatibility validation for connection operations against deployed connector.
- `Done`: Food search is wired to nutrition plan builder via VPS microservice (`searchFoodsFromSource` in `features/nutrition/food-search-source.ts` and `searchFoods` in `features/plans/plan-builder-source.ts`).
- `Done`: Wire predefined plan library persistence and bulk-assignment orchestration APIs.
  - `Done`: `features/plans/plan-source.ts#getMyPredefinedPlans` now reads both `nutritionPlans` and `trainingPlans` predefined records for the authenticated professional.
  - `Done`: `features/plans/plan-source.ts#bulkAssignPredefinedPlan` now resolves source plan collection (`nutritionPlans` or `trainingPlans`) and clones independent per-student assigned copies into the matching collection with owner/source-kind guards.
- `Done`: Wire water-goal ownership precedence from live assignment + nutritionist override data.
  - `Done`: `features/nutrition/water-tracking-source.ts#getMyWaterGoalContext` now validates active nutrition assignment against live `connections` (`professionalAuthUid + studentAuthUid + specialty=nutritionist + status=active`) before applying nutritionist-goal precedence.
- `Done`: Runtime Firestore environment selection is wired by `APP_VARIANT` in `app.config.ts` with:
  - `FIREBASE_DEV_*`
  - `FIREBASE_PROD_*`
  CI workflows set `APP_VARIANT` explicitly per lane and inject matching Firebase native config files/secrets.
- `Done`: Firestore project-id mapping is pinned in env contract:
  - `FIREBASE_DEV_PROJECT_ID=mychampions-fb928` for `com.edufelip.mychampions.dev` (`APP_VARIANT=dev`).
  - `FIREBASE_PROD_PROJECT_ID=mychampions-fb928` for `com.edufelip.mychampions` (`APP_VARIANT=prod`).
  - Firebase CLI aliases added in `.firebaserc` (`dev`, `prod`) for explicit project targeting.
- `Done`: Firestore infrastructure baseline is provisioned in project `mychampions-fb928`:
  - Firestore API enabled.
  - Default Firestore database created in `us-east4`.
  - Source-controlled rules/index config added (`firestore.rules`, `firestore.indexes.json`) and deployed via `firebase deploy --only firestore:rules,firestore:indexes`.

## Bottom Navigation Shell (Phase 7)
- `Done`: `app/(tabs)/_layout.tsx` replaced with role-aware tab layout (D-045):
  - Professional: Dashboard / Students / Nutrition / Training / Account
   - Student: Home / Nutrition / Exercise / Recipes / Profile
  - Tabs not belonging to the current role are hidden via `href: null`.
- `Done`: `IconSymbol` MAPPING expanded with tab bar icon pairs (SF Symbols + Material Icons).
- `Done`: `shell.tabs.*` and `shell.placeholder.coming_soon` localization keys added to en-US, pt-BR, es-ES.
- `Done`: Tab screens created: `(tabs)/index.tsx`, `(tabs)/students.tsx`, `(tabs)/nutrition.tsx`, `(tabs)/training.tsx`, `(tabs)/recipes.tsx`, `(tabs)/account.tsx`.
- `Done`: Tab switching animation enabled globally with cross-fade transition (`animation: 'fade'`) in `app/(tabs)/_layout.tsx`.
- `Done`: White-screen mitigation on tab switching applied in `app/(tabs)/_layout.tsx` by stabilizing tab scene rendering (`lazy: false`, `detachInactiveScreens: false`, `sceneStyle.backgroundColor = theme.color.canvas`).
- `Done`: Tab-wrapper fallback hardening in `(tabs)/index`, `(tabs)/nutrition`, and `(tabs)/training` — transient unavailable `lockedRole` no longer returns `null`; wrappers now redirect to `/auth/role-selection` to avoid blank tab scenes.
- `Done`: Tab-shell persistence guard for same authenticated UID — transient auth/profile re-hydration no longer unmounts the established tabs shell.
- `Done`: Professional nutrition placeholder (`app/professional/nutrition.tsx`) and training placeholder (`app/professional/training.tsx`) created for SC-207/SC-208 (not yet implemented).
- `Done`: SC-207 Nutrition Plan Builder implemented at `app/professional/nutrition/plans/[planId].tsx`; `app/professional/nutrition.tsx` converted to predefined plan library list screen.
- `Done`: SC-208 Training Plan Builder implemented at `app/professional/training/plans/[planId].tsx`; `app/professional/training.tsx` converted to predefined plan library list screen.
- `Done`: Routes `professional/nutrition/plans/[planId]` and `professional/training/plans/[planId]` registered in `app/_layout.tsx`.
- `Done`: Student self-guided empty-state CTAs in SC-209/SC-210 now route to direct creation flows: `/student/nutrition/plans/new` and `/student/training/plans/new`.
- `In progress`: Student-specific self-managed plan builder shell for SC-209/SC-210 currently reuses shared builder screens (`app/professional/nutrition/plans/[planId].tsx`, `app/professional/training/plans/[planId].tsx`) via student route aliases. Student-branded titles/actions are applied on student-prefixed routes; follow-up required for fully dedicated student-only layout treatment.

## YMove Exercise Search (BL-106 — SC-208)
- `Done`: `features/plans/ymove-source.ts` — YMove API v2 client: `searchYMoveExercises`, `getYMoveExerciseById`; full `YMoveExercise` type (correct `instructions: string[]`, `exerciseType: string[]`, `videos: YMoveVideo[]`); `YMoveSearchResponse` using correct v2 `pagination` shape (`pageSize`, not `limit`).
- `Done`: `features/plans/use-ymove-search.ts` — `useYMoveSearch` hook with `idle/loading/error/done` state machine.
- `Done`: `features/plans/use-ymove-thumbnail.ts` — `useYMoveThumbnail(ymoveId)` hook; fetches fresh thumbnail URL on demand via `getYMoveExerciseById`; never caches URLs (API contract: pre-signed URLs expire after 48 h).
- `Done`: `components/ds/patterns/ExerciseSearchModal.tsx` — two-phase modal (search results list → exercise detail/confirm form); all strings use i18n (including `pro.plan.item.search.back`); `muscleGroup` subtitle rendered via `ymove.muscle_group.<slug>` i18n key.
- `Done`: `features/plans/components/SessionCard.tsx` — `SessionItemRow` sub-component calls `useYMoveThumbnail` per item; placeholder shown while loading or when key is absent.
- `Done`: `features/plans/plan-builder.logic.ts` — `TrainingSessionItemInput` stores only `ymoveId`; `thumbnailUrl`/`videoUrl` removed (API contract violation — URLs expire after 48 h).
- `Done`: `features/plans/plan-builder-source.ts` — `addTrainingSessionItem` persists `ymoveId`, `quantity`, `notes` to Firestore; `mapTrainingPlanDetail` reads them back; `FirestoreTrainingItem` typed explicitly.
- `Done`: All `pro.plan.item.search.*` and `ymove.muscle_group.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Pending`: Set `EXPO_PUBLIC_YMOVE_API_KEY` in `.env` once API key is obtained (https://ymove.app/exercise-api/signup). Without it the search returns empty silently.

## Plan Builder (BL-106 — SC-207, SC-208)
- `Done`: `features/plans/plan-builder.logic.ts` — pure functions: `validateNutritionPlanInput`, `validateTrainingPlanInput`, `validateTrainingSessionItemInput`, `calculateNutritionTotals`, `isStarterTemplate`, `normalizePlanBuilderError`, plus food-search normalization helpers `normalizeFoodArray`, `normalizeFoodSearchResult` and associated raw types `RawFoodSearchFood`, `RawFoodSearchServing`, `FoodSearchResult` (D-127, TC-281).
- `Done`: `features/plans/plan-builder.logic.test.ts` — 24 unit tests for `normalizeFoodArray` and `normalizeFoodSearchResult` covering per-100g scaling, single/array serving normalization, missing fields, unsupported units, rounding, empty serving array, negative serving amount, negative macro fields (TC-281). App test suite at 691 pass, 0 fail.
- `Done`: `features/plans/plan-builder-source.ts` — Firestore stub surface for nutrition CRUD (`createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, `addNutritionMealItem`, `removeNutritionMealItem`) and training CRUD (`createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, `addTrainingSession`, `removeTrainingSession`, `addTrainingSessionItem`, `removeTrainingSessionItem`), plus `getStarterTemplates`, `cloneStarterTemplate`, `searchFoods`.
- `Done`: `features/plans/use-plan-builder.ts` — `useNutritionPlanBuilder` and `useTrainingPlanBuilder` hooks with `idle/loading/ready/saving/error` state machines.
- `Done`: `app/professional/nutrition.tsx` — plan library list screen (SC-207 lib).
- `Done`: `app/professional/nutrition/plans/[planId].tsx` — nutrition plan builder screen (SC-207).
- `Done`: `app/professional/training.tsx` — plan library list screen (SC-208 lib).
- `Done`: `app/professional/training/plans/[planId].tsx` — training plan builder screen (SC-208).
- `Done`: All `pro.plan.*`, `pro.library.*`, `pro.predefined_plan.*`, `pro.template_library.*`, `pro.template.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: SC-207 and SC-208 screen specs updated to reflect actual implementation.
- `Done`: D-126 — Wire Firestore generated SDK for all plan CRUD operations replacing raw `gql<T>()` HTTP transport stubs in `plan-builder-source.ts`. Functions now use `PlanBuilderSourceDeps` injectable pattern: `createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, `addNutritionMealItem`, `removeNutritionMealItem`, `createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, `addTrainingSession`, `removeTrainingSession`, `addTrainingSessionItem`, `removeTrainingSessionItem`. All `user: User` first params dropped; hooks updated to `isAuthenticated: boolean`; screens updated to `Boolean(currentUser)` pattern. Breaking API changes handled: `food_name` vs `name`, `exercise_name` vs `name`, `session_name` vs `name`, key-only returns with re-fetch where needed, `item_id`/`session_id` only (no plan_id on removes).
- `Done`: Wire food lookup into `searchFoods` in `plan-builder-source.ts` via VPS microservice (D-113, D-127).
  - `Done`: `features/nutrition/food-search-source.ts` created — HTTP source calling `EXPO_PUBLIC_FOOD_SEARCH_SERVICE_URL` with Firebase Auth ID token; sends `{ query, maxResults, region, language }` (locale-derived region/language mapping), parses per-100g macros from service response (`carbohydrate`, `protein`, `fat`), and derives calories client-side. Injectable deps retained for testability. Pattern matches `meal-photo-analysis-source.ts` (BL-108).
  - `Done`: `searchFoods` in `plan-builder-source.ts` wired to `searchFoodsFromSource`; no longer returns empty array stub. Gets current Firebase Auth user from `getFirebaseAuth().currentUser`.
  - `Done`: `.env.example` updated with `EXPO_PUBLIC_FOOD_SEARCH_SERVICE_URL`.
  - `Done`: `EXPO_PUBLIC_FOOD_SEARCH_SERVICE_URL` set in `.env` with VPS URL `https://foodservice.eduwaldo.com/searchFoods`.
  - `Done`: `features/nutrition/food-search-source.test.ts` — unit tests cover configuration error (missing/empty URL), network errors (ID token failure, fetch failure), unauthenticated (401, 403), quota handling (`200 { error: "quota_exceeded" }`, HTTP 429), bad-request mapping (`400 { error: "bad_request" }`), upstream 502 mappings (`upstream_ip_not_allowlisted`, `upstream_error`), unknown errors (non-JSON body, generic HTTP 500), locale-to-request mapping (`region/language`), and happy paths (results returned, empty results, missing results field, invalid item filtering, numeric-string macro parsing, `serving === 100` enforcement, request contract shape) (TC-282).
  - `Done`: Legacy Firebase Functions food-search proxy surface (`searchFoods`, provider-specific helper/test files) removed from this repo; `analyzeMealPhoto` remains active.
- `Done`: `features/plans/starter-template.logic.ts` — pure logic layer with 11 functions and 88 comprehensive unit tests (BL-006, FR-212, AC-256, TC-260).
- `Done`: D-114 — `getStarterTemplates` and `cloneStarterTemplate` now run on Firestore collections through source-layer operations (no generated Data Connect SDK/runtime dependency).
- `Done`: D-114 test coverage — `deriveStarterTemplatePlanType` and `coalesceTemplateDescription` extracted as pure helpers into `plan-builder.logic.ts`. `features/plans/plan-builder-source.test.ts` added with 29 tests (TC-280) covering prefix routing, null coalescing, edge cases, boundaries, and case-sensitivity. `StarterTemplateDeps` injection type exported for future integration test expansion. Test suite at 569 pass, 0 fail.

## Account Settings & Custom Meal Screens (Phase 6)
- `Done`: SC-213 Account & Privacy Settings (`app/settings/account.tsx`) implemented — privacy policy link and account deletion confirmation flow; Firestore profile-delete wiring deferred.
- `Done`: SC-214 Custom Meal Builder (`app/(tabs)/nutrition/custom-meals/[mealId].tsx`) implemented — create/edit form with all 7 fields, image upload stub, share CTA; Firestore and Cloud Storage wiring deferred.
- `Done`: SC-215 Custom Meal Library & Quick Log (`app/(tabs)/nutrition/custom-meals/index.tsx`) implemented — FlatList of meals, quick-log grams input with nutrition preview; Firestore and portion-log persistence deferred.
- `Done`: SC-215 empty state upgraded to illustrated hero pattern — warm amber/orange `menu-book` + `restaurant` icon tiles replacing the minimal text stub; `DsPillButton` CTA with add icon; offline write-lock notice; matches production quality of student nutrition and training empty states.
- `Done`: SC-216 Shared Recipe Save Confirmation (`app/shared/recipes/[shareToken].tsx`) implemented — token preview, ownership note, import; Firestore share endpoint wiring deferred.
- `Done`: Stack.Screen route registrations added in `app/_layout.tsx` for all 4 new Phase 6 screens.
- `Done`: Wire Firestore profile-delete operation into SC-213 account deletion flow. `deleteAccountAndDataFromSource()` called in `submitDeletionRequest`; Firebase `signOut` follows immediately (after Auth user deletion) so `onAuthStateChanged` clears session state. Stub `await Promise.resolve()` removed.
- `Done`: Wire Firestore custom-meal CRUD operations into SC-214 and SC-215 (D-126 batch — `custom-meal-source.ts` rewritten with SDK; `useCustomMeals` updated to `isAuthenticated: boolean`).
- `Done`: Wire Firestore share-link generation (`createMealShareLink`) and import (`importSharedMeal`, `previewSharedMeal`) endpoints into SC-214, SC-215, SC-216 (D-126 batch — `shareLinkId` return pattern; callers updated).
- `Done`: Wire Firebase Cloud Storage image upload pipeline into SC-214 image upload stub. `features/nutrition/image-upload-source.ts` source layer with full injectable deps + 20 unit tests (TC-287); `features/nutrition/use-image-upload.ts` hook wires expo-image-picker (Alert action sheet), expo-image-manipulator compression, and `uploadBytesResumable` with progress tracking; SC-214 stub replaced with real `useImageUpload(currentUser)` call; `ImageUploadSection` `onPickAndUpload`/`onRetry` callbacks wired (D-131).
- `Done`: Persist uploaded SC-214 recipe image download URL to Firestore custom-meal records on save/update. `handleSave` now passes `uploadState.url` when upload succeeds, and `useCustomMeals` forwards `imageUrl` to `createCustomMeal`/`updateCustomMeal` (with edit fallback to existing `imageUrl` when no new upload is selected).
- `Done`: Hydrate SC-214 edit mode image upload UI from persisted `imageUrl`. When opening an existing meal, `useImageUpload.hydrateExisting()` seeds `uploadState` to `done` so the image section starts in `change photo` state even before a new upload.
- `Done`: Move SC-214/SC-215 routes under the Nutrition tab stack (`app/(tabs)/nutrition/custom-meals/*`) so bottom tab icons remain visible while navigating custom meal library/builder. Added `app/(tabs)/nutrition/_layout.tsx` stack shell and removed root-stack explicit screen registration for old standalone route files.
- `Done`: Wire portion-log persistence (Firestore) into SC-215 quick-log confirm action. `logPortionFromSource` added to `custom-meal-source.ts`; `logPortion` callback added to `use-custom-meals.ts`; `handleConfirmLog` in SC-215 calls `logPortion(meal.id, grams)` and surfaces error via `meal.library.quick_log.error` locale key. Stub `await Promise.resolve()` removed.
- `Pending`: Wire deep-link resume (post-auth redirect back to `/shared/recipes/:shareToken`) for unauthenticated share link recipients in SC-216.

## Auth/Invite Error Copy Hardening (BL-010)
- `Done`: `mapInviteSubmitReasonToMessageKey(reason: InviteSubmitErrorReason): string` added to `features/connections/connection.logic.ts`. Maps all 7 error reasons to specific locale keys per D-123.
- `Done`: 7 unit tests added to `features/connections/connection.logic.test.ts` covering every reason branch (TC-252, TC-253).
- `Done`: 3 previously missing locale keys (`relationship.error.already_connected`, `relationship.error.network`, `relationship.error.unknown`) added to `en-US`, `pt-BR`, `es-ES` and `localized-copy-table-v2.md`.
- `Done`: Wire `mapInviteSubmitReasonToMessageKey` into the `app/student/professionals.tsx` invite-submit error display path. The inline `switch` block in `onSubmitCode` is replaced by `const messageKey = mapInviteSubmitReasonToMessageKey(errorReason); setSubmitError(t(messageKey))`. Behavior is identical; duplication eliminated (D-123).

## Analytics Event Emission (Phase 9 — BL-012)- `Done`: `features/analytics/analytics.logic.ts` — pure event builder functions for all Milestone A events (auth entry viewed, sign-in submitted/failed, sign-up submitted/failed, role selected, self-guided start clicked, invite submit requested/failed/pending-created/pending-canceled) with `redactEventProperties` guard. 146 unit tests cover all builders and redaction (TC-254, TC-255).
- `Done`: `features/analytics/use-analytics.ts` — React hook wrapping `transportEvent` stub (console.log in `__DEV__`, no-op otherwise). Real SDK transport deferred (tracked below).
- `Done`: `app/auth/sign-in.tsx` — emits `auth.entry.viewed` on mount; `auth.sign_in.submitted` before each channel attempt; `auth.sign_in.failed` with `reason_code` on failure for email/password, Google, and Apple channels.
- `Done`: `app/auth/create-account.tsx` — emits `auth.entry.viewed` on mount; `auth.sign_up.submitted`/`auth.sign_up.failed` for email/password, Google, and Apple channels.
- `Done`: `app/auth/role-selection.tsx` — emits `auth.entry.viewed` on mount; `onboarding.role.selected` with `role_context` on continue; `onboarding.self_guided_start.clicked` when Student is selected and Continue is tapped.
- `Done`: `app/student/professionals.tsx` — emits `invite.submit.requested` on manual code submit; `invite.pending.created` on success; `invite.submit.failed` with `reason_code` on failure; `invite.pending.canceled` (once, via ref guard) when `canceled_code_rotated` connections surface.
- `Pending`: Wire real analytics SDK transport (Firebase Analytics, Amplitude, or equivalent) in `features/analytics/use-analytics.ts` to replace `console.log` stub. Update `pending-wiring-checklist-v1.md` when complete.
- `Pending`: Emit analytics events for professional-side Milestone A actions (pending queue confirm/deny) when SC-204/SC-205 Firestore wiring is complete.

## Accessibility Baseline (Phase 8 — BL-013)
- `Done`: All auth screens (`sign-in.tsx`, `create-account.tsx`, `role-selection.tsx`) annotated with `accessibilityLabel`, `accessibilityRole`, `accessibilityState`, and live-region wrappers on error messages.
- `Done`: All student screens (`home.tsx`, `nutrition.tsx`, `training.tsx`, `professionals.tsx`) annotated with `accessibilityLabel` on `ActivityIndicator` loading states and `accessibilityLiveRegion="polite"` on error messages.
- `Done`: All professional screens (`home.tsx`, `students.tsx`, `student-profile.tsx`, `specialty.tsx`, `subscription.tsx`, `pending.tsx`) annotated — composite `accessibilityLabel` on stat/row cards, `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}` on pending-queue selection, live-region error wrappers.
- `Done`: Phase 6 screens (`settings/account.tsx`, `nutrition/custom-meals/index.tsx`, `nutrition/custom-meals/[mealId].tsx`, `shared/recipes/[shareToken].tsx`) annotated — contextual action button labels (`"Log <name>"`, `"Edit <name>"`, `"Share <name>"`), `accessibilityRole="alert"` on error views, live-region error wrappers. Verified complete in BL-013 implementation session.
- `Done`: 7 `a11y.*` localization keys added to all three locale bundles (`en-US`, `pt-BR`, `es-ES`) and tracked in `localized-copy-table-v2.md`.
- `Done`: Accessibility baseline approach documented in `decisions-log-v1.md` as D-105 (React Native core a11y props only, no external a11y library).
- `Done`: BL-013 annotation layer complete across all MVP screens. Deferred items explicitly scoped out per D-125.
- `Pending (deferred — release hardening)`: Screen-reader end-to-end smoke test via Detox (requires Detox CI wiring, D-125).
- `Pending (deferred — release hardening)`: Color-contrast audit with automated tool (requires design token finalization, D-125).

## Media Wiring
- `Done`: Wire image compression + upload pipeline to Firebase Cloud Storage in production flow. `use-image-upload.ts` wires `expo-image-manipulator` (resize ≤ 1600 px, JPEG 0.75) + `uploadBytesResumable` with progress callbacks (D-057, D-061, D-131).
- `Done`: Wire upload progress/retry state to real network/upload events. `ImageUploadState` state machine (`idle | uploading | done | failed`) driven by `uploadBytesResumable` `state_changed` events; retry re-runs pick → compress → upload pipeline from failed state.

## AI Meal Photo Analysis (BL-108)
- `Done`: `features/nutrition/meal-photo-analysis.logic.ts` — pure functions: `isValidMacroEstimate`, `parseMacroEstimateFromResponse`, `mapMacroEstimateToMealInput`, `normalizePhotoAnalysisError`, `buildAnalysisSystemPrompt`, `buildAnalysisUserPrompt`. `PhotoAnalysisErrorReason` union includes `'unauthenticated'` (added in code-review session).
- `Done`: `features/nutrition/meal-photo-analysis.logic.test.ts` — unit tests included in 301-test suite (TC-271–TC-274); 3 new tests added for `'unauthenticated'` reason in `normalizePhotoAnalysisError`.
- `Done`: `features/nutrition/meal-photo-analysis-source.test.ts` — 21 unit tests covering all branches: `PhotoAnalysisSourceError` constructor, configuration errors, network errors (ID token failure + fetch failure always = `'network'`), unauthenticated (401 and 403), `invalid_response` (non-JSON body, bad shape, negative field), domain errors (`unrecognizable_image`, `quota_exceeded` with and without status 429, `unknown` on 500/503), and happy paths (full result shape, rounding, confidence defaulting, request body/headers, URL routing) (TC-285).
- `Done`: `features/nutrition/meal-photo-analysis-source.ts` — HTTP source `analyzeMealPhoto`: Firebase ID token header, typed `PhotoAnalysisSourceError` (code typed as `PhotoAnalysisErrorReason` union), `MealPhotoAnalysisSourceDeps` injectable pattern (mirrors `food-search-source.ts`), full response/error mapping. 401 and 403 both map to `'unauthenticated'`; network catch always throws `'network'` unconditionally.
- `Done`: `features/nutrition/use-meal-photo-analysis.ts` — React hook `useMealPhotoAnalysis` with `idle/capturing/compressing/analyzing/done/error` state machine; `startCapture` (stub), `analyze`, `reset`, `preFillMealInput`.
- `Done`: SC-214 and SC-215 wired to `useMealPhotoAnalysis` — camera CTA, result pre-fill, attach-photo toggle (SC-214 only).
- `Done`: All `meal.photo_analysis.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: SC-219 screen spec updated to reflect actual implementation.
- `Done`: Provision Firebase Cloud Function `analyzeMealPhoto` (Gen 2, Node 20, us-central1, 60s timeout, 256MiB) deployed to `mychampions-fb928`. Exact contract implemented:
  ```
  POST /analyzeMealPhoto
  Headers: Authorization: Bearer <Firebase Auth ID token>
  Body:    { image: string (base64, JPEG), mimeType: 'image/jpeg' }
  Response 200: { calories, carbs, proteins, fats, totalGrams, confidence }
  Response 400: { error: 'unrecognizable_image' } | { error: 'bad_request', message }
  Response 401: { error: 'unauthenticated' }
  Response 429: { error: 'quota_exceeded' }
  Response 500: { error: string }
  ```
  - Firebase Auth ID token verified via `admin.auth().verifyIdToken()` (BR-288).
  - OpenAI API key stored as Firebase Secret Manager secret `OPENAI_API_KEY`; compute service account granted `roles/secretmanager.secretAccessor` automatically (D-106, BR-289).
  - Pure OpenAI helper logic extracted to `functions/src/openai-helpers.ts` (`callOpenAIVision`, `parseModelContent`); handles markdown code-fence stripping, field validation, rounding, confidence defaulting.
  - `functions/src/openai-helpers.test.ts` — 32 unit tests covering `OpenAIHelperError`, `parseModelContent` (13 cases: happy path, rounding, code-fence stripping, confidence defaulting, all error paths), `callOpenAIVision` (HTTP errors, domain errors, happy paths, header/body shape), prompt constants (TC-284). Functions test suite: 46 pass, 0 fail.
  - URL: `https://us-central1-mychampions-fb928.cloudfunctions.net/analyzeMealPhoto`
- `Done`: Wire `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` in `.env.example` (blank template) and `.env` (dev URL set).
- `Done`: Wire real camera capture / image picker (`expo-image-picker@~16.0.6`) into `use-meal-photo-analysis.ts`. `startCapture()` presents an action sheet ("Take Photo" / "Choose from Library" / "Cancel"), requests the relevant permission (`requestCameraPermissionsAsync` or `requestMediaLibraryPermissionsAsync`), and launches the native picker. Cancellation returns to `idle`.
- `Done`: Wire `expo-image-manipulator@~13.0.6` for client-side JPEG compression in the `compressing` state of `use-meal-photo-analysis.ts`. Images are resized to ≤ 1600 px longest side and compressed at 0.75 JPEG quality before being sent to the Cloud Function (FR-230, BR-287, Q-022).
- `Done`: Wire SC-214 photo attachment toggle into existing Cloud Storage image upload pipeline (D-109). The `attachPhoto` toggle is preserved; when `uploadState.kind === 'done'`, `uploadState.url` is persisted with the custom meal record on save/update via Firestore custom meal create/update operations.

## AI Meal Photo Analysis Paywall Gate (BL-108, D-132)
- `Done`: `react-native-purchases-ui@9.10.5` installed. React Native autolinking handles iOS/Android; `pod install` + Gradle sync required before running on device/simulator.
- `Done`: `subscription.logic.ts` — `AI_ENTITLEMENT_ID = 'student_pro'` constant added; `hasAiAnalysisAccess(professionalEntitlement, aiEntitlement)` pure function added. 8 unit tests cover all entitlement combinations.
- `Done`: `subscription-source.ts` — `AI_FEATURES_ENTITLEMENT_ID`, `mapCustomerInfoToAiEntitlementStatus`, `presentPaywall` dep in `SubscriptionSourceDeps`, `presentAiPaywall()` function. `makeDeps()` in `subscription-source.test.ts` updated with `presentPaywall: async () => {}`; 6 + 3 new unit tests.
- `Done`: `use-subscription.ts` — `aiEntitlementStatus` state, `hasAiAccess` derived bool, `openAiPaywall` action; single `getCustomerInfo()` call maps both entitlements; `RevenueCatUI.presentPaywall` wired as production dep.
- `Done`: SC-214 (`[mealId].tsx`) — `useSubscription` call added; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` passed to `MealPhotoAnalysisSection`; paywall banner + `ActivityIndicator` loading state rendered; `paywallBanner` StyleSheet entry added.
- `Done`: SC-215 (`index.tsx`) — `useSubscription` call added; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` threaded through `QuickLogPanel` → `QuickLogAnalysisRow`; paywall banner + loading state rendered.
- `Done`: `en-US.ts`, `pt-BR.ts`, `es-ES.ts` — 3 new `meal.photo_analysis.paywall.*` keys added (`locked`, `cta_upgrade`, `loading`) to all three locale bundles.
- `Done`: `localized-copy-table-v2.md` — 3 new rows added for paywall keys.
- `Done`: SC-219, SC-214, SC-215 screen specs updated to document paywall gate, new states, user actions, accessibility notes, and implementation files.
- `Done`: `decisions-log-v1.md` — D-132 added.
- `Done`: RevenueCat dashboard products registered (D-152): `mychampions_professional_anuual` (Professional Annual), `mychampions_professional_monthly` (Professional Monthly), `student_annual` (Student Annual), `student_monthly` (Student Monthly).
- `Done`: RevenueCat entitlement `professional_pro` configured in dashboard with professional products; `student_pro` entitlement configured with student products.
- `Done`: RevenueCat offering `default_student` (`AI_OFFERING_ID`) configured in dashboard with student products for `openAiPaywall` (SC-214/SC-215); offering `default_professional` (`PRO_OFFERING_ID`) configured with professional products for `openProPaywall` (SC-212).
- `Done`: RevenueCat SDK key config in `app.config.ts` is variant-aware (D-156): `APP_VARIANT=dev` uses `EXPO_PUBLIC_REVENUECAT_API_KEY_*_DEV`, `APP_VARIANT=prod` uses `EXPO_PUBLIC_REVENUECAT_API_KEY_*_PROD`, with temporary legacy fallback to `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS/ANDROID`.
- `Done`: `presentAiPaywall` uses `AI_OFFERING_ID` (`'default_student'`); `presentProPaywall` uses `PRO_OFFERING_ID` (`'default_professional'`). Production `presentPaywall` dep in `use-subscription.ts` always resolves offering object via `Purchases.getOfferings().all[offeringIdentifier]` — symmetric path for both paywalls (D-152).
- `Done`: SC-212 Purchase CTA replaced `purchase(undefined)` (broken) with `openProPaywall()` — presents native RevenueCat paywall for professional subscription (D-152).
- `Done`: `openProPaywall` action added to `UseSubscriptionResult` and `useSubscription` hook; 3 unit tests added to `subscription-source.test.ts` covering `presentProPaywall` (TC-286 extended).

## Validation Gate Before Release
- Every item in this checklist must be either `Done` or explicitly deferred in a release decision note.

## BL-002 QR Invite Scan (SC-211)
- `Done`: `expo-camera@~16.0.18` installed and `CameraView` + `useCameraPermissions` wired into `app/student/professionals.tsx`.
- `Done`: `parseQrInvitePayload` pure logic in `features/connections/qr-invite.logic.ts` handles bare codes, custom-scheme deep links, and HTTPS deep links (query-param and path-segment forms).
- `Done`: QR and manual entry paths converge at `onSubmitCode(code, surface)` — same `submitCode` hook call, same analytics events, same error branches (BR-263).
- `Done`: Camera permission denial shows inline error with fallback instruction to use manual entry (AC-249).
- `Done`: Invalid QR payload shows actionable inline error within the modal; close button allows switch to manual entry (TC-251).
- `Done`: iOS `NSCameraUsageDescription` applied directly to `ios/mychampions/Info.plist` (no expo prebuild policy — D-055, D-129). `expo-camera` plugin is intentionally omitted from `app.config.ts` plugins array to prevent accidental overwrite on any future `expo prebuild` run.
