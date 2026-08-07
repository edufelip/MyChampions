# CI Secrets Matrix V1

## Purpose
Define the GitHub Actions secrets, repository variables, runner capabilities,
and storage boundaries required by `.github/workflows/` so CI/CD setup is
reproducible and auditable.

## Current CI Contract
- `.github/workflows/trusted-selective-freshness.yml` is the protected-`main`,
  GitHub-hosted-only `pull_request_target` metadata invalidator. It checks out no
  candidate code and posts event-fingerprinted freshness pending only for a live
  owner-authored, same-upstream pull request.
- `.github/workflows/pr-selective-tests.yml` is the GitHub-hosted-only
  `pull_request`/`merge_group` preflight. It must not checkout candidate code or
  target a self-hosted runner. Pull-request base filters cover `main`,
  `release/**`, and `hotfix/**`; the pull-request job has only `statuses: read`
  and waits for the matching trusted freshness pending status.
- `.github/workflows/trusted-selective-tests.yml` is the authoritative
  selection/execution workflow. Pull-request work enters through `workflow_run`
  after the preflight completes, so GitHub loads the workflow definition from
  protected default branch `main`. Its hosted authorization job validates the
  triggering run against the live pull-request API before candidate checkout or
  self-hosted scheduling. Merge-group authorization validates every associated
  live pull request. Direct `main` push uses the trusted workflow
  from `main` without publishing the SHA-global pull-request status; manual
  execution requires `workflow_dispatch` at ref `main`, a PR number resolved live
  through the API, and full selection. The trusted workflow has no direct
  `merge_group`, release-branch, or hotfix-branch trigger.
  Authorized release/hotfix PR workflow runs force full selection.
- D-193 remains the selection/execution contract. D-195 blocks promotion and
  merge until trusted-workflow provenance, live-PR authorization, token
  isolation, exact status publishing, repository policy, dependency provenance,
  ephemeral secret handling, simulator ownership, and exact-head evidence gates
  below are all verified.
- `.github/workflows/android-pr.yml`, `ios-pr.yml`, and `web-pr.yml` are
  legacy/manual validation workflows. They run only through
  `workflow_dispatch`; they are not automatic or required PR gates.
- `.github/workflows/android-release.yml` and `ios-release.yml` remain the
  credentialed distribution workflows for release/hotfix branches or an
  explicitly approved manual dispatch.
- The repository-scoped self-hosted runners and the host-wide locks shared with
  Meer are configured. Their labels, service posture, hook installation, and
  recovery checks are recorded below as capacity and resource-serialization
  evidence only. They do not establish D-195 authorization. Promotion
  remains incomplete until every D-195 gate and the complete exact-head matrix
  are verified.

## Global Notes
- Store credentials in GitHub repository secrets, or in protected environment
  secrets for stricter release controls.
- `ENV_FILE` must contain the applicable variables listed in `.env.example`,
  including the MyChampions server URL and public RevenueCat keys used by the
  requested native build. E2E fixture flags are included only when the selected
  deterministic profile requires them.
- Native builds no longer require Firebase config files
  (`google-services.json`, `GoogleService-Info*.plist`), Firebase project files,
  or Firebase service accounts after the local-server migration.
- Workflows set `APP_VARIANT` explicitly (`dev` for selected/manual validation,
  `prod` for release) to prevent accidental cross-environment routing.
- Promotion target (pending verification): the GitHub-hosted-only PR/merge-group
  preflight never targets self-hosted labels. The protected-`main`
  `trusted-selective-tests.yml` workflow authorizes its `workflow_run` trigger
  before checkout by matching the live PR head, same upstream/base, owner
  actor/triggering actor/sender, workflow path/ref/SHA, and allowed event/ref.
  Fork, malformed, mismatched, and stale triggering runs are rejected before
  candidate checkout or self-hosted scheduling. Merge-group authorization
  validates all associated live pull requests for same-upstream owner
  provenance. PR bases are limited to `main`, `release/**`, and `hotfix/**`;
  release/hotfix workflow runs force the complete matrix without loading a
  trusted workflow from those branches.
- Promotion target (pending verification): before the PR preflight completes,
  the protected-`main` freshness workflow posts event-fingerprinted pending for
  a live owner-authored same-upstream PR; the preflight uses `statuses: read` to
  observe the pending description for the canonical fingerprint of its exact
  event.
- Promotion target (pending verification): candidate and self-hosted jobs have
  only `contents: read`. Only the trusted GitHub-hosted freshness invalidator,
  authorization/status initializer, and always-run finalizer have
  `statuses: write`; all three share one repository-global `queue: max` writer
  group. Initial and final publication each require one unique eligible open,
  ready, owner-authored same-upstream PR for the head. The finalizer may publish
  success/failure only while the latest `Selective CI gate` remains its
  run-owned in-progress pending target. Fork or unidentifiable authorization
  denials publish no candidate status. Separately, the freshness workflow uses a
  stable per-pull-request `cancel-in-progress: true` group to coalesce superseded
  metadata work before its job enters the global writer queue; trusted
  per-PR/head validation concurrency cancels superseded validation work.
- Verified repository setting (2026-07-29 read-back): fork workflow approval is
  `all_external_contributors`.
- Verified repository settings (2026-07-29 read-back): the default workflow
  token is read-only and workflows cannot approve pull requests.
- Residual public-repository limitation: static repository-scoped runner labels
  are technically targetable by any GitHub-approved workflow. Personal
  repositories cannot restrict a runner group to selected workflow files, and
  stock runner hooks are not an authorization boundary. The enforceable
  operational boundary is all-external manual workflow approval, `edufelip` as
  sole collaborator, and never approving fork or untrusted workflow changes.
  Adding a collaborator or approving external workflow changes requires pausing
  the persistent runners and re-architecting around a private broker, JIT, or
  ephemeral runners.
- Verified repository policy and checked-in contract (2026-07-29 read-back):
  allowed actions are restricted to GitHub-owned actions plus
  `oven-sh/setup-bun@*` and `r0adkll/upload-google-play@*`; verified-creator
  actions are not generally allowed, SHA pinning is required, and every current
  `uses:` reference has a reviewed full commit SHA. A selected server-backed web
  lane still requires pending run evidence that it records/checks out the exact
  `mychampions-api` commit SHA resolved before installation.
- Promotion target (pending verification): each native creation/use step
  installs idempotent `EXIT`, `INT`, and `TERM` handlers before materializing
  secrets. `ENV_FILE_CONTENT` is only the initial step-environment transport
  consumed by the atomic writer and is immediately unset before Yarn, Gradle,
  `xcrun`, or recovery subprocesses. The writer validates a per-job path below
  `$RUNNER_TEMP`, writes secret bytes only to that regular file with mode `0600`,
  and makes workspace `.env` an absolute symlink to the exact target. From the
  unset until cleanup, the bytes live only in that target. Normal/signal cleanup
  removes the link without following it, removes the target, and verifies both
  absent. The next trusted checkout/preflight removes and verifies absence of
  any unexpected workspace `.env` entry or fails closed; runner-temp cleanup
  remains hard-kill defense-in-depth. Long commands execute as supervised
  isolated process groups behind an interruptible shell wait. The outer
  supervisor grace covers coordinator-owned detached invocation/Metro group
  `TERM`/`KILL`, its outer fallback, and the corresponding executable fixture.
  The signal path performs bounded exact-device cleanup within GitHub's
  documented 7.5-second `SIGINT` plus 2.5-second `SIGTERM` grace window.
- Promotion target (pending verification): non-secret device recovery records
  live at the runner service environment value
  `MYCHAMPIONS_NATIVE_STATE_ROOT`. The value must resolve to an absolute
  canonical, runner-owned, non-symlink, mode-`0700` persistent directory outside
  the workspace and `$RUNNER_TEMP`, accessed only while the host lock is held.
  The lane validates the directory and each ledger file's owner, mode, type,
  no-symlink status, completeness, and strict numeric/UUID/name fields. `.env`,
  its runner-temp target, tokens, and secret values never enter it. The Mac
  service value
  `/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery` was
  configured and read back on 2026-07-29. The intended WSL value
  `/home/eduardo/.local/state/github-actions/mychampions-native-recovery`
  remains pending while the current WSL endpoint is recovered.
- Promotion target (pending verification): iOS persists a unique
  workflow-owned name/namespace before creation and then its exact returned
  UDID. Android makes launch-to-PID capture and durable
  PID/UID/Linux-start-time/AVD/port/serial/command handoff cancellation-safe.
  Before creating a new device, the next locked run revalidates and recovers any
  stale exact record. Normal/signal cleanup removes records only after exact
  process/device/serial/port absence is proved; failure retains evidence and
  fails closed. Later `if: always()` verification is defense-in-depth, not the
  cancellation guarantee; host hooks remain resource-lock-only. Global
  simulator shutdown, `pkill`, arbitrary QEMU signaling, and unrelated
  ADB/device mutation are prohibited. Executable failure/retry fixtures and live
  mid-build/mid-test cancellations must prove exact recovery, unrelated-resource
  preservation, and lock release.
- Promotion target (pending verification): this personal public repository
  cannot enable GitHub merge queues, so checked-in `merge_group` handling is
  future-compatible and current protection uses strict up-to-date branches.
  `main` requires pull requests, exact check `Hosted candidate preflight`, exact
  stable status `Selective CI gate`, conversation resolution, administrator
  enforcement, zero approvals, and no direct-push or merge bypass. CODEOWNERS is
  review routing only because the sole author cannot approve their own pull
  request.
- GitHub Actions-backed dependency caches are disabled, including setup-node
  caching and Gradle cache actions. Host-local caches may exist on a
  self-hosted runner, but they must never be uploaded through the Actions cache
  service.
- A successful selective run uploads no impact report, web export, app, APK, or
  test artifact. Only bounded failure diagnostics may be uploaded, with
  `retention-days: 1`. Necessary release AAB/IPA artifacts also retain for one
  day.
- Verified repository storage baseline (2026-07-29 read-back after failure
  cleanup): zero Actions artifacts and zero Actions caches. This does not replace
  the pending exact-head promotion-run storage proof.
- `.env.example` lists variable names with empty values. Copy it to `.env` for
  local work; `.env` remains gitignored. Gitignore is not a cleanup boundary on
  a persistent runner.
- Use `.github/ISSUE_TEMPLATE/ci-cd-setup-checklist.md` to track bootstrap and
  remote evidence without exposing registration tokens or credentials.

## Secret Inventory
| Secret | Required In | Purpose | Expected Format | Required |
|---|---|---|---|---|
| `ENV_FILE` | `trusted-selective-tests` native lanes; manual `android-pr`/`ios-pr`; Android/iOS release | Trusted selective native lanes write secret bytes only to a validated per-job mode-`0600` regular file below `$RUNNER_TEMP` and expose workspace `.env` as an absolute symlink to that target; legacy/release paths must retain their documented lifecycle until migrated | Raw multiline `.env` content | Yes for native/full-matrix and release execution |
| `ANDROID_KEYSTORE_BASE64` | `android-release` | Release keystore injection | Base64 of `.jks` file | Yes |
| `ANDROID_KEYSTORE_PASSWORD` | `android-release` | Keystore password | Plain string | Yes |
| `ANDROID_KEY_ALIAS` | `android-release` | Keystore key alias | Plain string | Yes |
| `ANDROID_KEY_ALIAS_PASSWORD` | `android-release` | Key alias password | Plain string | Yes |
| `PLAY_SERVICE_ACCOUNT_JSON` | `android-release` | Play Console API upload auth (`r0adkll/upload-google-play`) | Raw JSON string for Google Play service account | Yes |
| `IOS_TEAM_ID` | `ios-release` | Apple Developer Team ID for xcodebuild signing | Apple Team ID string | Yes |
| `IOS_KEYCHAIN_PASSWORD` | `ios-release` | Temporary keychain password in CI for release signing | Plain string | Yes |
| `IOS_DIST_CERT_P12_BASE64` | `ios-release` | Distribution signing certificate import | Base64 `.p12` | Yes |
| `IOS_DIST_CERT_PASSWORD` | `ios-release` | Distribution certificate password | Plain string | Yes |
| `IOS_PROFILE_BASE64` | `ios-release` | Release provisioning profile install | Base64 `.mobileprovision` | Yes |
| `IOS_PROFILE_NAME` | `ios-release` | Provisioning profile specifier for release archive/export | Plain string | Yes |
| `APP_STORE_CONNECT_API_KEY_ID` | `ios-release` | TestFlight upload auth | ASC API Key ID | Yes |
| `APP_STORE_CONNECT_API_KEY_ISSUER_ID` | `ios-release` | TestFlight upload auth | ASC Issuer ID (UUID) | Yes |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | `ios-release` | TestFlight upload auth | Base64 of `.p8` key content | Yes |

## Non-Secret CI Controls
| Control | Scope | Contract |
|---|---|---|
| `CI_FORCE_FULL` environment input | Local/direct impact-resolver invocation only | Optional broaden-only local resolver input. The trusted workflow does not read a repository variable by this name. |
| `ci:full` pull-request label | `trusted-selective-tests` | Optional broaden-only request for the complete registered matrix. |
| PR number manual input | `trusted-selective-tests` | Required for `workflow_dispatch`, which must run at ref `main`, resolve the PR's live head/base through the API, and force the complete registered matrix. |
| Trusted workflow authorization | `trusted-selective-freshness`, `pr-selective-tests`, and `trusted-selective-tests` | Protected-`main` freshness invalidates reusable success for owner-authored same-upstream PRs without candidate checkout; the hosted PR preflight uses `statuses: read` to await the pending description for its canonical exact-event fingerprint; the protected-default-branch `workflow_run` validates triggering-run and live-PR provenance before candidate checkout/self-hosted scheduling. Release/hotfix PRs force full, merge groups validate every associated live PR, and candidate/self-hosted jobs have only `contents: read`. Evidence pending. |
| Native secret target and workspace link | Each trusted selective native job | `ENV_FILE_CONTENT` is the initial step-environment transport consumed only by the atomic writer and immediately unset before Yarn, Gradle, `xcrun`, or recovery subprocesses. The bytes then exist only in a validated per-job mode-`0600` regular file below `$RUNNER_TEMP`; workspace `.env` is an absolute symlink to that exact target. Same-step normal/signal cleanup removes and verifies both; runner-temp cleanup and trusted next-checkout workspace sanitation are hard-kill defense-in-depth. |
| `MYCHAMPIONS_NATIVE_STATE_ROOT` service environment | Each persistent native runner while its host lock is held | Required absolute canonical path to runner-owned, non-symlink, mode-`0700` persistent state outside the workspace and `$RUNNER_TEMP`. Mac configured/read back 2026-07-29 at `/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery`; WSL intended at `/home/eduardo/.local/state/github-actions/mychampions-native-recovery`, pending endpoint recovery and service read-back. |
| Native ownership recovery ledger | Each persistent native runner while its host lock is held | Non-secret records below validated `MYCHAMPIONS_NATIVE_STATE_ROOT`; strict path/owner/mode/type/symlink/record validation; retains exact iOS namespace/UDID or Android PID/UID/start-time/AVD/port/serial/command evidence until verified absence. Never stores `.env`, its runner-temp target, or secret values. |
| Fork workflow approval | Repository Actions setting | Verified 2026-07-29: approval is required for all external contributors. |
| Default workflow token | Repository Actions setting | Verified 2026-07-29: default permission is read-only and workflows cannot approve pull requests. |
| Persistent-label operational boundary | Personal public repository and runner operations | Static labels can be targeted by any approved workflow and cannot use organization runner-group workflow allowlists. Keep the owner as sole collaborator, never approve fork/untrusted workflow changes, and pause runners before either condition changes. |
| Action policy | Repository Actions setting and workflow | Verified 2026-07-29: selected-actions mode allows GitHub-owned actions plus `oven-sh/setup-bun@*` and `r0adkll/upload-google-play@*`, disallows the general verified-creator category, and requires SHA pins; every checked-in `uses:` reference has a reviewed full commit SHA. |
| Main delivery ruleset | `main` | Must require pull requests, strict up-to-date branches, exact check `Hosted candidate preflight`, exact status `Selective CI gate`, conversation resolution, administrator enforcement, zero approvals, and no bypass. CODEOWNERS routes review only. Merge queue is unavailable to this personal public repository. Pending verified setting evidence. |

## Workflow Mapping
| Workflow | Role | Secrets |
|---|---|---|
| `trusted-selective-freshness.yml` | Protected-`main`, GitHub-hosted-only owner/upstream `pull_request_target` metadata invalidator; no candidate checkout | None |
| `pr-selective-tests.yml` | GitHub-hosted-only `pull_request` preflight for `main`, `release/**`, and `hotfix/**`, plus future-compatible `merge_group`; never checks out candidate code or targets self-hosted labels; uses `statuses: read` to await trusted freshness pending for its canonical exact-event fingerprint | None |
| `trusted-selective-tests.yml` | Protected-`main` authoritative workflow; accepts authorized `workflow_run`, direct `main` push, and `workflow_dispatch` at ref `main` with a live-resolved PR number and forced full selection; push publishes no PR gate; has no direct `merge_group`, release-branch, or hotfix-branch trigger; authorized release/hotfix PR workflow runs force full | `ENV_FILE` only in selected iOS/Android jobs; authorization, impact, fast-quality, web, and hosted status jobs use no repository secret |
| `android-pr.yml` | Manual-only legacy Android validation | `ENV_FILE` |
| `ios-pr.yml` | Manual-only legacy iOS validation | `ENV_FILE` |
| `web-pr.yml` | Manual-only legacy web validation | None |
| `android-release.yml` | Android signing and Play upload | `ENV_FILE`, `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_ALIAS_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON` |
| `ios-release.yml` | iOS signing and TestFlight upload | `ENV_FILE`, `IOS_KEYCHAIN_PASSWORD`, `IOS_DIST_CERT_P12_BASE64`, `IOS_DIST_CERT_PASSWORD`, `IOS_PROFILE_BASE64`, `IOS_PROFILE_NAME`, `IOS_TEAM_ID`, `APP_STORE_CONNECT_API_KEY_ID`, `APP_STORE_CONNECT_API_KEY_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT` |

## Configured Self-Hosted Runner Boundaries
| Selected lane | Exact labels | Required host capabilities | Current evidence status |
|---|---|---|---|
| Web | `self-hosted, Linux, X64, mychampions-ci, mychampions-web` | Repository-scoped Linux/WSL runner; Git and outbound access; Playwright browser/system dependencies; `unzip` for Bun bootstrap; capacity for Expo and the optional in-memory backend | Existing registration and browser launch probes are capacity evidence only; D-195 owner/trust/action/backend-SHA gates and exact-head browser proof remain pending |
| Android | `self-hosted, Linux, X64, mychampions-ci, mychampions-android` | Repository-scoped Linux/WSL runner; Android SDK/platform tools; hardware acceleration; `Pixel_10` AVD; Gradle wrapper support | Existing registration, KVM, preboot, and cleanup evidence is capacity evidence only; D-195 owner/trust/action/environment gates and exact-head emulator proof remain pending |
| iOS | `self-hosted, macOS, ARM64, mychampions-ci, mychampions-ios` | Repository-scoped Apple Silicon runner; Xcode 26 with iOS SDK 26+; disposable owned `iPhone 17` simulator UDID; CocoaPods; Homebrew path | Existing registration and toolchain evidence is capacity evidence only; D-195 owner/trust/action/environment/disposable-UDID gates and exact-head simulator proof remain pending |

## WSL Browser And Emulator Prerequisite Record

The unprivileged Ubuntu 24.04 runner keeps Playwright `1.61.1` / WebKit `2311`
runtime libraries under
`/home/eduardo/.local/playwright-libs-1.61.1-ubuntu24.04`. They were extracted
from official Ubuntu packages with `apt-get download` and `dpkg-deb -x`, without
altering system packages. A curated soname directory at
`/home/eduardo/.local/playwright-runtime-libs-1.61.1-ubuntu24.04` is first in
the runner `LD_LIBRARY_PATH`. `web-selected` uses the MyChampions-only browser
cache `/home/eduardo/.cache/ms-playwright-mychampions`; it does not mutate the
default cache used by Meer. After each browser install, the workflow makes the
isolated WPE and GTK MiniBrowser wrappers append a nonempty inherited path after
their bundled paths instead of replacing it.

Playwright validates `dlopen` dependencies only through the system `ldconfig`
inventory, which cannot discover these user-local libraries. After the complete
user-library closure was proved by launching headless WebKit from the same
systemd service environment, creating a page, and reading
`WEBKIT_SERVICE_PROBE=webkit-ready`, only the selected web job sets
`PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1`. The runner service does not set
that variable globally. Actual selected Playwright suites and owner-dispatched
full validation remain the runtime proof for every configured browser. Re-run
the service-context probe and rebuild the user-library closure
whenever Playwright, WebKit, or Ubuntu changes. The pre-change files remain
recoverable as:

- `/home/eduardo/actions-runner-mychampions-ci/.env.before-playwright-libs-20260729`

The earlier default-cache probe was fully reverted: its temporary WebKit marker
and MyChampions `.links` entry were removed, and both shared WPE/GTK launchers
were restored byte-for-byte from their
`MiniBrowser.before-user-libs-20260729` backups. The final MyChampions runtime
uses only its isolated browser cache.

The Ubuntu login user belongs to `kvm`, but the previously long-lived user
manager predated that membership. An idle user-manager restart refreshed the
persistent MyChampions service; both the manager and
`mychampions-ci-ubuntu` listener now include group ID `993`. A transient probe
started from that same service manager completed `emulator -accel-check` with
`KVM (version 12) is installed and usable`. This proves acceleration
availability, while the promotion PR remains the required exact-head Detox
proof after D-195's trusted-workflow and repository controls are verified.

The installed Android Emulator `36.6.11` booted `Pixel_10` successfully at
console port `5554`, and pinned Detox `20.47.0` reused that running AVD across
sequential specs. The selected workflow therefore restarts ADB only under the
existing job-hook lease, fails closed on stale emulator/QEMU or `5554/5555`
state, preboots the exact AVD with snapshots disabled and read-only state, and
bounds readiness to 120 seconds. Teardown targets `emulator-5554` and only a
saved PID whose runner UID, Linux start time, and command line still match the
captured owner and expected AVD/port, verifies all QEMU processes, emulator
devices, and owned ports disappear, and stops ADB; the workflow does not create
a second shell-level host lock.

## Shared Host Lock Operational Record

The Mac iOS lane and the WSL web/Android lanes share their physical hosts with
Meer runner services. Both pairs use GitHub runner job-started and job-completed
hooks to acquire and release one POSIX file lock per physical host. The start
hook waits at most 10,800 seconds and fails closed if ownership cannot be
established. A tokenized owner/holder fence binds the lease to the exact
`Runner.Worker` boot ID, start identity, and command identity so a killed worker
is recoverable without allowing an overlapping successor.

This lock is a resource-serialization boundary and defense-in-depth measure, not
an authorization or sandbox boundary. D-195 authorization belongs to the
protected-default-branch trusted workflow and its GitHub-hosted triggering-run
and live-PR validation before candidate checkout or self-hosted scheduling.

The host-owned hook files are installed at:

- macOS: `/Users/eduwaldo/.local/libexec/github-actions/`
- WSL: `/home/eduardo/.local/libexec/github-actions/`

The native recovery directory is supplied by the runner service, not derived
from a GitHub workspace variable. The macOS service environment was configured
and read back on 2026-07-29 with
`MYCHAMPIONS_NATIVE_STATE_ROOT=/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery`;
the directory is an absolute real runner-owned mode-`0700` path outside the
workspace and `$RUNNER_TEMP`. The intended WSL service value is
`MYCHAMPIONS_NATIVE_STATE_ROOT=/home/eduardo/.local/state/github-actions/mychampions-native-recovery`;
its configuration and read-back remain pending recovery of the current WSL
endpoint. Workflow access to either directory is permitted only while the
corresponding host lock is held.

The installed production hashes on both hosts are:

```text
69fd3be3dcca9c1a3bac5b64f36eca5ac910bff1a91f2237fe33b36b6badbf69  mobile-host-lock.py
343dafbca37a3a72d2ed7c4850d971dba09831b1e0cecee9e2832199275ceba3  mobile-host-lock-start.sh
e45740b98d4e0e6f7fbeeaed57b0533ed7a46f4dc70134c6a16a659e46b885d8  mobile-host-lock-completed.sh
```

The final implementation passed 12 complete Darwin and 12 complete WSL stress
suites: 96 behavioral scenarios and 384 contending jobs with zero overlap,
correct bounded-wait failure, crash fencing/recovery, and no live lease, holder,
owner, or prototype process afterward. Runner `.env` backups with the suffix
`.before-mobile-host-lock-20260728` preserve the pre-hook configuration.

`mychampions-ios-ci-m5` and the Meer Mac service run as launchd services.
`mychampions-ci-ubuntu` runs as an enabled and active user systemd service. The
WSL user has `Linger=no`, so reboot-survival is not claimed until a login starts
the user manager. The existing Meer WSL root service remains enabled but
inactive; its listener was restarted manually and must be checked as online
before relying on that peer. This known service-manager difference does not
weaken the shared hook lock while either listener is running.

The WSL runner path includes a user-local Ubuntu `unzip` 6.00 installation at
`/home/eduardo/.local/bin/unzip`. It is required by `oven-sh/setup-bun` and was
validated by extracting and executing Bun 1.3.10 without elevated privileges.
That prerequisite evidence does not satisfy D-195 until the action is referenced
by an approved full commit SHA and repository policy enforces the pin.

Runner registration tokens are ephemeral bootstrap credentials and must not be
stored in repository secrets, issue comments, screenshots, or logs.

## D-195 Promotion Security Gates

All rows below are promotion and merge gates. `Pending verification` means this
document defines the required target but does not claim that the live host,
workflow, or repository setting currently satisfies it. Dated `Verified` rows
record repository-setting or checked-in evidence read back on that date; ongoing
operational conditions must remain true through promotion and persistent-runner
operation.

| Gate | Required evidence | Status |
|---|---|---|
| Trusted workflow provenance | Read-only workflow/run evidence proves `trusted-selective-freshness.yml` is registered on protected default `main`, runs hosted-only through `pull_request_target`, and checks out no candidate code; PR preflight bases are limited to `main`, `release/**`, and `hotfix/**`, merge-group preflight is hosted-only, and `trusted-selective-tests.yml` is loaded from protected default branch `main`. It has no direct merge-group/release/hotfix/schedule trigger, release/hotfix PRs force full, push resolves from `main` without publishing the PR gate, and manual dispatch is accepted only at ref `main` with a live-resolved PR number and forced full selection | Pending verification |
| Authorization and stale-run rejection | Negative probes cover fork upstream, actor/triggering-actor/sender mismatch, wrong workflow path/ref/SHA, wrong event/ref, malformed triggering data, live API head mismatch, and a PR whose head moves after preflight; merge-group evidence validates every associated live PR; every rejection occurs before candidate checkout/self-hosted scheduling, while one exact owner-authored upstream case proceeds | Pending verification |
| Token permission isolation and status publication | Workflow/job permissions prove candidate/self-hosted jobs have only `contents: read`; only the hosted freshness invalidator, authorization/status initializer, and finalizer have `statuses: write`; the preflight has `statuses: read`. Freshness posts the pending description for the canonical exact-event fingerprint before preflight completion, then authorized validation publishes run-owned pending and success/failure for exact context `Selective CI gate`; fork/unidentifiable denial publishes no status | Pending verification |
| Status concurrency and SHA uniqueness | The freshness workflow uses stable per-pull-request `cancel-in-progress: true` to coalesce superseded metadata work before its writer job enters the repository-global queue; all three writer jobs share `queue: max` serialization; same-PR/head validation reruns share stable cancellation; initializer/finalizer require one unique eligible open, ready, owner-authored upstream PR for the head; final publication proves the latest pending target is still owned by that run, so a `ci:full` label change cannot leave or overwrite stale success | Pending verification |
| Fork approval | Read-only repository-setting evidence shows approval required for all external contributors | Verified 2026-07-29: `all_external_contributors` |
| Repository workflow-token defaults | Read-only repository-setting evidence shows default workflow-token permission is read-only and workflows cannot approve pull requests | Verified 2026-07-29 |
| Public-runner operational boundary | Read-only collaborator/settings evidence shows `edufelip` is the sole collaborator and all external workflows require approval; operations require that fork/untrusted workflow changes are never approved and that collaborators/approvals cannot expand until runners are paused for private-broker/JIT/ephemeral redesign | Current roster/settings verified 2026-07-29; ongoing operational gate |
| Action supply chain | Every workflow `uses:` entry resolves to a reviewed full commit SHA; read-only policy evidence shows selected-actions allowlisting and SHA pinning required | Verified 2026-07-29: GitHub-owned actions plus `oven-sh/setup-bun@*` and `r0adkll/upload-google-play@*`; general verified-creator allowance disabled |
| Coordinated backend provenance | Run resolves one 40-character `mychampions-api` object ID, checks out that detached SHA even if the branch moves, and records it with the mobile head | Pending verification |
| Native environment lifecycle | Static evidence must show each native creation/use step arms `EXIT`/`INT`/`TERM` before the atomic writer consumes the initial `ENV_FILE_CONTENT` step environment, creates the validated per-job mode-`0600` secret target below `$RUNNER_TEMP`, and exposes workspace `.env` only as an absolute symlink to that target. The shell immediately unsets `ENV_FILE_CONTENT` before Yarn, Gradle, `xcrun`, or recovery subprocesses. Long commands run as supervised isolated process groups behind interruptible waits whose outer grace covers coordinator detached-group `TERM`/`KILL` and fallback cleanup. Executable contracts must send both signals through that nested path and verify bounded `130`/`143` exit, link/target removal, and child termination. Live success, failure, mid-build cancellation, and mid-test cancellation must prove both entries absent within GitHub's 7.5-second plus 2.5-second grace window before lease release, with no value in logs/artifacts or the recovery ledger. Trusted next-checkout sanitation and runner-temp cleanup are hard-kill defense-in-depth only | Pending executable secret-lifecycle/recovery and live cancellation verification |
| Native device ownership and stale recovery | Runner services must provide `MYCHAMPIONS_NATIVE_STATE_ROOT` as an absolute canonical runner-owned non-symlink mode-`0700` directory outside the workspace and `$RUNNER_TEMP`; the ledger is accessed only under the host lock and passes directory/file owner/mode/type/no-symlink, completeness, and strict field validation. Mac configuration/read-back is verified 2026-07-29 at `/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery`; the WSL intended value `/home/eduardo/.local/state/github-actions/mychampions-native-recovery` remains pending endpoint recovery. Creation has no unowned interruption gap: iOS persists a workflow namespace before UUID handoff; Android durably captures exact PID/UID/start-time/AVD/port/serial/command identity cancellation-safely. Records survive cleanup failure and the next locked run must revalidate and recover the exact stale resource before creating another; only verified absence permits record removal. Executable signal/pre-metadata/failure/retry fixtures and live success, failure, mid-build, and mid-test cancellation must preserve unrelated resources and prove exact process/device/serial/port absence or retained fail-closed recovery evidence. Broad cleanup is prohibited; later `if: always()` verification and host hooks are defense-in-depth/resource locks only | Mac service path configured/read back 2026-07-29; WSL service path, executable recovery, and live cancellation verification pending |
| Main enforcement | Read-only ruleset/branch evidence shows pull requests, strict up-to-date branches, exact check `Hosted candidate preflight`, exact status `Selective CI gate`, conversation resolution, administrator enforcement, zero approvals, and no direct bypass; CODEOWNERS is routing only. Evidence records that merge queue is unavailable to this personal public repository | Pending verification |
| Promotion run/storage | Complete web/iOS/Android matrix passes on the exact candidate head after the preceding gates; successful run has zero Actions artifacts/caches and failure diagnostics, if any, remain bounded/redacted with one-day retention | Storage baseline verified 2026-07-29 at 0 artifacts / 0 caches after failure cleanup; exact-head promotion run pending |

## Setup And Evidence Checklist
1. Implement and verify every D-195 promotion gate above without printing
   registration tokens, environment contents, or other credentials.
2. Add only the secrets required by the workflow being validated.
3. Verify the registered runner names, exact labels, service state,
   resource-lock hashes, and empty lock state before an authoritative run. Treat
   host hooks as serialization/defense-in-depth evidence only.
4. Preserve the verified sole-collaborator roster, all-external approval,
   read-only default token, disabled workflow PR approval, selected-actions
   allowlist, and SHA-pinning settings. Record the stop condition: pause both
   persistent runners before adding a collaborator or approving an external
   workflow change.
5. Use the manual-only Android, iOS, and web workflows for isolated validation
   when useful; do not treat them as the pull-request gate.
6. Prove the protected-`main` freshness workflow registration and one live
   exact-event fingerprint handshake with the hosted preflight,
   GitHub-hosted-only preflight, protected-`main` trusted workflow
   provenance, authorization negatives, live-head stale-run rejection, token
   isolation, freshness/run-owned pending plus terminal publication, global
   freshness per-PR cancellation before job-level max-queue writer
   serialization, unique eligible-PR binding, and same-PR/head validation
   cancellation under a `ci:full` label rerun. Verify strict up-to-date plus both
   required gate names, then run the authoritative workflow against the exact
   promotion head with full selection and record every selected lane result
   before making the gate required.
7. Verify `MYCHAMPIONS_NATIVE_STATE_ROOT` in each runner service and read back an
   absolute canonical runner-owned non-symlink mode-`0700` path outside the
   workspace and `$RUNNER_TEMP`; WSL remains pending endpoint recovery. Prove
   the initial `ENV_FILE_CONTENT` transport is consumed only by the atomic
   runner-temp writer and unset before later subprocesses, then prove the
   runner-temp target/workspace-link lifecycle, next-checkout sanitation,
   outer-supervisor/coordinator detached-group cancellation, hardened persistent
   native ledger, interruption-safe ownership handoff, retained cleanup-failure
   records, and next-run exact stale-resource recovery through executable
   fixtures. Then collect live success, failure, mid-build, and mid-test evidence
   on both native hosts without exposing secret values.
8. Preserve the verified zero-artifact/zero-cache baseline, then confirm the
   exact-head green selective run also leaves zero Actions artifacts and zero
   Actions caches. If failure diagnostics exist, verify their path is bounded,
   their retention is one day, and they are removed before final promotion.
9. Validate Android/iOS release workflows only through an explicitly approved
   release test because they sign and upload store binaries.
10. Rotate secrets on certificate/profile renewal and update this matrix if
   names, scopes, runner labels, or workflow responsibilities change.
