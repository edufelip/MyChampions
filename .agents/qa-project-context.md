# MyChampions QA project context

## Purpose and authority

This is a routing adapter for generic QA skills installed under the local Codex
skill directory. It is not a product, release, or compliance source of truth.

Read `AGENTS.md` first. For a behavior change or test verdict, use the affected
documents under `docs/functional-requirements/`, `docs/use-cases/`,
`docs/acceptance-criteria/`, `docs/business-rules/`, `docs/test-cases/`,
`docs/screens/v2/`, and `docs/discovery/` as applicable. Record documentation
updates or why none are needed.

## Product and repository boundaries

- This repository is the Expo/React Native MyChampions client. Browser evidence
  exercises the shared web surface; it is not native-device evidence.
- The root MyChampions server owns auth, sessions, Postgres/Drizzle persistence,
  and image storage. `mychampionsapi-food` and `mychampionsapi-exercises` are
  separate owned repositories. Resolve the owning repository before changing or
  testing a server-side concern.
- Firebase mobile runtime services are retired context. Do not add or describe
  Firebase as the current backend baseline; see
  `docs/discovery/backend-provider-migration-v1.md`.

## Existing QA workflows

- `yarn test:component` provides rendered component evidence for the scoped
  BL-018 families; `test:all` runs unit plus component. Native adapters and
  transport are mocked at their boundaries. This is separate from browser,
  Postgres, physical-device and provider proof; see the testing strategy and
  component replacement ledger for current gaps.

- Use `qa-manual-run` for a bounded, evidence-backed validation and
  `qa-exploration-loop` for resumable scenario exploration. Preserve their
  `.qa/artifacts/` contract; do not replace it with an upstream template.
- Use `qa-atlas` only for an explicit full-flow visual atlas. It owns its
  isolated artifact root and manifest verification.
- Run browser commands from this repository with the package-local Playwright
  binary. `yarn test:e2e:web:smoke`, `functional`, `accessibility`,
  `critical-paths`, `evidence`, and `flow-atlas` are the configured entrypoints.
  Confirm the app identity and use an isolated port; never stop another
  worktree's server to free the default port.
- Native scopes use the checked-in Detox configurations and are explicit-only.
  Protected iOS/Android validation handles manual, published-release and
  release/hotfix push triggers; it is not ordinary PR or browser proof. Maestro
  remains a BL-018 pilot until integrated per-platform receipts satisfy D-218.

## Evidence and environment rules

- Keep unit, local browser, hosted CI, native device/simulator, server/API,
  provider acceptance, deployment, and store-live evidence separate. Missing
  evidence is `Blocked` or `Unverified`, never a pass.
- Default to local or approved non-production fixtures. Do not use production
  accounts, customer data, real purchases, secrets, or provider-console changes
  without explicit user authorization.
- RevenueCat provider validation is a credential-gated Test Store lane with
  isolated test identities and read-only reconciliation. It is separate from
  fixture tests and from production billing.
- `env=dev` is not a valid target until a dedicated API/database exists. Keep
  test data deterministic, non-sensitive, parallel-safe, and cleanable.

## Selector, reliability, and visual policy

- Prefer accessible role/name and label locators in web tests. Use a stable
  native `testID` for native value assertions when appropriate; neither is a
  substitute for accessibility semantics.
- Classify a failure before repairing it: product regression, selector drift,
  test-data problem, environment interference, or infrastructure failure.
  Never hide a failure through unreviewed retries, broad skips, or auto-healing.
- Do not create or refresh tracked visual baselines without an approved owner,
  review record, and refresh policy. Local screenshots are evidence, not a
  baseline pass.

## Guidance for the installed reference skills

- **Contract testing:** start with one fragile consumer/provider boundary and
  use the owning server repository for provider verification. Do not add a Pact
  Broker, deployment gate, or cross-repository workflow without a separately
  approved implementation task.
- **Test environments, data, and virtualization:** use disposable fixtures and
  explicit state ownership. Preserve auth, entitlement, media, and external
  provider boundaries rather than mocking away the behavior under test.
- **Cross-browser testing:** prioritize real mobile Safari and Android Chrome
  smoke in addition to current browser emulation. Keep browser purchases and
  provider-live paths out of scope unless approved.
- **Test reliability, selector recovery, and suite curation:** require a human
  review for behavior-affecting selector changes, retain diagnostics, and run
  the affected suite before accepting a repair.

## Current high-value gaps

Use `docs/qa/test-gap-sweep.md` and
`docs/discovery/web-pending-items-and-future-improvements.md` to select work.
The current priorities include cross-repository contracts, deterministic
server-backed browser data, real mobile browser coverage, accessibility/manual
assistive checks, performance and observability evidence, and an approved
visual-baseline policy. These are gaps to investigate, not authorization to
change production or third-party services.
