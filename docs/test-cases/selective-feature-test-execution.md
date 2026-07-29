# Selective Feature Test Execution

## Current rollout state

The feature-aware workflow is the authoritative pull-request gate. Promotion was
explicitly approved in D-193; it does not claim that the former two-week,
20-pull-request shadow window completed. The promotion change itself touches CI
infrastructure and therefore must run the full registered matrix before merge.

The stable gate runs for pull requests targeting `main`, `release/**`, and
`hotfix/**`, pushes to `main`, merge queues, the daily scheduled full run, and
manual dispatch. The legacy Android, iOS, and web PR workflows are manual-only.
The repository-scoped Mac and WSL runners are registered and their services use
stress-proven host-wide locks shared with Meer. The promotion pull request still
must prove the complete matrix on its exact head before merge.

## Sources of truth

- `config/test-impact.json`: feature paths, dependencies, owners, shared rules,
  suites, platforms, executable fixture profiles, and CI eligibility.
- `scripts/ci/test-impact.ts`: validation, matching, graph construction, and
  conservative impact resolution.
- `scripts/ci/execute-selected-tests.ts`: allowlisted, argument-safe execution
  of selected Playwright and Detox suites.
- `scripts/ci/metro-process-group.ts`: owned-member Metro termination and
  fail-closed process-group verification.
- `scripts/ci/detox-fixture-profiles.ts`: isolated Detox phase contracts.
- `.github/workflows/pr-selective-tests.yml`: exact-head resolution, universal
  fast checks, selected lanes, full fallbacks, and the stable gate.
- `.github/CODEOWNERS`: review ownership aligned with feature paths.

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
CI matrix. `merge_group`, scheduled runs, release/hotfix PRs, `ci:full`, and
`CI_FORCE_FULL=true` also force the complete matrix. These controls may only
broaden selection. A complete-matrix decision selects every suite registered
with `ci: true`, including CI suites that are not referenced by a feature.
Detox suites enter only the platform lanes declared by their `platforms` field;
non-CI provider-live and evidence suites remain excluded.

Unowned documentation-only changes run universal fast checks and no expensive
UI lane.

## Execution contract

The workflow transports suite IDs through validated JSON job outputs; it does
not upload an impact artifact. Before a command is spawned, the executor rejects
empty, duplicate, unknown, non-CI, provider-live, wrong-runner, wrong-platform,
or invalid-profile selections.

Web suites are grouped by Playwright configuration and browser project. Shared
specs and grep tags are deduplicated. The coordinated `mychampions-api` checkout
is installed only when a selected suite uses the server-backed configuration.

iOS uses `ios.sim.debug`; Android uses `android.emu.debug`/`devDebug` so the
dev-only deterministic fixture harness remains enabled. Each native job builds
once, then runs isolated fixture phases with a freshly owned Metro process and
explicit environment. Runtime phase values take precedence over the app config
embedded by the one-time native build; an explicit empty runtime value clears a
fixture from the preceding phase. On macOS, process-group probing can return
`EPERM` when even one group member has another UID. The cleanup fallback reads
the numeric process table, signals only runner-UID group members, verifies TERM
and KILL outcomes, and separately proves that the Metro port closed. Foreign
processes are never signaled, while a surviving runner-owned member or listener
fails the lane. CI also fails if a selected Detox invocation skips every test.
`detox:revenuecat-live` remains manual/provider-live and is never PR-eligible.

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
- macOS: one iOS debug build plus selected iOS Detox phases.
- WSL Android: Gradle lint/unit checks, one `devDebug` app/test build, and
  selected Android Detox phases.

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
`docs/discovery/ci-secrets-matrix-v1.md`.

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
files are excluded.

If any full or authoritative run finds a reproducible omission, set the
repository variable `CI_FORCE_FULL=true`, fix the ownership/dependency/profile
metadata with a regression test, prove a full exact-head run, and only then
remove the override.

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
