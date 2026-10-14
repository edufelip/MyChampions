# Documentation-First Agent Rules

## Documentation scope and validation

Before implementation, read the documentation governing the affected behavior and inspect the relevant code and tests.

For a typo, formatting change, or internal refactor with unchanged behavior, inspect only the affected documentation and record when no documentation update is needed.

For changes to product behavior, domain terminology, deferred wiring, or backlog scope, read the relevant discovery decisions, open questions, wiring entries, screen specifications, and linked requirements/tests. Update only the artifacts affected by the change.

If code and documentation disagree, establish the intended behavior from the request and authoritative decisions before changing either.

A task is complete when the affected documentation accurately represents the final behavior and the applicable validation has been performed.

## Implementation Workflow Per Task
1. Identify the requested scope; map it to a backlog item or screen when applicable.
2. Implement only behavior covered by docs or explicitly update docs first.
3. If using placeholders/stubs, record them in docs as temporary implementation state.
4. Run validation (tests/lint/typecheck as applicable).
5. Update affected docs when needed; otherwise record why no update is necessary.

## Documentation Update Rules
Whenever behavior changes, update all impacted artifacts:
- Functional requirements: `docs/functional-requirements/`
- Use cases: `docs/use-cases/`
- Acceptance criteria: `docs/acceptance-criteria/`
- Business rules: `docs/business-rules/`
- Test cases: `docs/test-cases/`
- Screen specs/copy: `docs/screens/v2/`
- Diagrams: `docs/diagrams/`
- Decisions/backlog mapping: `docs/discovery/`

## Backend Provider Tracking
- Current app-domain backend baseline is the root-level MyChampions server:
  server-owned auth/session handling, Postgres/Drizzle persistence, and
  server-managed image storage (local filesystem by default and private GCS
  when configured in production).
- Firebase Auth, Cloud Firestore, and Firebase Cloud Storage are retired mobile
  runtime context, not the current backend baseline.
- Track the retired provider migration and its replacement references in:
  - `docs/discovery/backend-provider-migration-v1.md`
- If a document introduces backend provider terminology, ensure it is
  consistent with the MyChampions server baseline or explicitly marked as
  retired, superseded, or legacy context.

## Deferred Wiring Policy
- If wiring is intentionally deferred, add/update an entry in:
  - `docs/discovery/pending-wiring-checklist-v1.md`
- Also add/update a decision entry in:
  - `docs/discovery/decisions-log-v1.md`
- Deferred work must have clear status (`Pending`, `In progress`, `Done`).

## Localization Policy
- All user-facing strings must be documented and prepared for:
  - `en-US`
  - `pt-BR`
  - `es-ES`
- Source of truth:
  - `docs/screens/v2/localized-copy-table-v2.md`
- No user-facing copy literals are allowed in screen `TSX` files; use localization keys and locale bundles.
- Every new screen must ship with keys populated in all three bundles (`en-US`, `pt-BR`, `es-ES`) in the same change.

## Done Criteria For Any Session
A session is only complete when:
1. Code matches current docs.
2. Docs reflect final implemented behavior of that session.
3. Backlog traceability is updated when scope moved forward.
4. Deferred wiring/localization gaps are explicitly tracked (not implicit).
