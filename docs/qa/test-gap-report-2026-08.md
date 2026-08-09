# Monthly test-gap sweep — 2026-08

## Scope and exact heads

| Repository       | Worktree/branch                                                               | Exact head | Local status                                    |
| ---------------- | ----------------------------------------------------------------------------- | ---------- | ----------------------------------------------- |
| App              | `mychampions-testing-strategy` / `codex/testing-strategy-app`                 | `df48a33`  | Green local implementation gates                |
| Root server      | `mychampions-testing-strategy-server` / `codex/testing-strategy-server`       | `92b2d1d`  | Green local quality and contract gates          |
| Food service     | `mychampions-testing-strategy-food` / `codex/testing-strategy-food`           | `11f8d93`  | Green local quality and consumer contract gates |
| Exercise service | `mychampions-testing-strategy-exercises` / `codex/testing-strategy-exercises` | `718d2b9`  | Green local quality and consumer contract gates |

Date: 2026-08-08, America/Sao_Paulo. This is the first sweep for the ten-workstream testing strategy. It records implementation and local evidence; hosted, native, provider, deployment, and store-live evidence remain separate.

## Evidence matrix

| Surface                  | Local evidence                                                                                                                                                                             | Hosted / live evidence                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| App static               | `yarn typecheck`, `yarn lint --quiet`, and `yarn format:check` passed. Full `yarn test:unit`: 1,491 passed, 0 failed, 36 skipped out of 1,527.                                             | Exact-head hosted selective-CI rerun is pending after the trusted push publisher repair.                                            |
| Selective CI publication | Contract tests cover push publication, default-branch authorization, exact SHA, conservative fallbacks, and failure-only artifacts.                                                        | GitHub Actions proof is pending; no local result is promoted to hosted status.                                                      |
| Root server              | Bun tests: 282 passed, 0 failed; lint: 58 warnings, 0 errors; build passed; contract suite: 26 passed.                                                                                     | Hosted exact-head service workflow is pending.                                                                                      |
| Food service             | Install, lint, build, full suite, and consumer contract suite passed; consumer contract: 3/3.                                                                                              | Hosted exact-head service workflow is pending.                                                                                      |
| Exercise service         | Install, lint, build, integration/full suites, and consumer contract suite passed; consumer contract: 3/3.                                                                                 | Hosted exact-head service workflow is pending.                                                                                      |
| Playwright               | `yarn test:e2e:web`: 74 passed, 4 expected skips across mobile/tablet Chromium and the full browser matrix where declared. Evidence root: `.artifacts/web-e2e/2026-08-09T02-19-23Z-full/`. | Hosted browser rerun at the exact app/server head is pending.                                                                       |
| Visual evidence          | Comparator unit tests passed, including a deliberate two-pixel failure and an intentional mask pass. Captured metadata is schema-versioned, but 16 states are `unbaselined`.               | Reviewed baselines and pixel-diff sign-off are unavailable; no visual-live pass claimed.                                            |
| Native Detox             | Protected manual/release-only iOS/Android workflow, exact SHA, build-once, state-root lock, cleanup diagnostics, and three highest-risk gap scenarios are implemented.                     | No approved self-hosted iOS/Android runner was available in this session; native result is `Unverified`.                            |
| RevenueCat provider      | Preflight and runner contract tests passed. Missing-key proof exited 2 before build/provider access.                                                                                       | Approved Test Store key, catalog access, provider run, read-only reconciliation, and store-live evidence are `Blocked`/unavailable. |
| Recurring personas       | ET-25 created for the browser-first first-week charter; report: `docs/qa/first-week-personas-2026-08-08.md`.                                                                               | Recurring hosted/native/provider persona run is pending.                                                                            |

## Top ten gaps

| Rank | Gap                                                                                                                  | Risk                                                                                       | Owner/status                     |
| ---- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------- |
| 1    | Trusted selective-CI publisher has not yet produced hosted exact-head push evidence.                                 | Required checks can still be misreported until hosted proof exists.                        | CI / Pending                     |
| 2    | Protected native workflow has no approved runner proof for cleanup, lock contention, cancellation, or duration SLO.  | Native failures may remain environment-specific or leak state.                             | Mobile infra / Pending           |
| 3    | RevenueCat Test Store run lacks an approved `test_*` SDK key and catalog/reconciliation access.                      | Monetization behavior cannot be promoted from deterministic fixtures to provider evidence. | Subscriptions / Blocked          |
| 4    | Android provider validation still needs catalog/config/runner permission evidence.                                   | Cross-platform monetization coverage is incomplete.                                        | Subscriptions / Blocked          |
| 5    | Visual captures have no reviewed baselines or approved ignore rectangles.                                            | Pixel regressions cannot be classified without inventing a baseline.                       | QA/design / Pending              |
| 6    | `noUncheckedIndexedAccess` is evaluated but not enabled.                                                             | Unsafe indexed access remains a type-system gap.                                           | App platform / Deferred decision |
| 7    | New native role-relaunch, malformed-QR, and camera-permission scenarios have contract coverage but no device result. | High-risk auth/data-loss/privacy behavior is not yet runner-proven.                        | Mobile QA / Unverified           |
| 8    | Full Playwright coverage is green locally but lacks hosted exact-head browser evidence.                              | Browser environment drift could remain undetected.                                         | Web QA / Pending                 |
| 9    | Cross-repo service gates are green locally but need hosted exact-head runs and artifact retention.                   | API response/error drift could bypass local-only protection.                               | Backend / Pending                |
| 10   | Persona coverage is recorded once in ET-25 but has no recurring scheduled run with native/API/provider access.       | Regressions can return between manual sweeps.                                              | QA operations / Pending          |

## Three next tests

1. Run the hosted exact-head service consumer matrix against the root server, food, and exercise commits, including success/error shape assertions and artifact retention.
2. Run the protected native trio on both platforms: role persistence after relaunch, malformed QR rejection without pending state, and camera permission denial without a preview.
3. Run the hosted browser critical path plus reviewed visual-baseline comparison; if provider credentials become available, append the read-only RevenueCat reconciliation as a separate gate.

## Documentation and deferred wiring

- Backlog traceability, decisions, open questions, and pending wiring were updated for the ten workstreams.
- Native, provider, visual, persona, and monthly sweep procedures are documented under `docs/qa/`.
- Missing hosted/native/provider access is explicitly tracked as pending or blocked; no production mutation, purchase, credential invention, or baseline refresh was performed.
