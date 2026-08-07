# Feature boundaries

`config/test-impact.json` is the source of truth for feature ownership, declared
dependencies, and UI-test suites.

New feature code belongs under `features/<feature-id>/`. Cross-feature imports
must be intentional and represented by `dependsOn`. Prefer a feature's public
entry point when one exists; direct internal imports are legacy-compatible while
the boundary ratchet is introduced.

The existing `nutrition`/`plans` and `professional`/`subscription` relationships
contain bidirectional implementation dependencies. They are recorded as explicit
legacy exceptions in the impact manifest. New dependency cycles are rejected.

Routes under `app/` compose features but do not own domain logic. Reusable,
feature-neutral UI stays under `components/ds/`; platform adapters stay under
`features/platform/`.

Before adding or moving a runtime file:

1. Add its path to exactly one feature or shared rule.
2. Declare any new dependency.
3. Register every new Detox or Playwright spec in a suite.
4. Update `CODEOWNERS` when ownership changes.
5. Run `yarn test:impact` and `yarn test:impact:resolver`.
