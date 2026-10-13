# Task Card: ET-230 typed error contracts and payment-pending UX

## Status

Current bucket: In review preparation
Risk level: High (auth, billing classification, and entitlement-adjacent UI)
Owner: App implementation agent with independent root review
Blocked by: Real RevenueCat receipt/store validation is a separate pending gate
Human approval required: Review/merge/release approval; no provider purchase or production mutation is authorized here

## Goal

Replace fragile message parsing at the meal-photo, email sign-up, and
RevenueCat boundaries with explicit typed contracts while preserving current
wire envelopes, auth/session behavior, account-enumeration protections, and
entitlement authority. Make RevenueCat payment pending distinct from
cancellation and show a neutral localized notice in every affected consumer.

## Non-Goals

- No TypeSafe/AI call or provider model change.
- No server envelope migration, schema migration, SDK upgrade, offering/product change, or production provider mutation.
- No auth/session policy change, duplicate-email disclosure, entitlement grant/revoke policy change, retry loop, or polling.
- No real purchase, restore, provider credential use, deployment, merge, or production release.

## Affected Surfaces

| Surface | Files/Systems | Owner | Notes |
|---|---|---|---|
| App/UI | SC-212 subscription; SC-214 builder; SC-215 library/quick-log; SC-219 AI analysis; SC-218 sign-up | App agent | Pending notice keeps current access state and is polite/live-region only |
| Service/API | MyChampions server meal-photo contract tests | Server agent | Existing 401/422/429/503 envelopes retained |
| Data/storage | None | App/server | No schema or persistent entitlement-state change |
| CI/deploy | Focused app/server checks; exact-head hosted CI separate | Root/reviewer | No deploy performed |
| Docs | Discovery, decisions, pending wiring, FR/BR/AC, SC specs, TC-003, locale table, task card | App agent | Docs-first rule satisfied |
| External providers | RevenueCat installed declaration contract only | App agent | Live receipt/store validation remains pending |

## Docs-Backed Kickoff

Risk rule: auth/payment-adjacent classification is high risk; evidence must
separate local contracts, browser/native fixtures, provider-live behavior, and
release/deploy claims.

Docs consulted: parent and app `AGENTS.md`, Linear Flow skill and references,
evidence-delivery/project-adapter rules, ET-230 plan, SC-212/SC-214/SC-215/
SC-218/SC-219, FR-001, BR-002, AC-003, UC-002, TC-003, localization table,
decisions log, pending wiring checklist, backend provider migration notes.

Business rules found or updated: BR-345 typed structured classification;
BR-346 payment-pending semantics.

Requirements found or updated: FR-275 structured classification; FR-276
payment-pending presentation.

Use cases found or updated: UC-002 auth/session flow consulted; no flow
sequence change was needed.

Test cases found or updated: TC-441 mapper precedence; TC-442 pending state;
TC-443 sign-up privacy.

ADRs found or updated: D-219 and D-220 in `decisions-log-v1.md`.

Terminology gaps: none after defining transport context, wire/provider code,
domain reason, diagnostic message, and payment pending in
`docs/discovery/typed-error-contracts-v1.md`.

Contradictions: Prior implementation inferred reasons from messages and
treated payment pending as cancellation. Current docs now state structured
reasons are authoritative and pending is distinct. Existing provider/store
live-validation gaps remain explicitly pending.

Decision: proceed with exact, source-specific mappings and preserve all
authorization/session/entitlement invariants.

## Acceptance Matrix

| ID | Scenario | Expected Behavior | Evidence Required | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Meal-photo exact codes and HTTP statuses | Codes and trusted 401/403/413/429 context map deterministically; malformed/unknown values fail closed; valid success shape remains unchanged | Focused app tests + server contract tests | Done | Test logs in ET-230 evidence directory |
| A2 | Meal-photo message and locale independence | Empty/English/Portuguese/Spanish prose never changes a code result; raw messages never reach UI | Mapper/source tests | Done | Focused app tests |
| A3 | Sign-up exact aliases and anti-enumeration | Typed aliases map; message-only duplicate/account hints remain unknown; requires-sign-in source branch and session handoff remain unchanged | Auth logic/source/runtime tests and docs | Done | Focused app tests; SC-218/ET-75 docs |
| A4 | Installed RevenueCat enum contract | Every installed numeric enum and readable alias is tested; unknown future/prototype values fail closed | Declaration-reading contract test | Done | `revenuecat-error.test.ts` |
| A5 | Pending beats cancellation | Code 20 maps to `payment_pending` even with `userCancelled: true`; code 1 remains cancellation | Mapper tests | Done | `revenuecat-error.test.ts` |
| A6 | Pending UI/state | Loading clears; current entitlement remains; neutral copy appears in SC-212 and SC-214/SC-215; no retry/poll/paywall mutation; affected AI consumers expose explicit refresh | Hook/source tests + browser/native fixture evidence | Done | Native fixture assertions; subscription browser proof; quick-log and builder proof at `supervision/ai-pending-browser-proof.json` |
| A7 | Locale completeness | `subscription.error.payment_pending` is populated in all three locales and copy table | Localization tests + table review | Done | Locale bundles/table |
| A8 | Server wire compatibility | Existing 401/422/429/503 and request-validation responses remain stable | Server focused tests + typecheck | Done | Server logs |
| A9 | Provider/store live behavior | Real receipt pending/cancel/restore and catalog validation | Approved Test Store/device evidence | Pending | Existing provider gate; no purchase authorized |

## Edge Cases

- stale data: pending does not replace the current entitlement state.
- repeated action: no automatic purchase retry or polling is introduced.
- skipped flow: paywall `NOT_PRESENTED` remains its existing configuration path.
- expired token/session: existing auth source/session guards remain unchanged.
- wrong environment: provider keys/offering guards remain unchanged.
- missing config: source-specific configuration reason, never message inference.
- network/provider failure: exact transport/provider code mapping, raw message ignored.
- old app/client version: server wire envelopes and success payloads remain compatible.
- unauthenticated/authenticated mismatch: meal-photo 401/403 remains unauthenticated; no logout side effect.
- concurrency/race condition: currentAuthUid guards prevent stale user A result changing user B state.
- deploy ordering: no deployment or schema change.
- rollback behavior: revert scoped app/server/docs commits; provider catalog/data is untouched.

## Risks

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| RevenueCat SDK adds a new enum | Misclassification | Declaration contract test maps unlisted values to unknown | Controlled |
| Provider returns hostile object/proxy | Crash or unsafe coercion | Descriptor-based guarded field reader and revoked-proxy tests | Controlled |
| Pending treated as cancellation | Misleading UI and lost state | Separate union reason, exhaustive copy map, state tests | Controlled |
| Signup message leaks account existence | Privacy regression | Exact-code-only mapping and preserved session-less acknowledgement flow | Controlled |
| Live store semantics differ from fixtures | Release uncertainty | Keep provider/device evidence pending and separate from local proof | Open, explicitly gated |

## Implementation Notes

- `features/errors/read-error-fields.ts` is policy-free and safe for unknown input.
- `features/nutrition/photo-analysis-error.ts` and
  `features/subscription/revenuecat-error.ts` own source-specific tables.
- `features/subscription/subscription-error-copy.ts` is exhaustive over the
  subscription reason union.
- Fixed diagnostics in touched subscription wrappers do not interpolate raw
  SDK errors.
- The server only gained contract tests; its response behavior is unchanged.

## Commands Run

| Command | Result | Notes |
|---|---|---|
| `yarn tsx --test ...` focused mapper/source/paywall suite | Pass | Includes hostile values and pending classification |
| `yarn typecheck` | Pass | App TypeScript |
| `bun test tests/meal-photo-analysis.test.ts tests/meal-photo-analyzer.test.ts tests/meal-photo-analysis-request.test.ts` | Pass | Server wire/request contract |
| `bunx tsc --noEmit` | Pass | Server TypeScript |
| `yarn test:unit` | Pass | 1,649 passed, 36 skipped, 0 failed; `supervision/typed-errors-full-unit-final.log` |
| `yarn lint` | Pass | Full app lint gate; `supervision/typed-errors-lint.log` |
| `yarn format:check` | Partial | Changed files pass targeted Prettier check; repository-wide check reports seven pre-existing unrelated files |
| `git diff --check` | Pass | Both worktrees clean at final commits |
| Hosted selective preflight | Pass | Exact-head rerun `36283301533` for `08381f4`; aggregate Selective CI gate remains pending |

## Open Questions

- Provider-backed pending/restore receipt behavior still needs an approved
  Test Store or platform sandbox run; this is outside local implementation
  authority and remains a release gate.

## Final Evidence Report

| Area | Evidence |
|---|---|
| Unit tests | Focused mapper/source/copy/paywall tests; full app regression `supervision/typed-errors-full-unit-final.log`; signup/meal-photo contract log `supervision/signup-meal-photo-contracts.log` |
| Integration tests | Server meal-photo contract tests; no wire change |
| E2E tests | Native fixture assertions; subscription browser pending→refresh→pending proof; quick-log and builder pending/refresh/manual-field proof `supervision/ai-pending-browser-proof.json` |
| Lint/typecheck | App/server typecheck pass; full lint pass; repository-wide format check has seven unrelated pre-existing warnings |
| Build | No release build requested or run |
| Deploy/config checks | No deploy; no provider credentials used |
| Docs consulted/updated | Typed-error discovery, D-219/D-220, FR/BR/AC, SC-212/214/215/218/219, TC-003, pending wiring, copy table |
| Report/log paths | `/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/et-230` and `/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/supervision` |
| Screenshot/golden/snapshot paths | `/Users/eduwaldo/Projects/MyChampions/outputs/typesafe-delivery-2026-09-26/supervision/subscription-pending-mobile.png`, `ai-quick-log-pending.png`, and `ai-builder-pending.png` |
| Manual/dev smoke | Pass on owned port 8330; server target 8331 remained unstarted, so connection-refused analytics noise is recorded separately |
| Independent mobile replay | Pass | Root replay on owned port 8339: quick-log and builder pending → Refresh → pending; grams/manual name preserved |
| Residual risk | Live RevenueCat/store behavior not proven |
| Merge/deploy recommendation | Review only; do not merge/deploy until exact-head CI and provider gates are independently satisfied |

## Human Approval

Required: Review/merge/release approval
Approver: Root agent / product owner
Decision: Pending review
Timestamp: 2026-09-26
Notes: ET-230 implementation is authorized for draft PR and Linear In Review; no production action is authorized.

## Retrospective

Escaped bug: Payment pending was previously conflated with cancellation and
message parsing could be influenced by wording.

Missed scenario: Hostile prototype keys and revoked proxies were added after
independent review identified unsafe lookup/`instanceof` paths.

New acceptance row: TC-441, TC-442, TC-443.

New test/guard: Installed enum declaration contract, own-property lookup,
safe instance checks, and exhaustive pending copy mapping.
