# Decisions Log V1

## Confirmed Decisions

- `D-001`: Role is fixed per account; switching role requires creating a new account with a different email.
- `D-002`: Professional credential capture is optional; no credential-verification workflow is included in MVP.
- `D-003`: Professional-student connection uses invite code; invite submission is handled by the MyChampions server `POST /connections/invite-submissions` route so pending Connection creation, duplicate checks, and pending-cap checks are enforced server-side.
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
- `D-015`: MVP nutrition search is exposed to mobile through the MyChampions server `POST /integrations/food/search` route. The server owns the food-service integration and serves local development from the mirrored catalog Postgres database.
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
- `D-034`: Professionals can add specialties after onboarding; specialty removal uses the authenticated MyChampions server specialty-removal route and is blocked when active or pending students exist in that specialty or when it would leave zero specialties. Direct client deletion/deactivation of Specialty records is blocked.
- `D-035`: Credential records are separate per specialty, type `professional_registry`, max one per specialty in MVP, and skippable in no-regulator contexts.
- `D-036`: Students can view credential info only for currently assigned professionals, limited to `registry_id`, `authority`, and `country`.
- `D-037`: Professional invite code is persistent by default, revocable/regenerable on demand, and only one active code exists per Professional Specialty; regeneration invalidates the old Specialty code and auto-cancels pending requests created from it, while Specialty removal deletes the scoped code and lookup.
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
- `D-050`: Superseded by the local MyChampions server migration. Active app-domain backend baseline is the root-level MyChampions server with local Postgres/Drizzle persistence and local filesystem image storage while remote provider wiring is pending.
- `D-051`: Superseded by the self-managed auth migration. Social authentication no longer constructs provider credentials in the mobile app; explicit E2E fixtures still short-circuit tests, native provider-token capture plus the MyChampions server `POST /auth/social/sign-in` boundary is the normal path, and the server directly verifies configured provider issuer/audience claims. Deterministic local social sessions remain reserved for explicit local/dev configuration gaps.
- `D-052`: Superseded for launch-readiness planning. Crash monitoring provider remains a future provider choice and is not tied to a mobile-owned Firebase runtime.
- `D-053`: Superseded by server-backed custom meal image upload. User-uploaded meal media is stored through the MyChampions server local image-storage path during local development; durable remote storage is future provider work.
- `D-054`: UI stack for MVP uses NativeWind (Tailwind-style React Native styling).
- `D-055`: Native projects (`ios/`, `android/`) are committed from day 1 after a single `expo prebuild`, and are then maintained directly without recurring prebuild regeneration.
- `D-056`: QA distribution strategy:
  - Release branches distribute iOS builds via TestFlight.
  - Pull requests use repository-owned native build and test checks. Successful PR
    builds remain ephemeral on the self-hosted runners instead of being uploaded to
    GitHub Actions; only bounded failure diagnostics may be retained for one day.
    The retired Firebase distribution workflows are no longer part of the mobile
    package.
- `D-057`: Client-side media compression is mandatory before server-backed upload.
- `D-058`: Non-crash monitoring tooling (for example Sentry) is out of MVP; crash/ANR provider selection is deferred while the mobile-owned Firebase runtime is retired.
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
- `D-086`: Create-account UI and validation are implemented; email/password sign-up now routes through the MyChampions server email-auth boundary, backed by local Postgres `local_email_auth_credentials` by default, and fails closed without local/E2E auth.
- `D-087`: Role-selection UI and quick self-guided entry are implemented with MyChampions server-backed role-lock persistence/session wiring; selected role routes to concrete journeys (`student` -> `/`, `professional` -> `/professional/specialty`).
- `D-088`: Route-guard enforcement uses explicit E2E or local MyChampions server auth session state for authentication and server-backed role profile source-of-truth.
- `D-089`: Legacy backend-provider references are deprecated in project planning artifacts and replaced by the MyChampions server/Postgres migration path; backend migration tracking is maintained in this decision log and `docs/discovery/pending-wiring-checklist-v1.md`.
- `D-090`: Auth entry providers use MyChampions server-owned auth boundaries. Email/password establishes sessions through Postgres `local_email_auth_credentials`; Google and Apple ID tokens are verified directly by the server against configured issuer/audience claims. Deterministic local sessions are reserved for explicit local/dev provider-token configuration gaps outside E2E fixtures.
- `D-091`: Superseded. Native backend config selection now exposes the MyChampions server URL and no longer ships mobile-owned provider config files.
- `D-092`: CI/CD workflow baseline is inherited from `meer` and adapted to `my-champions`:
  - Workflows cover Android/iOS PR checks, ephemeral native build proof, and release-branch validation pipelines.
  - This project standardizes JS dependency installation in CI with Yarn 1.22.22, `yarn.lock`, and `yarn install --frozen-lockfile`; npm lockfiles and `npm ci` are not used.
- `D-093`: CI/CD secret names and requirements are governed by `docs/discovery/ci-secrets-matrix-v1.md`; workflow secret changes must update that document in the same change.
- `D-094`: CI/CD bootstrap/validation execution should be tracked through issue template `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` for operational consistency.
- `D-095`: Primary app-domain database model is MyChampions server-owned Postgres through Drizzle. New persistence planning must extend server migrations, route/repository tests, and current product docs.
- `D-096`: App-domain integration contract source-of-truth is the local MyChampions server route/repository test suite plus current product docs. The retired Firestore spec remains only as legacy context.
- `D-097`: Auth role-lock persistence uses the MyChampions server profile-source abstraction with server-only profile reads/writes through the local bearer session; no client/provider role-lock fallback path remains.
- `D-098`: App-domain compatibility is validated through local server Bun tests, Postgres repository tests, focused mobile source tests, and mobile typecheck. The old Firestore smoke harness is retired.
- `D-099`: Connection lifecycle operations (`submitInviteCode`, `confirmPendingConnection`, `endConnection`, `getMyConnections`) are implemented in `features/connections/connection-source.ts` using MyChampions server endpoints with typed source-layer errors and logic-layer normalization.
- `D-100`: Connection lifecycle screen wiring uses a `useConnections` React hook in `features/connections/use-connections.ts` as the single UI adapter over connection-source; screens import only the hook and logic types, never connection-source directly. Route guard extended in `auth-route-guard.logic.ts` to enforce `/student/*` → student-only and `/professional/*` → professional-only path prefixes.

- `D-101`: Professional screen stubs use `useState<EntitlementStatus>('unknown')` (not `const`) to prevent TypeScript literal narrowing; this pattern must be applied to all stub state that will later be replaced by live data.
- `D-102`: Phase 5 professional screens (SC-202, SC-204, SC-205, SC-206, SC-212) are implemented with server-backed data where migrated and RevenueCat wiring where applicable; all deferred items are tracked in `docs/discovery/pending-wiring-checklist-v1.md`.
- `D-103`: Phase 6 screens (SC-213, SC-214, SC-215, SC-216) are implemented with server-backed support/custom-meal/share/image paths where migrated. SC-216 shared-recipe deep links now preserve a safe `/shared/recipes/:shareToken` return target through auth, terms acceptance, and role-selection fallbacks. Privacy policy URL in SC-213 is a placeholder that must be replaced with the real legal URL before release.
- `D-104`: Phase 7 bottom navigation shell is implemented per D-045. Professional SC-207 and SC-208 tabs now route to server-backed plan-library screens (`/professional/nutrition`, `/professional/training`) backed by the local MyChampions server plan store. The `(tabs)/_layout.tsx` uses `href: null` to hide role-inappropriate tabs rather than conditional rendering, keeping expo-router file-system routing intact.
- `D-105`: Accessibility baseline (BL-013, FR-217) is implemented using React Native core a11y props only — no external a11y library. Pattern applied across all implemented screens: (1) `ActivityIndicator` gets `accessibilityLabel` from `a11y.loading.*` locale keys; (2) inline error `Text` nodes are wrapped in `accessibilityLiveRegion="polite"` `View`; (3) alert banners keep `accessibilityRole="alert"`; (4) interactive rows that carry composite data (student row, stat card, assignment card) get a single `accessibilityLabel` combining all relevant fields; (5) checkbox `View` gets `accessibilityRole="checkbox"` + `accessibilityState={{ checked }}`; (6) `MealRow` action buttons get contextual labels (`"Log <name>"`, `"Edit <name>"`, `"Share <name>"`). This covers auth, student, professional, and Phase 6 screens. Phase 9 analytics and real-service wiring remain deferred.
- `D-106`: AI meal photo analysis uses the MyChampions server analyzer route. Provider API keys remain server-side; the mobile client sends compressed image data to the local server with a provider-neutral bearer token.
- `D-107`: Camera capture and client-side image compression happen using Expo Camera / ImagePicker and `expo-image-manipulator`. The compressed image is sent as base64 in the server analyzer request body; image attachment upload is a separate server-backed flow.
- `D-108`: AI macro estimates always pre-fill editable form fields (calories, carbs, proteins, fats, totalGrams); no auto-save without explicit user confirmation. An AI disclaimer is always shown alongside pre-filled values.
- `D-109`: In SC-214, attaching the captured photo to the meal image record is optional after analysis. Analysis-only path does not require media upload; photo attachment uses the MyChampions server image-upload path.
- `D-110`: AI analysis errors (network, quota, unrecognizable image) are recoverable. User is shown a reason-specific error message and can dismiss it to fill form fields manually. Analysis failure is never a hard failure blocking meal creation.
- `D-111`: SC-207 (Nutrition Plan Builder) and SC-208 (Training Plan Builder) are implemented as route-level screens at `/professional/nutrition/plans/:planId` and `/professional/training/plans/:planId`. The tab-level `app/professional/nutrition.tsx` and `app/professional/training.tsx` become plan library list screens showing the professional's predefined plan library with create and open CTAs.
- `D-112`: Plan builder logic (validation, totals calculation, error normalization) is isolated in `features/plans/plan-builder.logic.ts` (pure functions, no provider deps). Plan CRUD operations (create/update plan, add/remove items/sessions) use the MyChampions server source pattern with `PlanSourceError` normalization. React hook `features/plans/use-plan-builder.ts` adapts source for screen consumption.
- `D-113`: Legacy Firebase `searchFoods` function integration has been decommissioned. SC-207 food search now uses the MyChampions server `POST /integrations/food/search` route with a local server bearer token and mirrored local catalog Postgres data.
- `D-114`: Starter templates are returned by `getStarterTemplates(planType)` in plan-builder-source; template persistence and cloning remain tracked for the server-backed template library path.
- `D-115`: BL-104 water tracker is implemented as embedded widgets in existing screens — no standalone route is created. Implementation surfaces:
  - `HydrationCard` in `app/student/home.tsx` (SC-203) — compact daily hydration summary with progress and streak.
  - `WaterWidget` in `app/student/nutrition.tsx` (SC-209) — full intake log form with effective-goal progress, no direct goal-edit form.
  - Nutrition plan builders in `app/professional/nutrition/plans/[planId].tsx` and `/student/nutrition/plans/[planId]` (SC-207 alias) own hydration-goal authoring.
  - SC-220 documents the water tracker feature and goal-authoring boundaries across these surfaces.

- `D-116`: BL-005 plan change request flow is implemented with screen-specific localization keys per plan type (`student.nutrition.plan_change.*` for SC-209, `student.training.plan_change.*` for SC-210) rather than a single shared key group. Professional-side triage uses `pro.student_profile.plan_change_requests.*` keys in SC-206. Pure logic lives in `plan-change-request.logic.ts`, server-backed source functions live in `plan-source.ts` (`submitPlanChangeRequest`, `reviewPlanChangeRequest`, `getStudentPlanChangeRequests`, `getProfessionalPlanChangeRequests`), and the React hook lives in `use-plans.ts`. The local in-app professional notification surface is server-backed through Professional Home and `GET /professional/plan-change-requests?status=pending`; push/provider notification delivery remains future work.

- `D-117`: BL-002 QR invite scan is implemented using `expo-camera@~16.0.18` (`CameraView` + `useCameraPermissions`). The scanner is presented as a full-screen `Modal` (no new route) to keep the implementation KISS/YAGNI. QR and manual entry paths converge at the same `submitCode` hook method per BR-263 — `onSubmitCode(code, surface)` accepts `'manual' | 'qr'` and routes to the same analytics events and error branches. Payload parsing is isolated in `features/connections/qr-invite.logic.ts` (pure, no React or provider runtime deps). Path-segment extraction requires the segment to immediately follow an `invite` path segment to avoid false-positive matches on generic URL paths. Camera permission denied shows an inline error in the main screen rather than opening the modal.

- `D-118`: BL-001 quick self-guided start path is implemented in `app/auth/role-selection.tsx`. The self-guided path is executed when the user selects Student and taps Continue; this commits student role via `lockRole('student')` and routes to student home (`'/'`). Analytics event `onboarding.self_guided_start.clicked` is emitted on this Student+Continue path. Student screens (`home.tsx`, `nutrition.tsx`, `training.tsx`) display self-guided empty states with localized CTAs when no professional is connected. Empty state copy explicitly communicates "No nutritionist connected? You can still..." / "No coach connected? You can still..." per BR-226. Server endpoints for connections/plans/water provide the self-guided data path and are tracked in pending-wiring-checklist-v1.md.

- `D-119`: BL-003 pending-canceled-by-code-rotation notification is implemented in `features/connections/connection.logic.ts` and `app/student/professionals.tsx` (SC-211). The `canceled_code_rotated` display state is resolved when a connection record has `status='ended'` and `canceledReason='code_rotated'`. ConnectionCard renders this state with red styling (red text + red border) and displays locale key `relationship.pending.canceled_code_rotated` with actionable reconnect CTA per AC-253. All 3 locales (en-US, pt-BR, es-ES) provide clear copy explaining the code rotation and prompting reconnection. Unit tests in `connection.logic.test.ts` cover canceled_code_rotated detection and display state preservation (TC-256).

- `D-120`: Source layer functions that call native/Expo SDKs or network clients keep testable boundaries. The established pattern for source-layer testability is: (1) extract all pure decision logic (routing, mapping, normalization) into `*.logic.ts` as pure helper functions; (2) source layer calls those helpers; (3) tests cover logic and injectable source contracts. For `plan-builder-source.ts`, `deriveStarterTemplatePlanType` and `coalesceTemplateDescription` were extracted into `plan-builder.logic.ts` and covered by `plan-builder-source.test.ts`. The `StarterTemplateDeps` injection type is exported to support focused integration testing.

- `D-121`: BL-008 offline banner and write-lock wiring pattern is fully applied across all 12 remaining screens (`pro/students`, `pro/student-profile`, `pro/specialty`, `pro/pending`, `pro/subscription`, `student/home`, `student/nutrition`, `student/training`, `settings/account`, `nutrition/custom-meals/index`, `nutrition/custom-meals/[mealId]`, `shared/recipes/[shareToken]`). Pattern: import `resolveOfflineDisplayState` + `useNetworkStatus`; derive `isWriteLocked` from `offlineDisplay.showOfflineBanner` (OR-ed with subscription lock where applicable); render offline banner after `Stack.Screen`; pass `disabled={isWriteLocked}` to all write-action Pressables. Offline-aware screens now derive `lastSyncedAtIso` from server-backed source load timestamps via `resolveLatestSyncTimestamp`, so stale indicators can use the latest successful MyChampions server-backed read instead of a hard-coded null timestamp.

- `D-122` (superseded in part by D-187): BL-009 subscription pre-lapse warning copy was migrated from the legacy `pro.subscription.warning` single key to a three-key structure: `pre_lapse.title`, `pre_lapse.body`, `pre_lapse.cta_renew`. All three keys remain present in `en-US`, `pt-BR`, and `es-ES`; recovery-action gating and warning activation now follow D-187.

- `D-123`: BL-010 auth/invite error copy hardening is implemented as `mapInviteSubmitReasonToMessageKey(reason: InviteSubmitErrorReason): string` in `features/connections/connection.logic.ts`. Mapping: `code_not_found` and `code_expired` → `relationship.error.invalid_code`; `already_connected` → `relationship.error.already_connected`; `pending_cap_reached` → `relationship.error.pending_cap`; `network` → `relationship.error.network`; `configuration` and `unknown` → `relationship.error.unknown`. The three previously missing locale keys (`already_connected`, `network`, `unknown`) were added to all 3 bundles and to `localized-copy-table-v2.md`. Seven unit tests in `connection.logic.test.ts` cover every reason branch (TC-252, TC-253).

- `D-124`: BL-011 specialty removal assist screen wiring (SC-202): when `checkRemoval` returns `allowed: false`, `handleRemove` calls `resolveRemovalAssistState` (pure logic, no side effects) and stores the result in `blockedAssist` state. The `RemovalAssistCard` component renders inline (not as `Alert`) with title/body from `getRemovalBlockedMessageKeys`, and one `Pressable` action button per `buildActionMetadata` entry. Primary actions use filled tint background; secondary use outline. Tapping an action calls `router.push(meta.navigationTarget)` and resets `blockedAssist` to `null`. A dismiss CTA resets state without navigating. The new `pro.specialty.remove_blocked.dismiss` locale key was added to all 3 bundles (`en-US`: "Dismiss", `pt-BR`: "Dispensar", `es-ES`: "Descartar") and must be tracked in `localized-copy-table-v2.md`.

- `D-125`: BL-013 accessibility baseline annotation layer is complete for all MVP screens (auth, student, professional, Phase 6). Screen-reader E2E smoke test via Detox and automated color-contrast audit are explicitly deferred to release hardening — they require Detox CI wiring and design token finalization respectively. These deferred items are not blockers for BL-013 `Implemented` status.

- `D-126`: Superseded by the local MyChampions server migration. App-domain source modules preserve hook/screen-facing contracts while routing through server endpoints, local bearer-token deps, and test doubles. Source functions continue to avoid direct screen coupling; hooks remain the UI adapter boundary.

- `D-127`: Food search is implemented via the MyChampions server food catalog route from `features/nutrition/food-search-source.ts`, using a local server bearer token. Request body uses `{ query, maxResults, region, language }`, where `region/language` are derived from effective app locale (language override first, device locale fallback; mapping `en-US -> us/en`, `pt-BR -> br/pt`, `es-ES -> es/es`, fallback `us/en`). Response parsing uses per-100g macros (`carbohydrate`, `protein`, `fat`) with tolerant numeric parsing (`number` or numeric `string`), enforces `serving === 100`, and derives calories client-side (`4/4/9`). The server route reads the mirrored local food catalog database and maps quota/upstream/configuration failures to provider-neutral mobile error reasons.

- `D-128`: Code review of the full `analyzeMealPhoto` (BL-108) feature identified and fixed four must-fix issues:
  1. **M1** — `PhotoAnalysisSourceError.code` was typed as loose `string`; changed to `PhotoAnalysisErrorReason` union for compile-time safety.
  2. **M2** — 401 HTTP response was incorrectly mapped to `'configuration'` error code; 401 and 403 now both map to `'unauthenticated'`. `PhotoAnalysisErrorReason` union extended with `'unauthenticated'` variant. `normalizePhotoAnalysisError` updated to handle `'unauthenticated'` code and message patterns.
  3. **M3** — Source layer had no injectable deps (no `MealPhotoAnalysisSourceDeps`), making it impossible to unit-test. `MealPhotoAnalysisSourceDeps` now uses provider-neutral server dependencies (`getServerBaseUrl`, `getCurrentAccessToken`, `fetchFn`), mirroring the current server-backed source pattern. The focused `meal-photo-analysis-source.test.ts` suite (TC-285) now runs without any network access.
  4. **M4** — Network-level fetch catch block was routing through `normalizePhotoAnalysisError` (fragile string matching); changed to unconditionally throw `'network'`, consistent with `food-search-source.ts` pattern.
     Two should-fix issues also addressed: hook now reads `err.code` directly when `err instanceof PhotoAnalysisSourceError` (S1); 403 was not handled and fell through to `invalid_response` — now correctly mapped to `'unauthenticated'` (S4). The mobile meal-photo source maps HTTP 401/403 to `'unauthenticated'` before parsing response JSON, so empty or non-JSON auth failures cannot be swallowed as `invalid_response`. The local MyChampions server now trims meal-photo analysis image input, rejects blank or whitespace-only payloads with `400 invalid_image`, and rejects images above 6,000,000 base64 characters with `413 file_too_large` before analyzer execution. Analyzer prompt construction is server-owned in `server/src/nutrition/meal-photo-analysis-prompt.ts` so the mobile client no longer carries provider prompt text (S3). The server-owned provider request contract in `server/src/nutrition/meal-photo-analysis-request.ts` pins image detail to `high`, caps analyzer output at 500 tokens, and builds the JPEG data URL from the normalized base64 payload before any future provider adapter call.

- `D-129`: BL-108 camera capture and client-side compression wired in `features/nutrition/use-meal-photo-analysis.ts`:
  - **Image picker**: `expo-image-picker@~16.0.6` (`launchCameraAsync` + `launchImageLibraryAsync`). `startCapture()` presents a localized native `Alert.alert` action sheet, then requests the applicable permission. User cancellation returns to `idle`; permission denial raises the typed `photo_permission_denied` adapter error and displays localized device-settings guidance while manual entry remains available.
  - **Compression**: `expo-image-manipulator@~13.0.6` (`manipulateAsync`). Resize to ≤ 1600 px longest side + JPEG compress at quality 0.75 (FR-230, BR-287, Q-022).
  - `analyze(base64Image)` kept as a public method for direct injection in integration tests.
  - **Native permissions applied manually** (no `expo prebuild` policy):
    - iOS `ios/mychampions/Info.plist`: `NSCameraUsageDescription` (QR scanning + meal photo camera) and `NSPhotoLibraryUsageDescription` (meal photo library access) added directly.
    - Android `android/app/src/main/AndroidManifest.xml`: `android.permission.CAMERA` added; `READ_EXTERNAL_STORAGE` scoped to `maxSdkVersion="32"`; `READ_MEDIA_IMAGES` added for API 33+; `WRITE_EXTERNAL_STORAGE` scoped to `maxSdkVersion="29"`.
    - `expo-camera` and `expo-image-picker` plugin entries removed from `app.config.ts` plugins array; `ios.infoPlist` entries replaced with comments. Plugin entries would conflict with manually maintained native files on any future accidental `expo prebuild` run.
  - `app.config.ts` comment documents the no-prebuild policy for all future plugin additions.

- `D-130`: RevenueCat SDK (`react-native-purchases@9.10.5`) is configured lazily inside `features/subscription/use-subscription.ts` using a module-level `sdkConfigured` singleton guard. API keys are platform-specific and read from `Constants.expoConfig.extra.revenueCatApiKeyIos` and `Constants.expoConfig.extra.revenueCatApiKeyAndroid` (resolved from `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` in `app.config.ts`). Runtime validation rejects secret keys (`sk_*`) and invalid platform prefixes; only public SDK keys are accepted (`appl_*` for iOS, `goog_*` for Android). Lazy configuration avoids any `_layout.tsx` change and means the SDK is only initialized when the hook is first mounted by an authenticated professional. This pattern is specific to RevenueCat because its `configure()` call is idempotent and safe to call once per app session.

- `D-131`: Custom meal image upload is server-backed. During local development, images are uploaded through `POST /nutrition/custom-meal-images/:mealId` and stored under the server local image-storage path. The returned URL is persisted with the custom meal record via server-backed `createCustomMeal` / `updateCustomMeal`; update flow falls back to existing `imageUrl` when no new upload is selected. SC-214 edit mode hydrates `uploadState` from persisted `imageUrl` so image UI starts in `done/change photo` state for existing meals.

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

- `D-133`: Environment model is local-server-first during migration:
  - `APP_VARIANT=dev` keeps native bundle separation.
  - `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL` selects the MyChampions server base URL.
  - `app.config.ts` exposes server config, not mobile-owned Firebase project config.

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
  - Runtime terms config source is Expo `extra.terms` (`EXPO_PUBLIC_TERMS_REQUIRED_VERSION`, `EXPO_PUBLIC_TERMS_URL`, `EXPO_PUBLIC_PRIVACY_POLICY_URL`) with fallbacks `v1`, `https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use`, and `https://portfolio.eduwaldo.com/projects/my-champions/privacy_policy`.
  - Persistence is server-backed via the MyChampions profile endpoint; auth session no longer relies on AsyncStorage for terms acceptance state.

- `D-137`: Retired 2026-03-06 persistence baseline:
  - Data Connect runtime/schema artifacts are removed from app runtime (`features/dataconnect.ts`, `features/dataconnect-generated/`, `dataconnect/`).
  - Current source modules use MyChampions server endpoints as the app-domain persistence contract.
  - Runtime/env contract for persistence is the MyChampions server URL plus local bearer auth.
  - Validation baseline is local server tests, focused mobile source tests, and typecheck.
- `D-138`: Superseded. Auth session hydration now uses explicit E2E sessions or MyChampions server sessions; durable self-managed session persistence is tracked by the server auth migration.
- `D-139`: Superseded. The 2026-03-04 role-lock persistence incident belonged to the retired Data Connect/Firestore connector baseline and is no longer active architecture. Current role-lock persistence uses the MyChampions server profile endpoint backed by local Postgres profile rows; diagnostics and recovery should inspect server route/repository behavior and the local server database instead of connector deployment state.
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
  - **Change password**: `requestPasswordResetFromSource()` submits a MyChampions server password-reset request for `password` provider accounts. OAuth users (Google, Apple) receive an informational alert noting their provider manages the password. Row is always visible; provider detection is runtime.
  - **Language switcher**: User-selectable in-app locale override persisted to `AsyncStorage` via `features/auth/language-storage.ts` (key: `app.language.override`). Tapping pushes to `/settings/language-select` (SC-222); Save calls `setActiveLocale()` and takes effect immediately in-session via `LocaleContext` with no app restart required. Supported locales: `en-US`, `pt-BR`, `es-ES`. No server sync required.
  - **Contact support**: Opens a server-backed support dialog that submits authenticated messages through `POST /support/messages` and stores them in MyChampions server Postgres.
  - **Sign out**: Dedicated CTA above the danger zone; confirmation alert before `signOutFromSource()` + `clearSession()`, which clears local server auth without invoking Firebase Auth. Previously sign-out only occurred as a side-effect of account deletion.
  - **Profile header**: Avatar initials from `displayName` → email prefix → `?`. Role badge pill uses DS `accentBlue` tokens.
  - **Privacy policy / Terms URLs**: Use the MyChampions legal URLs (`https://portfolio.eduwaldo.com/projects/my-champions/privacy_policy` and `https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use`) from Expo config fallbacks or explicit env overrides.

- `D-145`: `DsScreen` now supports a non-scroll shell mode (`scrollable={false}`) for routes that render VirtualizedList-based content (`FlatList`/`SectionList`). This prevents React Native runtime warnings about nested VirtualizedLists inside same-orientation `ScrollView` containers and preserves list windowing behavior. Applied to `SC-205` (`/professional/students`), professional plan library routes (`/professional/nutrition`, `/professional/training`), and `SC-215` (`/nutrition/custom-meals`).

- `D-146`: Tab wrapper route `/(tabs)/recipes` renders `SC-215` (`/nutrition/custom-meals`) with `hideHeader=true` so the recipes tab does not show an extra local toolbar/header inside the tabs shell. SC-214/SC-215 route files now live under `app/(tabs)/nutrition/custom-meals/*` so `/nutrition/custom-meals` and `/nutrition/custom-meals/:mealId` remain in the tabs navigator and keep bottom tab icons visible.

- `D-147`: Native navigation toolbar is disabled app-wide (`headerShown: false`) so navigation chrome is fully controlled by screen UI. For pushed routes that need return navigation, screens must provide explicit in-content back controls. Screen content must also respect top safe area insets when toolbar is absent. SC-211 (`/student/professionals`) now uses an icon-only back button.

- `D-148`: Student empty-state self-guided actions in SC-209 and SC-210 now route to direct self-managed plan creation flows (`/student/nutrition/plans/new`, `/student/training/plans/new`) instead of returning to Home. Current implementation reuses shared plan builder screens to keep plan authoring behavior consistent and applies student-branded titles/actions on student-prefixed routes while broader student-only shell refinements remain pending.

- `D-149`: SC-201 role-lock persistence enforces strict remote confirmation: after `setLockedRole` mutation, client performs multi-attempt **server-only** confirmation reads and only routes forward when `getMyProfile` confirms `lockedRole`. If confirmation remains stale after retries, role selection returns `auth.role.error.save_failed` and user stays on role-selection (no mutation-ack fallback routing).
- `D-157`: Role-lock failure diagnostics are hardened for dev troubleshooting:
  - Client logs pre-lock profile snapshot (`exists`, `lockedRole`, `hasAuthUidMismatch`) before attempting `setLockedRole`.
  - Each server-only confirmation retry logs snapshot fields and attempt index.
  - When `setLockedRole` returns a key but confirmed role remains `null`, client throws typed `ProfileSourceError` code `role_update_not_persisted` (distinct from generic `invalid_response`) to explicitly classify non-persisted update paths.
  - Local server route/repository tests and focused mobile source tests are the baseline checks for profile read/write invariants.
- `D-158`: Role-lock diagnostics distinguish missing-row failures from non-persisted field updates. If all confirmation snapshots return `exists=false` after role-lock attempts, client throws typed `ProfileSourceError` code `profile_row_not_found_after_upsert` and logs `allSnapshotsMissing=true`. Recovery path is MyChampions server route/repository inspection and local Postgres correction.

- `D-150`: Profile hydration query for auth context is moving to deterministic key lookup (`userProfile(key: { id_expr: "auth.uid" })`) instead of filtered list query to prevent cross-UID row resolution anomalies. Client parser remains backward-compatible with legacy `userProfiles[]` payload shape until connector deployment + SDK regeneration is completed in all environments.

- `D-151`: Superseded. The local migration removed mobile Firebase auth bootstrap. Relaunch persistence restores MyChampions server sessions from AsyncStorage and refreshes expired persisted sessions when a refresh token is available. A definitive 401/403 refresh rejection or a missing refresh credential clears the session; transport, 5xx, URL-resolution, and malformed-success failures preserve the persisted refresh credential for a later retry while token-requiring operations remain closed. Durable server-side session persistence is part of the self-managed auth migration.

- `D-152`: RevenueCat product catalog, entitlement mappings, and paywall offering routing finalized:
  - **Products registered in RevenueCat dashboard:**
    - `professional_annual` — Professional Annual
    - `professional_monthly` — Professional Monthly
    - `student_annual` — Student Annual
    - `student_monthly` — Student Monthly
  - **Entitlement `professional_pro`** (SC-212, D-011): attach `professional_annual` + `professional_monthly`.
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

- `D-154`: Profile hydration and role-lock are server-backed: `features/auth/profile-source.ts` now reads/writes through the MyChampions server profile endpoints, keeps strict role-lock confirmation retries, and preserves injectable deps (`getAccessToken`, `delay`, fetch ops) for testability. `features/auth/profile-source.test.ts` covers hydration, lock, deletion, and error normalization with injectable fakes.
- `D-155`: Auth bootstrap profile hydration contract is now read-first and upsert-only-if-missing. `hydrateProfileFromSource` first reads `GetMyProfile`; if profile exists, it returns `lockedRole` immediately and skips upsert. Upsert is only executed when profile is absent, followed by a single re-read for canonical state. Existing profiles must never be mutated during session bootstrap, preserving role-lock routing across app relaunch.
- `D-156`: RevenueCat SDK key selection is now variant-aware to prevent dev/prod bundle mismatch errors:
  - `APP_VARIANT=dev` resolves `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_DEV` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_DEV`.
  - `APP_VARIANT=prod` resolves `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD`.
  - Temporary backward-compatible fallback remains enabled for legacy vars `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS` / `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID` to avoid breaking existing CI/local setups during migration.
  - Objective: keep `com.edufelip.mychampions.dev` and `com.edufelip.mychampions` mapped to matching RevenueCat apps/SDK keys, eliminating runtime bundle mismatch and empty-offerings failure mode in dev.
- `D-159`: Mobile backend environment mapping is local-server-bound during migration:
  - `com.edufelip.mychampions.dev` (`APP_VARIANT=dev`) targets the configured MyChampions server URL.
  - `com.edufelip.mychampions` (`APP_VARIANT=prod`) must not use the local dev-session bridge.
  - Production release builds require `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=https://api.mychampions.eduwaldo.com`; CI rejects local or missing values before native builds.
  - Production iOS builds also require `EXPO_PUBLIC_GOOGLE_OAUTH_IOS_CLIENT_ID` and an `appl_*` `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS_PROD`; Android builds require `EXPO_PUBLIC_GOOGLE_OAUTH_ANDROID_CLIENT_ID` and a `goog_*` `EXPO_PUBLIC_REVENUECAT_API_KEY_ANDROID_PROD`. This blocks incomplete provider configuration before native compilation without placing any provider secret in the app.
- `D-160`: SC-202 specialty-removal blocker checks are now driven by live MyChampions server counts scoped to the specialty being removed. `handleRemove` requests `getSpecialtyBlockerCounts(specialty)` before `checkRemoval`, and `removeProfessionalSpecialty(specialtyId)` validates blockers with `professionalAuthUid + specialty + status` filters (`active`, `pending_confirmation`) instead of a global all-specialties blocker query.
- `D-161`: BL-106 predefined plan library and bulk assignment orchestration are now server-backed across both domains:
  - `getMyPredefinedPlans` reads nutrition and training predefined plans through MyChampions server plan endpoints.
  - `bulkAssignPredefinedPlan` resolves the source plan by `planId`, validates professional ownership + `sourceKind=predefined`, and writes independent assigned copies through server-owned Postgres rows for each selected student.
  - Outcome aligns SC-207/SC-208 library parity and BR-283 copy-independence semantics without Data Connect runtime assumptions.
- `D-162`: Water goal precedence now requires live assignment validation through the MyChampions server:
  - `getMyWaterGoalContext` no longer infers assignment activity from persisted `nutritionistAuthUid` alone.
  - Student hydration context now checks server-owned connection state for an active nutrition relationship (`professionalAuthUid`, `studentAuthUid`, `specialty=nutritionist`, `status=active`) before enabling nutritionist-goal precedence.
  - When no active relationship exists, the student personal goal remains the effective goal even if a historical nutritionist goal value is stored.
- `D-163`: Superseded. Connection lifecycle compatibility is now validated through local MyChampions server route/repository tests and focused mobile source tests.
  - Retired provider smoke probes were removed with the mobile-owned provider project files.
  - The current local evidence path verifies profile, connection, plan, and tracking invariants through server tests, mobile source tests, and typecheck.
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

- `D-171`: Contact support (SC-213) migrated from mailto link to a custom MyChampions server-backed dialog.
  - **Server persistence**: `support_messages` in local Postgres.
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

- `D-157`: SC-208 exercise integration uses the MyChampions server exercise catalog (supersedes direct-client YMove key approach).
  - **Server catalog required**: Mobile calls MyChampions server `POST /integrations/exercise/search` for search and `GET /integrations/exercise/exercises/:id` for detail instead of direct upstream calls or a separate public exercise microservice.
  - **No client upstream key**: The upstream YMove API key is injected server-side only. `EXPO_PUBLIC_YMOVE_API_KEY` is removed from mobile runtime contract.
  - **Request correlation**: Mobile always sends `x-request-id` and captures response `x-request-id` for diagnostics.
  - **Language contract**: Mobile sends the effective app/device locale in `lang`; the service normalizes it for response localization and does not treat it as the query language.
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
  - Freshness strategy is optimistic writes + targeted invalidation/reload; realtime server push is out of scope in this phase.
  - Auth-boundary safety:
    - Store state and in-memory plan caches are reset when auth is lost or auth UID changes.
    - Builder loads use request-id guards to ignore stale/out-of-order async responses.
  - Route-scope safety:
    - Builder hooks now accept an optional scope key and reset builder/food-search state on scope transitions to avoid stale plan bleed between route instances.
  - Unsaved drafts remain session-only; no AsyncStorage draft persistence was introduced by this migration.

- `D-174`: GitHub Actions workflows no longer run legacy Data Connect runtime validation (`scripts/check-dataconnect-runtime-config.mjs`) because app/runtime persistence is moving through the MyChampions server.
  - Removed `Validate Data Connect runtime config` steps from Android/iOS PR and release workflows.
  - Retired Firebase distribution workflows and native Firebase config checks are no longer part of the mobile package.

- `D-175`: Professional read access to student tracking logs is enforced by the MyChampions server using connection and tracking-access rows materialized in local Postgres. Server route/repository tests validate access without client-side rules.

- `D-176`: Plan archive/restore lifecycle writes are authorized through server-owned connection lifecycle state and a `lifecycleConnectionId` marker on the affected plan row. Server connection activation/end handlers set the marker alongside `isArchived` changes, validate the referenced connection transition, and require normal plan edits to preserve both `isArchived` and `lifecycleConnectionId`.

- `D-177`: Active specialty state is also materialized per student in server-owned tracking-access rows. The server uses the exact `fitness_coach` sentinel to block student self-managed training creates and normal edits while an active coach connection exists; active updates refuse overwrite by a different active connection, ended updates require the existing sentinel to reference the same `connectionId`, and connection end restores only archived self-managed plans whose `lifecycleConnectionId` matches the ending connection.

- `D-178`: Nutritionist governance mirrors training governance before release. Student-created NutritionPlans are Self-Managed Plans, active nutritionist Connections block Student self-managed nutrition create/edit, draft assigned NutritionPlans are invisible to Students, and published assigned NutritionPlans remain editable by the owning Professional while the matching active nutritionist Connection exists.
- `D-179`: Assigned NutritionPlan creation/send/bulk assignment requires an active nutritionist Connection to each target Student and nutrition-scoped targets. Connection end archives assigned NutritionPlans and restores the latest Self-Managed NutritionPlan tied to the ending Connection if present; no plan is auto-created. Professional and Student unbinds use the same lifecycle semantics.
- `D-180`: InviteCodes are Specialty-scoped at `professionals/{professionalUid}/inviteCodes/{specialty}`. The old `inviteCodes/{professionalUid}` shape is replaced with no compatibility migration because the app is not live.
- `D-181`: Nutritionist review is read-only on Professional Student Profile. TrackingLogs remain Student-owned but may carry plan/connection provenance. CustomMeals are user-owned reusable meals/recipes; NutritionPlans and TrackingLogs store stable snapshots/provenance, and Professionals cannot add Student-owned CustomMeals into assigned plans unless shared/imported first.

- `D-182`: RevenueCat identity is bound to the self-managed MyChampions server UID before any native subscription SDK operation.
  - `useSubscription` receives `currentUser?.uid ?? null`, not a boolean auth flag. It does not configure RevenueCat for a blank UID or outside explicit E2E fixtures.
  - The first queued SDK operation calls `Purchases.configure({ apiKey, appUserID: authUid })`. Subsequent user changes are serialized through `Purchases.logIn(authUid)` before a customer-info read, restore, purchase, or paywall operation can run.
  - The app ignores stale entitlement results after a UID change. Its server snapshot source verifies the expected current server UID both before and after resolving the bearer token, so an old RevenueCat result cannot be synchronized to a new server session.
  - This alignment is a prerequisite for enabling the RevenueCat dashboard webhook because server webhook snapshots are keyed by RevenueCat `app_user_id` and server authorization is keyed by the same auth UID.

- `D-183`: Google social authentication uses the native `@react-native-google-signin/google-signin` SDK and the self-managed MyChampions token-exchange endpoint.
  - Android is registered in Google Cloud by production package plus the Google Play app-signing SHA-1. The mobile SDK requests an ID token for the configured web client; the server accepts only the explicitly configured Android, iOS, and web audiences. Release CI validates platform client IDs, the iOS callback scheme, Android package, and Play signing SHA-1 against `config/google-oauth-production.json` so a rotated or mismatched environment value fails before compilation.
  - iOS registers both production and development Google callback schemes and requires the matching iOS client ID plus the web client ID.
  - The former browser-based `expo-auth-session` adapter is removed because custom-scheme Android redirects are not a supported production Google OAuth path.
  - Sign in with Apple remains native. The source entitlement and release-profile guard require `com.apple.developer.applesignin = Default`; local device Release signing now proves that entitlement after the Apple account holder accepted the current Program License Agreement. CI/App Store signing still requires a conforming Apple Distribution profile with production push entitlement.

- `D-184`: Expo web is a responsive SPA target with platform-specific adapter
  modules. Under 768px it keeps bottom navigation; 768-1023px uses an icon rail;
  1024px and above uses a labeled sidebar. `DsScreen` owns form/content/wide
  constraints. The PR workflow validates the export ephemerally and does not
  publish it; website deployment remains a separate approval boundary.
- `D-185`: Browser auth uses an in-memory access token plus rotating HttpOnly refresh cookie selected by `sessionMode: cookie`. Exact credentialed CORS origins come from `WEB_ALLOWED_ORIGINS`; production defaults fail closed. Native bearer response contracts remain backward compatible.
- `D-186`: Browser subscriptions read server entitlement snapshots and expose `mobile_handoff` or `unavailable`; RevenueCat stays native-only. Unknown paid entitlement fails closed. In-browser purchase/restore is deferred.
- `D-187`: Subscription UI keeps entitlement verification, student capacity, and purchase capability as separate states. Unknown entitlement and count are shown as unavailable rather than as an endless check or fabricated zero. Plan-write locks never disable purchase/restore/handoff recovery. Pre-lapse warnings require an explicit billing-expiry risk signal and are not inferred from active-student count; adding that authoritative signal remains required before enabling the warning.
- `D-188`: RevenueCat subscription authorization uses a canonical customer-manager boundary.
  - The server holds the only secret `sk_*` key and fetches `GET /v1/subscribers/{app_user_id}` after each authenticated webhook. It maps `professional_pro` and `student_pro` independently so a partial product event cannot revoke the unrelated privilege.
  - `TRANSFER` deliveries reconcile every source and destination App User ID before acknowledgement. Configuration/provider failures return non-2xx so RevenueCat can retry instead of leaving an accepted but stale privilege snapshot.
  - Professional snapshot metadata now includes normalized entitlement expiry and an authoritative renewal-risk flag derived only while the entitlement is active and expiring with explicit non-renewal, unsubscribe, or billing-issue evidence.
  - Native paywall presentation exposes success, cancellation, not-presented, network, and store/provider outcomes. Cancellation is nonfatal; RevenueCat `NOT_PRESENTED` is a recoverable configuration failure; provider failures remain visible after refresh; deterministic Detox scenarios cover these outcomes separately from provider-backed sandbox evidence.
  - Mobile server-snapshot fallback validates every privilege/timestamp/count field, requires `source=revenuecat`, rejects a snapshot whose `authUid` differs from the expected current user, and rechecks the session after the network read. A malformed or stale cross-account snapshot cannot unlock paid behavior.
- `D-189`: The 2026-07-23 live RevenueCat audit supersedes D-152's earlier unverified provider-inventory claims while retaining its offering identifiers and application code path.
  - Apps: production App Store and Play Store plus development App Store and Test Store exist. `com.edufelip.mychampions.dev` has no Play Store app configuration, and the dashboard reports that the current account cannot add app configurations.
  - Products: App Store production contains `professional_annual`, `professional_monthly`, `student_annual`, and `student_monthly`, all marked `Missing Metadata`; Play Store contains no products. Development App Store contains `professional_test` and the legacy-typo `student_text`. Test Store contains shared `lifetime`, `yearly`, and `monthly` products that are not attached to entitlements.
  - Entitlements: `professional_pro` correctly owns the two professional App Store products plus `professional_test`; `student_pro` owns the two student App Store products plus `student_text`.
  - Offerings: `default_professional` and `default_student` each expose `$rc_annual` and `$rc_monthly`. Both map the same unattached Test Store yearly/monthly products; neither has Android products or a configured paywall. `default_student` monthly incorrectly maps `professional_test` for the development App Store app.
  - Keys/security: all existing app/Test Store public SDK keys exist, but no secret API key exists. Local Android dev currently reuses the production Android public key because the dev Android provider app is missing.
  - Webhook: `whintgr487dee5eb5` is active at the production HTTPS endpoint, has a masked Authorization header, HMAC enabled, both production and sandbox environments, all apps, and all events. The dashboard currently shows no delivery history.
  - Sandbox access currently allows anybody. Keep it open only through the provider-backed verification run, then restrict it to explicit test App User IDs.
  - Live verification uses the Test Store through an explicit dev-only `test_*` key gate. Production ignores that gate and continues requiring `appl_*`/`goog_*` keys.
  - Live Test Store runs derive fresh, run-scoped App User IDs by default and clear every deterministic entitlement override. The student matrix accepts caller-supplied identities only as an explicit, exact nine-ID set whose members are safe, distinct, and isolated by the caller. Live provider runners require an exclusively owned, newly started Metro process with cleared transforms and fail closed when their configured Metro port is already occupied, so stale Expo environment values cannot select another customer or a fixture entitlement. The optional server-evidence phase reads the canonical subscriber API and the production snapshot for both professional and student customers; it does not write provider or database state or expose credentials.
  - Production deployment now fails before migration/cutover unless `REVENUECAT_SECRET_API_KEY` is a nonblank `sk_*` key and both webhook Authorization and HMAC values are present.
  - Test Store restore only returns retained current customer information; it is not evidence of a true App Store/Google Play restore. Platform-sandbox restore remains a separate release gate.

- `D-190`: AI upgrade paywall initiation is locked-role aware while entitlement evaluation remains backward compatible.
  - Locked students present the guarded student offering: `default_student` normally, or temporary `test_student` only when an explicit development Test Store build opts in.
  - Locked professionals entering either AI gate present `default_professional` normally, or `test_professional` only when an explicit development Test Store build opts in. Both offerings grant the existing `professional_pro` entitlement, which already includes AI access. They cannot initiate a new student-plan purchase through the app.
  - Missing or malformed role state fails closed without presenting a paywall.
  - A valid existing `student_pro` entitlement continues to grant AI access regardless of role; no entitlement is revoked or remapped by this routing change.
  - `test_student` and `Student Paywall v1 Test` remain temporary provider artifacts for the approved Test Store evidence batch. `Student Paywall v1 Production` is now published on `default_student`; the 2026-07-26 promotion approval is recorded in D-196.

- `D-191`: Browser account switching is serialized behind a single in-flight cookie sign-out barrier. `clearSession()` is the only account-screen cleanup boundary and remains awaitable; it clears local identity immediately while the credentialed sign-out attempt continues. Every server-backed email/password, social, and local-development session-establishment path waits for that barrier. Native bearer sessions retain immediate local clearing and persisted-token removal.

- `D-192`: Feature-aware UI-test selection uses one checked-in manifest and a fail-closed resolver for Detox and Playwright.
  - Feature ownership, declared dependencies, suite membership, fixture profiles, shared rules, and platform scope live in `config/test-impact.json`; `.github/CODEOWNERS` starts with `@edufelip` as the fallback owner.
  - Pull requests compare the merge base with the exact head. Renames/copies include old and new paths, deletions retain old ownership, and base/head reverse-import graphs widen indirect impact.
  - Navigation, localization, global design tokens, native/tooling inputs, resolver changes, invalid metadata, unknown runtime paths, resolution errors, or more than 500 changed files fail closed to the complete registered CI matrix. `ci:full` may only broaden selection. D-195 retires the proposed repository-level `CI_FORCE_FULL` switch from the authoritative gate; that environment input remains local/direct-resolver-only.
  - The initial workflow is intentionally shadow-only: it reports proposed Playwright/Detox matrices while existing Android, iOS, and web PR workflows remain authoritative. Fast unit/lint/type checks run universally. Selective device/browser execution becomes enforceable only after at least two weeks and 20 representative PRs with zero known selection misses.
  - Full expensive coverage remains the target for nightly and release/hotfix gates after fixture-profile execution and runner capacity are proven. Existing `nutrition`/`plans` and `professional`/`subscription` bidirectional implementation dependencies are explicit legacy boundary exceptions; new undeclared cycles fail validation.

- `D-193`: The feature-aware workflow is promoted from shadow reporting to the
  candidate selection/execution contract under an explicit delivery decision; this
  supersedes the elapsed-time and PR-count precondition in D-192 without claiming
  that the former observation window completed. D-195 adds the separate
  persistent-runner security and repository-enforcement promotion gate.
  - The promotion pull request changes workflow/test infrastructure, so the
    resolver must fail closed and execute the complete registered CI matrix on its
    exact head before the gate is made required.
  - Pull requests to `main`, `release/**`, and `hotfix/**` always run universal
    manifest, unit, lint, type, and diff checks. A normal feature change runs the
    affected Playwright and Detox suites on every platform declared by those
    suites. Shared navigation, localization, native, global design-system, unknown
    runtime, invalid metadata, merge-queue, release/hotfix, and
    `ci:full` inputs broaden to the complete applicable matrix.
  - Detox fixture profiles are executable, validated contracts. Every selected
    phase owns a fresh Metro process and explicit app/test environment. Runtime
    phase values, including explicit empty clears, take precedence over fixture
    values embedded when the native debug binary is built once per platform job.
    Metro's status endpoint proves only that the server is listening: before
    Detox launches, the executor must fetch and fully consume the current
    platform's Expo development bundle under that phase's exact environment,
    with a four-minute bounded request window that tolerates a healthy cold
    transform on the shared host. A timeout, non-success response, missing,
    empty, or interrupted body, or Metro exit during prewarming fails the phase;
    the bundle is never shared across fresh fixture phases.
    Contradictory story states execute in separate scenario-gated phases; AI meal
    analysis proves the locked state only when both AI and professional
    entitlements are lapsed, then proves success in a separate active-entitlement
    phase. Missing or invalid scenarios fail authenticated direct runs instead of
    skipping both expectations. Image-upload source-sheet and synthetic-success
    assertions likewise execute in separate scenario-gated phases; the success
    fixture is cleared for the source-sheet phase, and a missing or invalid
    scenario fails an authenticated direct run. The student dashboard and
    relationship native stories launch a fresh app per case, and Android CI specs
    never reload React Native across Detox's idling registry.
    The SC-215 custom-meal quick-log story atomically replaces and asserts its
    controlled grams value, dismisses the active keyboard through the
    platform-owned path, and uses stable element identifiers rather than
    coordinate fallbacks.
    The iOS job reserves dedicated non-ephemeral Metro port `18081`, verifies it
    is free before the one-time native build, passes it through
    `DETOX_METRO_PORT`, compiles it as `RCT_METRO_PORT`, and routes every
    debug-app launch through the matching `RCT_jsLocation`. Every subsequent
    phase rechecks ownership before binding. An unrelated
    listener, including a developer server on the default `8081`, is never
    reused or terminated. Android retains fixed port `8081` because its app,
    instrumentation preference, and ADB reverse tunnel form one coordinated
    contract.
    The WSL lane rejects stale Android emulator state, restarts ADB, and
    preboots `Pixel_10` at console port `5554` before selected Detox execution.
    Its 120-second gate revalidates the saved PID, runner UID, Linux process
    start time, expected AVD/port command identity, exact `emulator-5554`
    readiness, `sys.boot_completed=1`, and reported AVD name. Detox then reuses
    that running AVD, while both in-step and always-run cleanup target only its
    exact serial and revalidated process and fail if any QEMU process, emulator
    device, or `5554/5555` listener survives.
    The executor explicitly suppresses only the in-app development LogBox
    notification layer during native E2E phases while warnings remain in runner
    logs, and compact-viewport tests scroll stable targets into view before
    interaction.
    Cleanup enumerates and signals runner-UID members when a mixed-UID process
    group makes group signaling return `EPERM`, then verifies that no runner-owned
    member or Metro listener survives. A run that executes no test or cannot
    prove cleanup fails closed. Provider-live suites remain ineligible for PR CI.
    Android Detox instrumentation synchronously persists React Native's
    `debug_http_host` as `localhost:8081` before each instrumented launch. This
    makes the existing `reversePorts: [8081]` tunnel authoritative instead of the
    stock emulator's `10.0.2.2` gateway, and a failed preference write aborts the
    invocation before React Native starts.
  - The three legacy PR workflows are manual-only. The stable selective gate fails
    when any selected lane is skipped or fails. D-195 separates the
    GitHub-hosted-only pull-request preflight from the protected-default-branch
    trusted workflow that may reach persistent runners.
  - Green runs upload no impact report, web export, app, APK, or test artifact.
    Only bounded failure diagnostics may be uploaded, with one-day retention.
    GitHub Actions-backed caches are disabled; persistent caches are local to the
    self-hosted hosts.
  - Owner-dispatched full validation and the release/hotfix full matrix provide
    omission detection without an unattended daily native run. Merge-group
    full-matrix handling remains checked-in for
    future organization-owned repository use; GitHub does not offer merge queues
    to this personal public repository. Any reproducible selection miss pauses
    promotion and uses the `ci:full` label or an owner-dispatched full run until
    ownership or dependency metadata is corrected and exact-head full evidence
    passes.

- `D-194`: SC-207 meal-item authoring renders the tall add-food editor in normal
  measured page flow rather than as an absolute child outside the parent scroll
  extent. Compact native clients can therefore scroll search, result selection,
  quantity review, and Add into view. Deterministic coverage asserts the exact
  meal name and dismisses its editor without synthetic Android Enter, then
  asserts the exact search query and waits for the debounced result after
  dismissing Gboard on Android or uses iOS Return, and uses the semantic
  localized removal confirmation instead of screen coordinates.

- `D-195`: D-193 remains authoritative for feature-impact resolution, selected
  suite execution, full-matrix fallback, and zero-success-artifact behavior, but
  promotion onto persistent self-hosted runners is conditional on a separate
  runner-security and repository-enforcement gate.
  - `.github/workflows/trusted-selective-freshness.yml` is a
    protected-default-branch, GitHub-hosted-only `pull_request_target` metadata
    workflow. It never checks out candidate code. For an open owner-authored,
    same-upstream pull request it replaces any reusable `Selective CI gate`
    success with a freshness-owned pending status carrying a canonical event
    fingerprint before the matching candidate preflight may complete.
  - `.github/workflows/pr-selective-tests.yml` is a GitHub-hosted-only
    `pull_request`/`merge_group` preflight and must never target a self-hosted
    runner. Pull-request base filters include `main`, `release/**`, and
    `hotfix/**`. Its pull-request job has only `statuses: read` and waits until
    the trusted pending status for its exact event fingerprint is observable.
    `.github/workflows/trusted-selective-tests.yml` is the authoritative
    execution workflow. The supported pull-request path reaches it after the
    preflight completes and GitHub dispatches `workflow_run`; GitHub loads this
    workflow definition from protected default branch `main`, not from the
    candidate branch.
  - Live same-upstream owner PRs into `release/**` or `hotfix/**` are authorized
    through that same protected-`main` workflow-run path and force the complete
    matrix. Neither target branch is a direct source or trigger for the trusted
    workflow.
  - Before candidate checkout or self-hosted scheduling, a GitHub-hosted
    authorization job compares the triggering workflow run and event with the
    live pull-request API. It fails closed unless the live head equals the
    candidate SHA and provenance proves the expected upstream/base repository,
    owner actor, triggering actor, sender, preflight workflow path/ref/SHA,
    trusted workflow path/ref/SHA, and allowed event/ref/base. Missing, malformed,
    fork, stale, or inconsistent provenance is rejected.
  - Candidate and self-hosted jobs have only `contents: read`. Exactly three
    trusted GitHub-hosted jobs may have `statuses: write`: the freshness
    invalidator, the authorization/status initializer, and the always-run
    finalizer. After freshness invalidates an old exact-head success, the
    initializer safely resolves one eligible open, ready, owner-authored
    same-upstream pull request for that head and publishes
    `Selective CI gate` as in-progress pending. The finalizer repeats that unique
    pull-request binding, reduces authorization, impact, fast-quality, web, iOS,
    and Android results, and publishes success or failure only if the latest
    status is still the pending target owned by its workflow run. Fork or
    unidentifiable authorization denials publish no candidate status; freshness
    pending or an absent required context remains merge-blocking.
  - The freshness invalidator, authorization/status initializer, and finalizer
    share one repository-global `queue: max` status-writer concurrency group.
    GitHub serializes these writers and retains their queued order instead of
    replacing a pending writer. Separately, the freshness workflow's stable
    per-pull-request group uses `cancel-in-progress: true` to coalesce superseded
    metadata work before its job enters the global writer queue, and the trusted
    per-PR/head workflow concurrency may cancel superseded validation work. The
    finalizer validates ownership of the latest pending target rather than
    querying the latest Actions run, so an older run cannot overwrite a newer
    freshness or validation cycle.
  - Merge-group authorization resolves and validates every associated live pull
    request for the same upstream and owner provenance. The trusted workflow has
    no direct `merge_group` trigger because queue-ref YAML is not a trusted
    default-branch source. This support is future-compatible only: GitHub merge
    queues are available to organization-owned public repositories, not this
    personal public repository. Current merge safety therefore uses strict
    up-to-date branch protection.
  - Direct push-to-`main` executes the trusted workflow
    from `main` but never publishes the SHA-global pull-request status context.
    Manual execution is allowed only through `workflow_dispatch` at ref `main`;
    it accepts a pull-request number, resolves the live head/base via API, and
    forces the complete matrix. These paths receive equivalent hosted
    authorization before candidate checkout or self-hosted scheduling.
  - GitHub runner started/completed hooks remain host-wide resource locks and
    defense-in-depth only. They are not an authorization boundary and are not
    used to establish candidate provenance.
  - Repository-scoped runner labels are static and technically targetable by
    any GitHub-approved workflow. A personal repository cannot apply an
    organization runner-group workflow allowlist, and stock runner hooks cannot
    close that authorization gap. The enforceable operational boundary is
    GitHub approval for all external workflows, `edufelip` as the sole
    collaborator, and a standing rule to never approve fork or untrusted
    workflow changes. Adding a collaborator or approving any external workflow
    change requires first pausing the persistent runners and replacing this
    boundary with a private broker, JIT, or ephemeral runners.
  - GitHub fork-workflow approval must require approval for all external
    contributors. Every `uses:` entry must be pinned to a reviewed full commit
    SHA, and repository Actions policy must enforce the approved action
    allowlist and SHA pinning. The 2026-07-29 settings read-back verifies
    all-external approval, a read-only default workflow token, disabled workflow
    pull-request approval, selected-actions mode with GitHub-owned actions plus
    `oven-sh/setup-bun@*` and `r0adkll/upload-google-play@*`, no general
    verified-creator allowance, and required SHA pinning; the checked-in action
    audit verifies every current `uses:` reference is full-SHA pinned.
  - The freshness and authoritative workflows must first be present and
    registered on default branch `main`; only then may the PR preflight and
    required checks be enabled. Default-branch registration and one live
    exact-event-fingerprint freshness/preflight handshake are promotion
    evidence, not an assumption from checked-in files.
  - A coordinated `mychampions-api` branch is resolved once to a full commit SHA.
    The web lane checks out that detached SHA and records it with the mobile head
    evidence; a mutable branch name is not accepted as exact-run provenance.
  - Each native creation/use step installs idempotent `EXIT`, `INT`, and `TERM`
    handlers before materializing secrets. `ENV_FILE_CONTENT` is the initial
    step-environment transport consumed only by the atomic secret writer and is
    immediately unset before Yarn, Gradle, `xcrun`, or recovery subprocesses.
    Secret bytes are then present only in a validated per-job regular file below
    `$RUNNER_TEMP` with mode `0600`; the workspace root `.env` is an absolute
    symlink to that exact target and its contents are never echoed. Normal and
    signal handlers remove the symlink without following it, remove the exact
    target, and verify both absent before returning. Runner-temp teardown is
    hard-kill defense-in-depth, while the next trusted checkout/preflight removes
    and verifies absence of any unexpected workspace `.env` entry or fails
    closed. Long build/test commands run as supervised isolated process groups
    behind an interruptible shell wait. The outer supervisor grace covers
    coordinator-owned detached invocation/Metro group `TERM`/`KILL`, the outer
    fallback, and the executable fixture for that nested path. The signal path
    must complete bounded native-resource cleanup within GitHub's documented
    7.5-second `SIGINT` plus 2.5-second `SIGTERM` grace window. A retained link or
    target fails the secret cleanup contract.
  - Device ownership needed after job teardown is a non-secret recovery ledger,
    not `$RUNNER_TEMP` or workspace state. While holding the host lock, each
    native lane uses the runner service environment
    `MYCHAMPIONS_NATIVE_STATE_ROOT`. It must be a validated absolute canonical,
    runner-owned, non-symlink, mode-`0700` persistent directory outside the
    workspace and `$RUNNER_TEMP`; the lane verifies every ledger file's owner,
    mode, type/no-symlink status, record completeness, and strict
    numeric/UUID/name fields before trusting a record. Malformed or incomplete
    state fails closed. `.env`, its runner-temp target, tokens, and secret values
    never enter this ledger. The Mac service value
    `/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery` was
    configured and read back on 2026-07-29. The intended WSL value
    `/home/eduardo/.local/state/github-actions/mychampions-native-recovery`
    remains pending recovery of the current endpoint and service read-back.
  - Native creation has no interruptible gap before exact recovery becomes
    possible. The iOS lane writes a workflow-owned name/namespace intent before
    `simctl create`, then durably records and validates the returned exact UUID;
    interruption before UUID handoff is recovered only by that unique namespace.
    Android launch-to-PID capture and durable PID/UID/Linux-start-time plus
    expected AVD/port/serial/command record is cancellation-safe, or a later run
    may recover only a process that proves that complete exact identity.
  - At the start of the next trusted native run, while holding the host lock and
    before creating any device, the lane consumes stale workflow-owned records,
    revalidates exact identity, and cleans/verifies only that resource. Normal and
    signal cleanup remove an owner record only after exact device/process,
    serial, and port absence is proved. Cleanup or recovery failure retains the
    record/evidence and fails closed. Global `simctl shutdown all`, `pkill`,
    arbitrary QEMU signaling, and unrelated ADB/device mutation are prohibited.
    Later `if: always()` verifiers are defense-in-depth, not the cancellation
    guarantee; host hooks remain resource-lock-only.
  - The web-only companion is the controlled exception to the WSL native host
    lease. It has only `mychampions-ci,mychampions-web-only`, receives neither
    native hook environment nor `MYCHAMPIONS_NATIVE_STATE_ROOT`, and can execute
    only the Playwright lane. Live overlap exceeded the 15-percent regression
    threshold when Playwright took 13m56s against its 2m18s baseline. Web and
    Android therefore use the shared
    `mychampions-wsl-ui` concurrency group; the companion, native Android hook
    lease, recovery contract, and timeout protections remain.
  - Hosted selected invocations are bounded at 600000 ms and report the exact
    invocation ID after terminating their owned process group. An absent timeout
    variable leaves local execution unbounded. Native jobs have an outer
    75-minute limit and preserve their existing Metro, emulator, simulator, and
    secret cleanup paths.
  - Executable contracts must send both `SIGINT` and `SIGTERM` through the
    checked-in supervisor and exact cleanup path, cover interruption before
    metadata handoff, inject cleanup failure, prove retained-record next-run
    recovery, and preserve unrelated resources. These local fixtures validate
    shell control flow but do not prove live runner cancellation cleanup.
    Promotion requires live mid-build and mid-test cancellations on both native
    hosts showing workspace-link and runner-temp secret-target absence,
    terminated supervised children, exact owned-device cleanup or retained
    recovery evidence, preserved unrelated devices, and released host locks.
  - `main` must require a pull request, strict up-to-date branches, the exact
    `Hosted candidate preflight` check, the exact stable `Selective CI gate`
    status, conversation resolution, administrator enforcement, and no
    direct-push or merge bypass. Required approvals remain zero because the sole
    repository author cannot approve their own pull request. CODEOWNERS provides
    review routing and visibility only; it is not an owner-approval gate.
  - Trusted-workflow provenance, negative authorization probes, live-head
    mismatch/stale-run rejection, job-token isolation, stale-safe
    freshness/run-owned pending/final status publishing, exact backend SHA,
    environment cleanup, simulator ownership, and the `main` rules remain
    promotion gates pending workflow-run/API, cancellation, repository-setting,
    and exact-head full-matrix evidence. Fork approval, the current
    sole-collaborator roster, repository workflow-token defaults, the action
    allowlist, and SHA-pinning policy have dated 2026-07-29 read-back evidence
    and must remain unchanged. Existing runner
    registration, host-lock stress tests, checked-in workflow text, or a green
    run do not by themselves satisfy D-195.
  - D-195 supersedes D-193 only where D-193 describes the workflow as already
    promoted or safely handling forks. D-193's test-selection and execution
    semantics remain unchanged.
  - D-195 evidence establishes CI trust and merge enforcement only. It does not
    prove deployment, production configuration, provider-console state,
    store-live distribution, or provider-backed purchase/restore behavior.

- `D-196` (superseded for the professional surface by `D-197`): The 2026-07-26 RevenueCat paywall promotion keeps one explicit student Test Store variant and one production student variant.
  - `Student Paywall v1 Test` remains published on `test_student` for the explicit development/Test Store route.
  - `Student Paywall v1 Production` is published on `default_student` with the same approved package bindings, localized copy, monthly default, legal destinations, and light/dark/accessibility contract. The normal student app route already resolves `default_student`, so no mobile code change is required for this provider promotion.
  - The earlier decision to keep professionals on one offering was intentionally conservative, but is superseded by `D-197` after the requirement for explicit professional Test Store and production surfaces was clarified.

- `D-197`: Professionals have explicit production and Test Store RevenueCat surfaces.
  - Production uses `default_professional` with `Professional Paywall v1`; an explicit development/Test Store build uses `test_professional` with `Professional Paywall v1 Test`.
  - Both offerings use the `professional_pro` entitlement and separate plan-specific products. `test_professional` is selected only when `APP_VARIANT=dev`, `EXPO_PUBLIC_REVENUECAT_TEST_STORE_ENABLED=true`, and `EXPO_PUBLIC_REVENUECAT_PROFESSIONAL_OFFERING_ID=test_professional` are all present.
  - Production and normal development continue to resolve `default_professional`; malformed or unsafe professional offering overrides fail closed before paywall presentation.
  - RevenueCat's Published view now contains four paywalls: the production and Test Store variants for both Student and Professional. Inactive remains empty. Dashboard publication is not a substitute for updated device rendering, App Store/Google Play purchase, or true platform restore evidence.

- `D-198`: Student RevenueCat paywalls use the professional surface's vertical rhythm for visual parity.
  - `Student Paywall v1 Test` and `Student Paywall v1 Production` retain the student-specific headline, benefits, packages, legal destinations, monthly default, and accessibility/localization contract.
  - The 2026-07-26 editor refinement sets 16 px root child spacing, a 72 px top margin on the student value-proposition header, and an 8 px purchase-footer cadence with 12/16/16/16 px top/right/bottom/left padding. This removes the dominant disconnected middle gap while preserving the existing products, offerings, entitlements, and paywall logic.
  - Both published variants were verified in the RevenueCat iPhone 17 Pro dashboard preview. Device/Test Store rendering and platform-store purchase/restore remain separate release evidence gates.

- `D-199`: On-demand manual QA uses a **global** Agent Skill (`~/.cursor/skills/qa-manual-run`) plus Linear, not a Cursor Automation trigger. Product specifics live in family adapters (`families/mychampions.md`, `families/guiabrecho.md`); repo-local `qa-*.md` files remain pack sources of truth.
  - Kickoff is chat-only. Scope defaults to the **surface** smoke pack (cwd or `surface=`), or explicit `UC-*` / `TC-*` / named packs. MyChampions surfaces: `mobile`/`web` (`mychampions`), `api` (`server`), `food` (`mychampionsapi-food`), `exercises` (`mychampionsapi-exercises`).
  - Execution is hybrid: automated signal for the surface, then a human-like pass (UI or backend contract/security/data-shape/concurrency checklist). Cross-surface only when scoped.
  - Linear system of record is a parent **QA Run** issue (`qa-run` label) with auto-filed child issues using the workspace **Bug** label in the MyChampions project (team Edulyta). Doc Gaps and Known Deferred stay on the QA Run (`doc-gap` / `known-deferred`) and are never filed as Bugs. Bug titles require id prefixes with strict open-issue dedupe.
  - Environment registry is `docs/test-cases/qa-env-registry.md` for the app: default `local`; `dev` refused until a dedicated VM development API/DB exists; `prod` confirm-gated (`confirm prod qa`). App `APP_VARIANT` is not the QA env id.
  - Before finalize, each run writes Skill self-improvement insights to `~/Documents/Default/Projects/MyChampions/QA-Skill-Insights/` for human triage. These are not Linear Bugs.

- `D-200`: iOS test execution is controlled by the default-on repository variable
  `MYCHAMPIONS_ENABLE_IOS_TESTS`.
  - The exact string `false` skips new iOS test-only jobs, including the manual
    iOS smoke path, selected iOS Detox suites, protected full iOS Detox
    validation, and provider-backed iOS Test Store validation. An unset
    variable or any other value, including `true`, keeps iOS testing enabled.
    The protected full workflow remains test-only even when triggered by a
    published release event, and this checkout has no scheduled or nightly iOS
    test workflow.
  - The variable does not cancel jobs that are already running and does not
    gate credentialed release/distribution workflows.
  - The final selective status publisher treats an intentional iOS skip as
    allowed only while the variable is exactly `false`; JavaScript,
    TypeScript, lint, unit, web, Android, backend, and all other enabled lanes
    remain enforced.
- `D-201`: The 2026-08-08 testing-strategy workstreams are implemented as
  evidence-producing gates, but unavailable hosted, native-runner, provider,
  and store-live sources remain explicitly unavailable rather than inferred.
  - Selective CI publication now authorizes and publishes the exact-head
    status on `push` as well as pull-request/dispatch/merge-group runs. Owned
    pending-status protection remains limited to event types that have a pull
    request context; a hosted rerun on the corrected revision is still needed
    to prove the previous main-branch failure publication path.
  - The app now has typed ESLint, typecheck, Prettier check, Husky/lint-staged,
    browser critical paths, visual evidence metadata, protected deterministic
    native profiles, and three targeted native gap scenarios. `noUncheckedIndexedAccess`
    was evaluated but is not enabled in this change because the current app
    baseline requires a separately budgeted migration; that debt is tracked as
    an open follow-up, not silently waived.
  - The root Bun server, food service, and exercise service each expose local
    build/lint/test or consumer-contract gates. Their contracts keep the
    MyChampions server as the domain backend baseline; no new cross-service
    API shape is accepted without a documented consumer mismatch.
  - Full Detox validation is protected manual/release-only, checks out the
    exact SHA, builds once per platform, serializes the explicit recovery-root
    host lock, and excludes live RevenueCat. No unattended nightly is enabled
    until runner cleanup, duration, and reliability SLO evidence exists.
  - RevenueCat validation is manual and Test Store-only with `test_*` keys,
    isolated App User IDs, and read-only server reconciliation. Missing keys,
    provider access, Android catalog/app configuration, or runner capacity are
    blocked evidence; deterministic entitlement fixtures are not provider
    proof. Production purchases and store mutations remain prohibited.
  - The first recurring-persona browser-first run is Linear QA Run `ET-25` in
    the Edulyta workspace. It records the three personas, twelve manifest
    feature families, browser evidence, and unverified native/provider rows;
    no Bug is filed without two reproductions plus a control.
  - A dated cross-repo test-gap report and repeatable sweep procedure are
    required monthly. This change records the first report and keeps local,
    hosted, native, provider, and store-live evidence as separate states.

- `D-202`: Supersedes the AsyncStorage half of `D-151`. Native (iOS/Android)
  server-auth session persistence (`features/auth/server-auth-storage.ts`)
  splits the persisted record across two backing stores instead of writing
  the whole JSON blob to plain `@react-native-async-storage/async-storage`:
  - The bearer credentials (`accessToken`, `refreshToken` — the actual secret
    that lets a device act as the user for the refresh token's 30-day
    lifetime) are written to `expo-secure-store`, which is backed by the iOS
    Keychain / Android Keystore.
  - The remaining session fields (profile, `expiresAt`, `authProviderIds`,
    `emailVerified`) are not authentication secrets on their own and stay in
    plain AsyncStorage, keeping each SecureStore write comfortably under its
    ~2048-byte platform limit even with this app's RS256-signed tokens.
  - A record written by the pre-fix code (tokens embedded directly in the
    AsyncStorage blob) is migrated in place the first time it is read: tokens
    move into SecureStore and are stripped from the AsyncStorage copy, so an
    already-logged-in device keeps its session across the upgrade instead of
    being signed out.
  - The web build is unaffected: `features/auth/server-auth-storage.web.ts`
    was already a correct no-op (web relies on the server's HttpOnly cookie
    refresh session, not client-JS-readable storage).

- `D-203`: ET-106 — the professional pending-queue row (`SC-205`, `/professional/pending`)
  is a non-interactive container, not a button. Row-level `accessibilityRole="button"`
  previously wrapped the Accept and Deny buttons as DOM descendants, which
  react-native-web rendered as an invalid `<button>` nested inside another
  `<button>` on web, producing React hydration errors and an unreliable
  accessibility tree/focus order. The fix scopes row selection to a single
  dedicated sibling checkbox control (`accessibilityRole="checkbox"`, 44x44
  touch target, Space-key operable) so the row, checkbox, Accept, and Deny are
  all siblings with independent, unambiguous focus stops. This resolves the
  "entire row vs. checkbox only" open question in favor of checkbox-only
  selection, matching the equivalent decision already made for the student
  assigned-meal card (ET-99).

## Pending Decisions

- See `docs/discovery/open-questions-v1.md`.

## Native iOS Build Compatibility

- `D-173`: Local iOS builds on Xcode 26.5 keep React Native targets on C++20 but force only the `fmt` pod target to C++17 in `ios/Podfile` post-install, because `fmt 11.0.2` fails to compile its C++20 consteval `FMT_STRING` path under this toolchain.
