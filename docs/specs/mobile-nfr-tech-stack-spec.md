# Mobile NFR And Tech Stack Spec (Draft)

## Purpose
Define non-functional architecture constraints and technology options for the mobile app stack.

## Scope
- Mobile framework/runtime strategy.
- Build/release strategy without EAS dependency.
- Backend-as-a-service and storage foundation.
- Crash and reliability tooling.
- UI stack choices for a Tailwind-style developer experience.
- E2E automation baseline for test-oriented development.
- CI/CD orchestration options.

## Confirmed Decisions
- Mobile app uses React Native with Expo.
- Project must not rely on EAS services as a hard dependency for build/release.
- Android and iOS native packages/pipelines are managed independently.
- Native directories (`ios/`, `android/`) are committed from day 1.
- Native directory generation policy is one-time `expo prebuild`; ongoing native work is edited directly in committed native projects.
- Native identity must stay aligned across Expo config and committed native projects:
  - prod bundle/package id: `com.edufelip.mychampions`
  - dev bundle/package id: `com.edufelip.mychampions.dev`
  - stable app deep-link scheme: `mychampions`
- Backend platform is the MyChampions server backed by Postgres; local development uses the root-level Bun/Elysia server.
- Social auth uses explicit E2E fixtures first, then native provider-token capture plus the MyChampions server `POST /auth/social/sign-in` boundary; deterministic local MyChampions server social sessions are reserved only for explicit provider-token configuration gaps.
- Crash reporting provider is not selected in this local migration slice.
- Non-crash monitoring tooling (for example Sentry) is out of MVP scope.
- User media (for example recipe images) is routed through the MyChampions server; local development stores custom-meal images on the local filesystem.
- UI styling stack for MVP is NativeWind.
- Client-side media compression is mandatory before upload.
- OTA strategy is store-only for MVP (no remote JS bundle delivery channel).
- CI signing strategy uses platform-native secret management in pipelines.
- Core MVP screens must meet accessibility baseline (contrast, dynamic text scaling, focus order, screen-reader labels).
- QA distribution policy:
  - Release branch iOS builds are distributed through TestFlight.
  - Pull requests targeting `main` run feature-aware native toolchain jobs on the
    exact head. Successful binaries remain ephemeral; only bounded one-day
    failure diagnostics may be uploaded.
- Post-compression media constraints:
  - max upload size: `1.5 MB`.
  - max image dimension: `1600 px` on longest side.
- Localization baseline requires all user-facing strings to ship in `en-US`, `pt-BR`, and `es-ES`.
- E2E automation baseline uses Detox with Jest runner for mobile smoke coverage.
  The default Android Detox command builds the secret-free `productionDebug`
  profile; signed `productionRelease` Detox evidence is an explicit command
  that requires `CI_VERSION_CODE`, forwards it to Gradle, and retains the
  private-keystore requirements.
- Selective native CI builds each debug app once. Every isolated fixture phase
  starts a freshly owned Metro process whose explicit runtime E2E values take
  precedence over the app config embedded by the build, including empty values
  that clear the preceding phase. After the listener becomes ready, the executor
  requests and fully consumes the current platform's rewritten Expo development
  bundle before Detox launches; cold transformation, response, or stream failure
  therefore belongs to phase setup rather than a screen assertion.
- The selected iOS job reserves dedicated non-ephemeral Metro port `18081`,
  verifies it is free before building, compiles it as React Native's Debug
  fallback, and routes every app launch to it through the app-level
  `RCT_jsLocation` argument. The executor uses the same validated
  `DETOX_METRO_PORT` for prewarming and phase ownership, so an unrelated
  developer process on default port `8081` is neither reused nor signalled.
- The selected Android lane runs `lintDevDebug` before Detox. The manually
  maintained native baseline keeps camera hardware optional because manual
  invite entry remains available, declares Android 13 notification capability
  required by the Expo video playback service, and places
  `windowSplashScreenBehavior` in `values-v33` so the API-33 attribute does not
  violate the API-24 minimum. The lane rejects stale emulator/QEMU/console
  state, preboots `Pixel_10` on `emulator-5554`, bounds exact AVD readiness to
  120 seconds while revalidating PID/UID/Linux start time plus AVD/port command
  identity, lets Detox reuse that instance, and verifies that no QEMU process,
  emulator device, or owned port survives teardown.

## Constraints From Platform Docs
- Expo local builds support CI and local machine execution and work with managed and bare workflows.
- Native server-backed flows require `EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL` and a MyChampions bearer session.
- Direct Google/Apple token verification requires configured server audiences and deep-link handling before production traffic.
- MyChampions server routes and Postgres migrations define app-domain persistence and authorization behavior.
- Server-backed upload flows must enforce client compression and server-side storage validation.

## Technology Options

### 1) Tailwind-Style UI
- Option A: NativeWind.
  - Pros: Tailwind-compatible API, strong Expo/React Native adoption, utility-first workflow.
  - Cons: Build/runtime considerations for dynamic class composition.
- Option B: `twrnc` (tailwind-react-native-classnames).
  - Pros: Lightweight, straightforward class-to-style mapping.
  - Cons: Smaller ecosystem and fewer first-party patterns than NativeWind.
- Option C: `tailwind-rn`.
  - Pros: Simple mental model.
  - Cons: Historically less feature-complete for modern RN use cases.
- Selected for MVP: NativeWind.

### 2) Navigation
- Option A: Expo Router.
  - Pros: File-based routes, good fit with existing Expo baseline.
  - Cons: Requires strict route conventions.
- Option B: React Navigation (manual config only).
  - Pros: Maximum explicit control.
  - Cons: More boilerplate for route structure.
- Recommended starting point: Keep Expo Router.

### 3) Server-State And Caching
- Option A: TanStack Query + lightweight local state (Zustand).
  - Pros: Excellent async cache primitives, retries, invalidation, optimistic updates.
  - Cons: More moving parts if overused for simple local state.
- Option B: Redux Toolkit + RTK Query.
  - Pros: Centralized state model with integrated data fetching.
  - Cons: Higher upfront structure for smaller feature slices.
- Recommended starting point: TanStack Query + Zustand.

### 4) Forms And Validation
- Option A: React Hook Form + Zod.
  - Pros: Strong performance, type-safe schemas, good RN ergonomics.
  - Cons: Schema duplication risk if backend schemas diverge.
- Option B: Formik + Yup.
  - Pros: Mature ecosystem and familiar API.
  - Cons: Usually heavier re-render profile.
- Recommended starting point: React Hook Form + Zod.

### 5) Local Persistence For Offline Read-Only
- Option A: MyChampions server snapshots + SQLite (`expo-sqlite`) tables.
  - Pros: Reliable structured offline reads, explicit TTL policies.
  - Cons: Additional sync layer complexity.
- Option B: MMKV/AsyncStorage cache only.
  - Pros: Fast setup and low complexity.
  - Cons: Harder queryability and consistency for complex views.
- Recommended starting point: SQLite snapshots for core lists + MMKV/AsyncStorage for session/preferences.

### 6) CI/CD Without EAS
- Option A: GitHub Actions + Fastlane + native toolchains (`gradlew`, `xcodebuild`).
  - Pros: Maximum control, transparent pipelines, no EAS lock-in.
  - Cons: More initial setup for signing and caching.
- Option B: Codemagic + Fastlane/native scripts.
  - Pros: Faster mobile-first bootstrap.
  - Cons: Additional vendor dependency.
- Option C: Bitrise + Fastlane/native scripts.
  - Pros: Mature mobile CI features.
  - Cons: Additional vendor dependency.
- Recommended starting point: GitHub Actions + Fastlane.

Feature-aware test selection uses `config/test-impact.json` plus
`scripts/ci/resolve-test-impact.ts`. The resolver combines path ownership,
declared reverse feature dependencies, and TypeScript reverse import consumers.
It fails closed to the full registered UI matrix for shared-global, tooling,
native, invalid, unknown, or unresolved changes. D-193 defines the candidate
exact-head gate: universal fast checks always run, affected Playwright and
both-platform Detox suites execute on dedicated self-hosted lanes, and
workflow/tooling, scheduled, merge-queue, release/hotfix, or explicit-full
inputs select the complete registered matrix. D-195 makes persistent-runner
promotion conditional on a GitHub-hosted-only PR preflight, a
`workflow_run`-triggered trusted workflow sourced from protected default branch
`main`, a GitHub-hosted triggering-run/live-PR authorization job before
candidate checkout, read-only candidate/self-hosted tokens, trusted hosted
pending/terminal exact-status publishers with stale-run protection, all-external fork approval, pinned-action
policy, an exact recorded backend SHA, ephemeral mode-`0600` environment
cleanup, owned disposable iOS simulator cleanup, required `main` PR/status
enforcement, and one complete exact-head matrix. Host hooks remain resource
locks only. Those promotion controls remain pending verified workflow,
repository, and exact-head evidence.
The hosted preflight covers PR bases `main`, `release/**`, and `hotfix/**` plus
merge groups. Release/hotfix PRs use the protected-`main` workflow-run path and
force the complete matrix; the trusted workflow is not sourced or triggered
directly from those branches.
Static repository labels remain technically targetable by any GitHub-approved
workflow because this personal repository has no organization runner-group
workflow allowlist. The operational boundary therefore keeps the owner as sole
collaborator, requires approval for all external workflows, never approves fork
or untrusted workflow changes, and pauses runners before either constraint is
relaxed pending private-broker/JIT/ephemeral isolation.
Contradictory native fixture states execute in scenario-gated fresh-Metro phases,
each of which fully prewarms its exact platform bundle before Detox launches, and
the iOS lane keeps its app launch route and compiled fallback on dedicated port
`18081`. Android instrumentation routes Metro through the configured localhost ADB
reverse tunnel before React Native starts. The Android runner supplies one
health-checked `emulator-5554` for the job instead of delegating console-port
allocation to Detox. Successful runs create no GitHub
Actions artifact or cache.
## High-Level Architecture (Target)
1. Expo/React Native client handles UI, routing, and offline read models.
2. MyChampions server and Postgres manage identity and sessions.
3. MyChampions server enforces domain rules through route guards and Postgres persistence.
4. MyChampions server stores and serves user media through local storage in development and a future remote storage provider.
5. MyChampions server proxies nutrition and exercise lookup against local catalog mirrors.
6. RevenueCat orchestrates professional subscription entitlements.
7. Crash/non-fatal monitoring provider remains pending.

Diagram: `docs/diagrams/mobile-stack-high-level-v1.md`.
Current local server contract: root-level `server/` plus this migration task card.

## Suggested Default NFR Targets For MVP
- App cold start: <= 2.5s median on modern mid-tier devices.
- Crash-free sessions: >= 99.5%.
- API p95 latency (critical endpoints): <= 800ms (region-adjusted).
- Auth/session reliability: silent refresh success >= 99%.
- Image upload success rate: >= 99% with retry for transient failures.
- Observability: structured logs with no sensitive token/link leakage.

## Traceability Links
- Functional requirements: `FR-192`, `FR-193`, `FR-194`, `FR-195`, `FR-196`, `FR-197`, `FR-198`, `FR-199`, `FR-200`, `FR-201`, `FR-202`, `FR-217`, `FR-227`, `FR-228`, `FR-271`, `FR-272`.
- Business rules: `BR-253`, `BR-254`, `BR-255`, `BR-256`, `BR-257`, `BR-258`, `BR-259`, `BR-260`, `BR-261`, `BR-275`, `BR-284`, `BR-285`, `BR-344`.
- Acceptance criteria: `AC-501`, `AC-502`, `AC-503`, `AC-504`, `AC-505`, `AC-506`, `AC-507`, `AC-508`, `AC-509`, `AC-510`, `AC-511`, `AC-512`, `AC-513`, `AC-514`, `AC-515`, `AC-540`, `AC-542`.
- Test cases: `TC-501`, `TC-502`, `TC-503`, `TC-504`, `TC-505`, `TC-506`, `TC-507`, `TC-508`, `TC-509`, `TC-510`, `TC-511`, `TC-512`, `TC-513`, `TC-514`, `TC-515`, `TC-516`, `TC-517`, `TC-518`, `TC-519`.- Diagram: `docs/diagrams/mobile-stack-high-level-v1.md`.

## Open Questions
- None currently.

## References
- Expo local app builds: https://docs.expo.dev/build-reference/local-builds/
- Expo local builds: https://docs.expo.dev/build-reference/local-builds/
- Elysia: https://elysiajs.com/
- Drizzle ORM: https://orm.drizzle.team/
- Fastlane docs: https://docs.fastlane.tools/
- GitHub Actions docs: https://docs.github.com/actions
- Detox docs: https://wix.github.io/Detox/docs/introduction/project-setup/
