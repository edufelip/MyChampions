# Pending Wiring Checklist V1

## Purpose

Track intentionally deferred implementation wiring so it is completed before release hardening.

## Status Legend

- `Pending`: not wired yet.
- `In progress`: partially wired.
- `Done`: fully wired and validated.

## Auth Wiring (Current Priority)

- `Done`: Sign-in posts email/password credentials to the MyChampions server `POST /auth/email/sign-in` boundary, persists the returned local bearer session from local Postgres `local_email_auth_credentials`, and fails closed without falling back to Firebase email/password sign-in and without using the deterministic dev-session bridge for normal local email/password auth.
- `Done`: Create-account submit posts to the MyChampions server `POST /auth/email/create-account` boundary, persists the returned local bearer session from local Postgres `local_email_auth_credentials`, and fails closed without falling back to Firebase email/password sign-up and without using the deterministic dev-session bridge for normal local email/password auth.
- `Done`: Google Sign-In no longer constructs Firebase provider credentials. `features/auth/google-social-auth-source.ts` uses `@react-native-google-signin/google-signin` on iOS and Android, requires the web client ID plus the iOS client ID on iOS, and forwards the native Google `idToken` to the server-owned `POST /auth/social/sign-in` boundary. The deterministic local dev-session fallback is available only in explicit local/dev app variants for explicit provider-token configuration gaps, with provider-neutral `google` IDs only when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps.
- `Done`: Apple Sign-In no longer constructs Firebase provider credentials; outside explicit E2E social-auth fixtures, it now tries native `expo-apple-authentication` identity-token capture, posts the captured Apple `idToken` plus nonce to the server-owned `POST /auth/social/sign-in` boundary, and falls back to a deterministic local MyChampions server social session with provider-neutral `apple` IDs only when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps.
- `In progress`: Complete durable self-managed auth session persistence and approved production provider configuration after the remote server/database are ready.
  - Done: Local dev-session and E2E auth-session state drive `isAuthenticated`; missing local/E2E auth now hydrates as unauthenticated instead of subscribing to a mobile-owned provider session.
  - Done: The server owns the email/password auth boundary with local Postgres `local_email_auth_credentials` and Argon2id hashes.
  - Done: iOS/Android production release workflows now fail before native compilation unless the platform Google OAuth client ID and correctly prefixed public RevenueCat SDK key are present in `ENV_FILE`.
  - Partial: Google Android/iOS/web and Apple native audiences are configured in the VM and production GitHub environment. The Android OAuth client is bound to `com.edufelip.mychampions` plus the Play app-signing SHA-1; both iOS reverse-client schemes are registered; Google OAuth is external and published. Apple source entitlement and CI profile checks are implemented, but Apple blocks profile creation until the account holder accepts the latest Program License Agreement and regenerates a profile carrying `com.apple.developer.applesignin = Default`.
  - Done: The server owns the Google/Apple social auth exchange boundary at `POST /auth/social/sign-in`, directly verifies provider ID tokens against issuer JWKS and configured audiences, and otherwise fails closed with a configuration error.
  - Done: `features/auth/social-auth-source.ts` posts captured Google/Apple provider tokens to `POST /auth/social/sign-in` and persists the returned MyChampions server bearer session without Firebase credential helpers.
  - Done: `features/auth/apple-social-auth-source.ts` captures native Apple identity tokens with a nonce through `expo-apple-authentication`, forwards them to the social-auth source, and only uses deterministic local dev-session fallback when the app variant is unset, blank, or `dev`, and only for explicit provider-token configuration gaps.
  - Done: `features/auth/google-social-auth-source.ts` configures Google's supported native iOS/Android SDK, checks Play Services on Android, normalizes cancellation, forwards the provider `idToken` to the server-owned social-auth source, and limits deterministic fallback to local/dev configuration gaps.
  - Done: Durable self-managed server auth sessions are persisted in PostgreSQL with rotating refresh-token digests and stable configured JWT key material; local mobile auth/profile behavior is server-owned.
  - Done: Role-lock reads/writes pass through `profile-source` and now prefer the MyChampions server profile endpoints for local bearer sessions.
- `Done`: Full create-account form implemented in `app/auth/create-account.tsx` with documented password and duplicate-email validation rules.
- `Done`: Full role-selection UX implemented in `app/auth/role-selection.tsx` with role cards, required-selection validation, and self-guided Student+Continue path (no standalone quick-start button).
- `Done`: Persist and enforce role-lock flow through `features/auth/profile-source.ts`, `features/auth/auth-session.tsx`, and `app/auth/role-selection.tsx`; local bearer sessions use the MyChampions server profile endpoint.
- `Done`: Session/route guard wiring implemented in `app/_layout.tsx` with auth-required routing and wrong-role redirects.
- `Done`: Terms acceptance gate wiring after authentication:
  - Done: `/auth/accept-terms` route implemented; sign-in/create-account success now route to terms screen.
  - Done: Global auth guard blocks role-selection/role-home when terms acceptance is pending.
  - Done: Root auth guard path normalization + redirect de-duplication prevent replace-loop churn (fixes max update depth during terms transitions).
  - Done: Runtime terms config is environment-driven (`EXPO_PUBLIC_TERMS_REQUIRED_VERSION`, `EXPO_PUBLIC_TERMS_URL`) with fallback (`v1`, `https://portfolio.eduwaldo.com/projects/my-champions/terms_of_use`).
    - Done: Accepted terms version is persisted in the MyChampions server profile via `setAcceptedTermsVersionInSource`; AsyncStorage fallback removed from auth-session terms flow.
- `Done`: Documented auth/onboarding analytics events emit through the MyChampions server analytics path in real runtime telemetry. Sign-in and create-account screens emit entry, submit, async failure, and client-side validation failure events; role selection emits entry, selected-role, and student self-guided-start events.

## Native Bootstrap

- `Done`: One-time `expo prebuild` executed and native directories generated (`ios/`, `android/`) for direct maintenance going forward.
- `Done`: Native permissions policy — all native permission strings and manifest entries are applied directly to `ios/mychampions/Info.plist` and `android/app/src/main/AndroidManifest.xml`. Expo config plugins for packages with native side-effects (`expo-camera`, `expo-image-picker`) are **not** listed in `app.config.ts` plugins array to prevent accidental overwrite on any future `expo prebuild`. New packages requiring native permissions must add them directly to the native files (D-129).
- `Done`: Native app-identity drift cleanup — iOS URL schemes and Android source packages are aligned with the documented Expo/native identifiers (`com.edufelip.mychampions`, `com.edufelip.mychampions.dev`, `mychampions`), removing the legacy `com.eduardo880.mychampions` runtime reference that could break Expo dev-client launches.
- `Retired`: Environment-aware Firebase config wiring is no longer part of native bootstrap.
  - Android Gradle no longer applies the Google Services plugin or consumes `google-services.json`.
  - iOS no longer has a `[Firebase] Select GoogleService plist` build phase, and iOS run scripts no longer call `check:ios-firebase`.

## Manual QA Skill + Linear

- `Done`: On-demand chat Skill contract documented (`docs/test-cases/qa-manual-run-playbook.md`, `qa-smoke-pack.md`, `qa-env-registry.md`) and implemented as global `~/.cursor/skills/qa-manual-run` with family adapter `families/mychampions.md` (D-199). Sibling API smoke packs live under `server/docs`, `mychampionsapi-food/docs`, `mychampionsapi-exercises/docs`. Linear MyChampions project + `qa-run` / workspace `Bug` / `doc-gap` / `known-deferred` labels are the system of record.
- `Pending`: Dedicated VM **development** database + API host (or path) so QA env id `dev` can leave Placeholder status in `docs/test-cases/qa-env-registry.md`. Until then the Skill defaults to `local` and refuses `env=dev`.
- `Pending`: Extend the manual QA Skill to native surfaces (iOS/Android simulator or TestFlight) with the same Linear QA Run / Bug contract. Web remains the only supported Skill surface in v1.

## E2E Wiring

- `Done`: Detox project scaffolding added (`.detoxrc.js`, `e2e/jest.config.js`, auth smoke specs, Android instrumentation wiring, auth screen `testID` selectors).
- `Done`: Focused iOS Detox manual smoke wiring added. `.detoxrc.js` supports `DETOX_JEST_CONFIG`, `e2e/jest.smoke.config.js` selects the migration-critical smoke specs, `package.json` exposes `test:e2e:ios:debug:smoke`, and the legacy manual-only `.github/workflows/ios-pr.yml` runs the debug Detox build/test commands when dispatched.
- `Done`: Detox smoke coverage now includes auth sign-in, onboarding role-lock, wrong-role redirects, and student invite entry through `auth-sign-in.e2e.test.js`, `auth-role-selection.e2e.test.js`, and `student-professionals.e2e.test.js`; compact auth actions are scrolled into view, role selection uses a deterministic runtime source contract for the disabled Continue accessibility/interaction wiring plus native E2E for the preselection route state, and native selective phases suppress the in-app development LogBox overlay while preserving runner diagnostics.
- `Done`: Native fixture lifecycle hardening isolates image-upload source-sheet and synthetic-success assertions in separate scenario-gated phases, rejects missing authenticated scenarios, and routes Android React Native debug traffic through the configured localhost ADB reverse tunnel before every instrumented launch.
- `Done`: Default Android Detox build/test commands use the secret-free `productionDebug` profile. Signed `productionRelease` Detox evidence remains available through explicit `*:android:release` commands; its build command requires and forwards `CI_VERSION_CODE` and retains the private signing guards.
- `Done`: Web Playwright coverage is organized into smoke, functional, accessibility, evidence, and full batches. Each run creates ignored HTML/JSON/JUnit reports, screenshot attachments, metadata, and a manual-validation checklist. The expansion and review contract is documented in `docs/test-cases/web-playwright-batches-and-manual-validation.md`.
- `In progress`: The protected-default-branch trusted selective workflow runs affected browser suites and checks out the coordinated `mychampions-api` branch only when a selected server-backed cookie-session suite requires it. The legacy `.github/workflows/web-pr.yml` path is manual-only. Both configurations install locked Bun dependencies without provider or production secrets, and Playwright owns the in-memory backend and Expo processes on isolated ports. D-195 promotion still requires resolving the backend branch once to a full commit SHA, checking out that detached SHA, and recording it with the mobile head evidence.
- `Pending`: Complete the server-backed, provider-live, browser-media, assistive-technology, and full student/professional workflow matrix in `docs/discovery/web-pending-items-and-future-improvements.md` before web release approval.

## CI/CD Wiring

- `Done`: GitHub Actions workflow baseline copied/adapted from `meer` into `.github/workflows/`; the original Android/iOS/web PR-named checks remain as manual-only validation paths and the release pipelines remain separate.
- `Retired`: Firebase App Distribution workflows and Firebase config injection steps were removed during the local-server migration.
- `Done`: Workflows are adapted to this repository conventions (`yarn install --frozen-lockfile` with `yarn.lock`, `mychampions` iOS workspace/scheme, and `com.edufelip.mychampions` package identifiers).
- `Done`: CI secret inventory documented in `docs/discovery/ci-secrets-matrix-v1.md` with required/optional scope per workflow.
- `Done`: BL-016 manifest and ownership foundation inventories the feature domains, UI suites, executable fixture profiles, shared/global rules, and platform scope; resolver and contract tests cover feature-only changes, reverse dependencies, shared imports, renames, copies, deletions, documentation-only changes, conservative full fallback, dedicated iOS Metro routing that leaves unrelated listeners untouched, and fail-closed Metro cleanup when macOS process groups contain foreign-UID members.
- `In progress`: `.github/workflows/trusted-selective-freshness.yml` is the protected-default-branch, GitHub-hosted-only `pull_request_target` metadata invalidator for owner-authored same-upstream pull requests. `.github/workflows/pr-selective-tests.yml` is the GitHub-hosted-only `pull_request` preflight for bases `main`, `release/**`, and `hotfix/**`, plus future-compatible `merge_group`; it never checks out candidate code or targets self-hosted labels, and its pull-request job waits for the pending description matching the canonical fingerprint of its exact event. `.github/workflows/trusted-selective-tests.yml` is the protected-default-branch authoritative workflow for authorized `workflow_run`, direct `main` push, schedule, and `workflow_dispatch` at ref `main` with a live-resolved PR number and forced full selection. Push/schedule runs do not publish the pull-request gate. It has no direct merge-group/release/hotfix trigger; merge-group authorization validates every associated live PR, and authorized release/hotfix PR runs force the complete matrix. It keeps universal unit/lint/type checks, runs selected Playwright and both-platform Detox suites through validated executors, and runs complete safety matrices. D-193 supersedes the former elapsed-time/PR-count shadow precondition for selection/execution, while D-195 keeps authoritative promotion and merge blocked until the security and enforcement gates below are verified.
- `Done`: Green selective runs create no GitHub Actions artifact or cache. Native apps/APKs remain on the runner for their single job; bounded failure diagnostics alone use one-day retention. The 2026-07-29 repository read-back after failure cleanup is zero Actions artifacts and zero Actions caches; the exact-head promotion run must preserve that baseline. The `ci:full` label and owner `workflow_dispatch` remain broaden-only full-matrix controls. `CI_FORCE_FULL` remains available only to local/direct resolver invocation; the trusted workflow does not consume a repository variable by that name.
- `Done (capacity only)`: Repository-scoped `mychampions-ios-ci-m5` and `mychampions-ci-ubuntu` runners are registered with the exact labels in `docs/discovery/ci-secrets-matrix-v1.md`. Both physical hosts use the same fail-closed resource-lock contract as their Meer peer, and the frozen lock implementation passed contention/crash coverage. Existing KVM, emulator, and browser launch probes establish capacity only; they do not establish the D-195 authorization boundary.
- `In progress (D-195 promotion gate)`: The complete persistent-runner security and repository-enforcement boundary requires the trusted-workflow and live evidence below.
  - Keep `trusted-selective-freshness.yml` as a protected-`main`,
    GitHub-hosted-only `pull_request_target` metadata workflow with no candidate
    checkout. It posts event-fingerprinted freshness pending only for a live
    owner-authored, same-upstream eligible pull request. Keep the `pull_request` preflight for
    bases `main`, `release/**`, and `hotfix/**`, plus future-compatible
    `merge_group`, GitHub-hosted-only; its pull-request job has only
    `statuses: read` and waits for its matching fingerprinted pending status. The supported candidate
    path dispatches from `trusted-selective-tests.yml` loaded from protected
    default branch `main` after `workflow_run`; release/hotfix PRs force full,
    and static runner labels are not technically restricted to that workflow.
  - Before candidate checkout or self-hosted scheduling, use a GitHub-hosted authorization job to validate the triggering run against the live PR API: exact current head SHA, same upstream/base, owner actor/triggering actor/sender, workflow path/ref/SHA, and event/ref. Prove fork, identity, provenance, malformed-input, head-mismatch, and stale-run negatives.
  - Give candidate and self-hosted jobs only `contents: read`. Give
    `statuses: write` only to the trusted hosted freshness invalidator,
    authorization/status initializer, and always-run finalizer. Serialize all
    three in one repository-global `queue: max` writer group so pending writers
    are queued rather than replaced. Freshness replaces reusable
    exact-head success with pending before preflight completes; the initializer
    requires exactly one eligible open, ready, owner-authored same-upstream PR for
    the head and posts its own pending; the finalizer repeats that unique binding
    and writes success/failure only while the latest pending target is still
    owned by its run. Fork/unidentifiable denials publish no status. Separately,
    keep stable per-pull-request `cancel-in-progress: true` on the freshness
    workflow so superseded metadata work is coalesced before the writer job
    enters the global queue; retain stable per-PR/head cancellation for
    superseded trusted validation work.
  - `Done (2026-07-29 setting read-back)`: GitHub approval is required for all external fork contributors, the default workflow token is read-only, and workflows cannot approve pull requests. Treat host started/completed hooks as resource locks and defense-in-depth only, and never approve or run fork/untrusted workflow changes on the persistent self-hosted runners.
  - Record the personal-public-repository limitation: static runner labels are
    targetable by any GitHub-approved workflow and cannot use organization
    runner-group workflow allowlists. Keep `edufelip` as sole collaborator,
    never approve fork or untrusted workflow changes, and pause the runners
    before adding a collaborator or granting such approval. That scope expansion
    requires a private broker, JIT, or ephemeral-runner architecture.
  - `Done (2026-07-29 policy read-back and contract audit)`: selected-actions mode allows GitHub-owned actions plus `oven-sh/setup-bun@*` and `r0adkll/upload-google-play@*`, does not generally allow verified-creator actions, and requires SHA pins; every checked-in `uses:` reference has a reviewed full commit SHA.
  - Bootstrap `trusted-selective-freshness.yml` and
    `trusted-selective-tests.yml` onto default branch `main`, prove their live
    registration and one matching freshness/preflight fingerprint handshake,
    and only then enable the PR preflight as a required check.
  - Resolve the coordinated backend once to a 40-character SHA, checkout that detached object, and record it in exact-run evidence.
  - In each native creation/use step, arm idempotent `EXIT`, `INT`, and `TERM`
    handlers before materializing secrets. Treat `ENV_FILE_CONTENT` only as the
    initial step-environment transport consumed by the atomic writer, then unset
    it immediately before Yarn, Gradle, `xcrun`, or recovery subprocesses. The
    secret bytes then live only in a validated per-job regular file below
    `$RUNNER_TEMP` with mode `0600`; make workspace `.env` an absolute symlink to
    that exact target. Normal/signal cleanup removes the link without following
    it, removes the target, and verifies both absent. Treat runner-temp teardown
    as hard-kill defense-in-depth, and make the next trusted
    checkout/preflight remove and verify absence of any unexpected workspace
    `.env` entry or fail closed. Run long build/test commands as supervised
    isolated process groups behind an interruptible shell wait. The outer
    supervisor grace must include coordinator detached invocation/Metro group
    `TERM`/`KILL`, the outer fallback, and the executable fixture for that
    nested path. Finish bounded exact-device cleanup within GitHub's documented
    7.5-second `SIGINT` plus 2.5-second `SIGTERM` grace window.
  - Store non-secret ownership recovery records in a permission-hardened
    runner-local persistent directory supplied by the runner service environment
    `MYCHAMPIONS_NATIVE_STATE_ROOT`. Require an absolute canonical, runner-owned,
    non-symlink, mode-`0700` directory outside the workspace and `$RUNNER_TEMP`.
    Access it only while the host lock is held and validate each ledger file's
    owner, mode, type/no-symlink status, completeness, and strict
    numeric/UUID/name fields. Never place `.env`, its runner-temp target, or
    secrets there.
  - `Done (Mac service configuration/read-back 2026-07-29)`: the Mac runner
    service provides
    `MYCHAMPIONS_NATIVE_STATE_ROOT=/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery`.
    `Pending WSL endpoint recovery`: configure and read back
    `MYCHAMPIONS_NATIVE_STATE_ROOT=/home/eduardo/.local/state/github-actions/mychampions-native-recovery`
    in the WSL runner service before accepting native recovery evidence there.
  - Close the creation-to-metadata cancellation window. Before iOS creation,
    persist the unique workflow-owned simulator name/namespace so an interrupted
    `simctl create` can be recovered before UUID handoff. Make Android
    launch-to-PID capture and durable PID/UID/start-time/AVD/port/serial/command
    handoff cancellation-safe, or recover only a process proving that complete
    exact identity.
  - Before new device creation, the next locked trusted run consumes any stale
    workflow-owned record, revalidates exact identity, and deletes/verifies only
    that resource. Remove records only after exact absence is proved. Cleanup or
    recovery failure retains evidence and fails closed; never use global
    `simctl shutdown all`, `pkill`, arbitrary QEMU signaling, or unrelated
    ADB/device mutation. Treat later `if: always()` verifiers as defense-in-depth
    and keep host hooks resource-lock-only.
  - `Pending executable recovery contract`: Exercise both `SIGINT` and `SIGTERM`,
    interruption before UUID/PID metadata handoff, cleanup failure with retained
    records, exact next-run recovery, malformed/incomplete record rejection,
    bounded `130`/`143` exit, workspace-link plus runner-temp secret-target
    removal, outer-supervisor grace through coordinator detached-group
    `TERM`/`KILL`, supervised-child termination, and unrelated-resource
    preservation.
  - `Pending live cancellation evidence`: cancel both native lanes during a supervised build and during selected test execution. Prove workspace `.env` link and exact runner-temp secret target absence, no supervised child/process-group survivor, exact owned-device absence with owner-record removal on success or retained validated recovery evidence on cleanup failure, unrelated-device preservation, and host-lock release within the documented runner cancellation boundary; then prove the next locked run recovers the exact stale resource before creating a replacement.
  - Record that GitHub merge queues are unavailable to this personal public
    repository; checked-in `merge_group` support is future-compatible. Require
    `main` protection with pull requests, strict up-to-date branches, exact
    `Hosted candidate preflight`, exact `Selective CI gate`, conversation
    resolution, administrator enforcement, zero approvals, and no direct-push or
    merge bypass. CODEOWNERS provides routing only because the sole author cannot
    approve their own pull request.
- `Promotion evidence gate`: The promotion pull request must pass TC-519's trusted-workflow provenance, authorization-negative, stale-run, token-isolation, sole-collaborator/external-approval, repository-setting, cleanup, and exact-status probes plus the complete web/iOS/Android matrix on the same exact candidate head. Read-only workflow/run, host resource-lock, repository-setting, collaborator-roster, and GitHub status evidence—not checked-in workflow text, prior runner registration, or local tests—are required. No D-195 live deployment/settings evidence is claimed here yet.

## Professional Screen Wiring (Phase 5)

- `Done`: SC-202 Specialty screen (`app/professional/specialty.tsx`) implemented — specialty list/add, blocker counts, removal, and credential upsert now use MyChampions server `GET /professional/specialties`, `POST /professional/specialties`, `GET /professional/specialties/:specialty/blockers`, `DELETE /professional/specialties/:specialtyId`, and `PUT /professional/specialties/:specialtyId/credential` with local bearer auth and fail closed without local/E2E auth.
- `Done`: SC-204 Professional Home (`app/professional/home.tsx`) implemented — invite code display via `useInviteCode`, subscription state via `resolveSubscriptionState`; RevenueCat entitlement and unique active-student usage are wired through `useSubscription()`.
- `Done`: SC-205 Student Roster (`app/professional/students.tsx`) implemented — search + filter chip UI, FlatList, and MyChampions server roster/assignment snapshot endpoints are wired for local bearer sessions.
- `Done`: DS shell virtualization fix for list screens — `DsScreen` now supports `scrollable={false}` (non-ScrollView mode) and is applied to FlatList-backed routes (`SC-205`, `/professional/nutrition`, `/professional/training`, `SC-215`) to avoid nested VirtualizedList warnings in runtime logs.
- `Done`: SC-206 Student Profile Professional View (`app/professional/student-profile.tsx`) implemented — assignment status cards, unbind CTA, and plan-change requests; direct water-goal form removed (goal authoring occurs in SC-207 nutrition plan builder flows).
- `Done`: SC-212 Professional Subscription Gate (`app/professional/subscription.tsx`) implemented — entitlement status display, cap usage, purchase/restore/refresh CTAs; RevenueCat SDK and unique active-student usage are wired through `useSubscription()`.
- `Done`: Stack.Screen route registrations added in `app/_layout.tsx` for all 5 new professional screens.
- `Done`: SC-205/SC-206 roster and assignment snapshot reads now require MyChampions server `GET /professional/students` and `GET /professional/students/:studentUid/assignment-snapshot` with local bearer auth outside E2E fixtures. Unbind uses the server assignment snapshot plus server-backed `endConnection`.
- `Done`: SC-206 nutrition tracking review uses `student-tracking-review-source.ts`, which now requires the MyChampions server `GET /professional/students/:studentUid/tracking-review` endpoint with local bearer auth outside E2E fixtures.
- `Done`: `student-tracking-review-source.ts` no longer loads or calls `firebase/firestore` or default Firestore helpers; no-server sessions fail closed instead of reading `waterLogs` and `portionLogs` from Firestore.
- `Done`: `professional-source.ts` no longer loads or calls `firebase/firestore` or default Firestore helpers; professional roster, assignment snapshot, invite-code, and Specialty operations fail closed without local server auth outside E2E fixtures.
- `Done`: SC-205 roster state arbitration hardened — initial loading and empty hero are mutually exclusive, preventing loading/empty flicker overlap.
- `Done`: Wire RevenueCat entitlement live state and unique active-student usage into SC-204, SC-206, SC-212 (replaced `useState<EntitlementStatus>('unknown')` stubs with `useSubscription()` hook; `features/subscription/subscription-source.ts` source layer with full injectable deps + 35 unit tests (TC-286); `features/subscription/use-subscription.ts` hook with lazy SDK configuration via module-level singleton guard and professional count loading; `features/professional/professional-source.ts#getActiveProfessionalStudentCount` now uses the MyChampions server roster endpoint outside E2E fixtures).

## Localization

- `Done`: All `pro.home.*`, `pro.specialty.*`, `pro.students.*`, `pro.student_profile.*`, `pro.subscription.*` keys synced across `en-US.ts`, `pt-BR.ts`, `es-ES.ts`.
- `Done`: All `settings.account.*`, `meal.builder.*`, `meal.library.*`, `shared_recipe.*` keys synced across `en-US.ts`, `pt-BR.ts`, `es-ES.ts` (Phase 6).
- `Done`: `useTranslation()` returns a locale-stable `t` function reference, reducing effect-churn re-fetch loops tied to translation callback identity.
- `Done`: Language override (`app.language.override` AsyncStorage key) is now wired into `useTranslation()` via `LocaleContext`. `LocaleProvider` wraps the app root; `useTranslation()` reads `activeLocale` from context so all components re-render immediately when the language changes. The gap where the stored override was never fed into the translation hook is resolved (D-155, SC-222).
- `Pending`: Bundle and load Manrope font assets natively (Android/iOS) so DS typography intent is guaranteed beyond platform fallback font resolution.

- `Done`: Wire RevenueCat entitlement checks to professional cap-sensitive actions.
  - Done: Server-side pending connection confirmation now blocks activation of a new 11th unique active student unless `subscription_entitlement_snapshots.professional_entitlement_status` is `active`; a second specialty for an already-active student does not require entitlement.
  - Done: Server-side plan repositories now block professional writes to assigned student plans while the professional is already over cap unless the latest server entitlement snapshot is active; plan route and mobile plan sources map the lock to a subscription-required domain error.
- `Partial`: BL-009 pre-lapse warning UI and localized copy exist, but activation now correctly requires an authoritative billing-expiry risk signal. Active-student count is capacity data and no longer fabricates an expiry warning. Purchase/restore/handoff recovery remains available through entitlement-based plan locks; provider/server expiry-signal wiring is pending.

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
- `Done`: Wire `lastSyncedAtIso` from real data-layer sync timestamps.
  - Done: Student Home, Student Nutrition, and Student Training derive offline freshness from the latest successful MyChampions server-backed plan, connection, and water read timestamps.
  - Done: Professional, account, custom-meal, and shared-recipe offline-aware screens derive offline freshness from server-backed or provider-bound profile, specialty, invite-code, connection, roster, assignment, subscription, plan, custom-meal, and shared-recipe preview reads.

## Professional Pending Queue Tools (BL-004)

- `Done`: `features/connections/pending-queue.logic.ts` — pure functions: `filterPendingQueue`, `canBulkDeny`, `validateBulkDeny`, `buildBulkDenyConfirmationMessage`, `formatSearchResultsSummary`. Supports search by student UID, specialty filtering, and bulk deny validation.
- `Done`: `features/connections/pending-queue.logic.test.ts` — comprehensive unit tests (26 tests, TC-257, TC-258) covering filter combinations, bulk deny validation, confirmation messaging, and edge cases.
- `Done`: `app/professional/pending.tsx` (SC-204/SC-205) — Pending connection queue fully wired with:
  - Search bar filtering by student ID (substring match, case-insensitive)
  - Row-based selection for bulk operations
  - Individual confirm/deny actions per pending request
  - Bulk deny with confirmation alert showing count and specialty distribution
  - Optimistic removal after successful bulk deny
  - Error handling with retry CTA
  - Empty state and loading indicators
- `Done`: All `pro.pending.*` localization keys present in `en-US`, `pt-BR`, and `es-ES` (`search.placeholder`, `filter.label`, `bulk_deny.cta`, `bulk_deny.confirm_title`, `bulk_deny.confirm_body`, `bulk_deny.success`, `confirm.cta`, `deny.cta`, `empty`, `error`).
- `Done`: `confirmPendingConnection` and `endConnection` now require the MyChampions server when local bearer auth is available and fail closed without local server auth outside E2E fixtures. Server-owned confirm/end release local pending invite guard/student-slot state, write tracking-access and active-specialty rows, and archive/restore matching nutrition/training plans in local Postgres. Both operations are consumed by `useConnections` in `app/professional/pending.tsx`; legacy Firestore fallback was removed from the mobile connection source.

## Professional Specialty Removal Assist (BL-011)

- `Done`: `features/professional/specialty-removal-assist.logic.ts` — pure functions: `resolveRemovalAssistState`, `buildActionMetadata`, `filterBlockersBySpecialty`, `countBlockers`, `canRemovalProceedNow`, `formatRemovalBlockedMessage`, `shouldShowBlockers`. Provides direct navigation/actions to resolve blocking conditions (active/pending students, last specialty).
- `Done`: `features/professional/specialty-removal-assist.logic.test.ts` — comprehensive unit tests (34 tests, TC-262, TC-263) covering:
  - Assist state resolution: no blockers, active students, pending students, last specialty priority order
  - Action metadata: navigation targets, labels, descriptions, priority levels
  - Blocker filtering by specialty and status
  - Blocker counting (active vs pending)
  - Removal proceed validation after assist actions
  - Blocked message formatting with proper singularization
  - Edge cases: zero total specialties, large blocker counts, mixed statuses
- `Done`: `app/professional/specialty.tsx` (SC-202) — Specialty removal flow with blocking reason display (already implemented, awaiting assist action wiring).
- `Done`: All `pro.specialty.removal_assist.*` localization keys present in `en-US`, `pt-BR`, and `es-ES` (8 keys: view_active, view_active_desc, view_pending, view_pending_desc, bulk_deny, bulk_deny_desc, add_specialty, add_specialty_desc).
- `Done`: Wire assist actions into SC-202 removal blocked state — `RemovalAssistCard` renders inline with title/body from `getRemovalBlockedMessageKeys`, action buttons from `buildActionMetadata`, and `useRouter.push` navigation to students roster, pending queue, or specialty setup; dismiss CTA clears blocked state. `pro.specialty.remove_blocked.dismiss` key added to all 3 locale bundles (D-124).
- `Done`: SC-202 specialty removal now resolves active/pending blocker counts through `getSpecialtyBlockerCounts`, which uses the MyChampions server local Postgres blocker endpoint outside E2E fixtures; remove CTA shows assist flow from real blocker state instead of stubbed `0/0` counts.

## Plan Change Request Flow (BL-005)

- `Done`: `features/plans/plan-change-request.logic.ts` — pure functions: `validatePlanChangeRequestInput`, `normalizePlanChangeRequestStatus`, `normalizePlanType`, `normalizePlanChangeRequestError`. Unit tests in `plan-change-request.logic.test.ts` (11 tests, TC-259).
- `Done`: `features/plans/plan-source.ts` — `submitPlanChangeRequest`, `reviewPlanChangeRequest`, and `getStudentPlanChangeRequests` require MyChampions server plan-change endpoints with local bearer auth outside E2E fixtures and fail closed without local server auth.
- `Done`: `features/plans/use-plans.ts` — React hook `usePlans` with `submitChangeRequest`, `validateChangeRequest`, `reviewChangeRequest`, `getChangeRequestsForStudent`.
- `Done`: `app/student/nutrition.tsx` (SC-209) — `PlanChangeRequestForm` wired to `usePlans`; full validation + error handling with all error branches and write-lock guard.
- `Done`: `app/student/training.tsx` (SC-210) — `PlanChangeRequestForm` wired to `usePlans`; full validation + error handling with improved error branches (plan_not_found, no_active_assignment, network) and write-lock guard.
- `Done`: `app/professional/student-profile.tsx` (SC-206) — `PlanChangeRequestsCard` wired to `usePlans.getChangeRequestsForStudent`; lists pending requests from specific student with review/dismiss actions via `reviewChangeRequest`; loads change requests on mount, shows load/action errors, optimistically removes reviewed/dismissed requests.
- `Done`: All `student.nutrition.plan_change.*`, `student.training.plan_change.*`, and `pro.student_profile.plan_change_requests.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: All plan-change keys tracked in `localized-copy-table-v2.md` with correct screen-specific key names.
- `Done`: Wire `submitPlanChangeRequest`, `reviewPlanChangeRequest`, and `getStudentPlanChangeRequests` to the local MyChampions server; the no-server-session Firestore fallback has been removed from `plan-source.ts`.
- `Done`: Professional home now has a local in-app notification surface for pending student plan-change requests. `GET /professional/plan-change-requests?status=pending` lists pending requests across the authenticated professional's owned plans, `getProfessionalPlanChangeRequests()` reads it through the MyChampions server bearer path, and `app/professional/home.tsx` shows the count/latest request with a CTA to the existing student profile review card. Push notification delivery remains future provider work.

## Water Tracking (BL-104)

- `Done`: `features/nutrition/water-tracking.logic.ts` — pure functions: `resolveEffectiveWaterGoal`, `resolveWaterDayStatus`, `calculateWaterStreak`, `validateWaterGoalInput`, `validateWaterIntakeInput`, `normalizeWaterTrackingError`.
- `Done`: `features/nutrition/water-tracking.logic.test.ts` — unit tests included in 301-test suite (TC-264–TC-267).
- `Done`: `features/nutrition/water-tracking-source.ts` — `getMyWaterLogs`, `logWaterIntake`, and `getMyWaterGoalContext` require MyChampions server endpoints with the local bearer token outside E2E fixtures; goal context reads local server `nutrition_plans` plus active nutritionist `connections`.
- `Done`: `features/nutrition/use-water-tracking.ts` — React hook with `idle/loading/ready/error` state machine, `reload`, `logIntake`, `validateIntake` (goal mutation API removed from hook surface).
- `Done`: `HydrationCard` in `app/student/home.tsx` (SC-203) — wired to `useWaterTracking`; shows progress, streak, goal ownership label.
- `Done`: `WaterWidget` in `app/student/nutrition.tsx` (SC-209) — intake log form + helper text indicating water goals are defined in nutrition plans.
- `Done`: Hydration-goal input is documented and wired in nutrition plan builder metadata form (SC-207) for both professional and student plan-authoring routes.
- `Done`: Localization alignment shipped in `en-US`, `pt-BR`, and `es-ES` for hydration helper and plan-builder hydration field/validation keys.
- `Done`: Screen spec created at `docs/screens/v2/SC-220-water-tracker.md`.
- `Done`: Wire hydration tracking source (`getMyWaterLogs`, `logWaterIntake`, `getMyWaterGoalContext`) replacing stubs in `water-tracking-source.ts` (D-126 batch), with plan-context precedence documented in D-172; water-log read/write and water-goal context now require the local MyChampions server outside E2E fixtures.

## Food/Plan/Data Wiring

- `Done`: Local mobile auth and server-backed source modules now use the MyChampions server or explicit E2E fixtures. Missing local server URL/auth fails closed outside those fixtures.
  - Done: Root-level Bun/Elysia server added with local Postgres profile/session support.
  - Done: `features/auth/profile-source.ts` now calls MyChampions server profile endpoints for hydration, role lock, terms acceptance, and profile data deletion; default token resolution no longer reads Firebase Auth.
  - Done: `features/support/support-source.ts` now calls MyChampions server `POST /support/messages` and stores support messages in server Postgres; it no longer falls back to Firebase Auth tokens when local server auth is missing.
  - Done: Local email/password sign-in and account creation establish a server-owned bearer session through `POST /auth/email/sign-in` and `POST /auth/email/create-account`, backed by local Postgres `local_email_auth_credentials` by default.
  - Done: Auth entry screens delegate the real email/password source boundary to `features/auth/email-auth-source.ts`, which posts to `POST /auth/email/sign-in` and `POST /auth/email/create-account`, no longer calls Firebase Auth, and no longer falls back to the local dev-session route when configuration fails. Local Postgres is the only credential store.
  - Done: Auth entry screens no longer construct Google/Apple Firebase credentials. The obsolete `features/auth/firebase-social-auth.ts` config helper was removed; explicit E2E social fixtures remain available, Google actions now use native `@react-native-google-signin/google-signin` ID-token capture and Apple actions use native identity-token capture before only using deterministic local dev-session fallback in unset, blank, or `dev` app variants for explicit provider-token configuration gaps. The server-owned `POST /auth/social/sign-in` direct-verification boundary exists, and `features/auth/social-auth-source.ts` posts captured provider tokens to that route.
  - Done: `features/auth/auth-session.tsx` no longer imports or requires Firebase Auth or the Firebase app wrapper. Auth session hydration now uses explicit E2E sessions, current local server sessions, or fails closed as unauthenticated when neither is available.
  - Done: `features/auth/firebase.ts` was removed, `app.config.ts` no longer resolves `FIREBASE_DEV_*`/`FIREBASE_PROD_*` into `extra.firebase`, and the production `firebase` package dependency was removed from the mobile package.
  - Done: The legacy Firestore rules harness (`tests/firestore/**`), `test:rules`, `validate:firestore:smoke`, `@firebase/rules-unit-testing`, and `firebase-tools` were retired from the mobile package while the app migrates to the local MyChampions server.
  - Done: Account settings password reset now uses `requestPasswordResetFromSource()` and the MyChampions server `POST /auth/password-reset` endpoint when the local server is configured; the server records a provider-neutral local Postgres reset request with hashed reset-token digest and expiry, plus a local-only `password_reset_delivery_artifacts` debug-outbox row containing the raw token/reset URL for development inspection without Firebase Auth delivery. Direct transactional email delivery remains disabled until its own transport credentials are approved and configured.
  - Done (ET-71): The client-side gap this checklist previously left implicit — no unauthenticated forgot/reset-password UI and no deep-link consumer for the debug-outbox `mychampions://auth/password-reset?token=...&email=...` link — is closed. `app/auth/forgot-password.tsx` (SC-226) and `app/auth/password-reset.tsx` (SC-227, routed to match the deep-link path) call `requestPasswordResetFromSource()` and the new `confirmPasswordResetFromSource()` against the server's `POST /auth/password-reset` and `POST /auth/password-reset/confirm` endpoints respectively. See `D-202` in `decisions-log-v1.md`.
  - Done: Account settings sign-out and post-deletion cleanup now call `signOutFromSource()` before `clearSession()`; account auth source no longer calls Firebase Auth for password reset or sign-out.
  - Done: `features/connections/connection-source.ts#getMyConnections` now uses MyChampions server `GET /connections` with the local server bearer token and fails closed without local server auth outside E2E fixtures.
  - Done: `features/connections/connection-source.ts` no longer imports, requires, types, or calls Firebase Firestore/default Firestore helpers.
  - Done: `features/connections/connection-source.ts#submitInviteCode` now uses MyChampions server `POST /connections/invite-submissions` with the local server bearer token and fails closed when no local server auth is available.
  - Done: `features/connections/connection-source.ts#confirmPendingConnection` now uses MyChampions server `POST /connections/:connectionId/confirm` with the local server bearer token and fails closed without local server auth outside E2E fixtures.
  - Done: `features/professional/professional-source.ts#getOrCreateActiveInviteCode` and `rotateInviteCode` now use MyChampions server professional invite-code endpoints with the local server bearer token and fail closed without local server auth outside E2E fixtures.
  - Done: `features/professional/professional-source.ts#getProfessionalSpecialties`, `addProfessionalSpecialty`, `getSpecialtyBlockerCounts`, `removeProfessionalSpecialty`, and `upsertProfessionalCredential` now use MyChampions server professional specialty endpoints with the local server bearer token and fail closed without local server auth outside E2E fixtures.
  - Done: `features/professional/professional-source.ts` no longer loads or calls `firebase/firestore` or default Firestore helpers.
  - Done: `features/training/workout-log-source.ts#logWorkoutSession` and `getTodayWorkoutLogs` now require MyChampions server `POST /training/workout-logs` and `GET /training/workout-logs` with the local server bearer token outside the assigned-training E2E fixture.
  - Done: `features/training/workout-log-source.ts` no longer loads or falls back to `firebase/firestore` or default Firestore helpers.
  - Done: `features/nutrition/water-tracking-source.ts#logWaterIntake`, `getMyWaterLogs`, and `getMyWaterGoalContext` now require MyChampions server `POST /nutrition/water-logs`, `GET /nutrition/water-logs`, and `GET /nutrition/water-goal-context` with the local server bearer token outside E2E fixtures.
  - Done: `features/nutrition/water-tracking-source.ts` no longer loads or falls back to `firebase/firestore` or default Firestore helpers.
  - Done: `features/nutrition/custom-meal-source.ts#logAssignedMealPortion` and `getTodayPortionLogs` now require MyChampions server `POST /nutrition/portion-logs` and `GET /nutrition/portion-logs` with the local server bearer token outside E2E fixtures.
  - Done: `features/nutrition/custom-meal-source.ts#getMyCustomMeals`, `createCustomMeal`, `updateCustomMeal`, `deleteCustomMeal`, `createMealShareLink`, `previewSharedMeal`, `importSharedMeal`, and `logPortionFromSource` now require MyChampions server custom-meal/share endpoints outside E2E fixtures and fail closed when local server URL/auth is unavailable. Custom meal image upload also requires the local MyChampions server path, stores compressed JPEGs in local filesystem storage by default, uses private GCS objects only when the server bucket is configured, and fails closed when local server URL/auth is unavailable.
  - Done: `features/nutrition/custom-meal-source.ts` no longer imports, requires, types, or calls Firebase Firestore/default Firestore helpers.
  - Done: `features/nutrition/use-image-upload.ts` no longer imports or calls `firebase/storage`; the custom meal image upload hook uses only the local MyChampions server upload path outside E2E fixtures.
  - Done: `features/nutrition/use-image-upload.ts`, `features/nutrition/use-meal-photo-analysis.ts`, and `features/nutrition/meal-photo-analysis-source.ts` no longer import `firebase/auth` for the `User` type; they use the local `features/auth/auth-user.ts` shape.
  - Done: `features/nutrition/meal-photo-analysis-source.ts#analyzeMealPhoto` now uses MyChampions server `POST /nutrition/meal-photo-analysis` with the local server bearer token and fails closed when no local server URL/token is available.
  - Done: `features/nutrition/food-search-source.ts#searchFoodsFromSource` now uses MyChampions server `POST /integrations/food/search` with the local server bearer token and fails closed when no local server URL/token is available.
  - Done: `features/subscription/use-subscription.ts` now best-effort syncs the latest native RevenueCat-derived professional and AI entitlement statuses to MyChampions server `POST /subscription/entitlements/snapshot` through `features/subscription/subscription-server-source.ts` for local development; the server stores the snapshot in local Postgres `subscription_entitlement_snapshots`, accepts only strictly newer observations, and uses it for local cap enforcement. Native RevenueCat operations are bound to the current self-managed auth UID, and the snapshot source rejects a UID change before it can use a different server bearer session. Production rejects client snapshot writes and relies on signed webhook snapshots instead.
  - Done: `features/plans/exercise-service-source.ts#searchExerciseLibrary` and `getExerciseById` now require MyChampions server `POST /integrations/exercise/search` and `GET /integrations/exercise/exercises/:id` with the local server bearer token outside E2E fixtures and fail closed when no local server URL/token is available.
  - Done: `features/plans/plan-source.ts#getMyPlans` and `getMyPredefinedPlans` now require MyChampions server `GET /plans/my` and `GET /plans/predefined` with the local server bearer token outside E2E fixtures and fail closed when no local server URL/token is available.
  - Done: `features/plans/plan-source.ts#bulkAssignPredefinedPlan` now requires MyChampions server `POST /plans/predefined/:planId/bulk-assign` with the local server bearer token outside E2E fixtures and fail closed when no local server URL/token is available.
  - Done: `features/plans/plan-source.ts#createDraftAssignedPlan` now requires MyChampions server `POST /plans/predefined/:planId/draft-assignments` with the local server bearer token outside E2E fixtures and fail closed when no local server URL/token is available.
  - Done: `features/plans/plan-source.ts` no longer imports, requires, types, or calls `firebase/firestore` or default Firestore helpers; plan reads, plan-change requests, predefined assignment, and draft assignment fail closed without local server auth outside E2E fixtures.
  - Done: `features/plans/plan-builder-source.ts#createNutritionPlan`, `createTrainingPlan`, `deleteNutritionPlan`, `deleteTrainingPlan`, `getNutritionPlanDetail`, `getTrainingPlanDetail`, `updateNutritionPlan`, `updateTrainingPlan`, `updateTrainingPlanWithSessions`, `addNutritionMeal`, `removeNutritionMeal`, `reorderNutritionMeals`, `addNutritionMealItem`, `removeNutritionMealItem`, `reorderNutritionMealItems`, `addTrainingSession`, `removeTrainingSession`, `reorderTrainingSessions`, `addTrainingSessionItem`, `removeTrainingSessionItem`, and `reorderTrainingSessionItems` now require MyChampions server plan-builder endpoints with the local server bearer token outside E2E fixtures and fail closed when no local server URL/token is available.
  - Done: `features/plans/plan-builder-source.ts` no longer imports, requires, types, or calls `firebase/firestore` or default Firestore helpers; plan-builder operations no longer keep a Firestore fallback path.
  - Done: `app/professional/training/plans/[planId].tsx` no longer imports the Firebase-backed `features/firestore` wrapper just to create local draft IDs; it uses the pure `features/id-source.ts` helper instead.
  - Done: Dead mobile Firestore wrapper modules `features/firestore.ts` and `features/firestore-error.ts` were removed after all migrated runtime sources stopped importing them.
  - Done: `features/plans/plan-source.ts#submitPlanChangeRequest`, `getStudentPlanChangeRequests`, and `reviewPlanChangeRequest` now require MyChampions server plan-change endpoints with the local server bearer token outside E2E fixtures and fail closed when no local server URL/token is available.
  - Done: Legacy Firebase Cloud Functions project files, Firestore rules/index files, Firebase project aliases, and Firebase App Distribution workflows are removed from the mobile package.
  - Partial: Durable self-managed auth, private GCS, native Google provider configuration, and the HMAC-signed RevenueCat webhook are live. Server-owned Postgres email/password and direct Google/Apple ID-token verification boundaries are configured in production; malformed live provider tokens fail closed with 401. The public endpoint routes to verified green image `mychampions-server:20260712183508`. Apple account governance is complete and local device signing proves the Sign in with Apple entitlement; remaining release evidence is the CI Apple Distribution profile, a real device sign-in, and a RevenueCat sandbox purchase smoke.
- `Done`: Replace the old provider profile connector contract with the MyChampions server profile source.
  - Done: App-side profile source abstraction in `features/auth/profile-source.ts` is integrated into auth session provider.
  - Done: `features/auth/profile-source.ts` now uses MyChampions server profile endpoints for hydration, role lock, terms acceptance, and profile data deletion.
  - Done: Client role-lock confirmation is strict-confirm only with multi-read server-only retries in `features/auth/profile-source.ts`; unconfirmed writes now throw typed diagnostics (`role_update_not_persisted`, `profile_row_not_found_after_upsert`) and do not route forward.
  - Done: TC-301 unit tests in `features/auth/profile-source.test.ts` cover the server-backed profile source with injectable deps fakes.
- `Done`: Implement MyChampions server connection lifecycle connectors for invite submit/confirm/end and code rotation cancellation semantics.
  - Done: Pure connection logic module created in `features/connections/connection.logic.ts` (status/reason normalization, display state resolution, error mapping).
  - Done: Connection source module created in `features/connections/connection-source.ts` (`getMyConnections`, `submitInviteCode`, `confirmPendingConnection`, and `endConnection` now use the local MyChampions server outside E2E fixtures and no longer fall back to Firestore).
  - Done: Wire connection-source operations into app screens:
    - `app/student/professionals.tsx` (SC-211): invite code entry → `submitInviteCode`, connection list → `getMyConnections` + `resolveConnectionDisplayState`, unbind → `endConnection`. Surfaces `canceled_code_rotated` state (BL-003 / D-069).
    - `app/professional/pending.tsx` (SC-204/SC-205 subset): pending queue → `getMyConnections` (pending_confirmation filter), accept → `confirmPendingConnection`, deny/bulk deny → `endConnection`.
    - `features/connections/use-connections.ts`: React hook wrapping connection-source for UI consumption.
    - Route guard extended to block student from `/professional/*` and professional from `/student/*`.
  - Retired: `scripts/validate-firestore-smoke.mjs` previously validated Firestore connection and plan collection invariants, but it was removed with the legacy Firestore rules harness during the local-server migration.
  - Done: Professional invite-code generation/rotation now prefers the MyChampions server when local bearer auth is available; server rotation cancels pending requests created from the old code.
  - Done: Pending connection confirmation now prefers the MyChampions server when local bearer auth is available; server confirmation validates professional ownership, pending status, and duplicate active same-specialty assignments.
  - Done: Manual connection end/unbind now prefers the MyChampions server when local bearer auth is available; server end validates participant ownership and marks local Postgres `connections` rows as `ended`.
  - Done: Port plan archive/restore side effects for server-owned confirm/end into local Postgres `nutrition_plans` and `training_plans` using `lifecycle_connection_id`.
  - Done: Port pending invite guard/student-slot allocation and release plus tracking-access and active-specialty writes into MyChampions server-owned Postgres storage for local bearer sessions. Invite submission creates local guard/slot materialized state; confirm/end/rotation release the relevant pending state and update `tracking_access`/`active_specialties`.
  - Pending: Live endpoint compatibility validation for remaining connection operations after remote server deployment.
- `Done`: Food search is wired to nutrition plan builder via `searchFoodsFromSource`; local bearer sessions now search through MyChampions server `POST /integrations/food/search` against the mirrored local catalog Postgres database, and no-server sessions fail closed instead of falling back to any retired direct provider service.
- `Done`: Wire predefined plan library persistence and bulk-assignment orchestration APIs.
  - `Done`: `features/plans/plan-source.ts#getMyPredefinedPlans` now reads predefined nutrition and training plans through the MyChampions server for the authenticated professional.
  - `Done`: `features/plans/plan-source.ts#bulkAssignPredefinedPlan` now resolves the source plan type and clones independent per-student assigned copies through server-owned Postgres rows with owner/source-kind guards.
- `Done`: Wire water-goal ownership precedence from live assignment + nutritionist override data.
  - `Done`: `features/nutrition/water-tracking-source.ts#getMyWaterGoalContext` now validates active nutrition assignment against MyChampions server connection state (`professionalAuthUid + studentAuthUid + specialty=nutritionist + status=active`) before applying nutritionist-goal precedence.
- `Retired`: Runtime Firestore environment selection was previously wired by `APP_VARIANT` in `app.config.ts` with `FIREBASE_DEV_*`/`FIREBASE_PROD_*`; the mobile app no longer exposes `extra.firebase` or requires those env vars for local server auth/data paths.
- `Historical`: Firestore project-id mapping was previously pinned for `mychampions-fb928` and Firebase CLI aliases were added in `.firebaserc`.
- `Historical`: The retired Firestore infrastructure baseline previously lived in project `mychampions-fb928`:
  - The retired project had its document API enabled.
  - The retired project had a default document database in `us-east4`.
  - Source-controlled rules/index config (`firestore.rules`, `firestore.indexes.json`) was retired with the Firebase project files during the local-server migration.

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
- `Retired`: The initial Professional Nutrition/Training tab placeholders were replaced by the SC-207/SC-208 server-backed plan-library screens below.
- `Done`: SC-207 Nutrition Plan Builder implemented at `app/professional/nutrition/plans/[planId].tsx`; `app/professional/nutrition.tsx` converted to predefined plan library list screen.
- `Done`: SC-208 Training Plan Builder implemented at `app/professional/training/plans/[planId].tsx`; `app/professional/training.tsx` converted to predefined plan library list screen.
- `Done`: Routes `professional/nutrition/plans/[planId]` and `professional/training/plans/[planId]` registered in `app/_layout.tsx`.
- `Done`: Student self-guided empty-state CTAs in SC-209/SC-210 now route to direct creation flows: `/student/nutrition/plans/new` and `/student/training/plans/new`.
- `In progress`: Student-specific self-managed plan builder shell for SC-209/SC-210 currently reuses shared builder screens (`app/professional/nutrition/plans/[planId].tsx`, `app/professional/training/plans/[planId].tsx`) via student route aliases. Student-branded titles/actions are applied on student-prefixed routes; follow-up required for fully dedicated student-only layout treatment.

## Exercise Service Search (BL-106 — SC-208)

- `Done`: `features/plans/exercise-service-source.ts` — catalog client: `searchExerciseLibrary`, `getExerciseById`; local bearer sessions now route through MyChampions server `POST /integrations/exercise/search` and `GET /integrations/exercise/exercises/:id` against the mirrored local catalog Postgres database. Missing local server URL/auth fails closed outside E2E fixtures. Requests keep effective locale `lang` and `x-request-id`.
- `Done`: `features/plans/use-exercise-search.ts` — `useExerciseSearch` hook with `idle/loading/error/done` state machine.
- `Done`: `features/plans/use-exercise-thumbnail.ts` — `useExerciseThumbnail(exerciseId)` hook; fetches fresh thumbnails on demand via `getExerciseById`; never caches expiring URLs.
- `Done`: `components/ds/patterns/ExerciseSearchModal.tsx` — two-phase modal wired to exercise service search; subtitle localized via `exercise.muscle_group.<slug>` keys.
- `Done`: `features/plans/components/SessionCard.tsx` — item rows resolve thumbnails from `exerciseId` with legacy `ymoveId` fallback.
- `Done`: `features/plans/plan-builder.logic.ts` and `features/plans/plan-builder-source.ts` — `exerciseId` is canonical persisted field; legacy `ymoveId` remains read-compatible during migration.
- `Done`: Exercise muscle-group localization keys (`exercise.muscle_group.*`) are present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: `.env` / `.env.example` use `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL` for exercise search; client-side upstream YMove and old public exercise-service URL contracts are removed.

## Plan Builder (BL-106 — SC-207, SC-208)

- `Done`: `features/plans/plan-builder.logic.ts` — pure functions: `validateNutritionPlanInput`, `validateTrainingPlanInput`, `validateTrainingSessionItemInput`, `calculateNutritionTotals`, `isStarterTemplate`, `normalizePlanBuilderError`, plus food-search normalization helpers `normalizeFoodArray`, `normalizeFoodSearchResult` and associated raw types `RawFoodSearchFood`, `RawFoodSearchServing`, `FoodSearchResult` (D-127, TC-281).
- `Done`: `features/plans/plan-builder.logic.test.ts` — 24 unit tests for `normalizeFoodArray` and `normalizeFoodSearchResult` covering per-100g scaling, single/array serving normalization, missing fields, unsupported units, rounding, empty serving array, negative serving amount, negative macro fields (TC-281). App test suite at 691 pass, 0 fail.
- `Done`: `features/plans/plan-builder-source.ts` — server source surface for nutrition CRUD (`createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, nutrition meal/item mutations) and training CRUD (`createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, training session/item mutations), server-backed starter template listing/cloning, and `searchFoods`.
- `Done`: `features/plans/use-plan-builder.ts` — `useNutritionPlanBuilder` and `useTrainingPlanBuilder` hooks with `idle/loading/ready/saving/error` state machines.
- `Done`: `app/professional/nutrition.tsx` — plan library list screen (SC-207 lib).
- `Done`: `app/professional/nutrition/plans/[planId].tsx` — nutrition plan builder screen (SC-207).
- `Done`: SC-207 meal add-food editing participates in measured screen flow; compact native coverage scrolls and targets search, result, quantity, Add, and semantic removal confirmation without coordinates.
- `Done`: `app/professional/training.tsx` — plan library list screen (SC-208 lib).
- `Done`: `app/professional/training/plans/[planId].tsx` — training plan builder screen (SC-208).
- `Done`: All `pro.plan.*`, `pro.library.*`, `pro.predefined_plan.*`, `pro.template_library.*`, `pro.template.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: SC-207 and SC-208 screen specs updated to reflect actual implementation.
- `Done`: Centralized plans Zustand store (`features/plans/plans-store.ts`) now orchestrates plan-library and builder state for SC-206/SC-207/SC-208/SC-209/SC-210 while preserving hook contracts (`usePlans`, `useNutritionPlanBuilder`, `useTrainingPlanBuilder`).
  - Done: Plan-store auth context and cache ownership now resolve from the local MyChampions server user first, then the explicit E2E user, and otherwise fail closed without a legacy provider auth fallback.
- `Done`: Cross-screen consistency for plan mutations now uses store-level optimistic updates plus a wired plans invalidation/reload trigger (consumed by `usePlans`) instead of per-screen isolated `useState` trees.
- `Done`: Plan store now resets state/caches on auth UID boundary changes and ignores stale async builder load responses with request-id guards.
- `Done`: Builder hooks now support route-scope reset semantics (optional scope key) to prevent stale builder payload carry-over between distinct plan/meal routes.
- `Done`: Unsaved plan draft behavior remains session-only (in-memory); no persistent draft storage was added in this rollout.
- `Done`: D-126 — Plan CRUD operations in `plan-builder-source.ts` now use the local MyChampions server source pattern instead of Firestore. Functions use `PlanBuilderSourceDeps` for server URL/token/fetch injection: `createNutritionPlan`, `updateNutritionPlan`, `getNutritionPlanDetail`, nutrition meal/item mutations, `createTrainingPlan`, `updateTrainingPlan`, `getTrainingPlanDetail`, and training session/item mutations. All `user: User` first params dropped; hooks updated to `isAuthenticated: boolean`; screens updated to `Boolean(currentUser)` pattern. Breaking API changes handled: `food_name` vs `name`, `exercise_name` vs `name`, `session_name` vs `name`, key-only returns with re-fetch where needed, `item_id`/`session_id` only (no plan_id on removes).
- `Done`: Wire food lookup into `searchFoods` in `plan-builder-source.ts` via the MyChampions server food integration route (D-113, D-127).
  - `Done`: `features/nutrition/food-search-source.ts` uses the MyChampions server `POST /integrations/food/search` endpoint with the local bearer token; missing server URL/auth fails closed outside explicit E2E fixtures.
  - `Done`: `searchFoods` in `plan-builder-source.ts` calls `searchFoodsFromSource(query)` directly; the deprecated provider-user bridge was removed, so food lookup now depends only on the local MyChampions server URL plus bearer token.
  - `Done`: The mobile `.env.example` no longer exposes a direct food-search service URL; food API routing is owned by the MyChampions server integration boundary.
  - `Done`: `features/nutrition/food-search-source.test.ts` — unit tests cover configuration error (missing/empty URL), server-token authentication failure, fetch failure, unauthenticated responses (401, 403), quota handling (`200 { error: "quota_exceeded" }`, HTTP 429), bad-request mapping (`400 { error: "bad_request" }`), upstream 502 mappings (`upstream_ip_not_allowlisted`, `upstream_error`), unknown errors (non-JSON body, generic HTTP 500), locale-to-request mapping (`region/language`), and happy paths (results returned, empty results, missing results field, invalid item filtering, numeric-string macro parsing, `serving === 100` enforcement, request contract shape) (TC-282).
  - `Done`: Legacy function-era food-search proxy surface (`searchFoods` and retired direct-provider helper files) removed from this repo; meal-photo analysis now routes through the MyChampions server analyzer endpoint.
- `Done`: `features/plans/starter-template.logic.ts` — pure logic layer with 11 functions and 88 comprehensive unit tests (BL-006, FR-212, AC-256, TC-260).
- `Done`: D-114 — `getStarterTemplates` now reads the server-owned starter template catalog from MyChampions server `GET /plans/starter-templates`, and `cloneStarterTemplate` now calls `POST /plans/starter-templates/:templateId/clone` so the server owns starter template defaults, including default meals/sessions and their items.
- `Done`: D-114 test coverage — `deriveStarterTemplatePlanType` and `coalesceTemplateDescription` extracted as pure helpers into `plan-builder.logic.ts`. `features/plans/plan-builder-source.test.ts` added with 29 tests (TC-280) covering prefix routing, null coalescing, edge cases, boundaries, and case-sensitivity. `StarterTemplateDeps` injection type exported for future integration test expansion. Test suite at 569 pass, 0 fail.

## Account Settings & Custom Meal Screens (Phase 6)

- `Done`: SC-213 Account & Privacy Settings (`app/settings/account.tsx`) implemented — privacy policy link and account deletion confirmation flow; account deletion now uses the MyChampions server profile deletion endpoint for local bearer sessions.
- `Done`: SC-214 Custom Meal Builder (`app/(tabs)/nutrition/custom-meals/[mealId].tsx`) implemented — create/edit form with all 7 fields, image upload, share CTA; custom meal definition/share-link storage now requires the MyChampions server outside E2E fixtures, while custom meal image upload requires the local server upload path.
- `Done`: SC-215 Custom Meal Library & Quick Log (`app/(tabs)/nutrition/custom-meals/index.tsx`) implemented — FlatList of meals, quick-log grams input with nutrition preview; custom meal library, share/import, and portion-log storage now require the MyChampions server outside E2E fixtures.
- `Done`: SC-215 empty state upgraded to illustrated hero pattern — warm amber/orange `menu-book` + `restaurant` icon tiles replacing the minimal text stub; `DsPillButton` CTA with add icon; offline write-lock notice; matches production quality of student nutrition and training empty states.
- `Done`: SC-216 Shared Recipe Save Confirmation (`app/shared/recipes/[shareToken].tsx`) implemented — token preview, ownership note, and import; share preview/import now use the MyChampions server share endpoints.
- `Done`: Stack.Screen route registrations added in `app/_layout.tsx` for all 4 new Phase 6 screens.
- `Done`: Wire account deletion into SC-213 account deletion flow. `deleteAccountAndDataFromSource()` calls the MyChampions server account deletion endpoint when a local bearer token is available; post-deletion cleanup awaits the single `clearSession()` boundary. The explicit development E2E auth fixture completes the deletion source operation without a server/provider mutation and verifies the same local-session cleanup and sign-in redirect. The server now removes direct account-owned local rows and rewrites retained relationship/history rows to a non-reversible `deleted_account_*` pseudonym, so local Postgres no longer keeps the deleted auth UID in server-owned account tables. The account deletion UI no longer exposes Firebase reauthentication or current-user deletion semantics. Stub `await Promise.resolve()` removed.
- `Done`: Wire MyChampions server custom-meal CRUD operations into SC-214 and SC-215 (D-126 batch — `custom-meal-source.ts` now uses local server endpoints; `useCustomMeals` updated to `isAuthenticated: boolean`).
- `Done`: Wire MyChampions server share-link generation (`createMealShareLink`) and import (`importSharedMeal`, `previewSharedMeal`) endpoints into SC-214, SC-215, SC-216 (D-126 batch — `shareLinkId` return pattern; callers updated).
- `Done`: Wire SC-214 image upload pipeline. `features/nutrition/image-upload-source.ts` source layer has injectable deps and server-upload tests (TC-287); `features/nutrition/use-image-upload.ts` hook wires expo-image-picker (Alert action sheet), expo-image-manipulator compression, and local MyChampions server upload with progress tracking; SC-214 stub replaced with real `useImageUpload(currentUser)` call; `ImageUploadSection` `onPickAndUpload`/`onRetry` callbacks wired (D-131).
- `Done`: Persist uploaded SC-214 recipe image URL to MyChampions server custom-meal records on save/update. `handleSave` now passes `uploadState.url` when upload succeeds, and `useCustomMeals` forwards `imageUrl` to `createCustomMeal`/`updateCustomMeal` (with edit fallback to existing `imageUrl` when no new upload is selected).
- `Done`: Hydrate SC-214 edit mode image upload UI from persisted `imageUrl`. When opening an existing meal, `useImageUpload.hydrateExisting()` seeds `uploadState` to `done` so the image section starts in `change photo` state even before a new upload.
- `Done`: Move SC-214/SC-215 routes under the Nutrition tab stack (`app/(tabs)/nutrition/custom-meals/*`) so bottom tab icons remain visible while navigating custom meal library/builder. Added `app/(tabs)/nutrition/_layout.tsx` stack shell and removed root-stack explicit screen registration for old standalone route files.
- `Done`: Wire portion-log persistence into SC-215 quick-log confirm action. `logPortionFromSource` added to `custom-meal-source.ts`; `logPortion` callback added to `use-custom-meals.ts`; `handleConfirmLog` in SC-215 calls `logPortion(meal.id, grams)` and surfaces error via `meal.library.quick_log.error` locale key. Portion logs and custom meal definitions now require MyChampions server local auth outside E2E fixtures.
- `Done`: Wire deep-link resume for SC-216. Unauthenticated `/shared/recipes/:shareToken` opens redirect to `/auth/sign-in?returnTo=...`; only safe normalized shared-recipe app paths are accepted as `returnTo`, and sign-in/create-account/terms/role-selection preserve the target until the recipient resumes the same share token route.

## Auth/Invite Error Copy Hardening (BL-010)

- `Done`: `mapInviteSubmitReasonToMessageKey(reason: InviteSubmitErrorReason): string` added to `features/connections/connection.logic.ts`. Maps all 7 error reasons to specific locale keys per D-123.
- `Done`: 7 unit tests added to `features/connections/connection.logic.test.ts` covering every reason branch (TC-252, TC-253).
- `Done`: 3 previously missing locale keys (`relationship.error.already_connected`, `relationship.error.network`, `relationship.error.unknown`) added to `en-US`, `pt-BR`, `es-ES` and `localized-copy-table-v2.md`.
- `Done`: Wire `mapInviteSubmitReasonToMessageKey` into the `app/student/professionals.tsx` invite-submit error display path. The inline `switch` block in `onSubmitCode` is replaced by `const messageKey = mapInviteSubmitReasonToMessageKey(errorReason); setSubmitError(t(messageKey))`. Behavior is identical; duplication eliminated (D-123).

## Analytics Event Emission (Phase 9 — BL-012)

- `Done`: `features/analytics/analytics.logic.ts` — pure event builder functions for all Milestone A events (auth entry viewed, sign-in submitted/failed, sign-up submitted/failed, role selected, self-guided start clicked, invite submit requested/failed/pending-created/pending-canceled, professional pending confirmed/denied/bulk-denied) with `redactEventProperties` guard. Focused analytics tests cover all builders, redaction, and professional pending-screen wiring (TC-254, TC-255).
- `Done`: `features/analytics/use-analytics.ts` sends provider-neutral, redacted, best-effort events to the MyChampions server `POST /analytics/events` route through `features/analytics/analytics-source.ts`. The server stores events in local Postgres `analytics_events` and rejects sensitive property keys before persistence.
- `Done`: `app/auth/sign-in.tsx` — emits `auth.entry.viewed` on mount; `auth.sign_in.submitted` before each channel attempt; `auth.sign_in.failed` with `reason_code` on failure for email/password, Google, and Apple channels.
- `Done`: `app/auth/create-account.tsx` — emits `auth.entry.viewed` on mount; `auth.sign_up.submitted`/`auth.sign_up.failed` for email/password, Google, and Apple channels.
- `Done`: `app/auth/role-selection.tsx` — emits `auth.entry.viewed` on mount; `onboarding.role.selected` with `role_context` on continue; `onboarding.self_guided_start.clicked` when Student is selected and Continue is tapped.
- `Done`: `app/student/professionals.tsx` — emits `invite.submit.requested` on manual code submit; `invite.pending.created` on success; `invite.submit.failed` with `reason_code` on failure; `invite.pending.canceled` (once, via ref guard) when `canceled_code_rotated` connections surface.
- `Done`: `app/professional/pending.tsx` — emits `invite.pending.confirmed` after successful pending-connection accept, `invite.pending.denied` after successful single deny, and `invite.pending.bulk_denied` after successful bulk deny with `pending_count`.
- `Pending`: Choose and wire any future remote analytics export/provider after the remote server/provider posture is decided; the mobile runtime path no longer keeps a console/no-op transport stub.

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

- `Done`: Wire image compression + upload pipeline to the local MyChampions server in production flow. `use-image-upload.ts` wires `expo-image-manipulator` (resize ≤ 1600 px, JPEG 0.75) and `POST /nutrition/custom-meal-images/:mealId` with progress callbacks; missing local server URL/auth now fails closed instead of using Firebase Storage. The server stores images on the local filesystem by default and switches to private GCS only when the server bucket and credentials are configured.
- `Done`: Wire upload progress/retry state to the server-backed upload pipeline. `ImageUploadState` state machine (`idle | uploading | done | failed`) is driven by the `uploadMealImageToServer` progress callback around the authenticated `POST /nutrition/custom-meal-images/:mealId` request; retry re-runs pick -> compress -> upload pipeline from failed state.

## AI Meal Photo Analysis (BL-108)

- `Done`: `features/nutrition/meal-photo-analysis.logic.ts` — mobile pure functions: `isValidMacroEstimate`, `parseMacroEstimateFromResponse`, `mapMacroEstimateToMealInput`, `normalizePhotoAnalysisError`. `PhotoAnalysisErrorReason` keeps native photo-permission denial distinct from user cancellation and includes `'unauthenticated'`. Analyzer prompt construction is server-owned in `server/src/nutrition/meal-photo-analysis-prompt.ts`.
- `Done`: `features/nutrition/meal-photo-analysis.logic.test.ts` — unit tests included in 301-test suite (TC-271–TC-274); 3 new tests added for `'unauthenticated'` reason in `normalizePhotoAnalysisError`.
- `Done`: `features/nutrition/meal-photo-analysis-source.test.ts` — 23 unit tests covering all branches: `PhotoAnalysisSourceError` constructor, configuration errors, fetch failures, unauthenticated missing-token/401/403 responses, `invalid_response` (non-JSON body, bad shape, negative field), domain errors (`unrecognizable_image`, `quota_exceeded` with and without status 429, `configuration`, `unknown` on 500/503), server bearer path, and happy paths (full result shape, rounding, confidence defaulting, request body/headers, URL routing) (TC-285).
- `Done`: `features/nutrition/meal-photo-analysis-source.ts` — HTTP source `analyzeMealPhoto`: MyChampions server bearer token path only; missing server URL maps to `'configuration'`, missing local server bearer token maps to `'unauthenticated'`, and the source no longer reads the legacy meal-analysis function URL or provider ID tokens. 401 and 403 both map to `'unauthenticated'`; network catch always throws `'network'` unconditionally.
- `Done`: Local MyChampions server meal-photo analysis can be exercised without remote analyzer credentials by setting `MEAL_PHOTO_ANALYZER=local_mock`; the default remains fail-closed as `unconfigured`, and the mock returns a deterministic low-confidence advisory estimate for development/testing only.
- `Done`: `features/nutrition/use-meal-photo-analysis.ts` — React hook `useMealPhotoAnalysis` with `idle/capturing/compressing/analyzing/done/error` state machine; `startCapture` opens the native camera or image picker, compresses the selected image, and posts it to the MyChampions server analyzer; `analyze`, `reset`, `preFillMealInput`.
- `Done`: SC-214 and SC-215 wired to `useMealPhotoAnalysis` — camera CTA, result pre-fill, attach-photo toggle (SC-214 only).
- `Done`: All `meal.photo_analysis.*` localization keys present in `en-US`, `pt-BR`, and `es-ES`.
- `Done`: SC-219 screen spec updated to reflect actual implementation.
- `Historical`: The retired Firebase meal-analysis function (Gen 2, Node 20, us-central1, 60s timeout, 256MiB) was deployed to the old mobile-owned provider project, but the mobile source no longer calls it during the local server migration. The exact legacy URL and route are intentionally omitted from current guidance; the active route is `POST /nutrition/meal-photo-analysis` on the MyChampions server.
  - Retired request/response mapping covered base64 JPEG input, macro estimates, unrecognizable-image errors, unauthenticated responses, quota handling, bad-request mapping, and generic server errors.
  - The retired function verified a provider-specific identity token with its Admin SDK. Current meal-photo analysis uses the MyChampions server bearer-token boundary.
  - Historical OpenAI API key was stored as Firebase Secret Manager secret `OPENAI_API_KEY`; compute service account had `roles/secretmanager.secretAccessor` for the retired Cloud Function path (D-106, BR-289).
  - Historical parser/analyzer code under `functions/src/**` was removed when the mobile-owned Firebase Functions project was retired; current analyzer routing lives under the root-level MyChampions server.
  - Functions tests cover provider-neutral parser behavior, OpenAI adapter HTTP errors/domain errors/happy paths, and factory selection (TC-284).
- `Historical`: `EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL` was wired for the legacy Cloud Function path; `features/nutrition/meal-photo-analysis-source.ts` no longer reads it.
- `Done`: Wire real camera capture / image picker (`expo-image-picker@~16.0.6`) into `use-meal-photo-analysis.ts`. `startCapture()` presents a localized action sheet, requests the relevant permission (`requestCameraPermissionsAsync` or `requestMediaLibraryPermissionsAsync`), and launches the native picker. Cancellation returns to `idle`; permission denial renders localized device-settings guidance and leaves manual entry available.
- `Done`: Wire `expo-image-manipulator@~13.0.6` for client-side JPEG compression in the `compressing` state of `use-meal-photo-analysis.ts`. Images are resized to ≤ 1600 px longest side and compressed at 0.75 JPEG quality before being sent to the MyChampions server (FR-230, BR-287, Q-022).
- `Done`: Wire SC-214 photo attachment toggle into the image upload pipeline (D-109). The `attachPhoto` toggle is preserved; when `uploadState.kind === 'done'`, `uploadState.url` is persisted with the custom meal record on save/update via the server-backed custom meal source. Outside E2E fixtures, missing local server URL/auth now fails closed instead of falling back to Firestore.

## AI Meal Photo Analysis Paywall Gate (BL-108, D-132)

- `Done`: `react-native-purchases-ui@9.10.5` installed. React Native autolinking handles iOS/Android; `pod install` + Gradle sync required before running on device/simulator.
- `Done`: `subscription.logic.ts` — `AI_ENTITLEMENT_ID = 'student_pro'` constant added; `hasAiAnalysisAccess(professionalEntitlement, aiEntitlement)` pure function added. 8 unit tests cover all entitlement combinations.
- `Done`: `subscription-source.ts` — `AI_FEATURES_ENTITLEMENT_ID`, `mapCustomerInfoToAiEntitlementStatus`, `presentPaywall` dep in `SubscriptionSourceDeps`, `presentAiPaywall()` function. `makeDeps()` in `subscription-source.test.ts` updated with `presentPaywall: async () => {}`; 6 + 3 new unit tests.
- `Done`: `use-subscription.ts` — `aiEntitlementStatus` state, `hasAiAccess` derived bool, and role-aware `openAiUpgradePaywall(lockedRole)` action; students resolve the guarded student offering, professionals resolve the guarded production/Test Store professional offering, and missing roles fail closed; a single `getCustomerInfo()` call maps both entitlements; `RevenueCatUI.presentPaywall` is the production dep (D-190, D-197).
- `Done`: SC-214 (`[mealId].tsx`) — `useSubscription` call added; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` passed to `MealPhotoAnalysisSection`; paywall banner + `ActivityIndicator` loading state rendered; `paywallBanner` StyleSheet entry added.
- `Done`: SC-215 (`index.tsx`) — `useSubscription` call added; `hasAiAccess`, `isSubscriptionLoading`, `onOpenPaywall` threaded through `QuickLogPanel` → `QuickLogAnalysisRow`; paywall banner + loading state rendered.
- `Done`: `en-US.ts`, `pt-BR.ts`, `es-ES.ts` — 3 new `meal.photo_analysis.paywall.*` keys added (`locked`, `cta_upgrade`, `loading`) to all three locale bundles.
- `Done`: `localized-copy-table-v2.md` — 3 new rows added for paywall keys.
- `Done`: SC-219, SC-214, SC-215 screen specs updated to document paywall gate, new states, user actions, accessibility notes, and implementation files.
- `Done`: `decisions-log-v1.md` — D-132 added.
- `Partial`: The live RevenueCat audit corrected the App Store identifiers to `professional_annual`, `professional_monthly`, `student_annual`, and `student_monthly`. App Store production products still report missing metadata; Play Store has no products; and the development Android app configuration is absent. Plan-specific Test Store products are now mapped into the student and professional Test Store offerings, while true platform-store validation remains pending.
- `Done`: RevenueCat entitlement `professional_pro` is attached to `professional_annual`, `professional_monthly`, `professional_test`, `professional_test_annual`, and `professional_test_monthly`; `student_pro` is attached to `student_annual`, `student_monthly`, and the existing legacy-typo `student_text` development product.
- `Done`: Offerings `default_student`, `test_student`, `default_professional`, and `test_professional` have annual/monthly packages and published branded paywalls. `default_student` is bound to `Student Paywall v1 Production`; `test_student` is bound to `Student Paywall v1 Test`; `default_professional` is bound to `Professional Paywall v1`; and `test_professional` is bound to `Professional Paywall v1 Test`. The current dashboard package lists show the plan-specific Test Store products attached to the professional and student Test Store offerings. Explicit dev/Test Store overrides select the two Test Store offerings; production and normal development remain on the two default offerings.
- `Done`: RevenueCat dashboard visual refinement completed on 2026-07-26 for both published student variants. The student value proposition now follows the professional vertical rhythm, with a 16 px root cadence, centered lower content block, and an 8 px purchase-footer cadence; products, offerings, entitlements, copy, and paywall logic were unchanged. Dashboard preview verification passed; a fresh device/Test Store smoke run for this updated student layout remains pending.
- `Done`: RevenueCat SDK key config in `app.config.ts` is variant-aware (D-156): `APP_VARIANT=dev` uses `EXPO_PUBLIC_REVENUECAT_API_KEY_*_DEV`, `APP_VARIANT=prod` uses `EXPO_PUBLIC_REVENUECAT_API_KEY_*_PROD`, with temporary legacy fallback to `EXPO_PUBLIC_REVENUECAT_API_KEY_IOS/ANDROID`.
- `Done`: `presentAiPaywall` accepts the guarded student offering (`default_student` normally; temporary `test_student` only for explicit dev/Test Store config); `presentProPaywall` accepts the guarded professional offering (`default_professional` normally; `test_professional` only for explicit dev/Test Store config). Production `presentPaywall` resolves the requested offering object via `Purchases.getOfferings().all[offeringIdentifier]` (D-152, D-190, D-197).
- `Done`: SC-212 Purchase CTA replaced `purchase(undefined)` (broken) with `openProPaywall()` — presents native RevenueCat paywall for professional subscription (D-152).
- `Done`: `openProPaywall` action added to `UseSubscriptionResult` and `useSubscription` hook; professional offering resolution, production/Test Store guards, and `presentProPaywall` forwarding are covered in `subscription-source.test.ts` (TC-286 extended).
- `Done`: RevenueCat SDK identity is now bound to the current MyChampions server UID. `configure` receives `appUserID`, account switches wait for `logIn`, singleton SDK operations are serialized, and stale server snapshot writes fail closed on a changed auth session (D-182).
- `Done`: Added the server-side RevenueCat canonical customer manager and server-only `REVENUECAT_SECRET_API_KEY` contract. Signed webhooks reconcile both entitlements independently, handle both sides of transfers, return retryable failures when reconciliation cannot complete, and persist professional expiry/renewal-risk metadata (D-188).
- `Done`: Added deterministic subscription Detox scenarios for paywall success, cancellation, network failure, store/provider failure, refresh recovery, restore, pre-lapse warning, lapsed-over-cap lock, and unknown entitlement. These fixtures validate app behavior but do not replace the pending provider-backed Test Store/App Store sandbox run.
- `Done`: Added a separate opt-in RevenueCat Test Store Detox lifecycle. It accepts only a dev `test_*` key, derives unique main/created/social App User IDs, removes every deterministic entitlement override, and covers valid/cancelled/failed purchases, retained Test Store customer state, account switching, student-to-professional privilege isolation, and optional renewal/expiration observation. Test Store does not perform a true platform restore, so App Store/Google Play sandbox restore evidence remains pending.
- `Done`: Added a read-only production evidence verifier for the live Test Store runner. After an approved run it compares the server customer manager's canonical RevenueCat result with `subscription_entitlement_snapshots` for the unique main and created UIDs over the constrained `digiocean` boundary. Production rejects client-authored snapshots, so convergence proves the signed webhook reconciliation persisted provider state. The VM deployment guard now refuses cutover unless the `sk_*` customer API key and both webhook secrets are configured.
- `Done`: Read-only dashboard re-verification completed on 2026-07-23 (D-189). The production webhook URL, Authorization, HMAC, all-app/all-event scope, and production+sandbox scope are present; provider catalog gaps are recorded above.
- `Pending (provider approval/permission)`: Add production Android products and the missing development Android app/products; create the first server-only secret API key; restrict sandbox entitlement access after live verification; deploy the canonical reconciler and send a signed test event; rerun device/Test Store smoke evidence for the updated student layout and the new professional Test Store paywall. The current dashboard reports that this account cannot add app configurations, so the Android dev app may require an owner/billing-plan permission change.

## Validation Gate Before Release

- Every item in this checklist must be either `Done` or explicitly deferred in a release decision note.

## BL-002 QR Invite Scan (SC-211)

- `Done`: `expo-camera@~16.0.18` installed and `CameraView` + `useCameraPermissions` wired into `app/student/professionals.tsx`.
- `Done`: `parseQrInvitePayload` pure logic in `features/connections/qr-invite.logic.ts` handles bare codes, custom-scheme deep links, and HTTPS deep links (query-param and path-segment forms).
- `Done`: QR and manual entry paths converge at `onSubmitCode(code, surface)` — same `submitCode` hook call, same analytics events, same error branches (BR-263).
- `Done`: Camera permission denial shows inline error with fallback instruction to use manual entry (AC-249).
- `Done`: Invalid QR payload shows actionable inline error within the modal; close button allows switch to manual entry (TC-251).
- `Done`: iOS `NSCameraUsageDescription` applied directly to `ios/mychampions/Info.plist` (no expo prebuild policy — D-055, D-129). `expo-camera` plugin is intentionally omitted from `app.config.ts` plugins array to prevent accidental overwrite on any future `expo prebuild` run.

## Testing Strategy Evidence Wiring (2026-08-08)

- `Done`: Selective CI status publication includes exact-head `push` results;
  local workflow-contract coverage proves the event split and publisher
  authorization. A hosted rerun of the corrected main revision remains
  `Pending` until the exact failure publication is observed remotely.
- `Done`: App static gates are wired through typed ESLint, `tsc --noEmit`,
  Prettier check, Husky, and lint-staged. `noUncheckedIndexedAccess` remains
  `Pending` as a separately budgeted type-safety migration because enabling it
  globally would change the baseline beyond this testing gate.
- `Done`: Root server, food, and exercise service quality/consumer-contract
  jobs are wired in isolated repositories. Hosted exact-head CI evidence is
  `Pending`; local build/lint/test/contract evidence is recorded in the
  service QA docs.
- `Done`: Protected full Detox iOS/Android workflow, exact-SHA checkout,
  build-once execution, explicit `MYCHAMPIONS_NATIVE_STATE_ROOT` preflight,
  mode-checked host lock, deterministic fixture selection, and failure-only
  diagnostics are wired. Hosted native runner execution and cleanup/SLO proof
  remain `Pending`; no nightly is enabled.
- `Done`: Native role-persistence, camera-permission-denied, and malformed-QR
  phases are wired to dedicated fixture profiles and manifest entries. Local
  device proof is `Pending` when no approved simulator/emulator lane is
  available; static lifecycle and contract tests are required meanwhile.
- `Done`: Playwright critical paths and visual metadata are wired into the
  manifest and browser batch evidence. Approved visual baselines are
  `Pending`; unbaselined screenshots remain triage artifacts.
- `Done`: RevenueCat Test Store preflight, isolated IDs, iOS manual workflow,
  read-only reconciliation, account switching, restore/failure scenarios, and
  fail-closed missing-credential behavior are wired. Provider credentials,
  provider-console permissions, Android Test Store configuration, and store
  live purchase/restore proof remain `Pending`.
- `Done`: Week-one browser-first persona QA is tracked in Linear `ET-25` and
  the dated report. Native persona rotation, VM `dev` API/DB access, and a
  recurring scheduled execution remain `Pending` rather than implicit.
- `Done`: Monthly gap-sweep procedure and first dated report are added with
  separate local/hosted/native/provider/store-live evidence columns.
