# Task Card: Parallel CI optimization

## Status

Current bucket: Implementation
Risk level: High (CI workflow, runner registration, and secret lifecycle)
Owner: Codex
Blocked by: Bootstrap runner availability before routing promotion
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
| A2 | First runner bootstrap | Companion registers as `mychampions-web-ci-ubuntu` with `mychampions-web-only`. | Runner API snapshot and green bootstrap workflow. | Pending | |
| A3 | Repeated bootstrap | Existing registered runner starts/reconciles without a new token or duplicate service. | Second bootstrap workflow and script tests. | Pending | |
| A4 | Mixed web and Android selection | Web and Android jobs start concurrently on separate services and use distinct concurrency groups. | Exact-head job timestamps. | Pending | |
| A5 | Hung selected invocation | Owned process group is terminated after 600000 ms and the invocation ID is reported. | Focused executor tests. | Pending | |
| A6 | Local invocation | With no timeout environment variable, local execution remains unbounded. | Focused parser/executor test. | Pending | |
| A7 | Native job containment | iOS and Android jobs stop after 75 minutes while cleanup traps remain active. | Workflow contract test. | Pending | |
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
| Runner secret persists | Unnecessary credential exposure | Use a short-lived registration token and delete the repository secret after online verification. | Open |
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
| `yarn tsx --test tests/ci/provision-web-validation-runner.test.ts` | Passed (4/4) | Isolation, retryability, workflow contract, and hook exclusion. |
| `yarn test:unit` | Passed (1508 tests; 1472 passed, 36 skipped) | Full unit/contract suite on bootstrap branch. |
| `yarn lint` | Passed | Expo ESLint scope. |
| `yarn tsc --noEmit` | Passed | TypeScript validation. |
| `git diff --check` | Passed | No whitespace errors. |

## Open Questions

- None; the user approved maximum parallelism and the rollback threshold.

## Final Evidence Report

| Area | Evidence |
|---|---|
| Unit tests | 1508 total; 1472 passed, 36 skipped, 0 failed. |
| Integration tests | Pending |
| E2E tests | Pending exact-head trusted CI |
| Lint/typecheck | `yarn lint` and `yarn tsc --noEmit` passed. |
| Build | Pending native trusted CI |
| Deploy/config checks | Pending workflow and runner verification |
| Docs consulted/updated | Kickoff docs listed above; runner boundary recorded in `docs/discovery/ci-secrets-matrix-v1.md`. |
| Report/log paths | GitHub run URLs pending |
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
