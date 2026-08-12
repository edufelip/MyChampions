# Static analysis and local quality gates

The mobile app uses strict TypeScript plus scoped ESLint rules for typed
TypeScript, React Hooks, and import ordering. The typed rules are scoped to
TypeScript sources and high-volume legacy findings remain warnings until they
can be fixed without unrelated churn.

## Commands

- yarn lint runs ESLint across app, components, features, scripts, tests, and
  E2E sources.
- yarn typecheck runs tsc --noEmit against the strict project.
- yarn format formats tracked app, feature, script, test, E2E, and root
  configuration sources.
- yarn format:check checks the same source scope without modifying files.
- The Husky pre-commit hook runs lint-staged, which formats and lints only
  staged supported files.

The initial rollout does not enable noUncheckedIndexedAccess. Its error count
must be measured in a separate change before enabling it, and any future
enablement must keep the resulting fixes narrowly actionable.

Generated native, Expo, coverage, report, and artifact directories are excluded
from the formatter and ESLint scan.
