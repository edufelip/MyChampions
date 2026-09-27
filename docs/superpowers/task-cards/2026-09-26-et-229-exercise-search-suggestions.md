# Task Card: ET-229 exercise retrieval and explicit semantic suggestions

## Status

Current bucket: In progress / ready for review preparation
Risk level: High — cross-repository API, provider boundary, privacy, and stale UI state
Owner: Backend + mobile worktrees under the ET-229 Linear branch
Blocked by: Hosted exact-head CI, local representative Postgres timing, and the separate held-out evaluation/activation decision
Human approval required: TypeSafe enablement, deployment, provider spend controls, merging, and production activation

## Goal

Improve SC-208 exercise retrieval with deterministic normalization/ranking behind a disabled server flag and add a separate, explicit-consent semantic suggestion that can highlight one existing catalog result. Ordinary search must keep working with no provider key or provider calls, and only existing selection/Confirm/Save behavior may mutate or persist a plan.

## Non-Goals

- No generated exercises, workout plans, prescriptions, instructions, embeddings, vector store, food changes, catalog migration, or new pagination.
- No TypeSafe credential in the app, no automatic calls on typing/open/retry, and no production provider spend or feature activation.
- No plan mutation from a suggestion; Confirm and Save remain the only existing write steps.
- No claim that synthetic fixtures establish held-out precision, recall, cost, or production latency.

## Affected Surfaces

| Surface | Files/Systems | Owner | Notes |
|---|---|---|---|
| App/UI | `features/plans/exercise-service-source.ts`, `use-exercise-search.ts`, `ExerciseSearchModal.tsx`, SC-208 screen, three locale bundles, Playwright specs | Mobile | Explicit CTA/disclosure/status/badge; exact-query stale guards and debounce cancellation |
| Service/API | `src/integrations/exercise-query.ts`, `exercise-candidates.ts`, `exercise-search-gateway.ts`, `exercise-suggestion-service.ts`, `typesafe-exercise-client.ts`, `exercise-suggestion-limits.ts`, `src/app.ts`, `src/config.ts` | Backend | Separate route; deterministic retrieval; fail-closed model boundary |
| Data/storage | Existing mirrored Postgres exercise catalog only | Backend | No schema migration; local representative DB timing remains pending |
| CI/deploy | `playwright.config.ts`, `playwright.training.config.ts`, `config/test-impact.json` | QA | Semantic fixture lane is explicit; default app/server flags remain false |
| Docs | SC-208, FR-001, BR-002, UC-002, AC-002, TC-002, discovery decision/pending wiring, server design/README | Both | Contract and activation gates recorded |
| External providers | TypeSafe adapter, server-only | Owner approval | No live call in this delivery; held-out gate pending |

## Docs-Backed Kickoff

Risk rule: Cross-repository/provider work requires docs, acceptance matrix, red/green guards, rendered UI evidence, and explicit activation limitations.
Docs consulted: root `AGENTS.md`, app `AGENTS.md`, `linear-flow/SKILL.md` + reference, SC-208, FR-001, BR-002, UC-002, AC-002, TC-002, discovery decisions/open questions/pending wiring, server README, ET-229 plan.
Business rules found or updated: BR-002 and new ET-229 BR-307–309.
Requirements found or updated: FR-001 new ET-229 FR-275–278.
Use cases found or updated: UC-002.24.
Test cases found or updated: TC-333–336 and semantic browser spec; existing TC-332 remains the ordinary viewport contract.
ADRs found or updated: discovery `D-221`.
Terminology gaps: Provider quality/activation terms are explicitly separate from deterministic fixture evidence.
Contradictions: The plan's shared generation wording was reconciled with independent ordinary/suggestion counters plus immediate shared query invalidation so ordinary search cannot remain stuck while stale suggestions stay blocked.
Decision: Keep flags disabled by default and defer activation until held-out evidence and owner approval.

## Acceptance Matrix

| ID | Scenario | Expected Behavior | Evidence Required | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Ordinary `/search` with provider configured | Zero TypeSafe calls; normal result/error contract | Route test with fake client | Done | `tests/exercise-suggestion-route.test.ts` |
| A2 | Missing provider key/config | Ordinary search remains available; suggestion returns unavailable | Route/config tests | Done | Focused server suite |
| A3 | Deterministic V2 retrieval | Bounded parameterized search, stable rank, alias/constraint behavior | Query/candidate/gateway tests + local DB timing | In progress | Unit tests and isolated Postgres retrieval proof done; representative EXPLAIN/timing gate pending |
| A4 | Auth/consent/input | 401 before catalog/provider; 400 false/malformed consent; 429 limiter | Route tests | Done | Focused server suite |
| A5 | Provider response hardening | explicit `none`, probability/confidence bounds, membership, model pin | Adapter/service tests | Done | Focused server suite |
| A6 | Constraint safety | mixed/unknown negation abstains; unknown equipment cannot satisfy hard exclusion | Query/route tests | Done | Focused server suite |
| A7 | App opt-in UX | CTA/disclosure only when enabled; pending/status/badge localized; no automatic call | Source + rendered browser test | Done | Semantic Playwright fixture run; parent independent 8320 verification |
| A8 | Stale transitions | query edit/clear/close/new request cannot paint stale results or leave spinner | Hook/UI browser test | Done | `exercise-search-semantic.spec.ts` |
| A9 | Plan mutation boundary | selection opens detail; only Confirm/Save writes | Existing modal flow + manual check | Done | Parent independent browser proof in `/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/supervision/exercise-browser-proof.json` and `exercise-confirm-mobile.png` |
| A10 | Held-out activation | precision/recall/cost/latency gate | Frozen multilingual dataset/report | Pending | No dataset is available in this delivery |

## Edge Cases

- stale data: exact current query check plus independent generation counters hide old response rows/status/badges.
- repeated action: CTA is disabled while pending; server limiter has per-user/global/circuit bounds.
- skipped flow: opening/typing/ordinary Retry never calls TypeSafe; explicit CTA is required.
- expired token/session: server auth rejects before catalog/provider; app maps typed source errors.
- wrong environment: flags and E2E fixture are explicit; synthetic fixture is not activation proof.
- missing config: absent TypeSafe key returns unavailable without taking `/search` down.
- network/provider failure: bounded timeout/body/cancellation and deterministic fallback; no automatic retry.
- old app/client version: old clients use `/search`; new client against old server gets typed unavailable for explicit suggestion.
- unauthenticated/authenticated mismatch: 401 precedes gateway/provider access.
- concurrency/race condition: limiter and query generations reject stale/over-cap requests.
- deploy ordering: server may merge/deploy disabled; app flag cannot authorize server inference by itself.
- rollback behavior: disable server suggestion flag, app pilot flag, then V2 retrieval if needed; no DB rollback.

## Risks

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| Catalog scan/rank cost | Slow search at representative size | Parameterized bounded SQL, cap after rank, require local EXPLAIN/timing before enablement | Pending measurement |
| Model false match | Wrong exercise/equipment | Conservative parser, eligible candidate subset, membership/constraint checks, held-out gate | Guarded; activation pending |
| Replica quota multiplication | Higher provider spend | Single-process limitation documented; multi-replica enablement prohibited without shared limiter | Pending owner review |
| Stale UI result | User selects wrong row | Immediate query invalidation, independent generations, exact-query rendering, browser race test | Done |
| Secret/privacy leak | Sensitive data/provider credential exposure | Server-only key, bounded candidate fields, redacted telemetry, disclosure | Done; live provider pending |

## Implementation Notes

- Backend branch is a fresh `origin/main` checkout at `/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/worktrees/et-229-server`.
- App branch is a fresh `origin/main` checkout at `/Users/eduwaldo/.codex/worktrees/et-229-exercise-suggestions/mychampions`.
- No database migration or provider SDK import is required for v1.
- Development fixture rows are frozen synthetic evidence only; no independent held-out dataset currently exists.

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `EXERCISE_CATALOG_V2_TEST_DATABASE_URL=<isolated-local-db> bun test tests/config.test.ts tests/exercise-query.test.ts tests/exercise-candidates.test.ts tests/exercise-suggestion-limits.test.ts tests/typesafe-exercise-client.test.ts tests/exercise-search.test.ts tests/exercise-suggestion-route.test.ts tests/postgres-exercise-search-gateway.test.ts` | Pass | 37 tests / 115 assertions plus isolated V2 Postgres coverage |
| `bunx tsc --noEmit` | Pass | Server worktree |
| `yarn tsx --test features/plans/exercise-service-source.test.ts` | Pass | 18 tests |
| `yarn typecheck` | Pass | App worktree |
| `yarn eslint <changed app files>` | Pass with existing warnings | No errors; warnings are baseline/typed lint policy |
| `CI=1 PLAYWRIGHT_TRAINING_SEMANTIC_WEB_PORT=8322 npx playwright test --config=playwright.training.semantic.config.ts e2e/web/exercise-search-semantic.spec.ts --project=chromium` | Pass | 1 rendered fixture test; dedicated config forces the semantic flag true |
| `npx playwright test e2e/web/exercise-search-modal.spec.ts --project=chromium` | Pass | 4 existing viewport/detail tests; ordinary flag default false |

## Open Questions

- Which owner-approved local catalog dataset and hardware will supply the required EXPLAIN/timing evidence?
- When will the multilingual held-out set be labeled and frozen?
- Which operator spend controls and deployment topology will authorize a live TypeSafe pilot?

## Final Evidence Report

| Area | Evidence |
|---|---|
| Unit tests | Server focused suite and app source suite above |
| Integration tests | Fake TypeSafe adapter through authenticated Elysia route; local Postgres representative run pending |
| E2E tests | Existing ordinary exercise modal suite plus explicit semantic fixture suite |
| Lint/typecheck | App typecheck and focused lint; server typecheck |
| Build | Expo web dev server on owned port 8320 with fixture env; production build not run |
| Deploy/config checks | Flags default false; no deployment or provider activation |
| Docs consulted/updated | Task card, SC-208, FR/BR/UC/AC/TC, discovery D-221/pending wiring, server README/design |
| Report/log paths | ET-229 evidence folder outside the repositories; final paths to be added after capture |
| Screenshot/golden/snapshot paths | Semantic Playwright attachment and parent 8320 captures pending final consolidation |
| Manual/dev smoke | Parent independently verified the 8320 fixture server; evidence includes suggestion, selection/Confirm, stale edit, empty clear, close/reopen, and screenshots |
| Residual risk | No held-out quality or real provider evidence; local catalog timing pending |
| Merge/deploy recommendation | Draft PR only; no merge, deployment, or flag enablement |

## Reproducible local browser surface

The owned 8320 server remains running with the assigned-plan fixture and the
semantic client flag enabled. From the app worktree, restart only if that
process is unavailable:

```sh
CI=1 EXPO_OFFLINE=1 APP_VARIANT=dev \
EXPO_PUBLIC_ENV=dev EXPO_PUBLIC_E2E_AUTH_SESSION=true \
EXPO_PUBLIC_E2E_PRO_PLANS_FIXTURE=basic \
EXPO_PUBLIC_E2E_STUDENT_TRAINING_FIXTURE=assigned \
EXPO_PUBLIC_E2E_EXERCISE_SEARCH_FIXTURE=basic \
EXPO_PUBLIC_EXERCISE_SUGGESTIONS_ENABLED=true \
EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS=active \
EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS=active \
EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT=2 \
EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE=basic \
EXPO_PUBLIC_E2E_PRO_PENDING_FIXTURE=basic \
EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE=basic \
EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE=basic \
EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL=http://127.0.0.1:8320 \
yarn web:dev --port 8320 --clear
```

Evidence is retained at
`/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/supervision/exercise-browser-proof.json`,
`exercise-suggested-mobile.png`, and `exercise-confirm-mobile.png`.
Those browser runs recorded navigation/analytics `ERR_ABORTED` entries but no
page exceptions; they are not a network-clean claim. Root's independent V2
Postgres proof is at
`/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/supervision/exercise-postgres-proof.json`
with the executable setup in `exercise-postgres.ts`.

## Human Approval

Required: TypeSafe provider enablement, deployment, merge, and production pilot
Approver:
Decision: Pending
Timestamp:
Notes: ET-229 implementation may be reviewed with flags disabled.

## Published findings artifact

Claude artifact: https://claude.ai/code/artifact/b8fe4b71-c9b1-4c58-8cde-e75979690d5a

## Retrospective

Escaped bug: Manual 8320 initially omitted the assigned-plan fixture and failed closed before the modal; the reproducible command now includes the full Playwright fixture set.
Missed scenario: The first service implementation reused a per-request limiter and did not fail closed for mixed/unknown negation; focused regressions were added.
New acceptance row: A8 covers exact-query stale responses and spinner settlement.
New test/guard: Default-factory repeated-request limiter test; mixed/unknown negation route test; semantic immediate-CTA/browser test.
