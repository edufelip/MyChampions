# Selective Feature Test Execution

## Current rollout state

The feature-aware workflows implement the candidate selection/execution and
stable-status contract. D-193 approves that model without claiming that the
former two-week, 20-pull-request shadow window completed. D-195 separately
blocks persistent-runner promotion and merge until the trusted-workflow,
repository-policy, provenance, cleanup, and enforcement controls below are
implemented and verified.

`.github/workflows/trusted-selective-freshness.yml` is the protected-`main`,
GitHub-hosted-only `pull_request_target` metadata invalidator. It checks out no
candidate code and posts event-fingerprinted freshness pending only for a live
owner-authored same-upstream pull request.
`.github/workflows/pr-selective-tests.yml` is the GitHub-hosted-only
`pull_request` preflight for bases `main`, `release/**`, and `hotfix/**`, plus
future-compatible `merge_group`; it never checks out candidate code or targets
self-hosted labels, and its pull-request job has only `statuses: read` while it
waits for the pending description matching the canonical fingerprint of its
exact event.
`.github/workflows/trusted-selective-tests.yml` is the
authoritative workflow: pull-request execution enters through `workflow_run`,
whose definition GitHub loads from protected default branch `main`, while
direct `main` push and daily-schedule executions run from `main` without
publishing the SHA-global pull-request context. Manual execution
must dispatch at ref `main`, accept a PR number, resolve its live head/base, and
force full selection. The trusted workflow has no direct `merge_group` trigger;
its workflow-run authorization validates every associated live PR. It also has
no direct release/hotfix trigger; authorized same-upstream owner PRs targeting
those bases enter through the hosted preflight and force the full matrix. The
legacy Android, iOS, and web PR workflows are manual-only. The repository-scoped Mac
and WSL runners and stress-proven
host-wide resource locks establish capacity and serialization, not
authorization or sandboxing. Promotion still requires TC-519's trusted-workflow
provenance, authorization-negative, stale-run, permission-isolation, exact
status, repository-setting, and complete exact-head matrix evidence.

## Sources of truth

- `config/test-impact.json`: feature paths, dependencies, owners, shared rules,
  suites, platforms, executable fixture profiles, and CI eligibility.
- `scripts/ci/test-impact.ts`: validation, matching, graph construction, and
  conservative impact resolution.
- `scripts/ci/execute-selected-tests.ts`: allowlisted, argument-safe execution
  of selected Playwright and Detox suites.
- `scripts/ci/metro-bundle-prewarm.ts`: platform-specific Expo bundle readiness
  and full response-stream verification before native test launch.
- `scripts/ci/metro-process-group.ts`: owned-member Metro termination and
  fail-closed process-group verification.
- `scripts/ci/detox-fixture-profiles.ts`: isolated Detox phase contracts.
- `.github/workflows/trusted-selective-freshness.yml`: protected-`main`,
  GitHub-hosted-only owner/upstream pull-request metadata invalidation with no
  candidate checkout.
- `.github/workflows/pr-selective-tests.yml`: GitHub-hosted-only pull-request
  preflight for `main`, `release/**`, and `hotfix/**`, plus merge-group
  preflight; it never checks out or executes candidate code and waits for
  the trusted pending description for its canonical exact-event fingerprint with
  `statuses: read`.
- `.github/workflows/trusted-selective-tests.yml`: protected-default-branch
  authorization, exact-head resolution, universal fast checks, selected lanes,
  full fallbacks, and isolated final commit-status publication.
- `.github/CODEOWNERS`: review routing aligned with feature paths; it is not a
  required-approval boundary for the sole author.
- `docs/discovery/ci-secrets-matrix-v1.md`: D-195 workflow/repository promotion
  controls, evidence status, secret lifecycle, and runner boundaries.

## Resolution contract

For pull requests, the resolver computes the Git merge base and uses:

```bash
git diff --name-status -M -C --find-copies-harder <merge-base> <head>
```

Rename and copy entries contribute old and new paths; deletion entries retain
the deleted path. The affected feature set is the union of direct path owners,
suite owners, reverse TypeScript import consumers from both base and head graphs,
and transitive reverse dependents declared by the manifest.
A direct change to a registered suite spec selects that suite when it is
CI-eligible, even if no feature references it; non-CI provider/evidence suites
remain excluded.

A normal feature change selects only its affected Playwright and Detox suites.
Every selected Detox suite runs on both declared mobile platforms. Shared
navigation, localization, global design tokens, native/tooling configuration,
workflow or resolver changes, invalid metadata, unmapped runtime paths, Git
resolution errors, or more than 500 changed files select the complete registered
CI matrix. `merge_group`, scheduled runs, release/hotfix PRs, and `ci:full`
also force the complete matrix. The `CI_FORCE_FULL` environment input remains
available only to local/direct resolver invocation; the trusted gate does not
read a repository variable by that name. These controls may only
broaden selection. A complete-matrix decision selects every suite registered
with `ci: true`, including CI suites that are not referenced by a feature.
Detox suites enter only the platform lanes declared by their `platforms` field;
non-CI provider-live and evidence suites remain excluded.

Unowned documentation-only changes run universal fast checks and no expensive
UI lane.

## Execution contract

The trusted workflow transports suite IDs through validated JSON job outputs; it
does not upload an impact artifact. Before candidate checkout or self-hosted
scheduling, its GitHub-hosted authorization job validates the triggering
workflow run against the live pull-request API. Before a command is spawned, the
executor rejects empty, duplicate, unknown, non-CI, provider-live, wrong-runner,
wrong-platform, or invalid-profile selections.

Web suites are grouped by Playwright configuration and browser project. Shared
specs and grep tags are deduplicated. The coordinated `mychampions-api` checkout
is installed only when a selected suite uses the server-backed configuration.
For D-195 promotion, branch selection resolves once to a 40-character commit
SHA; the lane checks out that detached object and records it alongside the
mobile exact head. Branch movement after resolution must not change the tested
backend. This exact-SHA behavior remains a pending promotion gate until verified.

iOS uses `ios.sim.debug`; Android uses `android.emu.debug`/`devDebug` so the
dev-only deterministic fixture harness remains enabled. Each native job builds
once, then runs isolated fixture phases with a freshly owned Metro process and
explicit environment. Runtime phase values take precedence over the app config
embedded by the one-time native build; an explicit empty runtime value clears a
fixture from the preceding phase. The Metro status endpoint proves only that the
listener exists. The executor next requests the platform-specific Expo magic
development-bundle URL and fully consumes its rewritten response before spawning
Detox, so the first screen wait never owns a cold transform. The cold transform
has a bounded four-minute request window; a timeout, non-success response,
missing or empty body, interrupted stream, or Metro exit after prewarming fails
the phase and still enters owned-process cleanup. Stories
that require contradictory fixture
states run as separate scenario-gated phases: the AI meal-analysis spec runs
once with both AI and professional entitlement access lapsed and once with both
active, so no invocation observes an impossible mixed expectation. An
authenticated direct run with a missing or invalid AI-analysis scenario fails
immediately instead of reporting both expectations as skipped. Custom-meal image
upload likewise runs once with the synthetic upload fixture cleared to exercise
the native source sheet and once with the success fixture enabled to prove the
preview; only the assertion matching `E2E_IMAGE_UPLOAD_SCENARIO` executes, and
authenticated missing or invalid scenarios fail closed. The student dashboard
and relationship stories launch a fresh app instance with
synchronization disabled in `launchArgs` for every case; Android CI-eligible
Detox specs must not call `reloadReactNative()` across the native idling
registry. The iOS job reserves dedicated non-ephemeral Metro port `18081` and
rejects an existing listener before the one-time native build. The Debug build
compiles that value through `RCT_METRO_PORT`, and Detox's app-level
`RCT_jsLocation` launch argument routes every fresh app instance to the same
port while merging with per-story launch arguments. The executor independently
validates and forwards `DETOX_METRO_PORT` to prewarming and every phase, so an
unrelated listener on the local default `8081` remains untouched; a listener on
the dedicated port still fails closed. Before each Android instrumented launch,
`DetoxTest` synchronously
sets React Native's `debug_http_host` to `localhost:8081` and aborts if the
preference cannot be persisted. Together with the `reversePorts: [8081]`
setting in `.detoxrc.js`, this keeps Metro traffic on ADB's proven reverse tunnel
instead of the emulator's `10.0.2.2` gateway. Native selective phases explicitly
suppress the in-app development
LogBox notification overlay while retaining warning text in runner logs and
failure diagnostics, so diagnostics cannot intercept stable Detox action
targets. Tests scroll lower auth actions into view before interaction so the
same contract holds on the configured compact Android viewport. On macOS,
process-group probing can return
`EPERM` when even one group member has another UID. The cleanup fallback reads
the numeric process table, signals only runner-UID group members, verifies TERM
and KILL outcomes, and separately proves that the Metro port closed. Foreign
processes are never signaled, while a surviving runner-owned member or listener
fails the lane. CI also fails if a selected Detox invocation skips every test.
`detox:revenuecat-live` remains manual/provider-live and is never PR-eligible.
For D-195 promotion, each native creation/use step arms idempotent `EXIT`, `INT`,
and `TERM` handlers before materializing secrets or acquiring a native device.
`ENV_FILE_CONTENT` is only the initial GitHub step-environment transport into
the atomic secret writer. The owning shell unsets it immediately after that
writer returns and before invoking Yarn, Gradle, `xcrun`, or any recovery
subprocess. From that point until cleanup, secret bytes exist only in the exact
validated per-job mode-`0600` regular file below `$RUNNER_TEMP`; workspace
`.env` is an absolute symlink to that exact target. Normal/signal cleanup
removes the link without following it, removes the exact target, and verifies
both absent. Runner-temp teardown is hard-kill defense-in-depth, and the next
trusted checkout/preflight removes and verifies absence of any unexpected
workspace `.env` entry or fails closed. Long build/test commands run as
supervised isolated process groups behind an interruptible shell wait so a
runner signal reaches trusted cleanup instead of remaining deferred behind a
foreground child. The outer supervisor's bounded grace covers the coordinator's
own detached invocation/Metro process-group `TERM`/`KILL` cleanup and the outer
fallback, and the executable cancellation fixture must exercise that complete
nested path. The signal path terminates only the supervised groups and performs
bounded fast exact-device cleanup within GitHub's documented 7.5-second
`SIGINT` plus 2.5-second `SIGTERM` grace window. Normal exit performs the full
absence proof.
Non-secret device ownership needed after job teardown lives in a
permission-hardened runner-local persistent directory named by the runner
service environment variable `MYCHAMPIONS_NATIVE_STATE_ROOT`. It must be an
absolute canonical, runner-owned, non-symlink directory with mode `0700`,
outside the workspace and `$RUNNER_TEMP`, and never alongside `.env`, its
runner-temp target, or secrets. Only a host-lock holder may read or mutate it,
after validating that directory plus every ledger file's owner, mode, type,
no-symlink status, completeness, and strict numeric/UUID/name fields. The Mac
service value
`/Users/eduwaldo/.local/state/github-actions/mychampions-native-recovery` was
configured and read back on 2026-07-29. The intended WSL service value is
`/home/eduardo/.local/state/github-actions/mychampions-native-recovery`; its
configuration/read-back remains pending recovery of the current WSL endpoint.

The iOS lane persists a unique workflow-owned name/namespace before creation,
then records the exact returned UDID; Android makes launch-to-PID capture and
durable PID/UID/Linux-start-time plus expected AVD/port/serial/command handoff
cancellation-safe. The next locked run consumes and revalidates any stale record
before creating a device. Cleanup removes a record only after exact resource
absence is proved; failure retains evidence and fails closed. Global
`simctl shutdown all`, `pkill`, arbitrary QEMU signaling, and unrelated
ADB/device mutation are prohibited. Later `if: always()` verification is
defense-in-depth and host hooks remain resource-lock-only.

Executable workflow-contract fixtures must cover `SIGINT` and `SIGTERM`,
interruption before ownership handoff, cleanup failure with retained metadata,
next-run exact recovery, malformed/incomplete record rejection, bounded
`130`/`143` exit, workspace-link and runner-temp secret-target removal,
supervised-child termination, and unrelated-resource preservation. Local
fixtures are not live runner cancellation proof: promotion still requires live
mid-build and mid-test cancellations on both hosts.

## Fast and expensive checks

Universal fast checks are:

```bash
yarn test:impact
yarn test:unit
yarn lint
yarn tsc --noEmit
git diff --check <merge-base> <head>
```

Expensive jobs run only when selected:

- WSL web: web export plus selected Playwright suites. Its browser binaries live
  in a MyChampions-only cache; a post-install guard updates only the isolated
  WebKit launchers to inherit user-local libraries, and the job-scoped static
  validation bypass remains accountable to actual browser-suite execution.
- macOS: one iOS debug build plus selected iOS Detox phases. D-195 promotion
  additionally requires one recorded disposable simulator UDID and targeted
  shutdown/deletion that leaves unrelated simulators untouched.
- WSL Android: Gradle lint/unit checks, one `devDebug` app/test build, and
  selected Android Detox phases. After rejecting stale device/QEMU/console
  state, the job preboots `Pixel_10` at `emulator-5554`, requires its saved
  PID/UID/Linux start time and AVD/port command identity, exact serial, AVD name,
  and completed boot within 120 seconds, and lets Detox reuse it. In-step and
  always-run teardown target only that serial and revalidated process and fail
  if any QEMU process, emulator device, or `5554/5555` listener remains.

The Android lint boundary is part of the gate. API-33 splash-only attributes
live in `values-v33`, camera hardware is optional because manual invite entry
remains available, and the manifest declares the notification capability used
by the Expo video playback service.

`mychampions-ios-ci-m5` serves the Mac lane and
`mychampions-ci-ubuntu` serves both WSL lanes. Each runner service accepts one
job at a time, and repository concurrency prevents same-platform overlap.
GitHub runner started/completed hooks additionally serialize MyChampions and
Meer across each physical host. The lock has a 10,800-second bounded wait,
token-scoped release, exact-worker identity fencing, and crash recovery. Its
frozen hashes, stress evidence, service posture, recovery backups, required
labels, and host capabilities are tracked in
`docs/discovery/ci-secrets-matrix-v1.md`. This resource lock does not authorize
job provenance and is not a sandbox.

## D-195 persistent-runner promotion contract

The following controls are normative targets and remain pending until TC-519
records workflow/run, repository, host-resource, and exact-head evidence:

- The supported `pull_request`/`merge_group` preflight is GitHub-hosted-only,
  has no candidate checkout, and never targets self-hosted labels. The supported
  candidate path dispatches from `trusted-selective-tests.yml`, loaded from
  protected default branch `main` after the preflight completes through
  `workflow_run`.
- Before that pull-request preflight completes,
  `trusted-selective-freshness.yml` runs from protected `main` through
  `pull_request_target`, checks out no candidate code, and posts freshness
  event-fingerprinted pending only for a live owner-authored same-upstream pull
  request. The preflight has only `statuses: read` and waits until the pending
  status for its exact event fingerprint is visible.
- Before candidate checkout or self-hosted scheduling, a GitHub-hosted
  authorization job validates the triggering run against the live PR API:
  current exact head SHA, same upstream/base repository, owner actor,
  triggering actor, sender, workflow path/ref/SHA, and allowed event/ref.
  Missing, malformed, fork, identity-mismatch, workflow-mismatch, live-head
  mismatch, and stale runs fail closed. Trusted direct event paths resolve the
  workflow from `main` and receive equivalent authorization. Push and schedule
  validations never publish the SHA-global pull-request gate.
- Merge-group authorization validates every associated live pull request for
  same-upstream owner provenance. The trusted workflow has no direct
  `merge_group` trigger. This is future-compatible coverage: GitHub merge queues
  are unavailable to the current personal public repository, whose merge
  enforcement uses strict up-to-date branches. Manual execution requires `workflow_dispatch` at ref
  `main`, a PR number resolved through the live API, and forced full selection.
- Live same-upstream owner PRs targeting `release/**` or `hotfix/**` enter
  through the hosted preflight, use the protected-`main` trusted workflow, and
  force full selection. The trusted workflow is never sourced or directly
  triggered from those target branches.
- Candidate and self-hosted jobs have only `contents: read`. Only the trusted
  GitHub-hosted freshness invalidator, authorization/status initializer, and
  always-run finalizer have `statuses: write`; all three share the
  repository-global `mychampions-selective-status-writer` group with
  `queue: max`. The initializer and finalizer each require exactly one eligible
  open, ready, owner-authored same-upstream pull request for the exact head. The
  finalizer publishes success or failure only while the latest
  `Selective CI gate` status remains its run-owned in-progress pending target.
  Fork or unidentifiable authorization denial publishes no candidate status.
- Per-PR/head validation concurrency cancels superseded validation work, while
  the freshness workflow's stable per-pull-request
  `cancel-in-progress: true` coalesces superseded metadata work before its job
  enters the repository-global writer queue. Job-level max-queue serialization
  prevents pending invalidation, initialization, or finalization writes from
  being replaced. The finalizer validates owned latest pending status rather
  than a generic current-run identity, so an older run cannot overwrite a newer
  status cycle.
- Host started/completed hooks serialize shared resources and add
  defense-in-depth only; they do not authorize a candidate. GitHub requires
  approval for all external fork contributors. The 2026-07-29 settings read-back
  verifies that approval mode, a read-only default workflow token, and disabled
  workflow pull-request approval.
- Static repository-scoped runner labels are nevertheless targetable by any
  GitHub-approved workflow. Personal repositories lack organization runner-group
  workflow allowlists, and stock hooks cannot supply that boundary. Persistent
  operation therefore requires `edufelip` to remain the sole collaborator and
  fork or untrusted workflow changes never to be approved. Before adding a
  collaborator or approving an external workflow change, pause the runners and
  replace this operational boundary with a private broker, JIT, or ephemeral
  runners.
- Every action uses a reviewed full commit SHA, with the repository action
  allowlist and SHA-pinning policy enabled. The 2026-07-29 policy read-back
  verifies selected-actions mode, GitHub-owned actions plus
  `oven-sh/setup-bun@*` and `r0adkll/upload-google-play@*`, no general
  verified-creator allowance, and required SHA pinning.
- A server-backed web lane resolves and records one exact backend SHA before
  install. Each native creation/use step arms idempotent `EXIT`, `INT`, and
  `TERM` before atomically writing a mode-`0600` per-job secret target below
  `$RUNNER_TEMP` and linking workspace `.env` to it by absolute path.
  `ENV_FILE_CONTENT` is unset immediately after the atomic writer and before
  Yarn, Gradle, `xcrun`, or recovery subprocesses. The lane then supervises long
  commands in isolated process groups behind interruptible waits. Its bounded
  signal path removes/verifies both link and target, gives the coordinator time
  to terminate its detached invocation/Metro groups with `TERM`/`KILL`, applies
  the outer exact-group fallback, and cleans the exact owned device within the
  runner's ten-second grace window; the executable cancellation fixture covers
  that nested cleanup.
- Normal exit performs the full iOS exact-UDID or Android exact-emulator absence
  proof. Later `if: always()` verification is defense-in-depth, not the
  cancellation guarantee; host hooks are resource-lock-only. Device recovery
  records use the validated service-provided
  `MYCHAMPIONS_NATIVE_STATE_ROOT` outside the workspace and `$RUNNER_TEMP`, only
  while the host lock is held; they survive cleanup failure and are removed
  only after verified absence. Before any new device, the next lock holder
  revalidates and recovers the exact stale resource or fails closed. Executable
  signal, pre-metadata-interruption, cleanup-failure, and retry fixtures plus
  live mid-build and mid-test cancellations on both native hosts remain
  required. `main` requires a pull request, strict up-to-date branches, exact check
  `Hosted candidate preflight`, exact status `Selective CI gate`, conversation
  resolution, administrator enforcement, zero approvals, and no bypass.
  CODEOWNERS provides routing and visibility only because the sole author cannot
  self-approve.

Checked-in workflow text, runner registration, resource-lock stress results, or
an otherwise green matrix do not independently satisfy this promotion contract.
The freshness and authoritative workflow files must first be registered on
default `main`; one live exact-event-fingerprint freshness/preflight handshake
must pass before the preflight becomes required.

## Local validation

```bash
yarn test:impact
yarn test:impact:resolver
yarn test:impact:resolve --base main --head HEAD
SELECTED_SUITES_JSON='["web:auth"]' yarn test:impact:execute --platform web --plan
SELECTED_SUITES_JSON='["detox:auth"]' yarn test:impact:execute --platform ios --plan
SELECTED_SUITES_JSON='["detox:auth"]' yarn test:impact:execute --platform android --plan
```

The resolver writes local evidence under `.artifacts/test-impact/`. These files
are ignored and are summarized in the Actions step summary, not uploaded.

## Storage and rollback

Green PR runs upload no build, impact, web-export, or UI-test artifact and create
no GitHub Actions cache. On failure, only redacted diagnostics under
`.artifacts/ci-diagnostics/<platform>` may be uploaded, with one-day retention.
Native binaries, Pods, DerivedData, `node_modules`, home caches, and environment
files are excluded. For D-195 promotion, secret bytes exist only while required
in the validated mode-`0600` per-job target below `$RUNNER_TEMP`; workspace
`.env` is only its absolute symlink. `ENV_FILE_CONTENT` transports the value only
to the atomic writer and is unset before later subprocesses. Same-step handlers
remove/verify both before the resource lease is released, and neither enters the
persistent non-secret device recovery ledger under
`MYCHAMPIONS_NATIVE_STATE_ROOT`. Long commands must be supervised behind
interruptible waits whose outer grace includes coordinator detached-group
cleanup. Success, failure, and live mid-build/mid-test cancellation evidence
must prove link and target absence within the runner grace window. Device records
are removed only after exact absence; failure retains them for the next locked
recovery. Later `if: always()` and runner-temp cleanup are defense-in-depth only.

If any full or authoritative run finds a reproducible omission, pause promotion,
apply the `ci:full` label or use owner `workflow_dispatch` for full coverage, fix
the ownership/dependency/profile metadata with a regression test, and prove a
full exact-head run before restoring selective enforcement. `CI_FORCE_FULL`
remains a local/direct-resolver environment input, not a repository-variable
control in the trusted workflow.

## Acceptance examples

- A feature-A-only source change selects A, its reverse dependents, and their
  registered web/iOS/Android suites; unrelated B suites do not run.
- `app/_layout.tsx`, localization, native configuration, global tokens, workflow
  changes, or invalid metadata select every registered CI suite in the full
  applicable matrix, including an otherwise unowned suite.
- A design-system component change widens through actual reverse importers.
- Renames/copies use old and new ownership; deletions preserve old ownership.
- Documentation-only changes run fast checks and skip expensive lanes.
- A selected lane that is skipped, empty, invalid, or provider-live makes the
  stable gate fail.
- A fork, identity mismatch, wrong workflow path/ref/SHA, disallowed event/ref,
  malformed trigger, live-head mismatch, or PR head moved after preflight is
  rejected by hosted authorization before candidate checkout or self-hosted
  scheduling.
- Candidate/self-hosted jobs cannot publish statuses; trusted hosted freshness,
  initialization, and finalization publish exact-event-fingerprinted freshness
  pending, run-owned pending, then terminal
  `Selective CI gate` on the authorized candidate SHA.
- A same-head `ci:full` label rerun cancels the superseded run and cannot leave
  or overwrite stale success.
- Moving the coordinated backend branch after resolution does not change the
  recorded detached SHA, and iOS cleanup deletes only the owned simulator UDID.
