# Decisions Log V1

## Confirmed Decisions
- `D-001`: Role is fixed per account; switching role requires creating a new account with a different email.
- `D-002`: Professional credential capture is optional; no credential-verification workflow is included in MVP.
- `D-003`: Professional-student connection uses invite code.
- `D-004`: Assignment activation requires professional confirmation after student submits invite code.
- `D-005`: Relationship and plan history are retained after termination.
- `D-006`: Student cannot edit professionally assigned plans (read-only).
- `D-007`: Student self-managed plan is archived when professional assignment for that specialty becomes active.
- `D-008`: Professional can review archived student self-managed plan when student wants/allows it.
- `D-009`: Students never pay subscription fees.
- `D-010`: Professional accounts include free management of up to 10 active students.
- `D-011`: More than 10 active students requires paid subscription entitlement (RevenueCat-managed).
- `D-012`: Student or professional can unbind relationship at any moment.
- `D-013`: Training schema is fully customizable by professional.
- `D-014`: MVP compliance baseline is defined by Apple App Store + Google Play policy requirements for payments, privacy, account deletion, and data disclosures.
- `D-015`: MVP nutrition API provider is fatsecret Platform API.
- `D-016`: UX copy must clearly communicate self-guided usage without professional connection and use plain-language role labels.
- `D-017`: Users can create reusable custom meals with weight, calories/macros, optional ingredient cost, and log consumed grams with proportional nutrient calculation.
- `D-018`: Shared recipe links create recipient-owned copies on confirmation; recipient copies remain available even if source creator deletes original recipe.
- `D-019`: Shared recipe links do not expire automatically.
- `D-020`: Shared recipe links are not revocable by creators.
- `D-021`: Import from the same shared link by the same recipient is idempotent.
- `D-022`: Logged-out shared-link opens force login and resume exact link flow after authentication.
- `D-023`: Shared-link import payload includes nutrition fields only and excludes ingredient cost.
- `D-024`: Professional active-student cap counts unique student accounts regardless of specialty count.
- `D-025`: Account deletion retains only minimum anonymized/pseudonymized historical records required for legal, billing, security, and continuity constraints.
- `D-026`: Professional credential/verification status is not exposed as student-facing label/filter.
- `D-027`: Custom meal/recipe records use UUID as primary identifiers (including recipient-owned imported copies).
- `D-028`: Public recipe-sharing abuse baseline includes endpoint rate limiting and telemetry redaction of full link/token values.
- `D-029`: Recipe UUID version is UUIDv7.
- `D-030`: MVP auth methods are email/password, Google, and Apple.
- `D-031`: Create-account requires name, email, password, password confirmation, reveal-password controls, and password policy (8+ chars, uppercase, number, special char, no emoji).
- `D-032`: Email is globally unique per account, and social login with same email links to existing account.
- `D-033`: Role-selection route auto-redirects when role is already locked.
- `D-034`: Professionals can add specialties after onboarding; specialty removal is blocked when active or pending students exist in that specialty or when it would leave zero specialties.
- `D-035`: Credential records are separate per specialty, type `professional_registry`, max one per specialty in MVP, and skippable in no-regulator contexts.
- `D-036`: Students can view credential info only for currently assigned professionals, limited to `registry_id`, `authority`, and `country`.
- `D-037`: Professional invite code is persistent by default, revocable/regenerable on demand, and only one active code exists per professional; regeneration invalidates old code and auto-cancels pending requests created from it.
- `D-038`: Professional pending connection requests are capped at 10.
- `D-039`: Professional dashboard shows active and pending counts separately.
- `D-040`: Wrong-role route access is hard-blocked with redirect to role home.
- `D-041`: MVP offline mode is read-only cached content; writes are blocked.
- `D-042`: MVP error handling uses mixed strategy (inline + full-screen + toast).
- `D-043`: If entitlement lapses while above cap, professional new activations and student-plan updates are locked until entitlement is restored.
- `D-044`: Student home prioritizes nutrition above training and highlights pending connection status.
- `D-045`: Bottom navigation model:
  - Professional: dashboard, students, nutrition, training, account.
  - Student: home, nutrition, training, recipes, account.
- `D-046`: Password special-character policy uses ASCII punctuation symbols only; emoji and non-ASCII symbols do not satisfy the special-character requirement.
- `D-047`: Offline cached content stale policy uses 24-hour TTL with stale indicator + last-sync timestamp while preserving read-only access.
- `D-048`: Mobile client stack is React Native with Expo.
- `D-049`: Build/release pipeline must not depend on EAS services; Android/iOS native packages and CI/CD are managed independently.
- `D-050`: Backend platform baseline is Firebase (Auth, Data Connect, Cloud Storage).
- `D-051`: Social authentication is implemented through Firebase Auth providers.
- `D-052`: Firebase Crashlytics is mandatory for production crash monitoring.
- `D-053`: User-uploaded media (including recipe images) is stored in Firebase Cloud Storage.
- `D-054`: UI stack for MVP uses NativeWind (Tailwind-style React Native styling).
- `D-055`: Native projects (`ios/`, `android/`) are committed from day 1 after a single `expo prebuild`, and are then maintained directly without recurring prebuild regeneration.
- `D-056`: QA distribution strategy:
  - Release branches distribute iOS builds via TestFlight.
  - Pull requests into `develop` distribute builds via Firebase App Distribution.
- `D-057`: Client-side media compression is mandatory before upload to Firebase Cloud Storage.
- `D-058`: Non-crash monitoring tooling (for example Sentry) is out of MVP; Crashlytics is used for crashes/ANRs only.
- `D-059`: MVP update delivery strategy is store-only (no OTA channel).
- `D-060`: CI signing strategy uses platform-native secret management.
- `D-061`: Post-compression media upload limits are fixed at `<= 1.5 MB` and `<= 1600 px` on longest side.
- `D-062`: Specialty removal guard uses `active + pending` constraint (removal blocked if either exists in that specialty).
- `D-063`: Student-visible professional credential field scope is `registry_id`, `authority`, and `country`, only for currently assigned professionals.
- `D-064`: Invite-code regeneration auto-cancels pending requests tied to superseded code (audit reason: `code_rotated`).
- `D-065`: Milestone A includes a quick self-guided start action in onboarding that commits student role and routes to self-managed setup.
- `D-066`: Milestone A invite flow supports QR-code scanning with validation parity to manual invite entry.
- `D-067`: Milestone A auth/invite surfaces require reason-specific actionable error copy for known failures.
- `D-068`: Milestone A analytics taxonomy is mandatory for auth, onboarding, self-guided start, and invite funnels with structured context fields and sensitive-data redaction.
- `D-069`: Students impacted by invite-code regeneration must see explicit pending-canceled reason and reconnect CTA.
- `D-070`: Professional pending-request queue must support search/filter and bulk deny operations.
- `D-071`: Students can submit plan-change requests on assigned plans; request flow is advisory and does not grant direct edit rights.
- `D-072`: Nutrition/training plan builders include starter template library with clone-then-customize behavior.
- `D-073`: Recipe image upload UX must show progress, recoverable failure reason, and retry path while preserving draft edits.
- `D-074`: Offline core screens show persistent read-only banner and explicit write-lock reasons for blocked actions.
- `D-075`: Professional monetization flow must show pre-lapse warning before entitlement lock state.
- `D-076`: Specialty-removal blocked states include direct assist actions to resolve active/pending blockers.
- `D-077`: MVP launch includes baseline accessibility coverage for core screens (contrast, dynamic text scaling, focus order, screen-reader labels).
- `D-078`: Habit-tracking P1 scope is narrowed to water tracking only (no sleep/steps in this item), with daily intake history and streak visibility.
- `D-079`: Water goals can be set by students for self-management, and nutritionists can set/update water goals for assigned students.
- `D-080`: Plan cloning/bulk-assignment P1 scope requires named predefined plans created by professionals (for example `Caloric Deficit A/B`), with per-student fine-tuning after assignment.
- `D-081`: Effective water-goal precedence uses nutritionist-defined goal when active nutrition assignment override exists; otherwise stored student personal goal is used.
- `D-082`: Bulk-assigned plans are independent per-student copies; later edits to source predefined plans do not mutate already assigned student plans.
- `D-083`: Deferred technical wiring tasks must be tracked in `docs/discovery/pending-wiring-checklist-v1.md` and resolved before release hardening.
- `D-084`: Product localization baseline requires all user-facing strings to be provided for `en-US`, `pt-BR`, and `es-ES`.
- `D-085`: Detox is the E2E framework baseline; auth smoke scenarios are part of the test-oriented development routine for mobile flows.
- `D-086`: Create-account UI and validation are implemented; email/password sign-up is wired through Firebase Auth.
- `D-087`: Role-selection UI and quick self-guided entry are implemented before role-lock persistence/session wiring; selected role currently routes to role-specific placeholder destinations.
- `D-088`: Route-guard enforcement is implemented with Firebase Auth session state for authentication and Data Connect-backed role profile source-of-truth.
- `D-089`: Legacy backend-provider references are deprecated in project planning artifacts and replaced by Firebase equivalents; backend migration tracking is maintained in `docs/discovery/backend-provider-migration-v1.md`.
- `D-090`: Auth entry providers (email/password, Google, Apple) are wired to Firebase Auth; provider-conflict handling is best-effort and role-lock profile persistence remains pending Data Connect wiring.
- `D-091`: Native Firebase config selection follows environment-aware wiring:
  - Android uses `dev`/`production` product flavors with flavor-specific `google-services.json` files under `android/app/src/<flavor>/`.
  - iOS selects `GoogleService-Info-Dev.plist` vs `GoogleService-Info-Prod.plist`/`GoogleService-Info.plist` via Xcode build phase using `EXPO_PUBLIC_ENV` with configuration fallback.
- `D-092`: CI/CD workflow baseline is inherited from `meer` and adapted to `my-champions`:
  - Workflows cover Android/iOS PR checks, Firebase App Distribution for `develop`, and release-branch distribution pipelines.
  - This project standardizes JS dependency installation in CI with `npm ci` (not `yarn`).
- `D-093`: CI/CD secret names and requirements are governed by `docs/discovery/ci-secrets-matrix-v1.md`; workflow secret changes must update that document in the same change.
- `D-094`: CI/CD bootstrap/validation execution should be tracked through issue template `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` for operational consistency.
- `D-095`: Primary database model is Firebase Data Connect (Cloud SQL-backed); new persistence planning must not introduce Firestore as the primary domain database.
- `D-096`: Data Connect integration contract source-of-truth is `docs/specs/firebase-data-connect-integration-spec.md`; connector surface changes must update this spec in the same change.
- `D-097`: Auth role-lock persistence uses Data Connect profile-source abstraction with remote-only reads/writes; no local role-lock fallback path remains.
- `D-098`: Live Data Connect profile operation compatibility is validated through `npm run validate:data-connect:profile` against environment endpoint + auth token.
- `D-099`: Connection lifecycle Data Connect operations (invite submit, professional confirm, end connection, `getMyConnections`) follow the same HTTP-over-GraphQL pattern as the profile source (`features/auth/profile-source.ts`): Firebase ID token in `Authorization` header, typed GraphQL calls, `ConnectionSourceError` typed errors. Connection status and `canceled_reason` normalization is isolated in `features/connections/connection.logic.ts` for unit testability.
- `D-100`: Connection lifecycle screen wiring uses a `useConnections` React hook in `features/connections/use-connections.ts` as the single UI adapter over connection-source; screens import only the hook and logic types, never connection-source directly. Route guard extended in `auth-route-guard.logic.ts` to enforce `/student/*` → student-only and `/professional/*` → professional-only path prefixes.

- `D-101`: Professional screen stubs use `useState<EntitlementStatus>('unknown')` (not `const`) to prevent TypeScript literal narrowing; this pattern must be applied to all stub state that will later be replaced by live data.
- `D-102`: Phase 5 professional screens (SC-202, SC-204, SC-205, SC-206, SC-212) are implemented with stub data for Data Connect and RevenueCat wiring; all deferred items are tracked in `docs/discovery/pending-wiring-checklist-v1.md`.
- `D-103`: Phase 6 screens (SC-213, SC-214, SC-215, SC-216) are implemented with stub data for Data Connect, Cloud Storage, and deep-link resume wiring; all deferred items are tracked in `docs/discovery/pending-wiring-checklist-v1.md`. Privacy policy URL in SC-213 is a placeholder that must be replaced with the real legal URL before release.
- `D-104`: Phase 7 bottom navigation shell is implemented per D-045. Professional SC-207 (nutrition plan builder) and SC-208 (training plan builder) tabs show "coming soon" placeholders until those screens are implemented. The `(tabs)/_layout.tsx` uses `href: null` to hide role-inappropriate tabs rather than conditional rendering, keeping expo-router file-system routing intact.
- `D-105`: Accessibility baseline (BL-013, FR-217) is implemented using React Native core a11y props only — no external a11y library. Pattern applied across all implemented screens: (1) `ActivityIndicator` gets `accessibilityLabel` from `a11y.loading.*` locale keys; (2) inline error `Text` nodes are wrapped in `accessibilityLiveRegion="polite"` `View`; (3) alert banners keep `accessibilityRole="alert"`; (4) interactive rows that carry composite data (student row, stat card, assignment card) get a single `accessibilityLabel` combining all relevant fields; (5) checkbox `View` gets `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}`; (6) `MealRow` action buttons get contextual labels (`"Log <name>"`, `"Edit <name>"`, `"Share <name>"`). This covers auth, student, professional, and Phase 6 screens. Phase 9 analytics and real-service wiring remain deferred.
- `D-106`: AI meal photo analysis uses OpenAI GPT-4o Vision via a Firebase Cloud Function proxy (`analyzeMealPhoto`). The OpenAI API key is server-side only; no key is shipped in the client binary or exposed via client-accessible environment variables. Cloud Function deployed to `mychampions-fb928` (us-central1); URL: `https://us-central1-mychampions-fb928.cloudfunctions.net/analyzeMealPhoto`. OpenAI API key stored as Firebase Secret Manager secret `OPENAI_API_KEY`. `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` set in `.env` with deployed URL. Pure helper logic (`callOpenAIVision`, `parseModelContent`) in `functions/src/openai-helpers.ts` with 32 unit tests (TC-284).
- `D-107`: Camera capture and client-side image compression happen using Expo Camera / ImagePicker and `expo-image-manipulator`. The compressed image is sent as base64 in the Cloud Function request body; no Cloud Storage upload is required for the analysis step itself.
- `D-108`: AI macro estimates always pre-fill editable form fields (calories, carbs, proteins, fats, totalGrams); no auto-save without explicit user confirmation. An AI disclaimer is always shown alongside pre-filled values.
- `D-109`: In SC-214, attaching the captured photo to the meal image record is optional after analysis. Analysis-only path does not require a Cloud Storage upload; photo attachment reuses the existing image upload stub.
- `D-110`: AI analysis errors (network, quota, unrecognizable image) are recoverable. User is shown a reason-specific error message and can dismiss it to fill form fields manually. Analysis failure is never a hard failure blocking meal creation.
- `D-111`: SC-207 (Nutrition Plan Builder) and SC-208 (Training Plan Builder) are implemented as route-level screens at `/professional/nutrition/plans/:planId` and `/professional/training/plans/:planId`. The tab-level `app/professional/nutrition.tsx` and `app/professional/training.tsx` become plan library list screens showing the professional's predefined plan library with create and open CTAs.
- `D-112`: Plan builder logic (validation, totals calculation, error normalization) is isolated in `features/plans/plan-builder.logic.ts` (pure functions, no Firebase deps). Data Connect CRUD operations (create/update plan, add/remove items/sessions) are stubbed in `features/plans/plan-builder-source.ts` following the existing `gql<T>()` + `PlanSourceError` pattern. React hook `features/plans/use-plan-builder.ts` adapts source for screen consumption.
- `D-113`: Fatsecret food search is intentionally stubbed (`searchFoods` returns empty array) for SC-207 MVP; the search entry point UI is shown but wiring is deferred. Stub is tracked in `docs/discovery/pending-wiring-checklist-v1.md`.
- `D-114`: Starter templates are returned by a stub `getStarterTemplates(planType)` in plan-builder-source; the stub returns two hardcoded template stubs per plan type. Template cloning (`cloneStarterTemplate`) is also stubbed and tracked for later Data Connect wiring.
- `D-115`: BL-104 water tracker is implemented as embedded widgets in existing screens — no standalone route is created. Implementation surfaces:
  - `HydrationCard` in `app/student/home.tsx` (SC-203) — compact daily hydration summary with progress and streak.
  - `WaterWidget` in `app/student/nutrition.tsx` (SC-209) — full intake log form and personal goal form.
  - Nutritionist override goal form in `app/professional/student-profile.tsx` (SC-206) — calls `setNutritionistWaterGoalForStudent` (stub; Data Connect wiring deferred).
  - SC-220 documents the water tracker feature across all three surfaces.

- `D-116`: BL-005 plan change request flow is implemented with screen-specific localization keys per plan type (`student.nutrition.plan_change.*` for SC-209, `student.training.plan_change.*` for SC-210) rather than a single shared key group. Professional-side triage uses `pro.student_profile.plan_change_requests.*` keys in SC-206. Pure logic in `plan-change-request.logic.ts`, Data Connect stubs in `plan-source.ts` (`submitPlanChangeRequest`, `reviewPlanChangeRequest`, `getStudentPlanChangeRequests`), React hook in `use-plans.ts`. Professional notification on submission is deferred until push notification infrastructure is provisioned.

- `D-117`: BL-002 QR invite scan is implemented using `expo-camera@~16.0.18` (`CameraView` + `useCameraPermissions`). The scanner is presented as a full-screen `Modal` (no new route) to keep the implementation KISS/YAGNI. QR and manual entry paths converge at the same `submitCode` hook method per BR-263 — `onSubmitCode(code, surface)` accepts `'manual' | 'qr'` and routes to the same analytics events and error branches. Payload parsing is isolated in `features/connections/qr-invite.logic.ts` (pure, no React/Firebase deps). Path-segment extraction requires the segment to immediately follow an `invite` path segment to avoid false-positive matches on generic URL paths. Camera permission denied shows an inline error in the main screen rather than opening the modal.

- `D-118`: BL-001 quick self-guided start path is implemented in `app/auth/role-selection.tsx`. The self-guided path is executed when the user selects Student and taps Continue; this commits student role via `lockRole('student')` and routes to student home (`'/'`). Analytics event `onboarding.self_guided_start.clicked` is emitted on this Student+Continue path. Student screens (`home.tsx`, `nutrition.tsx`, `training.tsx`) display self-guided empty states with localized CTAs when no professional is connected. Empty state copy explicitly communicates "No nutritionist connected? You can still..." / "No coach connected? You can still..." per BR-226. Data Connect endpoints for connections/plans/water are required for full self-guided functionality — tracked separately in pending-wiring-checklist-v1.md.

- `D-119`: BL-003 pending-canceled-by-code-rotation notification is implemented in `features/connections/connection.logic.ts` and `app/student/professionals.tsx` (SC-211). The `canceled_code_rotated` display state is resolved when a connection record has `status='ended'` and `canceledReason='code_rotated'`. ConnectionCard renders this state with red styling (red text + red border) and displays locale key `relationship.pending.canceled_code_rotated` with actionable reconnect CTA per AC-253. All 3 locales (en-US, pt-BR, es-ES) provide clear copy explaining the code rotation and prompting reconnection. Unit tests in `connection.logic.test.ts` cover canceled_code_rotated detection and display state preservation (TC-256).

- `D-120`: Source layer functions that call Firebase/Expo SDKs cannot be unit-tested with `tsx --test` (esbuild cannot process react-native). The established pattern for source-layer testability is: (1) extract all pure decision logic (routing, mapping, normalization) into `*.logic.ts` as pure helper functions; (2) source layer calls those helpers; (3) tests cover the logic layer only. For `plan-builder-source.ts`, `deriveStarterTemplatePlanType` and `coalesceTemplateDescription` were extracted into `plan-builder.logic.ts` and covered by `plan-builder-source.test.ts`. The `StarterTemplateDeps` injection type is exported to support future integration testing if a test-runner capable of mocking node_modules is introduced.

- `D-121`: BL-008 offline banner and write-lock wiring pattern is fully applied across all 12 remaining screens (`pro/students`, `pro/student-profile`, `pro/specialty`, `pro/pending`, `pro/subscription`, `student/home`, `student/nutrition`, `student/training`, `settings/account`, `nutrition/custom-meals/index`, `nutrition/custom-meals/[mealId]`, `shared/recipes/[shareToken]`). Pattern: import `resolveOfflineDisplayState` + `useNetworkStatus`; derive `isWriteLocked` from `offlineDisplay.showOfflineBanner` (OR-ed with subscription lock where applicable); render offline banner after `Stack.Screen`; pass `disabled={isWriteLocked}` to all write-action Pressables. `lastSyncedAtIso` remains `null` pending Data Connect cache-layer implementation.

- `D-122`: BL-009 subscription pre-lapse warning copy was migrated from the legacy `pro.subscription.warning` single key to a three-key structure: `pre_lapse.title`, `pre_lapse.body`, `pre_lapse.cta_renew`. The renew CTA is a Pressable rendered inside the warning banner in `app/professional/subscription.tsx` and is gated with `disabled={isWriteLocked}` consistent with the BL-008 offline write-lock pattern. All three keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles and tracked in `localized-copy-table-v2.md`.

- `D-123`: BL-010 auth/invite error copy hardening is implemented as `mapInviteSubmitReasonToMessageKey(reason: InviteSubmitErrorReason): string` in `features/connections/connection.logic.ts`. Mapping: `code_not_found` and `code_expired` → `relationship.error.invalid_code`; `already_connected` → `relationship.error.already_connected`; `pending_cap_reached` → `relationship.error.pending_cap`; `network` → `relationship.error.network`; `configuration` and `unknown` → `relationship.error.unknown`. The three previously missing locale keys (`already_connected`, `network`, `unknown`) were added to all 3 bundles and to `localized-copy-table-v2.md`. Seven unit tests in `connection.logic.test.ts` cover every reason branch (TC-252, TC-253).

- `D-124`: BL-011 specialty removal assist screen wiring (SC-202): when `checkRemoval` returns `allowed: false`, `handleRemove` calls `resolveRemovalAssistState` (pure logic, no side effects) and stores the result in `blockedAssist` state. The `RemovalAssistCard` component renders inline (not as `Alert`) with title/body from `getRemovalBlockedMessageKeys`, and one `Pressable` action button per `buildActionMetadata` entry. Primary actions use filled tint background; secondary use outline. Tapping an action calls `router.push(meta.navigationTarget)` and resets `blockedAssist` to `null`. A dismiss CTA resets state without navigating. The new `pro.specialty.remove_blocked.dismiss` locale key was added to all 3 bundles (`en-US`: "Dismiss", `pt-BR`: "Dispensar", `es-ES`: "Descartar") and must be tracked in `localized-copy-table-v2.md`.

- `D-125`: BL-013 accessibility baseline annotation layer is complete for all MVP screens (auth, student, professional, Phase 6). Screen-reader E2E smoke test via Detox and automated color-contrast audit are explicitly deferred to release hardening — they require Detox CI wiring and design token finalization respectively. These deferred items are not blockers for BL-013 `Implemented` status.

- `D-126`: All stub source files that previously used the raw `gql<T>()` HTTP transport pattern are now wired to the Firebase Data Connect generated SDK (`@mychampions/dataconnect-generated`). Completed sources: `profile-source.ts`, `connection-source.ts`, `professional-source.ts`, `plan-source.ts`, `water-tracking-source.ts`, `custom-meal-source.ts`, `plan-builder-source.ts` (CRUD ops — starter template ops were D-114). Wiring pattern: injectable `*Deps` type with `getDataConnectInstance()` singleton + individual SDK operation functions as injectable fields; production uses `defaultDeps`; tests inject mocks. All source functions drop `user: User` first param — SDK handles auth internally. All React hooks updated from `user: User | null` to `isAuthenticated: boolean`; screens pass `Boolean(currentUser)`. Breaking API shape changes documented in the summary note in `pending-wiring-checklist-v1.md`. Test suite remained at 649 pass, 0 fail throughout.

- `D-127`: fatsecret food search is implemented via Firebase Cloud Function proxy, not by direct client calls. fatsecret OAuth 2.0 docs explicitly require tokens to be requested through a proxy server to keep credentials off devices. Pattern matches AI meal analysis (D-106/BL-108). Client-side: `features/nutrition/food-search-source.ts` calls `EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL` with a Firebase Auth ID token; response normalization (per-serving → per-100g) lives in pure helpers `normalizeFoodArray` + `normalizeFoodSearchResult` in `plan-builder.logic.ts` (TC-281, 21 unit tests). `searchFoods` in `plan-builder-source.ts` is wired. Cloud Function `searchFoods` (Gen 2, Node 20, us-central1) is deployed to `mychampions-fb928`; fatsecret Client ID and Secret stored as Firebase Secret Manager secrets only. URL: `https://us-central1-mychampions-fb928.cloudfunctions.net/searchFoods`. `EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL` is set in `.env` for dev. Production Cloud Function deployment is deferred to when the prod Firebase project is provisioned.

- `D-128`: Code review of the full `analyzeMealPhoto` (BL-108) feature identified and fixed four must-fix issues:
  1. **M1** — `PhotoAnalysisSourceError.code` was typed as loose `string`; changed to `PhotoAnalysisErrorReason` union for compile-time safety.
  2. **M2** — 401 HTTP response was incorrectly mapped to `'configuration'` error code; 401 and 403 now both map to `'unauthenticated'`. `PhotoAnalysisErrorReason` union extended with `'unauthenticated'` variant. `normalizePhotoAnalysisError` updated to handle `'unauthenticated'` code and message patterns.
  3. **M3** — Source layer had no injectable deps (no `MealPhotoAnalysisSourceDeps`), making it impossible to unit-test. `MealPhotoAnalysisSourceDeps` type added (`getFunctionUrl`, `getIdToken`, `fetchFn`), mirroring `FoodSearchSourceDeps`. All 21 unit tests in `meal-photo-analysis-source.test.ts` (TC-285) now run without any network access.
  4. **M4** — Network-level fetch catch block was routing through `normalizePhotoAnalysisError` (fragile string matching); changed to unconditionally throw `'network'`, consistent with `food-search-source.ts` pattern.
  Two should-fix issues also addressed: hook now reads `err.code` directly when `err instanceof PhotoAnalysisSourceError` (S1); 403 was not handled and fell through to `invalid_response` — now correctly mapped to `'unauthenticated'` (S4). Advisory items (S2 stub passes empty string, S3 prompt duplication, A1 max_tokens, A2 image detail level, A3 no server-side size cap, A4 auth error swallowing) noted for future hardening.

- `D-129`: BL-108 camera capture and client-side compression wired in `features/nutrition/use-meal-photo-analysis.ts`:
  - **Image picker**: `expo-image-picker@~16.0.6` (`launchCameraAsync` + `launchImageLibraryAsync`). `startCapture()` presents a native `Alert.alert` action sheet ("Take Photo" / "Choose from Library" / "Cancel") then requests the applicable permission. Cancellation or permission denial returns to `idle` without an error state.
  - **Compression**: `expo-image-manipulator@~13.0.6` (`manipulateAsync`). Resize to ≤ 1600 px longest side + JPEG compress at quality 0.75 (FR-230, BR-287, Q-022).
  - `analyze(base64Image)` kept as a public method for direct injection in integration tests.
  - **Native permissions applied manually** (no `expo prebuild` policy):
    - iOS `ios/mychampions/Info.plist`: `NSCameraUsageDescription` (QR scanning + meal photo camera) and `NSPhotoLibraryUsageDescription` (meal photo library access) added directly.
    - Android `android/app/src/main/AndroidManifest.xml`: `android.permission.CAMERA` added; `READ_EXTERNAL_STORAGE` scoped to `maxSdkVersion="32"`; `READ_MEDIA_IMAGES` added for API 33+; `WRITE_EXTERNAL_STORAGE` scoped to `maxSdkVersion="29"`.
    - `expo-camera` and `expo-image-picker` plugin entries removed from `app.config.ts` plugins array; `ios.infoPlist` entries replaced with comments. Plugin entries would conflict with manually maintained native files on any future accidental `expo prebuild` run.
  - `app.config.ts` comment documents the no-prebuild policy for all future plugin additions.

- `D-130`: RevenueCat SDK (`react-native-purchases@9.10.5`) is configured lazily inside `features/subscription/use-subscription.ts` using a module-level `sdkConfigured` singleton guard. The API key is read from `Constants.expoConfig.extra.revenueCatApiKey` (resolved from `EXPO_PUBLIC_REVENUECAT_API_KEY` env var via `app.config.ts` extra block). Lazy configuration avoids any `_layout.tsx` change and means the SDK is only initialized when the hook is first mounted by an authenticated professional. This pattern is specific to RevenueCat because its `configure()` call is idempotent and safe to call once per app session.

- `D-131`: Firebase Cloud Storage paths for meal images follow the convention `users/{uid}/meals/{mealId}/{filename}` where `filename = {timestamp}-{random}.jpg` (generated by `generateFilename()` in `use-image-upload.ts`). When `mealId` is `'new'` (create mode), the image is uploaded under that literal path segment — the file is not moved when the meal is later saved. The download URL (returned by `getDownloadURL`) is available in `uploadState` when `kind === 'done'` and can be persisted with the meal record when Data Connect meal CRUD wiring is completed.

- `D-132`: AI meal photo analysis (BL-108, SC-219) is gated behind a RevenueCat entitlement paywall. Implementation decisions:
  - **Entitlement gate**: either `professional_unlimited` OR `premium_student` entitlement `'active'` grants access. Unknown/loading status is treated as **locked** (strict policy — only `'active'` unlocks).
  - **New entitlement ID**: `premium_student` — separate RevenueCat product from `professional_unlimited`; constant `AI_ENTITLEMENT_ID = 'premium_student'` in `subscription.logic.ts`.
  - **Non-premium UX**: inline paywall banner replaces the AI CTA inside the analysis section component when neither entitlement is active.
  - **Upgrade CTA**: opens the native RevenueCat paywall via `react-native-purchases-ui@9.10.5` (`RevenueCatUI.presentPaywall`).
  - **Offering identifier**: `'ai_features'` — must be configured in the RevenueCat dashboard.
  - **Hook surface**: `useSubscription` exposes `aiEntitlementStatus`, `hasAiAccess` (derived bool), and `openAiPaywall` action. A single `getCustomerInfo()` SDK call maps both `entitlementStatus` (pro cap) and `aiEntitlementStatus` to avoid duplicate SDK calls.
  - **Source layer**: `mapCustomerInfoToAiEntitlementStatus` and `presentAiPaywall` added to `subscription-source.ts`; `presentPaywall` injectable dep added to `SubscriptionSourceDeps`.
  - **Screens**: SC-214 (`[mealId].tsx`) and SC-215 (`index.tsx`) both call `useSubscription` and thread `hasAiAccess`, `isSubscriptionLoading`, and `onOpenPaywall` into their respective analysis components.
  - **Native wiring**: React Native autolinking handles iOS/Android automatically after `npm install react-native-purchases-ui`; `pod install` + Gradle sync are required build steps before running on device/simulator.

- `D-133`: Environment model clarified as **one Firebase project + two Data Connect services** (dev/prod) within that same project. Runtime service selection is now variant-driven:
  - `APP_VARIANT=dev` -> `EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_DEV` + `EXPO_PUBLIC_DATA_CONNECT_LOCATION_DEV`
  - `APP_VARIANT=prod` -> `EXPO_PUBLIC_DATA_CONNECT_SERVICE_ID_PROD` + `EXPO_PUBLIC_DATA_CONNECT_LOCATION_PROD`
  - Shared connector id: `EXPO_PUBLIC_DATA_CONNECT_CONNECTOR_ID` (current value `mychampions`)
  `features/dataconnect.ts` now builds `getDataConnect(app, { connector, service, location })` from `Constants.expoConfig.extra.dataConnect` rather than importing a single hardcoded generated `connectorConfig`. CI workflows now set `APP_VARIANT` explicitly per lane and run `scripts/check-dataconnect-runtime-config.mjs` before build/distribution.

- `D-134`: UI redesign patterns are standardized into an in-repo design system layer (tokens + primitives + patterns) for React Native screens:
  - Tokens source-of-truth: `constants/design-system.ts` (semantic colors, spacing, radius, typography, shadow; light/dark theme mapping).
  - Primitive layer: `components/ds/primitives/*` (`DsScreen`, `DsBlobBackground`, `DsCard`, `DsPillButton`, `DsOfflineBanner`, `DsIconButton`).
  - Pattern layer: `components/ds/patterns/*` (`WeekStrip`, `ReadOnlyNoticeCard`, `HeroEmptyState`, `PlanChangeRequestCard`).
  - First adoption surfaces: `app/student/nutrition.tsx` and `app/student/training.tsx`.
  - Architectural rule: business hooks and data logic remain in screens/features; DS components remain presentation-only and localization-key driven (no hardcoded user copy).
- `D-135`: Shell/auxiliary routes (`/`, `/modal`, `/(tabs)/explore` and tab wrapper routes) remain behavior-stable but adopt DS shell structure where they render standalone UI. Tab wrapper routes are documented as pure role-based delegates to screen specs (SC-203/204/207/208/209/210/213/215), with no duplicated business logic in wrapper files.
- `D-136`: Terms acceptance is enforced as a post-auth gate before role-selection/home routing:
  - Route: `/auth/accept-terms` (SC-221).
  - Sign-in/create-account success routes send users to `/auth/accept-terms`.
  - Global guard blocks role-selection and role-home routes when required terms version is not accepted.
  - Runtime terms config source is Expo `extra.terms` (`EXPO_PUBLIC_TERMS_REQUIRED_VERSION`, `EXPO_PUBLIC_TERMS_URL`) with fallbacks `v1` and `https://google.com`.
  - Persistence is local fallback (`AsyncStorage`, per-user+version) until Data Connect profile fields/mutation for terms acceptance are added.

- `D-137`: Data Connect dev service deployment baseline (2026-03-04):
  - Local deployment source-of-truth is `dataconnect/sql/dataconnect.yaml` with:
    - `serviceId: mychampions-fb928-2-service`
    - Cloud SQL datasource `mychampions-fb928-2-instance` / `mychampions-fb928-2-database`
  - Connector GraphQL variable names are camelCase (Firebase CLI validator rejects snake_case variable names).
  - Keyed upserts include deterministic `id` values where required by generated key types:
    - `UserProfile.id` is a String key bound to Firebase UID (not UUID), and `userProfile_upsert` uses `id_expr: "auth.uid"` plus `authUid_expr: "auth.uid"`
    - `waterGoal_upsert` uses `id_expr: "auth.uid"` (student) and `id: $studentUid` (nutritionist override)
    - `credential_upsert` uses `id: $specialtyId`
  - `LogWaterIntake` now receives `dateKey` from client (no server-side `today()` expr).
  - SQL migration (`firebase dataconnect:sql:migrate --service mychampions-fb928-2-service --location us-east4 --force`) and connector deploy completed successfully.
- `D-138`: Firebase Auth initialization for React Native uses `initializeAuth(..., { persistence: getReactNativePersistence(AsyncStorage) })` in `features/auth/firebase.ts`, with fallback to `getAuth()` if already initialized. This removes in-memory-only session behavior and keeps auth state persisted across app relaunches on device/simulator.
- `D-139`: Role-lock save failure in SC-201 was traced to Data Connect key-type mismatch: `UserProfile` previously had implicit UUID key while connector mutations keyed by `id_expr: "auth.uid"`. This could not persist Firebase Auth UIDs reliably. Fix: `UserProfile.id` is now explicit `String` in schema and keyed to `auth.uid`; auth_profile connector now sets `authUid_expr: "auth.uid"` (no client-supplied `authUid` variable). Dev service `mychampions-fb928-2-service` was migrated and deployed on 2026-03-04 with regenerated SDK.
- `D-140`: Root auth-route guard normalizes pathname inputs (`//`, missing leading slash, trailing slash) and root layout de-duplicates in-flight redirects. Additionally, `app/index.tsx` now redirects to `/(tabs)` (not `/auth/sign-in`) so root auth guard remains the single owner of auth routing decisions. This removes `/` <-> `/auth/sign-in` churn and prevents React maximum-update-depth crashes.
- `D-141`: App display names are bundle/package-specific: `com.edufelip.mychampions` uses `MyChampions`, and `com.edufelip.mychampions.dev` uses `MyChampions Dev`. Android source-of-truth is flavor resource overrides; iOS source-of-truth is `APP_DISPLAY_NAME` build setting consumed by `CFBundleDisplayName`.
- `D-142`: Design-system tokens are realigned to the dashboard reference visual DNA:
  - Core palette: `accentPrimary=#13ec49`, `accentBlue=#0A2463`, `canvas(light)=#f6f8f6`, `canvas(dark)=#102215`.
  - Navigation shell now consumes DS semantic tokens for background/card/text/border/accent.
  - DS primitives/patterns remove fixed coral palette literals and rely on semantic token mapping (`onAccent`, status tones, border tiers).
  - Typography family intent is Manrope-style geometric sans; current native runtime keeps fallback families where custom font assets are not yet bundled.

## Pending Decisions
- See `docs/discovery/open-questions-v1.md`.
