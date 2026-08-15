# AC-005 Mobile Platform And Delivery NFR (Proposed)

## Feature
Mobile platform constraints and delivery workflow without EAS dependency.

## Acceptance Criteria
- `AC-501`: Native project folders (`ios/`, `android/`) exist in repository and are treated as first-class source artifacts.
- `AC-502`: Build/release pipeline runs without requiring EAS Build or EAS Submit.
- `AC-503`: Mobile UI utility-class styling is implemented with NativeWind in MVP.
- `AC-504`: Release branch iOS builds are distributed through TestFlight.
- `AC-505`: Pull requests targeting `main` run the required feature-aware native
  and web checks after AC-542's persistent-runner promotion gates pass.
  Successful build outputs stay ephemeral on self-hosted runners; only bounded
  failure diagnostics may be uploaded for one day.
- `AC-506`: Image/media uploads are client-compressed before upload through the MyChampions server.
- `AC-507`: Runtime crash/ANR monitoring provider is selected before production release.
- `AC-508`: Additional non-crash monitoring tooling is not required for MVP.
- `AC-509`: OTA updates are disabled in MVP and production updates are shipped only through App Store/Play binaries.
- `AC-510`: CI signing workflow uses platform-native secret management for signing materials.
- `AC-511`: Post-compression uploads enforce `<= 1.5 MB` file size and `<= 1600 px` longest-side dimension.
- `AC-512`: Core screens meet accessibility baseline for contrast, dynamic text scaling, focus order, and screen-reader labels. Each workout session exposes one dedicated expandable-details control with a minimum 44×44 CSS px touch/focus target, a localized label, and its expanded/collapsed state; the SC-222 language rows expose semantic radio roles, localized names, and an explicit checked state that follows the pending selection.
- `AC-513`: User-facing strings use localization keys with populated values for `en-US`, `pt-BR`, and `es-ES` in release-candidate builds.
- `AC-514`: Detox E2E suite is configured for iOS simulator and Android emulator builds, includes auth sign-in smoke scenarios (empty-submit validation + success route to role-selection), and keeps the default Android build runnable without release credentials by targeting `productionDebug`; signed `productionRelease` evidence is exposed only through explicit release commands and still requires its CI version code and private keystore. The suite documents debug-build runtime prerequisites such as Metro when JS is not embedded, and uses stable non-production auth credentials or the explicit dev-only `EXPO_PUBLIC_E2E_AUTH_SESSION=true` harness, the sign-in-specific `EXPO_PUBLIC_E2E_EMAIL_PASSWORD_SIGN_IN=true` fixture, the create-account-specific `EXPO_PUBLIC_E2E_CREATE_ACCOUNT=true` fixture, or the social-auth-specific `EXPO_PUBLIC_E2E_SOCIAL_AUTH=true` fixture for approved mock auth coverage. The auth-session harness may provide deterministic read-only fixtures for source modules that otherwise require a local server session, such as empty student connections and a personal water goal for the dashboard. Provider-backed and network-state story fixtures must be opt-in via explicit dev-only flags such as `EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE`, `EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE`, `EXPO_PUBLIC_E2E_STUDENT_NUTRITION_FIXTURE`, `EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE`, `EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE`, `EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE`, `EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE`, `EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS`, `EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT`, `EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS`, and `EXPO_PUBLIC_E2E_NETWORK_STATUS`.
- `AC-515`: Android and iOS launcher icon assets are generated from the same source logo file (`assets/images/logo.svg`) and updated together.
- `AC-540`: Feature-aware test impact is resolved from a checked-in
  ownership/suite manifest, the PR merge-base-to-exact-head change set, reverse
  feature dependencies, and base/head TypeScript import consumers. Feature-only
  changes select affected Playwright and both declared mobile-platform Detox
  suites; shared or indirect changes widen selection; renames, copies, and
  deletions preserve historical and current ownership; invalid, unknown,
  oversized, unresolved, merge-queue, scheduled, release/hotfix, or explicit-full
  inputs select the complete registered CI matrix. Every selected executable
  profile must pass; native jobs build once while freshly owned Metro phases
  override or clear embedded dev-only fixture values. After Metro reports
  listening, the executor fully consumes the exact iOS or Android Expo
  development bundle within a bounded four-minute request window before Detox
  launches; timeout, response, body-stream, or Metro-exit failures fail the
  phase instead of consuming the test's first UI wait. Contradictory image-upload
  sheet and fixture-success expectations execute in separate scenario-gated
  phases, and authenticated runs reject a missing or invalid scenario. iOS CI
  reserves dedicated Metro port `18081`, verifies that it is unoccupied before
  building, compiles it as the React Native fallback, routes every debug-app
  launch to the same port through `RCT_jsLocation`, and forwards it to every
  prewarm/Detox phase without killing an unrelated
  listener on the local default `8081`. Android
  instrumentation persists `debug_http_host=localhost:8081` before React Native
  starts so the configured ADB reverse tunnel, rather than the emulator gateway,
  owns the Metro route; failure to persist that setting fails the invocation.
  Native selective phases
  preserve warning diagnostics without allowing the development LogBox overlay
  to intercept Detox actions, and tests bring compact-viewport targets into view
  before interaction. The SC-215 quick-log story uses atomic grams replacement,
  an exact-value assertion, explicit platform keyboard dismissal, and stable
  element targets. The Android job starts with no stale device, QEMU process, or
  `5554/5555` listener; preboots the declared AVD on `emulator-5554`; requires
  the saved PID, runner UID, Linux start time, expected AVD/port command, exact
  device state, completed boot, and AVD name within 120 seconds; and fails if
  any QEMU process, emulator device, validated PID, or owned port survives
  cleanup.
  Metro cleanup targets and
  verifies runner-owned members even when a mixed-UID process group makes group
  signaling return `EPERM`; surviving runner-owned members or an occupied Metro
  port fail the lane. The Android lane must pass native lint/unit/build checks,
  and a selected skipped/empty lane fails the stable gate, except that a
  selected iOS lane may be intentionally skipped when repository variable
  `MYCHAMPIONS_ENABLE_IOS_TESTS` is exactly `false`; that opt-out does not
  relax any other selected or enabled lane.
- `AC-542`: Persistent-runner promotion passes only when the supported
  pull-request path for bases `main`, `release/**`, and `hotfix/**` begins with a
  protected-`main`, GitHub-hosted-only `pull_request_target` freshness workflow
  that checks out no candidate code and posts event-fingerprinted pending only
  for a live owner-authored same-upstream pull request. A GitHub-hosted-only
  preflight with `statuses: read` must observe the pending description for the
  canonical fingerprint of its exact event before it dispatches self-hosted work from
  `.github/workflows/trusted-selective-tests.yml` loaded from protected
  default branch `main` after a completed `workflow_run`. Before candidate
  checkout or self-hosted scheduling, that trusted workflow's GitHub-hosted
  authorization job must compare the triggering run and event with the live
  pull-request API and validate the exact head SHA, same upstream/base
  repository, owner actor/triggering actor/sender, workflow path/ref/SHA, and
  allowed event/ref/base. A live release/hotfix PR must use the same
  protected-`main` trusted workflow and force the complete matrix; no trusted
  workflow definition is loaded directly from its target branch. Fork,
  identity, workflow-provenance, malformed-event, and
  live-head mismatch or stale-run probes must fail authorization. Merge-group
  authorization must validate every associated live pull request with the same
  upstream and owner provenance. Candidate and self-hosted jobs have only
  `contents: read`. Only three trusted GitHub-hosted jobs may have
  `statuses: write`: the freshness invalidator, authorization/status initializer,
  and always-run finalizer. They must share one repository-global `queue: max`
  writer group. Initial and final publication must each prove that the exact head
  identifies one eligible open, ready, owner-authored same-upstream pull request;
  the finalizer may post success or failure only while the latest status remains
  its own in-progress pending target. Fork or unidentifiable authorization
  denials publish no candidate status. The freshness workflow must use stable
  per-pull-request `cancel-in-progress: true` to coalesce superseded metadata
  work before its job enters the global writer queue. That layered concurrency,
  stable per-PR/head validation cancellation, and serialized status writes must
  ensure a `ci:full` label change cannot leave or overwrite stale success.
  Direct `main` push and schedule events use the
  trusted default-branch workflow without publishing the SHA-global pull-request
  context. Manual runs must dispatch that workflow at
  ref `main`, supply a pull-request number, resolve its live head/base through
  the API, and force the complete matrix; the trusted workflow has no direct
  `merge_group` trigger. Merge-group support is future-compatible only because a
  personal public repository cannot enable GitHub merge queues; current
  enforcement must require strict up-to-date branches. Repository evidence must
  also prove
  all-external fork approval, an approved action allowlist with full-SHA pinning
  enforcement, and `main` protection requiring a pull request, strict up-to-date
  branches, exact check `Hosted candidate preflight`, exact status
  `Selective CI gate`, conversation resolution, administrator enforcement, zero
  approvals, and no bypass. Exact backend-SHA recording and ephemeral secret
  handling remain required: `ENV_FILE_CONTENT` is only the initial
  step-environment transport consumed by the atomic writer and is immediately
  unset before Yarn, Gradle, `xcrun`, or recovery subprocesses. Secret bytes
  then exist only in a validated per-job mode-`0600` regular file below
  `$RUNNER_TEMP`, while workspace `.env` is an absolute symlink to that exact
  target. Same-step `EXIT`/`INT`/`TERM` cleanup must remove and verify both link
  and target; runner-temp cleanup is hard-kill defense-in-depth, and a trusted
  next checkout removes without following any unexpected workspace `.env`
  entry and fails closed unless absence is proved. Interruptible
  isolated-process-group supervision, including outer grace for coordinator
  detached-group `TERM`/`KILL` cleanup and its executable fixture,
  cancellation-safe durable native ownership, bounded exact-device signal
  cleanup, retained recovery metadata after cleanup failure, and next-run exact
  stale-resource recovery before new device creation remain required. The
  separate non-secret recovery ledger must live below the runner service
  environment `MYCHAMPIONS_NATIVE_STATE_ROOT`, an absolute canonical,
  runner-owned, non-symlink, mode-`0700` persistent directory outside the
  workspace and `$RUNNER_TEMP`; it may be touched only while the host lock is
  held and only after validated path, owner/mode, file type/no-symlink,
  complete-record, and strict numeric/UUID/name checks. `.env`, its target, and
  secrets remain ephemeral and never enter the ledger. The proof must cover
  interrupted creation before UUID/PID handoff,
  live mid-build/mid-test cancellation within GitHub's ten-second signal grace
  window, the exact-UDID/workflow-namespace iOS simulator, the exact
  PID/UID/start-time/AVD/port/serial/command Android emulator, preservation of
  unrelated resources, the complete exact-head matrix, and zero successful-run
  artifacts/caches. Owner records may be removed only after absence is proved;
  malformed, incomplete, or failed recovery retains evidence and fails closed.
  Host hooks are resource locks and defense-in-depth only, never the
  authorization boundary.
  Because a personal repository has no organization runner-group workflow
  allowlist, static repository runner labels remain technically targetable by
  any GitHub-approved workflow. The enforceable operational boundary is
  all-external manual workflow approval, sole-owner collaborator access, and
  never approving fork or untrusted workflow changes. Adding a collaborator or
  approving external workflow changes requires pausing the runners until a
  private broker, JIT, or ephemeral-runner boundary is in place.

## Gherkin Scenarios
```gherkin
Feature: Mobile platform and delivery constraints

  Scenario: Native projects are source-controlled
    Given the repository is freshly cloned
    Then ios and android native project folders are present

  Scenario: Pipeline does not rely on EAS
    Given CI pipeline configuration
    When Android and iOS jobs run
    Then builds execute with native toolchains without EAS Build/Submit dependency

  Scenario: PR QA build proof without success artifacts
    Given a pull request targets main
    When feature-aware CI completes
    Then every selected lane passed on the exact pull-request head
    And successful native and web build outputs were not uploaded
    And any uploaded failure diagnostics expire after one day

  Scenario: Release branch iOS distribution path
    Given a release branch is built
    When iOS distribution job completes
    Then build is uploaded to TestFlight

  Scenario: Store-only update strategy
    Given MVP release configuration
    When production updates are shipped
    Then delivery happens through App Store/Play binaries only
    And no OTA update channel is active

  Scenario: Platform-native signing in CI
    Given mobile CI signing jobs are configured
    When signing materials are loaded
    Then they are sourced from platform-native CI secret management

  Scenario: Post-compression upload limits
    Given a user selects media for upload
    When compression and validation run
    Then upload proceeds only if file size is at most 1.5 MB
    And upload proceeds only if longest side is at most 1600 px

  Scenario: Core screen accessibility baseline
    Given a user enables larger text and screen reader
    When user navigates onboarding, relationship, and tracking core screens
    Then content remains readable and operable
    And interactive controls expose meaningful labels in logical focus order
    And language selection rows expose a semantic radio role and an explicit checked state

  Scenario: Localization baseline completeness
    Given release-candidate build strings are prepared
    When localization table and runtime resource bundles are validated
    Then all user-facing keys have populated values for en-US, pt-BR, and es-ES

  Scenario: Detox auth smoke coverage
    Given Detox config and native build profiles are available for iOS and Android
    And the default Android command selects the secret-free productionDebug profile
    And the selected debug or release-like build has its required JavaScript runtime available
    And stable non-production auth credentials or the explicit dev-only E2E auth session harness is configured
    When the auth smoke suite runs
    Then empty sign-in submission shows required-field validation errors
    And valid credential submission routes the user to role-selection screen
    And signed productionRelease evidence remains an explicit credentialed command

  Scenario: Cross-platform icon source consistency
    Given the source logo file at assets/images/logo.svg
    When icon generation runs
    Then iOS app icon and Android launcher icons are regenerated from that same source

  Scenario: Feature A selects only affected suites
    Given a pull request changes only source owned by feature A
    When feature-aware impact is resolved
    Then feature A and its reverse dependents are selected
    And unrelated feature B suites are excluded
    And the selected Detox suites run on iOS and Android

  Scenario: Shared changes fail closed
    Given a pull request changes navigation, localization, native configuration, or CI tooling
    When feature-aware impact is resolved
    Then the complete applicable web, iOS, and Android matrix is selected

  Scenario: Trusted default-branch workflow authorizes persistent-runner work
    Given a GitHub-hosted-only pull-request preflight completed
    When the default-branch workflow-run authorization compares the triggering run with the live pull-request API
    Then fork, identity, workflow-provenance, event, ref, or stale-head mismatches are rejected before candidate checkout
    And only an authorized exact head may reach a self-hosted job with contents-read permission
    And trusted freshness posts the exact event-fingerprinted pending status before the hosted preflight completes
    And the hosted initializer and finalizer publish owned pending then terminal Selective CI gate on that candidate SHA
    And a superseded same-head run cannot overwrite the newer status cycle
```
