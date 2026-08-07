# Task Card: Parallel CI optimization

## Status

Current bucket: Implementation
Risk level: High (CI workflow, runner registration, and secret lifecycle)
Owner: Codex
Blocked by: None
Human approval required: Yes — approved by the user on 2026-08-06 with “PLEASE IMPLEMENT THIS PLAN”

## Goal

Remove the unattended daily full-native run, isolate Playwright on a companion WSL runner, allow web and Android validation to overlap, and bound individual selected test invocations without weakening exact-head selective CI.

## Non-Goals

- Change product behavior, release workflows, provider configuration, or native test selection.
- Add success artifacts or Actions caches.
- Run more than one web companion or one existing Android runner.

## Affected Surfaces

| Surface | Files/Systems | Owner | Notes |
|---|---|---|---|
| App/UI | Not applicable | Mobile | No runtime behavior changes. |
| Service/API | Not applicable | Server | Existing coordinated backend checkout remains unchanged. |
| Data/storage | Not applicable | Platform | No migrations or persisted product data. |
| CI/deploy | Trusted selective workflow, executor, GitHub runner service | Platform | High-risk exact-head gate and temporary registration secret. |
| Docs | This task card and selective CI test documentation | Platform | Record final runner topology and timeout contract. |
| External providers | GitHub Actions | Platform | No production provider mutation. |

## Docs-Backed Kickoff

Risk rule: The project adapter classifies CI workflow and secret changes as high risk.
Docs consulted: Evidence delivery workflow, project adapter, backlog, decisions log, open questions, pending wiring checklist, selective CI test cases, and existing workflow contract tests.
Business rules found or updated: No product business rule applies.
Requirements found or updated: BL-016 selective execution remains the governing delivery requirement.
Use cases found or updated: No user-facing use case changes.
Test cases found or updated: Add runner routing, concurrency, timeout, and cleanup contract coverage.
ADRs found or updated: No product ADR required; the topology is operational and reversible.
Terminology gaps: None. “Invocation timeout” means one planned Playwright or Detox command, not the native build.
Contradictions: None.
Decision: Preserve fail-closed selection and zero-success-artifact/cache policy while adding one web-only service.

## Acceptance Matrix

| ID | Scenario | Expected Behavior | Evidence Required | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Daily unattended trigger | Trusted selective CI has no schedule trigger; push and manual execution remain. | PR #8 exact-head gate and merged workflow inspection. | Passed | PR #8 merged at `9f004d0`; exact-head run `31132934917` passed web/iOS/Android and published a successful gate; merged `main` has `push` and `workflow_dispatch` with no `schedule`. |
| A2 | First runner bootstrap | Companion registers as `mychampions-web-ci-ubuntu` with `mychampions-web-only`. | Runner API snapshot and green bootstrap workflow. | Passed | PR #9 merged at `cc075e4`; push run `31139926304` passed in 42 seconds; runner API reported `mychampions-web-ci-ubuntu` online with exactly `mychampions-ci,mychampions-web-only`; the temporary registration secret was deleted. |
| A3 | Repeated bootstrap | Existing registered runner starts/reconciles without a new token or duplicate service. | Second bootstrap workflow and script tests. | Passed | No-secret manual run `31139984275` passed in 12 seconds against the existing service. |
| A4 | Mixed web and Android selection | Web and Android jobs start concurrently on separate services and use distinct concurrency groups. | Exact-head job timestamps. | Passed scheduling; functional rerun pending | Post-merge run `31142378665` started web on `mychampions-web-ci-ubuntu` and Android on `mychampions-ci-ubuntu` at the identical `02:51:09Z` timestamp, removing the 2m21s-2m24s pre-routing delay. The first fresh web service attempt then exposed missing global Yarn before tests; the follow-up enables repository-pinned Yarn through Corepack. |
| A5 | Hung selected invocation | Owned process group is terminated after 600000 ms and the invocation ID is reported. | Focused executor tests. | Passed locally | TERM-ignoring leader and descendant fixture was terminated as one exact owned process group; error included `detox:timeout-fixture`. Hosted exact-head proof remains part of this routing PR. |
| A6 | Local invocation | With no timeout environment variable, local execution remains unbounded. | Focused parser/executor test. | Passed locally | Parser and executor tests confirm absent configuration returns `undefined` and completes an unbounded local invocation. |
| A7 | Native job containment | iOS and Android jobs stop after 75 minutes while cleanup traps remain active. | Workflow contract test. | Passed locally | Workflow contract asserts 75-minute native jobs, 600000 ms invocation timeout, and retained cleanup steps. |
| A8 | Success evidence policy | Green runs upload no artifacts and create no Actions caches; failures retain one-day diagnostics. | Workflow contract test and exact-head run artifacts inspection. | Pending | |

## Edge Cases

- stale data: Exact candidate SHA authorization remains unchanged.
- repeated action: Bootstrap is idempotent and uses a dedicated root/work directory.
- skipped flow: Aggregate status continues to distinguish unselected lanes from failures.
- expired token/session: Registration token is required only for first configuration and deleted after success.
- wrong environment: Runner labels and repository URL are validated by registration and workflow routing.
- missing config: Missing first-run token fails closed before downloading/configuring.
- network/provider failure: Bootstrap fails without replacing a valid existing registration.
- old app/client version: Not applicable.
- unauthenticated/authenticated mismatch: Trusted workflow authorization remains unchanged.
- concurrency/race condition: Web and Android use separate runner roots and concurrency groups.
- deploy ordering: Bootstrap merges and reports online before routing changes merge.
- rollback behavior: Restore the shared UI concurrency group if either lane regresses by more than 15%.

## Risks

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| Same-host CPU/memory contention | Slower or flaky web/Android jobs | The web-only service deliberately excludes native shared-host hooks; compare against 2m27s web and 37m Android baselines and rollback overlap above 15%. | Open |
| Runner secret persists | Unnecessary credential exposure | Use a short-lived registration token and delete the repository secret after online verification. | Closed — secret deleted after runner API verification |
| Timeout kills unrelated process | Host contamination | Terminate only the child’s owned process group using existing ownership helpers. | Open |
| Routing lands before runner | Permanently queued required check | Separate bootstrap and routing PRs. | Mitigated |

## Implementation Notes

- Use isolated worktree `/Users/eduwaldo/.codex/worktrees/mychampions-ci-opt`.
- Keep the dirty primary checkout untouched.
- PR #8 is handled independently before the bootstrap branch is refreshed onto merged `main`.
- The existing WSL hook lease serializes web and Android today. The companion
  service explicitly unsets both hook variables and the native recovery root in
  system, user-systemd, and detached modes. It cannot target Android because it
  receives only `mychampions-ci,mychampions-web-only`; native runners retain the
  existing host-wide lease.

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `bash -n scripts/ci/provision-web-validation-runner.sh` | Passed | Bootstrap shell syntax. |
| `yarn node --test --import tsx tests/ci/provision-web-validation-runner.test.ts` | Passed (5/5) | Isolation, real archive digest verification, retryability, workflow contract, and hook exclusion. |
| `yarn test:unit` | Passed (1508 tests; 1472 passed, 36 skipped) | Full unit/contract suite on bootstrap branch. |
| `yarn test:unit` | Passed (1513 tests; 1477 passed, 36 skipped) | Full unit/contract suite on rebased routing branch. |
| `yarn lint` | Passed | Expo ESLint scope. |
| `yarn tsc --noEmit` | Passed | TypeScript validation. |
| `git diff --check` | Passed | No whitespace errors. |
| Post-merge run `31142378665` | Failed before web tests | Live runner routing overlapped web and Android exactly; fresh web runner lacked global `yarn`, so the workflow now enables the `packageManager`-pinned Yarn through Corepack before install. The failed remainder was cancelled to save native resources. |

## Open Questions

- None; the user approved maximum parallelism and the rollback threshold.

## Final Evidence Report

| Area | Evidence |
|---|---|
| Unit tests | Authoritative final routing/hotfix worktree: 1513 total; 1477 passed, 36 skipped, 0 failed. The earlier bootstrap-only branch had 1508 total before five bootstrap/timeout contract cases were added. |
| Integration tests | Bootstrap idempotency runs `31139926304` and `31139984275` passed. |
| E2E tests | Bootstrap exact-head full trusted run `31137603448` and routing exact-head full trusted run `31140123003` passed web, iOS, Android, and final publication. Hotfix exact-head run pending. |
| Lint/typecheck | `yarn lint` and `yarn tsc --noEmit` passed. |
| Build | Bootstrap and routing exact-head native trusted CI passed; hotfix exact-head build pending. |
| Deploy/config checks | Runner API online with exact labels; initial provision and no-secret idempotency runs passed; temporary registration secret absent. |
| Docs consulted/updated | Kickoff docs listed above; runner boundary recorded in `docs/discovery/ci-secrets-matrix-v1.md`. |
| Report/log paths | `https://github.com/edufelip/MyChampions/actions/runs/31137603448`, `https://github.com/edufelip/MyChampions/actions/runs/31139926304`, `https://github.com/edufelip/MyChampions/actions/runs/31139984275` |
| Screenshot/golden/snapshot paths | Not applicable |
| Manual/dev smoke | Runner registry and job timestamp inspection |
| Residual risk | Pending measurement |
| Merge/deploy recommendation | Pending regression gate |

## Human Approval

Required: Yes
Approver: User
Decision: Approved implementation and merge sequence
Timestamp: 2026-08-06
Notes: Explicit “PLEASE IMPLEMENT THIS PLAN” after reviewing the complete rollout plan.

## Retrospective

Escaped bug: Not applicable.
Missed scenario: Pending.
New acceptance row: Pending.
New test/guard: Pending.
