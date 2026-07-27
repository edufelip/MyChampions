# Selective Feature Test Execution

## Current rollout state

The feature-aware resolver is in shadow mode. It reports proposed Detox and
Playwright suites, while the existing Android, iOS, and web PR workflows remain
authoritative. Universal unit, lint, type, manifest, and workflow-contract checks
run in the shadow workflow.

Selective browser/device execution must not become required until at least two
weeks and 20 representative pull requests have completed with zero known
selection misses.

## Sources of truth

- `config/test-impact.json`: feature paths, dependencies, owners, shared rules,
  suites, platforms, fixture profiles, and CI eligibility.
- `scripts/ci/test-impact.ts`: matching, validation, graph construction, and
  conservative impact resolution.
- `.github/workflows/pr-selective-tests.yml`: merge-base inputs, shadow reporting,
  fast checks, artifacts, and the stable shadow gate.
- `.github/CODEOWNERS`: review ownership aligned with feature paths.

## Resolution contract

For pull requests, the resolver computes the Git merge base and uses
`git diff --name-status -M -C --find-copies-harder <merge-base> <head>`. Rename and copy entries
contribute old and new paths; deletion entries retain the deleted path.

The selected feature set is the union of direct path owners, suite owners,
reverse TypeScript import consumers from both the base and head graphs, and
transitive reverse dependents declared by the manifest.

The complete registered CI matrix is selected when impact metadata, workflows,
lockfiles, native/tooling configuration, or global shared code changes; when a
runtime path is unmapped; when validation or Git resolution fails; when more
than 500 files change; or when `ci:full`/`CI_FORCE_FULL=true` requests broader
coverage.

Documentation-only changes select no expensive suite.

## Local validation

```bash
yarn test:impact
yarn test:impact:resolver
yarn test:impact:resolve --base develop --head HEAD
```

The resolver writes:

```text
.artifacts/test-impact/
  impact.json
  summary.md
```

The JSON records direct and transitive features, shared rules, selected suites,
platforms, reasons, confidence, fallback reasons, and unmapped paths.

## Promotion evidence

For every shadow PR, retain the impact artifact and record:

- Selected-to-total suite ratio.
- Resolver fallback and unmapped-path rate.
- Fast and existing full-gate duration.
- Flaky retry rate.
- Any failure found by an authoritative/full run that the proposed selection
  omitted.

Promotion requires zero reproducible omissions, complete runtime ownership,
passing rename/delete/merge/dependency contracts, and working fixture-profile
execution. After promotion, add full nightly iOS, Android, and browser coverage,
retain release/hotfix full gates, and keep `CI_FORCE_FULL` as the rollback switch.
