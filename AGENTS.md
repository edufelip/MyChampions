# Documentation-First Agent Rules

## Core Contract
- Every single change to our application shall be validated according to the current documentation.
- Documentation shall be updated upon any change that happens in code.

## Mandatory Workflow For Any Change
1. Read the relevant docs before touching code.
2. Implement the change.
3. Validate behavior against existing docs.
4. Update documentation in the same change when behavior, UI, rules, requirements, or tests are impacted.
5. If docs and code conflict, resolve the conflict by updating docs and code until they match.

## Minimum Documentation Areas To Check
- `docs/functional-requirements/`
- `docs/use-cases/`
- `docs/acceptance-criteria/`
- `docs/business-rules/`
- `docs/test-cases/`
- `docs/screens/`
- `docs/diagrams/`

## Review Gate
- No task is complete if docs do not represent the final implemented behavior.

## New Session Start Checklist (Mandatory)
Before starting any implementation in a new session:
1. Read `docs/discovery/prioritized-backlog-v1.md` to identify the exact backlog item and priority.
2. Read `docs/discovery/decisions-log-v1.md` for locked product decisions.
3. Read `docs/discovery/open-questions-v1.md` to confirm if anything is unresolved.
4. Read `docs/discovery/pending-wiring-checklist-v1.md` for intentionally deferred wiring work.
5. Read the relevant screen specs under `docs/screens/v2/`.
6. Read linked FR/UC/AC/BR/TC artifacts before writing code.

## Implementation Workflow Per Task
1. Pick one backlog item/screen scope.
2. Implement only behavior covered by docs or explicitly update docs first.
3. If using placeholders/stubs, record them in docs as temporary implementation state.
4. Run validation (tests/lint/typecheck as applicable).
5. Update docs in the same change.

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
