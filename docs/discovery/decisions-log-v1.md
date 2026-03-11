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
- `D-015`: MVP nutrition API provider is the VPS food-search microservice (`https://foodservice.eduwaldo.com/searchFoods`).
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
   - Student: home, nutrition, exercise, recipes, profile.
- `D-046`: Password special-character policy uses ASCII punctuation symbols only; emoji and non-ASCII symbols do not satisfy the special-character requirement.
- `D-047`: Offline cached content stale policy uses 24-hour TTL with stale indicator + last-sync timestamp while preserving read-only access.
- `D-048`: Mobile client stack is React Native with Expo.
- `D-049`: Build/release pipeline must not depend on EAS services; Android/iOS native packages and CI/CD are managed independently.
- `D-050`: Backend platform baseline is Firebase (Auth, Firestore, Cloud Storage).
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
- `D-079`: Water goals are authored in nutrition plan create/edit flows: self-guided students define their personal hydration goal in self-managed plan builder, and nutritionists define assigned-student hydration goals in professional plan authoring.
- `D-080`: Plan cloning/bulk-assignment P1 scope requires named predefined plans created by professionals (for example `Caloric Deficit A/B`), with per-student fine-tuning after assignment.
- `D-081`: Effective water-goal precedence uses nutritionist-defined goal when active nutrition assignment override exists; otherwise stored student personal goal is used.
- `D-082`: Bulk-assigned plans are independent per-student copies; later edits to source predefined plans do not mutate already assigned student plans.
- `D-083`: Deferred technical wiring tasks must be tracked in `docs/discovery/pending-wiring-checklist-v1.md` and resolved before release hardening.
- `D-084`: Product localization baseline requires all user-facing strings to be provided for `en-US`, `pt-BR`, and `es-ES`.
- `D-085`: Detox is the E2E framework baseline; auth smoke scenarios are part of the test-oriented development routine for mobile flows.
- `D-086`: Create-account UI and validation are implemented; email/password sign-up is wired through Firebase Auth.
- `D-087`: Role-selection UI and quick self-guided entry are implemented with Firestore-backed role-lock persistence/session wiring; selected role now routes to concrete journeys (`student` -> `/`, `professional` -> `/professional/specialty`).
- `D-088`: Route-guard enforcement is implemented with Firebase Auth session state for authentication and Firestore-backed role profile source-of-truth.
- `D-089`: Legacy backend-provider references are deprecated in project planning artifacts and replaced by Firebase equivalents; backend migration tracking is maintained in `docs/discovery/backend-provider-migration-v1.md`.
- `D-090`: Auth entry providers (email/password, Google, Apple) are wired to Firebase Auth; provider-conflict handling is best-effort and role-lock profile persistence remains pending Firestore wiring.
- `D-091`: Native Firebase config selection follows environment-aware wiring:
  - Android uses `dev`/`production` product flavors with flavor-specific `google-services.json` files under `android/app/src/<flavor>/`.
  - iOS selects `GoogleService-Info-Dev.plist` vs `GoogleService-Info-Prod.plist`/`GoogleService-Info.plist` via Xcode build phase using `EXPO_PUBLIC_ENV` with configuration fallback.
- `D-092`: CI/CD workflow baseline is inherited from `meer` and adapted to `my-champions`:
  - Workflows cover Android/iOS PR checks, Firebase App Distribution for `develop`, and release-branch distribution pipelines.
  - This project standardizes JS dependency installation in CI with `npm ci` (not `yarn`).
- `D-093`: CI/CD secret names and requirements are governed by `docs/discovery/ci-secrets-matrix-v1.md`; workflow secret changes must update that document in the same change.
- `D-094`: CI/CD bootstrap/validation execution should be tracked through issue template `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` for operational consistency.
- `D-095`: Primary database model is Firebase Cloud Firestore (document database). New persistence planning must not reintroduce Firebase Data Connect as an app-domain runtime dependency.
- `D-096`: Firestore integration contract source-of-truth is `docs/specs/firebase-firestore-integration-spec.md`; Firestore collection contracts and source-layer behavior changes must update this spec in the same change.
- `D-097`: Auth role-lock persistence uses Firestore profile-source abstraction with remote-only reads/writes; no local role-lock fallback path remains.
- `D-098`: Live Firestore operation compatibility is validated through `npm run validate:firestore:smoke` using Firebase Auth ID token (`FIRESTORE_ID_TOKEN`) and current variant Firebase project config.
- `D-099`: Connection lifecycle operations (`submitInviteCode`, `confirmPendingConnection`, `endConnection`, `getMyConnections`) are implemented in `features/connections/connection-source.ts` using `firebase/firestore` queries/updates/transactions with typed source-layer errors and logic-layer normalization.
- `D-100`: Connection lifecycle screen wiring uses a `useConnections` React hook in `features/connections/use-connections.ts` as the single UI adapter over connection-source; screens import only the hook and logic types, never connection-source directly. Route guard extended in `auth-route-guard.logic.ts` to enforce `/student/*` → student-only and `/professional/*` → professional-only path prefixes.

- `D-101`: Professional screen stubs use `useState<EntitlementStatus>('unknown')` (not `const`) to prevent TypeScript literal narrowing; this pattern must be applied to all stub state that will later be replaced by live data.
- `D-102`: Phase 5 professional screens (SC-202, SC-204, SC-205, SC-206, SC-212) are implemented with stub data for Firestore and RevenueCat wiring; all deferred items are tracked in `docs/discovery/pending-wiring-checklist-v1.md`.
- `D-103`: Phase 6 screens (SC-213, SC-214, SC-215, SC-216) are implemented with stub data for Firestore, Cloud Storage, and deep-link resume wiring; all deferred items are tracked in `docs/discovery/pending-wiring-checklist-v1.md`. Privacy policy URL in SC-213 is a placeholder that must be replaced with the real legal URL before release.
- `D-104`: Phase 7 bottom navigation shell is implemented per D-045. Professional SC-207 (nutrition plan builder) and SC-208 (training plan builder) tabs show "coming soon" placeholders until those screens are implemented. The `(tabs)/_layout.tsx` uses `href: null` to hide role-inappropriate tabs rather than conditional rendering, keeping expo-router file-system routing intact.
- `D-105`: Accessibility baseline (BL-013, FR-217) is implemented using React Native core a11y props only — no external a11y library. Pattern applied across all implemented screens: (1) `ActivityIndicator` gets `accessibilityLabel` from `a11y.loading.*` locale keys; (2) inline error `Text` nodes are wrapped in `accessibilityLiveRegion="polite"` `View`; (3) alert banners keep `accessibilityRole="alert"`; (4) interactive rows that carry composite data (student row, stat card, assignment card) get a single `accessibilityLabel` combining all relevant fields; (5) checkbox `View` gets `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}`; (6) `MealRow` action buttons get contextual labels (`"Log <name>"`, `"Edit <name>"`, `"Share <name>"`). This covers auth, student, professional, and Phase 6 screens. Phase 9 analytics and real-service wiring remain deferred.
- `D-106`: AI meal photo analysis uses OpenAI GPT-4o Vision via a Firebase Cloud Function proxy (`analyzeMealPhoto`). The OpenAI API key is server-side only; no key is shipped in the client binary or exposed via client-accessible environment variables. Cloud Function deployed to `mychampions-fb928` (us-central1); URL: `https://us-central1-mychampions-fb928.cloudfunctions.net/analyzeMealPhoto`. OpenAI API key stored as Firebase Secret Manager secret `OPENAI_API_KEY`. `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` set in `.env` with deployed URL. Pure helper logic (`callOpenAIVision`, `parseModelContent`) in `functions/src/openai-helpers.ts` with 32 unit tests (TC-284).
- `D-107`: Camera capture and client-side image compression happen using Expo Camera / ImagePicker and `expo-image-manipulator`. The compressed image is sent as base64 in the Cloud Function request body; no Cloud Storage upload is required for the analysis step itself.
- `D-108`: AI macro estimates always pre-fill editable form fields (calories, carbs, proteins, fats, totalGrams); no auto-save without explicit user confirmation. An AI disclaimer is always shown alongside pre-filled values.
- `D-109`: In SC-214, attaching the captured photo to the meal image record is optional after analysis. Analysis-only path does not require a Cloud Storage upload; photo attachment reuses the existing image upload stub.
- `D-110`: AI analysis errors (network, quota, unrecognizable image) are recoverable. User is shown a reason-specific error message and can dismiss it to fill form fields manually. Analysis failure is never a hard failure blocking meal creation.
- `D-111`: SC-207 (Nutrition Plan Builder) and SC-208 (Training Plan Builder) are implemented as route-level screens at `/professional/nutrition/plans/:planId` and `/professional/training/plans/:planId`. The tab-level `app/professional/nutrition.tsx` and `app/professional/training.tsx` become plan library list screens showing the professional's predefined plan library with create and open CTAs.
- `D-112`: Plan builder logic (validation, totals calculation, error normalization) is isolated in `features/plans/plan-builder.logic.ts` (pure functions, no Firebase deps). Firestore CRUD operations (create/update plan, add/remove items/sessions) are stubbed in `features/plans/plan-builder-source.ts` following the existing `gql<T>()` + `PlanSourceError` pattern. React hook `features/plans/use-plan-builder.ts` adapts source for screen consumption.
- `D-113`: Legacy Firebase `searchFoods` Cloud Function integration has been decommissioned. SC-207 food search now uses the VPS food-search microservice with Firebase ID token authorization.
- `D-114`: Starter templates are returned by a stub `getStarterTemplates(planType)` in plan-builder-source; the stub returns two hardcoded template stubs per plan type. Template cloning (`cloneStarterTemplate`) is also stubbed and tracked for later Firestore wiring.
- `D-115`: BL-104 water tracker is implemented as embedded widgets in existing screens — no standalone route is created. Implementation surfaces:
  - `HydrationCard` in `app/student/home.tsx` (SC-203) — compact daily hydration summary with progress and streak.
  - `WaterWidget` in `app/student/nutrition.tsx` (SC-209) — full intake log form with effective-goal progress, no direct goal-edit form.
  - Nutrition plan builders in `app/professional/nutrition/plans/[planId].tsx` and `/student/nutrition/plans/[planId]` (SC-207 alias) own hydration-goal authoring.
  - SC-220 documents the water tracker feature and goal-authoring boundaries across these surfaces.

- `D-116`: BL-005 plan change request flow is implemented with screen-specific localization keys per plan type (`student.nutrition.plan_change.*` for SC-209, `student.training.plan_change.*` for SC-210) rather than a single shared key group. Professional-side triage uses `pro.student_profile.plan_change_requests.*` keys in SC-206. Pure logic in `plan-change-request.logic.ts`, Firestore stubs in `plan-source.ts` (`submitPlanChangeRequest`, `reviewPlanChangeRequest`, `getStudentPlanChangeRequests`), React hook in `use-plans.ts`. Professional notification on submission is deferred until push notification infrastructure is provisioned.

- `D-117`: BL-002 QR invite scan is implemented using `expo-camera@~16.0.18` (`CameraView` + `useCameraPermissions`). The scanner is presented as a full-screen `Modal` (no new route) to keep the implementation KISS/YAGNI. QR and manual entry paths converge at the same `submitCode` hook method per BR-263 — `onSubmitCode(code, surface)` accepts `'manual' | 'qr'` and routes to the same analytics events and error branches. Payload parsing is isolated in `features/connections/qr-invite.logic.ts` (pure, no React/Firebase deps). Path-segment extraction requires the segment to immediately follow an `invite` path segment to avoid false-positive matches on generic URL paths. Camera permission denied shows an inline error in the main screen rather than opening the modal.

- `D-118`: BL-001 quick self-guided start path is implemented in `app/auth/role-selection.tsx`. The self-guided path is executed when the user selects Student and taps Continue; this commits student role via `lockRole('student')` and routes to student home (`'/'`). Analytics event `onboarding.self_guided_start.clicked` is emitted on this Student+Continue path. Student screens (`home.tsx`, `nutrition.tsx`, `training.tsx`) display self-guided empty states with localized CTAs when no professional is connected. Empty state copy explicitly communicates "No nutritionist connected? You can still..." / "No coach connected? You can still..." per BR-226. Firestore endpoints for connections/plans/water are required for full self-guided functionality — tracked separately in pending-wiring-checklist-v1.md.

- `D-119`: BL-003 pending-canceled-by-code-rotation notification is implemented in `features/connections/connection.logic.ts` and `app/student/professionals.tsx` (SC-211). The `canceled_code_rotated` display state is resolved when a connection record has `status='ended'` and `canceledReason='code_rotated'`. ConnectionCard renders this state with red styling (red text + red border) and displays locale key `relationship.pending.canceled_code_rotated` with actionable reconnect CTA per AC-253. All 3 locales (en-US, pt-BR, es-ES) provide clear copy explaining the code rotation and prompting reconnection. Unit tests in `connection.logic.test.ts` cover canceled_code_rotated detection and display state preservation (TC-256).

- `D-120`: Source layer functions that call Firebase/Expo SDKs cannot be unit-tested with `tsx --test` (esbuild cannot process react-native). The established pattern for source-layer testability is: (1) extract all pure decision logic (routing, mapping, normalization) into `*.logic.ts` as pure helper functions; (2) source layer calls those helpers; (3) tests cover the logic layer only. For `plan-builder-source.ts`, `deriveStarterTemplatePlanType` and `coalesceTemplateDescription` were extracted into `plan-builder.logic.ts` and covered by `plan-builder-source.test.ts`. The `StarterTemplateDeps` injection type is exported to support future integration testing if a test-runner capable of mocking node_modules is introduced.

- `D-121`: BL-008 offline banner and write-lock wiring pattern is fully applied across all 12 remaining screens (`pro/students`, `pro/student-profile`, `pro/specialty`, `pro/pending`, `pro/subscription`, `student/home`, `student/nutrition`, `student/training`, `settings/account`, `nutrition/custom-meals/index`, `nutrition/custom-meals/[mealId]`, `shared/recipes/[shareToken]`). Pattern: import `resolveOfflineDisplayState` + `useNetworkStatus`; derive `isWriteLocked` from `offlineDisplay.showOfflineBanner` (OR-ed with subscription lock where applicable); render offline banner after `Stack.Screen`; pass `disabled={isWriteLocked}` to all write-action Pressables. `lastSyncedAtIso` remains `null` pending Firestore cache-layer implementation.

- `D-122`: BL-009 subscription pre-lapse warning copy was migrated from the legacy `pro.subscription.warning` single key to a three-key structure: `pre_lapse.title`, `pre_lapse.body`, `pre_lapse.cta_renew`. The renew CTA is a Pressable rendered inside the warning banner in `app/professional/subscription.tsx` and is gated with `disabled={isWriteLocked}` consistent with the BL-008 offline write-lock pattern. All three keys are present in `en-US`, `pt-BR`, and `es-ES` locale bundles and tracked in `localized-copy-table-v2.md`.

- `D-123`: BL-010 auth/invite error copy hardening is implemented as `mapInviteSubmitReasonToMessageKey(reason: InviteSubmitErrorReason): string` in `features/connections/connection.logic.ts`. Mapping: `code_not_found` and `code_expired` → `relationship.error.invalid_code`; `already_connected` → `relationship.error.already_connected`; `pending_cap_reached` → `relationship.error.pending_cap`; `network` → `relationship.error.network`; `configuration` and `unknown` → `relationship.error.unknown`. The three previously missing locale keys (`already_connected`, `network`, `unknown`) were added to all 3 bundles and to `localized-copy-table-v2.md`. Seven unit tests in `connection.logic.test.ts` cover every reason branch (TC-252, TC-253).

- `D-124`: BL-011 specialty removal assist screen wiring (SC-202): when `checkRemoval` returns `allowed: false`, `handleRemove` calls `resolveRemovalAssistState` (pure logic, no side effects) and stores the result in `blockedAssist` state. The `RemovalAssistCard` component renders inline (not as `Alert`) with title/body from `getRemovalBlockedMessageKeys`, and one `Pressable` action button per `buildActionMetadata` entry. Primary actions use filled tint background; secondary use outline. Tapping an action calls `router.push(meta.navigationTarget)` and resets `blockedAssist` to `null`. A dismiss CTA resets state without navigating. The new `pro.specialty.remove_blocked.dismiss` locale key was added to all 3 bundles (`en-US`: "Dismiss", `pt-BR`: "Dispensar", `es-ES`: "Descartar") and must be tracked in `localized-copy-table-v2.md`.

- `D-125`: BL-013 accessibility baseline annotation layer is complete for all MVP screens (auth, student, professional, Phase 6). Screen-reader E2E smoke test via Detox and automated color-contrast audit are explicitly deferred to release hardening — they require Detox CI wiring and design token finalization respectively. These deferred items are not blockers for BL-013 `Implemented` status.

- `D-126`: All app-domain source modules are cut over from Firebase Data Connect/generated SDK usage to Firebase JS Firestore (`firebase/firestore`) while preserving hook/screen-facing contracts. Completed sources: `profile-source.ts`, `connection-source.ts`, `professional-source.ts`, `plan-source.ts`, `water-tracking-source.ts`, `custom-meal-source.ts`, `plan-builder-source.ts`. Wiring pattern remains injectable `*Deps` with production `defaultDeps` and test doubles. Source functions continue to avoid direct screen coupling; hooks remain the UI adapter boundary.

- `D-127`: Food search is implemented via external VPS microservice (`https://foodservice.eduwaldo.com/searchFoods`) from `features/nutrition/food-search-source.ts`, using `Authorization: Bearer <Firebase ID token>`. Request body uses `{ query, maxResults, region, language }`, where `region/language` are derived from effective app locale (language override first, device locale fallback; mapping `en-US -> us/en`, `pt-BR -> br/pt`, `es-ES -> es/es`, fallback `us/en`). Response parsing uses per-100g macros (`carbohydrate`, `protein`, `fat`) with tolerant numeric parsing (`number` or numeric `string`), enforces `serving === 100`, and derives calories client-side (`4/4/9`). The app reads `EXPO_PUBLIC_FOOD_SEARCH_SERVICE_URL`, maps HTTP `429` and `200 { "error": "quota_exceeded" }` to quota-style errors, maps upstream 502 error bodies (`upstream_ip_not_allowlisted`, `upstream_error`) to network-style errors, and no longer depends on Firebase `searchFoods` Cloud Function secrets.

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

- `D-130`: RevenueCat SDK (`react-native-purchases@9.10.5`) is configured lazily inside `features/subscription/use-subscription.ts` using a module-level `sdkConfigured` singleton guard. API keys are platform-specific and read from `Constants.expoConfig.extra.revenueCatApiKeyIos` and `Constants.expoConfig.extra.revenueCatApiKeyAndroid` (resolved from `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` in `app.config.ts`). Runtime validation rejects secret keys (`sk_*`) and invalid platform prefixes; only public SDK keys are accepted (`appl_*` for iOS, `goog_*` for Android). Lazy configuration avoids any `_layout.tsx` change and means the SDK is only initialized when the hook is first mounted by an authenticated professional. This pattern is specific to RevenueCat because its `configure()` call is idempotent and safe to call once per app session.

- `D-131`: Firebase Cloud Storage paths for meal images follow the convention `users/{uid}/meals/{mealId}/{filename}` where `filename = {timestamp}-{random}.jpg` (generated by `generateFilename()` in `use-image-upload.ts`). When `mealId` is `'new'` (create mode), the image is uploaded under that literal path segment — the file is not moved when the meal is later saved. The download URL (returned by `getDownloadURL`) is persisted with the custom meal record via Firestore `createCustomMeal` / `updateCustomMeal`; update flow falls back to existing `imageUrl` when no new upload is selected. SC-214 edit mode hydrates `uploadState` from persisted `imageUrl` so image UI starts in `done/change photo` state for existing meals.

- `D-132`: AI meal photo analysis (BL-108, SC-219) is gated behind a RevenueCat entitlement paywall. Implementation decisions:
  - **Entitlement gate**: either `professional_pro` OR `student_pro` entitlement `'active'` grants access. Unknown/loading status is treated as **locked** (strict policy — only `'active'` unlocks).
  - **New entitlement ID**: `student_pro` — separate RevenueCat product from `professional_pro`; constant `AI_ENTITLEMENT_ID = 'student_pro'` in `subscription.logic.ts`.
  - **Non-premium UX**: inline paywall banner replaces the AI CTA inside the analysis section component when neither entitlement is active.
  - **Upgrade CTA**: opens the native RevenueCat paywall via `react-native-purchases-ui@9.10.5` (`RevenueCatUI.presentPaywall`).
  - **Offering identifier**: `'default_student'` (`AI_OFFERING_ID`) — must be configured in the RevenueCat dashboard.
  - **Hook surface**: `useSubscription` exposes `aiEntitlementStatus`, `hasAiAccess` (derived bool), and `openAiPaywall` action. A single `getCustomerInfo()` SDK call maps both `entitlementStatus` (pro cap) and `aiEntitlementStatus` to avoid duplicate SDK calls.
  - **Source layer**: `mapCustomerInfoToAiEntitlementStatus` and `presentAiPaywall` added to `subscription-source.ts`; `presentPaywall` injectable dep added to `SubscriptionSourceDeps`.
  - **Screens**: SC-214 (`[mealId].tsx`) and SC-215 (`index.tsx`) both call `useSubscription` and thread `hasAiAccess`, `isSubscriptionLoading`, and `onOpenPaywall` into their respective analysis components.
  - **Native wiring**: React Native autolinking handles iOS/Android automatically after `npm install react-native-purchases-ui`; `pod install` + Gradle sync are required build steps before running on device/simulator.

- `D-133`: Environment model is variant-driven Firebase config selection via `APP_VARIANT`:
  - `APP_VARIANT=dev` -> `FIREBASE_DEV_*`
  - `APP_VARIANT=prod` -> `FIREBASE_PROD_*`
  `app.config.ts` resolves variant Firebase config into Expo `extra.firebase`. `features/firestore.ts` uses the initialized Firebase app and `getFirestore(...)` (no Data Connect runtime config).

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
  - Persistence is Firestore-backed via `userProfiles/{uid}.acceptedTermsVersion` in `features/auth/profile-source.ts`; auth session no longer relies on AsyncStorage for terms acceptance state.

- `D-137`: Firestore cutover baseline (2026-03-06):
  - Data Connect runtime/schema artifacts are removed from app runtime (`features/dataconnect.ts`, `features/dataconnect-generated/`, `dataconnect/`).
  - Source modules use direct Firestore collections/documents as the app-domain persistence contract.
  - Runtime/env contract for persistence is Firebase config only (`FIREBASE_DEV_*`, `FIREBASE_PROD_*`, `APP_VARIANT`).
  - Validation baseline is `npm run validate:firestore:smoke`.
- `D-138`: Firebase Auth initialization for React Native uses `initializeAuth(..., { persistence: getReactNativePersistence(AsyncStorage) })` in `features/auth/firebase.ts`, with fallback to `getAuth()` if already initialized. This removes in-memory-only session behavior and keeps auth state persisted across app relaunches on device/simulator.
- `D-139`: Role-lock save failure in SC-201 was traced to Firestore key-type mismatch: `UserProfile` previously had implicit UUID key while connector mutations keyed by `id_expr: "auth.uid"`. This could not persist Firebase Auth UIDs reliably. Fix: `UserProfile.id` is now explicit `String` in schema and keyed to `auth.uid`; auth_profile connector now sets `authUid_expr: "auth.uid"` (no client-supplied `authUid` variable). Dev service `mychampions-fb928-2-service` was migrated and deployed on 2026-03-04 with regenerated SDK.
- `D-140`: Root auth-route guard normalizes pathname inputs (`//`, missing leading slash, trailing slash) and root layout de-duplicates in-flight redirects. Additionally, `app/index.tsx` now redirects to `/(tabs)` (not `/auth/sign-in`) so root auth guard remains the single owner of auth routing decisions. This removes `/` <-> `/auth/sign-in` churn and prevents React maximum-update-depth crashes.
- `D-141`: App display names are bundle/package-specific: `com.edufelip.mychampions` uses `MyChampions`, and `com.edufelip.mychampions.dev` uses `MyChampions Dev`. Android source-of-truth is flavor resource overrides; iOS source-of-truth is `APP_DISPLAY_NAME` build setting consumed by `CFBundleDisplayName`.
- `D-142`: Design-system tokens are realigned to the dashboard reference visual DNA:
  - Core palette: `accentPrimary=#1ea95a`, `accentBlue=#0A2463`, `canvas(light)=#f6f8f6`, `canvas(dark)=#102215`.
  - Navigation shell now consumes DS semantic tokens for background/card/text/border/accent.
  - DS primitives/patterns remove fixed coral palette literals and rely on semantic token mapping (`onAccent`, status tones, border tiers).
  - Typography family intent is Manrope-style geometric sans; current native runtime keeps fallback families where custom font assets are not yet bundled.
- `D-143`: Tokenization completion pass for app surfaces:
  - Hardcoded hex literals were removed from `app/` and `components/` presentation layers (excluding token source in `constants/design-system.ts`).
  - Remaining UI color usage is routed through semantic DS tokens (`getDsTheme`) or DS primitives/patterns.
  - Auth, student, professional, and settings surfaces now share the same semantic status/CTA color model.

- `D-144`: SC-213 Account & Privacy Settings expanded from a minimal compliance stub to a production-ready settings screen. Decisions applied:
  - **Change password**: `sendPasswordResetEmail` (Firebase Auth) is triggered for `password` provider accounts only. OAuth users (Google, Apple) receive an informational alert noting their provider manages the password. Row is always visible; provider detection is runtime.
  - **Language switcher**: User-selectable in-app locale override persisted to `AsyncStorage` via `features/auth/language-storage.ts` (key: `app.language.override`). Takes effect on next app launch; no server sync required. Supported locales: `en-US`, `pt-BR`, `es-ES`. iOS uses `ActionSheetIOS`; Android uses `Alert` with locale options.
  - **Contact support**: `mailto:support@mychampions.app` opened via `Linking.openURL`. Zero infrastructure required for MVP.
  - **Sign out**: Dedicated CTA above the danger zone; confirmation alert before `clearSession()` + `signOut()`. Previously sign-out only occurred as a side-effect of account deletion.
  - **Profile header**: Avatar initials from `displayName` → email prefix → `?`. Role badge pill uses DS `accentBlue` tokens.
  - **Privacy policy / Terms URLs**: Remain placeholder (`example.com`) per D-103; must be replaced with production URLs before release.

- `D-145`: `DsScreen` now supports a non-scroll shell mode (`scrollable={false}`) for routes that render VirtualizedList-based content (`FlatList`/`SectionList`). This prevents React Native runtime warnings about nested VirtualizedLists inside same-orientation `ScrollView` containers and preserves list windowing behavior. Applied to `SC-205` (`/professional/students`), professional plan library routes (`/professional/nutrition`, `/professional/training`), and `SC-215` (`/nutrition/custom-meals`).

- `D-146`: Tab wrapper route `/(tabs)/recipes` renders `SC-215` (`/nutrition/custom-meals`) with `hideHeader=true` so the recipes tab does not show an extra local toolbar/header inside the tabs shell. SC-214/SC-215 route files now live under `app/(tabs)/nutrition/custom-meals/*` so `/nutrition/custom-meals` and `/nutrition/custom-meals/:mealId` remain in the tabs navigator and keep bottom tab icons visible.

- `D-147`: Native navigation toolbar is disabled app-wide (`headerShown: false`) so navigation chrome is fully controlled by screen UI. For pushed routes that need return navigation, screens must provide explicit in-content back controls. Screen content must also respect top safe area insets when toolbar is absent. SC-211 (`/student/professionals`) now uses an icon-only back button.

- `D-148`: Student empty-state self-guided actions in SC-209 and SC-210 now route to direct self-managed plan creation flows (`/student/nutrition/plans/new`, `/student/training/plans/new`) instead of returning to Home. Current implementation reuses shared plan builder screens to keep plan authoring behavior consistent and applies student-branded titles/actions on student-prefixed routes while broader student-only shell refinements remain pending.

- `D-149`: SC-201 role-lock persistence enforces strict remote confirmation: after `setLockedRole` mutation, client performs multi-attempt **server-only** confirmation reads and only routes forward when `getMyProfile` confirms `lockedRole`. If confirmation remains stale after retries, role selection returns `auth.role.error.save_failed` and user stays on role-selection (no mutation-ack fallback routing).
- `D-157`: Role-lock failure diagnostics are hardened for dev troubleshooting:
  - Client logs pre-lock profile snapshot (`exists`, `lockedRole`, `hasAuthUidMismatch`) before attempting `setLockedRole`.
  - Each server-only confirmation retry logs snapshot fields and attempt index.
  - When `setLockedRole` returns a key but confirmed role remains `null`, client throws typed `ProfileSourceError` code `role_update_not_persisted` (distinct from generic `invalid_response`) to explicitly classify non-persisted update paths.
  - Live verification command `npm run validate:firestore:smoke` is the baseline smoke check for Firestore read/write invariants.
- `D-158`: Role-lock diagnostics distinguish missing-row failures from non-persisted field updates. If all confirmation snapshots return `exists=false` after role-lock attempts, client throws typed `ProfileSourceError` code `profile_row_not_found_after_upsert` and logs `allSnapshotsMissing=true`. Recovery path is direct Firestore document inspection and correction (no Data Connect repair workflow).

- `D-150`: Profile hydration query for auth context is moving to deterministic key lookup (`userProfile(key: { id_expr: "auth.uid" })`) instead of filtered list query to prevent cross-UID row resolution anomalies. Client parser remains backward-compatible with legacy `userProfiles[]` payload shape until connector deployment + SDK regeneration is completed in all environments.

- `D-151`: Firebase Auth bootstrap is restored to React Native persisted mode in `features/auth/firebase.ts` using `initializeAuth(..., { persistence: getReactNativePersistence(AsyncStorage) })` when available (with safe fallback to `getAuth`). This enforces relaunch session continuity so authenticated users at `/auth/role-selection` return to role-selection rather than being sent to sign-in after app close/open.

- `D-152`: RevenueCat product catalog, entitlement mappings, and paywall offering routing finalized:
  - **Products registered in RevenueCat dashboard:**
    - `mychampions_professional_anuual` — Professional Annual (note: typo in product ID is intentional/accepted)
    - `mychampions_professional_monthly` — Professional Monthly
    - `student_annual` — Student Annual
    - `student_monthly` — Student Monthly
  - **Entitlement `professional_pro`** (SC-212, D-011): attach `mychampions_professional_anuual` + `mychampions_professional_monthly`.
  - **Entitlement `student_pro`** (SC-214/SC-215, D-132): attach `student_annual` + `student_monthly`.
  - **Offering `default_professional`** (`PRO_OFFERING_ID`): contains professional products; used by `openProPaywall()` in SC-212.
  - **Offering `default_student`** (`AI_OFFERING_ID`): contains student products; used by `openAiPaywall()` in SC-214/SC-215.
  - **Code changes:**
    - `PRO_OFFERING_ID = 'default_professional'` and `AI_OFFERING_ID = 'default_student'` constants added to `subscription-source.ts`.
    - `presentProPaywall(deps)` function added — calls `presentPaywall(PRO_OFFERING_ID)`.
    - `presentAiPaywall` calls `presentPaywall(AI_OFFERING_ID)`.
    - Production `presentPaywall` dep in `use-subscription.ts` always resolves a `PurchasesOffering` object via `Purchases.getOfferings().all[offeringIdentifier]` and passes it to `RevenueCatUI.presentPaywall({ offering })`. Both paywalls use the same symmetric code path.
    - `openProPaywall` action added to `UseSubscriptionResult` and hook — calls `presentProPaywall`, then refreshes both entitlement statuses.
    - SC-212 Purchase CTA wired to `openProPaywall()` instead of broken `purchase(undefined)` call.
  - **Why not `presentPaywallIfNeeded`**: not used because SC-212 is only reachable when the user intentionally navigates there; the "if needed" guard (skip paywall when entitlement already active) would silently do nothing for already-subscribed professionals.

- `D-153`: SC-202 specialty setup is skippable at onboarding. Professionals may proceed to the dashboard (`/(tabs)`) without selecting a specialty. When at least one specialty is selected, the CTA reads "Continue to dashboard" (primary pill button). When no specialty is selected, a "Skip for now" link and a hint ("You can set up your specialties later from your account settings.") are shown instead. `roleHomePath('professional')` in `auth-route-guard.logic.ts` now returns `/(tabs)` so returning professionals land on the dashboard rather than the specialty setup screen. `resolvePostRoleRoute('professional')` in `role-selection.logic.ts` retains `/professional/specialty` so new professionals still pass through the specialty step immediately after role selection. Locale keys `pro.specialty.cta_continue`, `pro.specialty.cta_skip`, and `pro.specialty.cta_skip_hint` added to all 3 bundles and `localized-copy-table-v2.md`.

- `D-154`: Profile hydration and role-lock are fully Firestore-backed: `features/auth/profile-source.ts` now reads/writes `userProfiles/{uid}` via `firebase/firestore`, keeps strict role-lock confirmation retries, and preserves injectable deps (`getCurrentAuthUid`, `delay`, Firestore ops) for testability. `features/auth/profile-source.test.ts` covers hydration, lock, deletion, and error normalization with injectable fakes.
- `D-155`: Auth bootstrap profile hydration contract is now read-first and upsert-only-if-missing. `hydrateProfileFromSource` first reads `GetMyProfile`; if profile exists, it returns `lockedRole` immediately and skips upsert. Upsert is only executed when profile is absent, followed by a single re-read for canonical state. Existing profiles must never be mutated during session bootstrap, preserving role-lock routing across app relaunch.
- `D-156`: RevenueCat SDK key selection is now variant-aware to prevent dev/prod bundle mismatch errors:
  - `APP_VARIANT=dev` resolves `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV`.
  - `APP_VARIANT=prod` resolves `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD`.
  - Temporary backward-compatible fallback remains enabled for legacy vars `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` to avoid breaking existing CI/local setups during migration.
  - Objective: keep `com.edufelip.mychampions.dev` and `com.edufelip.mychampions` mapped to matching RevenueCat apps/SDK keys, eliminating runtime bundle mismatch and empty-offerings failure mode in dev.
- `D-159`: Firestore project mapping is explicitly environment-bound:
  - `com.edufelip.mychampions.dev` (`APP_VARIANT=dev`) uses Firebase project `mychampions-fb928` and Firestore database `(default)`.
  - `com.edufelip.mychampions` (`APP_VARIANT=prod`) uses Firebase project `mychampions-fb928` and Firestore database `(default)`.
  - Source-of-truth variables are `FIREBASE_DEV_PROJECT_ID=mychampions-fb928` and `FIREBASE_PROD_PROJECT_ID=mychampions-fb928`.
  - Firebase CLI aliases are tracked in `.firebaserc` (`dev`, `prod`) for environment-safe deploy/inspection commands.
- `D-160`: SC-202 specialty-removal blocker checks are now driven by live Firestore counts scoped to the specialty being removed. `handleRemove` requests `getSpecialtyBlockerCounts(specialty)` before `checkRemoval`, and `removeProfessionalSpecialty(specialtyId)` validates blockers with `professionalAuthUid + specialty + status` filters (`active`, `pending_confirmation`) instead of a global all-specialties blocker query.
- `D-161`: BL-106 predefined plan library and bulk assignment orchestration are now Firestore-backed across both domains:
  - `getMyPredefinedPlans` reads `nutritionPlans` and `trainingPlans` with `ownerProfessionalUid == auth.uid` and `sourceKind == predefined`.
  - `bulkAssignPredefinedPlan` resolves the source collection by `planId`, validates professional ownership + `sourceKind=predefined`, and writes independent assigned copies to the matching collection (`nutritionPlans` or `trainingPlans`) for each selected student.
  - Outcome aligns SC-207/SC-208 library parity and BR-283 copy-independence semantics without Data Connect runtime assumptions.
- `D-162`: Water goal precedence now requires live assignment validation in Firestore:
  - `getMyWaterGoalContext` no longer infers assignment activity from persisted `nutritionistAuthUid` alone.
  - Student hydration context now checks `connections` for an active nutrition relationship (`professionalAuthUid`, `studentAuthUid`, `specialty=nutritionist`, `status=active`) before enabling nutritionist-goal precedence.
  - When no active relationship exists, the student personal goal remains the effective goal even if a historical nutritionist goal value is stored.
- `D-163`: Firestore smoke validation now includes connection lifecycle compatibility checks:
  - `scripts/validate-firestore-smoke.mjs` was expanded from create/delete probes to transition checks (`pending_confirmation` → `active` → `ended`) on `connections` using the authenticated actor uid extracted from `FIRESTORE_ID_TOKEN`.
  - The same smoke run now verifies `nutritionPlans` write/read/delete invariants in addition to profile/connection probes.
  - Live execution remains environment-token dependent (`FIRESTORE_ID_TOKEN` must be provided at runtime).
- `D-164`: Bottom-tab blank-state hardening for role wrappers:
  - `app/(tabs)/_layout.tsx` enforces tab scene retention with `detachInactiveScreens: false` (alongside `lazy: false`, `animation: 'fade'`, and `sceneStyle.backgroundColor`).
  - Tab wrapper routes `/(tabs)/index`, `/(tabs)/nutrition`, and `/(tabs)/training` must never render `null` on transient role gaps; they now redirect deterministically to `/auth/role-selection`.
  - Auth guard ownership remains centralized in `app/_layout.tsx` + `resolveAuthGuardRedirect` (no tab-wrapper guard duplication).
- `D-165`: Professional tab-shell stability alignment with `meer`:
  - `(tabs)/_layout.tsx` now keeps the tab shell mounted during transient auth/profile re-hydration for the same authenticated UID (established shell guard), preventing tab-scene remount churn.
  - Full shell reset still occurs on real identity change (sign-out or UID swap).
  - Localization hook `useTranslation` now uses stable translation binding per locale; `t` reference remains stable while locale is unchanged.
  - SC-205 student roster loading arbitration now uses explicit first-load precedence so loading and empty states do not overlap/flicker.

- `D-166`: App icon and splash screen branding migrated to the official My Champions logo (`assets/images/logo.svg`):
  - Source SVG is stored at `assets/images/logo.svg` and used as the single source of truth for all icon and splash assets.
  - A Node script (`scripts/generate-icons.mjs`) powered by `sharp` (dev dependency) generates all PNG/WebP outputs from the SVG at build time. Run with `npm run icons`.
  - iOS app icon: `ios/mychampions/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png` (1024×1024).
  - iOS splash logo: `SplashScreenLogo.imageset/image.png|@2x|@3x` (200/400/600 px).
  - Android launcher icons: `mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher*.webp` (foreground, background solid `#E2FAE8`, monochrome, round, default).
  - Android splash drawables: `drawable-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/splashscreen_logo.png`.
  - Asset source files under `assets/images/` (`icon.png`, `splash-icon.png`, `android-icon-*.png`) are also regenerated from the SVG and remain the Expo config source for future managed-workflow compatibility.
  - Latest refresh: 2026-03-10, source updated from `~/Downloads/logo.svg` and full Android/iOS icon sets regenerated via `npm run icons`.
  - Splash background color is standardized to `#E2FAE8` (same as icon background) across Expo splash config, Android `splashscreen_background` color resources, and iOS `SplashScreenBackground` color asset/storyboard.
- `D-167`: Android SplashScreen native wiring migrated from `expo-splash-screen` `SplashScreenManager.registerOnActivity()` to the raw `androidx.core.splashscreen` API (`installSplashScreen()`):
  - `MainActivity.kt` now imports `androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen` and calls `installSplashScreen()` at the top of `onCreate`, before `super.onCreate(null)`.
  - The existing `android:theme="@style/Theme.App.SplashScreen"` on `<activity>` in `AndroidManifest.xml` is preserved; it must extend `Theme.SplashScreen` (from `androidx.core:core-splashscreen`) for `installSplashScreen()` to function.
  - `androidx.core:core-splashscreen` is available transitively through `expo-splash-screen`'s android module (`expo-splash-screen` remains installed as a package).
  - JS-side `SplashScreen.preventAutoHideAsync`/`hideAsync` calls are not present in the codebase; splash dismissal is fully native (auto-dismiss after JS bundle renders).
- `D-168`: Sign-in screen brand badge updated to display the My Champions SVG logo:
  - The `MaterialIcons fitness-center` icon in the `brandBadge` container on `app/auth/sign-in.tsx` is replaced with an `expo-image` `<Image>` rendering `assets/images/logo.svg`.
  - `expo-image` handles SVG rendering natively on both iOS and Android without additional native dependencies.
  - The `brandBadge` style is updated to `borderRadius: 20`, `overflow: hidden`, removing the previous border and surface background (the logo provides its own `#E2FAE8` background).
- `D-169`: SC-208 runtime stability guard — `app/professional/training/plans/[planId].tsx` keeps template picker visibility in explicit local state (`isTemplatePickerVisible`) so template-clone CTA and modal rendering do not throw `ReferenceError` at runtime.
- `D-170`: Native app identity is normalized to the `com.edufelip.*` baseline across Expo config and committed native projects:
  - iOS launch/deep-link registration keeps `mychampions` as the stable custom scheme.
  - iOS `CFBundleURLSchemes` also includes `com.edufelip.mychampions` and `com.edufelip.mychampions.dev` so Expo dev-client launches resolve against the current prod/dev bundle ids instead of the legacy `com.eduardo880.mychampions` scheme.
  - Android source packages are aligned to `com.edufelip.mychampions` to match Gradle `namespace` / `applicationId`.
  - The legacy `com.eduardo880.mychampions` identifier is deprecated and must not remain in runtime-critical native config.

- `D-171`: Contact support (SC-213) migrated from mailto link to custom Firestore-backed dialog.
  - **Firestore Collection**: `supportMessages`.
  - **Schema**: `id`, `userId`, `userEmail`, `userName`, `subject` (max 50), `body` (max 500), `status` (pending/reviewed/resolved), `createdAt`, `updatedAt`, `appVersion`, `platform`.
  - **UI**: Custom dialog with disclaimer, one-line subject, and multi-line body.
  - **Reason**: Better user experience and ability to track support requests within the app infrastructure.

- `D-172`: Hydration-goal authoring ownership is moved into nutrition plan builders (SC-207, including student alias route) for both self-guided and professional-assigned contexts.
  - SC-209/SC-203 hydration widgets are intake/progress surfaces only; they do not expose direct goal-edit controls.
  - SC-206 professional student profile no longer contains a direct water-goal form.
  - Effective-goal resolution reads active non-archived nutrition plans first, with temporary backward-compatibility fallback to legacy `waterGoals` records while existing accounts migrate.

- `D-155`: Language picker (SC-213) replaced with a dedicated Language Select screen (SC-222) at route `/settings/language-select`. Architecture decisions:
  - **Dedicated screen**: The former inline `ActionSheetIOS` (iOS) / `Alert.alert` (Android) picker in SC-213 is removed. Language selection now pushes SC-222 onto the navigation stack, matching the iOS Settings pattern and providing a consistent cross-platform experience.
  - **In-session locale switching**: A `LocaleContext` (`localization/locale-context.tsx`) holds the active locale in React state. `LocaleProvider` wraps the entire app in `app/_layout.tsx`. All `useTranslation()` callers re-render immediately when `setActiveLocale()` is called — no app restart required.
  - **useTranslation refactor**: To avoid a circular import (`locale-context.tsx` imports from `localization/index.ts`), `useTranslation` is moved to `localization/use-translation.ts` which imports from both `index.ts` and `locale-context.tsx`. The barrel `localization/index.ts` re-exports it so all existing import paths are unchanged.
  - **Save-on-confirm UX**: SC-222 uses a radio-style row list with an explicit Save button (enabled only when the pending selection differs from the current locale). Tapping Save calls `setActiveLocale()` + `router.back()`. Back/cancel discards pending selection without saving.
  - **Language row in SC-213**: Now reads `activeLocale` from `useLocale()` instead of a local `useState` backed by an async `getLanguageOverride()` read. The label updates reactively when returning from SC-222.
  - **Persistence**: `setLanguageOverride(locale)` (AsyncStorage key `app.language.override`) is called inside `setActiveLocale()`. Storage contract unchanged.
  - **Supersedes D-144 language switcher decision**: The inline picker behavior documented in D-144 no longer applies. D-144 remains for historical reference; SC-222 is the authoritative implementation.

- `D-157`: SC-208 exercise integration uses exercise proxy microservice (supersedes direct-client YMove key approach).
  - **Server proxy required**: Mobile calls `POST https://exerciseservice.eduwaldo.com/proxy` for search/detail requests instead of direct upstream calls.
  - **No client upstream key**: The upstream YMove API key is injected server-side only. `EXPO_PUBLIC_YMOVE_API_KEY` is removed from mobile runtime contract.
  - **Request correlation**: Mobile always sends `x-request-id` and captures response `x-request-id` for diagnostics.
  - **Language normalization**: App locale maps to proxy `lang` (`en-US -> en`, `pt-BR -> pt`, `es-ES -> es`, fallback `en`).
  - **No URL persistence**: Pre-signed media URLs still expire after 48 h and are never persisted; only stable exercise id is stored.
  - **Data compatibility**: `exerciseId` is the new persisted field; legacy `ymoveId` remains read-compatible during migration.

- `D-173`: Plan-state orchestration for SC-206/SC-207/SC-208/SC-209/SC-210 is centralized in a Zustand store (`features/plans/plans-store.ts`) with hook-compatible adapters.
  - Existing screen contracts remain stable: `usePlans`, `useNutritionPlanBuilder`, and `useTrainingPlanBuilder` continue exposing the same API shape to screens.
  - Store slices cover:
    - Plans library state (`plansState` with cached bootstrap + reload).
    - Nutrition builder state.
    - Training builder state.
    - Food-search state.
    - A plans invalidation version signal consumed by `usePlans` to trigger background list refetch after plan mutations.
  - Freshness strategy is optimistic writes + targeted invalidation/reload (no Firestore realtime `onSnapshot` listeners in this phase).
  - Auth-boundary safety:
    - Store state and in-memory plan caches are reset when auth is lost or auth UID changes.
    - Builder loads use request-id guards to ignore stale/out-of-order async responses.
  - Route-scope safety:
    - Builder hooks now accept an optional scope key and reset builder/food-search state on scope transitions to avoid stale plan bleed between route instances.
  - Unsaved drafts remain session-only; no AsyncStorage draft persistence was introduced by this migration.

## Pending Decisions
- See `docs/discovery/open-questions-v1.md`.
