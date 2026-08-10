# Monthly cross-repo test-gap sweep

## Purpose

Run this sweep once per calendar month across the MyChampions app, root Bun server, food service, and exercise service. The sweep identifies missing protection, records evidence by environment, and selects the next three tests to add. It is a gap review, not permission to mutate production, purchase subscriptions, refresh visual baselines, or invent credentials.

## Procedure

1. Start from fresh current `main` in isolated worktrees for all four repositories. Read `AGENTS.md`, the discovery backlog, decisions, open questions, pending wiring, relevant screen specs, and linked FR/UC/AC/BR/TC documents.
2. Record the exact tested commit for every repository. Keep local tests, hosted CI, native runner, provider, deployment, and store-live evidence in separate columns; unavailable evidence is `Blocked` or `Unverified`, never zero or pass.
3. Inspect the current selective-CI status publication, exact-head authorization, workflow contract tests, and the last hosted failures. Confirm that required statuses are published only by the trusted default-branch workflow.
4. Run app static, unit, web, and service quality/contract gates locally. Confirm that the food and exercise consumers still validate the root server response/error contract.
5. Compare the native Detox manifest against the documented UC/TC/AC matrix. Rank missing native tests by auth/data-loss, monetization, and privacy risk. Verify that protected runs have bounded cleanup, exact SHA binding, state-root isolation, and no unapproved nightly schedule.
6. Run Playwright critical paths on mobile/tablet Chromium and the complete browser matrix. Review visual metadata, dimensions, diff percentage, bounding box, masks, and baseline state. Never treat an unbaselined capture as a pass.
7. Preflight provider/subscription validation. Require explicit dev/Test Store mode, `test_*` key, distinct isolated IDs, expected test offerings, and read-only reconciliation. A missing credential or provider is a blocked result.
8. Run the recurring persona charter across all twelve manifest families, tracing each result to UC/TC/AC artifacts. Use browser-first QA when available, attach screenshots/artifacts, and create a Bug only after two reproductions plus a control.
9. Review recent merged diffs and hosted failures for duplicated gaps, stale documentation, skipped tests, flaky retries, and unowned paths. Add a decision/backlog/pending-wiring entry for every intentional deferral.
10. Select exactly three next tests. Prefer one cross-repo contract test, one highest-risk native scenario, and one browser/visual/provider gate that closes the largest evidence boundary.

## Required report fields

- Sweep date, timezone, exact commit per repository, worktree/branch, and reviewer.
- Local command, result, and artifact path for app, server, food, exercise, Playwright, visual, and static gates.
- Hosted CI workflow/run URL and exact-head status; use `Pending` when not available.
- Native platform, runner label, build SHA, scenario IDs, diagnostics, cleanup result, and report path.
- Provider mode, catalog/offering IDs, test identities, read-only reconciliation result, and credential availability. Never include secrets.
- Store-live/deployment evidence, or an explicit `Unavailable`/`Blocked` reason.
- Top ten gaps, risk/owner/status, three selected tests, documentation updates, and deferred-wiring entries.

## Completion gate

The sweep is complete only when the report, persona evidence, discovery traceability, pending-wiring checklist, and automation/QA memory are updated together. A green local run does not close a hosted, native, provider, deployment, or store-live gap.
