# Web Playwright batches and manual validation

## Purpose

Define repeatable browser test batches and a reviewable evidence package for MyChampions web. Existing fixture batches remain local/build-only and normally start Expo on `127.0.0.1:8081`. The integrated batch owns isolated loopback ports and disposable Postgres through the real sibling server. Both write ignored artifacts and do not deploy or mutate provider or production state.

## Executable batches

The 17 existing root `playwright*.config.ts` files are compatibility aliases.
Their separate fixture, memory-server, locale/device, error and subscription
capability states live in `e2e/web/support/test-profiles.ts`; shared report/output
setup lives in `create-web-test-config.ts`. Commands and existing profile
settings remain unchanged. BL-018 P3 records deep equality of all 34 local/CI
configurations and exact discovery equality for all 17 aliases. These checks
prove configuration/selection parity; executed browser receipts are separate.
Changes to either shared helper trigger the conservative full test selection.

| Batch                                         | Command                                                                                                                                   | Engines                                     | Intended use                                            | Current coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke                                         | `yarn test:e2e:web:smoke`                                                                                                                 | Chromium                                    | Fast local/PR signal                                    | Mobile, tablet, and desktop role onboarding; navigation geometry; horizontal overflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Functional                                    | `yarn test:e2e:web:functional`                                                                                                            | Chromium, Firefox, WebKit                   | Platform-specific behavior                              | Camera-denied manual invite fallback and subscription mobile-handoff surface.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Accessibility                                 | `yarn test:e2e:web:accessibility`                                                                                                         | Chromium, Firefox, WebKit                   | Keyboard, contrast, and dialog regression               | Explicit readable enabled/disabled controls, visible focus, logical role-option order, focus containment, Escape close, and focus restoration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Evidence                                      | `yarn test:e2e:web:evidence`                                                                                                              | Chromium                                    | Screenshot package for human review                     | Role selection, student home, and student account shell at three widths, professional home/unknown-entitlement handoff, and manual invite fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Complete flow atlas                           | `yarn test:e2e:web:flow-atlas`                                                                                                            | Chromium at mobile/tablet/web widths        | Exhaustive implemented-flow evidence and manual review  | 13 flow folders, 65 base checkpoints per platform plus 4 mobile-only auth checkpoints (199 total), exact-name verifier, auth/app HTML reports. The auth flow atlas is also a required selective-CI suite on Pixel 5 projects for en-US, pt-BR, and es-ES; the broader atlas remains local/manual evidence.                                                                                                                                                                                                                                                                                                                                      |
| Mobile WebView recovery                       | `yarn test:e2e:web:manual-webview-recovery`                                                                                               | Pixel 5 mobile Chromium                     | Manual runtime proof for malformed shared-link recovery | Authenticated mobile fixture verifies duplicate URL query parameters render the localized invalid-link state, keep the Back action in view, prevent external-link exposure, return to the professional app shell, and allow an exact configured legal URL on a custom trusted host. Local/manual only.                                                                                                                                                                                                                                                                                                                                          |
| Professional dashboard responsive             | `yarn playwright test --config=playwright.professional-home.config.ts e2e/web/professional-home-responsive.spec.ts`                       | Pixel 5 mobile Chromium, en-US/pt-BR/es-ES  | Compact dashboard regression                            | Authenticated professional fixture verifies no horizontal overflow, readable full-width cards below 400 CSS px, a wrapped task CTA, and the two-column summary layout at 412 CSS px. Evidence is local/manual unless selected by the feature-impact runner.                                                                                                                                                                                                                                                                                                                                                                                     |
| Professional student roster hero responsive   | `yarn playwright test --config=playwright.professional-students-roster.config.ts e2e/web/professional-students-roster-responsive.spec.ts` | Pixel 5 mobile Chromium, en-US              | Small-phone roster heading regression (ET-159, ET-167)  | Authenticated professional roster fixture verifies no horizontal overflow and that the "My students" hero title column is wide enough to wrap only between whole words at 320 CSS px (the "Bulk assign plan" CTA moves to its own row below the title instead of sharing it), while the existing 390 CSS px layout (CTA inline with the title) is unchanged. A second test exercises the same hero header once bulk-assign selection mode is active, asserting the "Bulk Assignment" title and "Cancel" CTA share the identical 320 CSS px breakpoint behavior (ET-167). Evidence is local/manual unless selected by the feature-impact runner. |
| Professional bottom tab bar labels responsive | `yarn playwright test --config=playwright.professional-tabbar-labels.config.ts e2e/web/professional-tabbar-labels-responsive.spec.ts`     | Pixel 5 mobile Chromium, en-US              | Small-phone tab-label truncation regression (ET-168)    | Authenticated professional fixture navigates to the Students and Training tabs at 320 CSS px and asserts the persistent bottom tab bar keeps the short static labels ("Students", "Training") legible and unclipped, instead of the nested screen's longer web document title ("My students", "Training Plans") bubbling up into `tabBarLabel` and truncating mid-word. Registered as `web:professional-tabbar-labels` and selected by the feature-impact runner.                                                                                                                                                                               |
| Student nutrition tab error recovery          | `yarn playwright test --config=playwright.student-nutrition-error.config.ts`                                                              | Chromium at 390x844 and 412x915             | Load-error retry regression (ET-163)                    | Authenticated student fixture forces a settled plans/connections load failure and verifies the `student.nutrition.loadError` card renders a real `role="button"` Retry control (`student.nutrition.loadError.retry`) that re-invokes the plans and connections reload and settles back into the same actionable error state. Registered as `web:student-nutrition-error` and selected by the feature-impact runner.                                                                                                                                                                                                                             |
| Exercise search modal                         | `yarn playwright test --config=playwright.training.config.ts e2e/web/exercise-search-modal.spec.ts`                                       | Chromium at Pixel 5, 320x720, and 1440x1000 | Responsive dialog and close-control regression (ET-172) | Isolated training fixture verifies initial, loading, empty, error/retry, result, focused compact, and centered desktop dialog states without browser errors. Registered as `web:exercise-search` and selected by the feature-impact runner.                                                                                                                                                                                                                                                                                                                                                                                                     |
| Custom-meal library error recovery            | `yarn playwright test --config=playwright.custom-meal-error.config.ts e2e/web/custom-meal-library-error-recovery.spec.ts`                 | Chromium at 390x844 and 412x915             | Negative fixture isolation regression                   | Dedicated Expo profile omits `EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE` so the recoverable load error cannot be masked by the positive custom-meal fixture. Registered as `web:custom-meal-error` and selected by the feature-impact runner.                                                                                                                                                                                                                                                                                                                                                                                                        |
| Professional roster error recovery            | `yarn playwright test --config=playwright.professional-roster-error.config.ts e2e/web/professional-roster-error.spec.ts`                  | Chromium at 390x844 and 412x915             | Negative fixture isolation regression                   | Dedicated Expo profile omits `EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE` so the settled roster error remains visible and actionable. Registered as `web:professional-roster-error` and selected by the feature-impact runner.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Server auth                                   | `yarn test:e2e:web:server`                                                                                                                | Chromium, Firefox, WebKit                   | Real client/server browser contract and PR gate         | Email create/sign-in, terms, role onboarding, HttpOnly cookie attributes, refresh rotation, ready-home restoration with error-state rejection, logout, and the sign-in double-submit guard (ET-162: a rapid multi-click on the sign-in CTA fires exactly one `POST /auth/email/sign-in`). Local runs default to sibling `server`; CI passes the coordinated backend checkout through `MYCHAMPIONS_SERVER_ROOT`. The backend uses in-memory auth state and never runs against production.                                                                                                                                                        |
| Full                                          | `yarn test:e2e:web`                                                                                                                       | Chromium, Firefox, WebKit                   | Build-only CI/regression gate                           | All current tests, failure diagnostics, and cross-engine screenshot attachments.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The critical-path batch is registered as `web:critical-paths` and runs the
critical product-path spec on Chromium, Firefox, and WebKit. Its Chromium lane
also exercises mobile (390x844) and tablet (820x1000) viewports for student
onboarding, camera-denied/manual invite fallback, and overflow safety. It does
not replace the existing smoke, functional, accessibility, server-auth, or
flow-atlas batches.

The authentication flow atlas is registered as `web:flow-atlas-auth` with the
standard Playwright runner, but its registry currently sets `ci: false`.
BL-018/P6 reconciles registry and observation workflow selection with the
resolved profile: `mobile` (Pixel 5, en-US), `tablet`, and `web`. The source
parity regression rejects the former nonexistent `mobile-auth*` projects.
The suite remains `ci: false` with non-blocking observation steps; browser and
exact-revision hosted execution are Pending. This is not a proven three-locale
atlas or a passing CI signal. Profile settings and D-195 gates remain unchanged;
feature mapping alone does not prove execution.
The atlas also verifies localized Google/Apple accessible names and confirms
sign-in password validation renders between the password field and the primary
CTA.

The training search suite runs with an isolated Playwright configuration and
Pixel 5 mobile emulation. It covers the initial, loading, empty, error with
retry, and successful-result states, one named dialog root, compact keyboard-
safe geometry, and expected error logging without exposing training fixtures to
unrelated browser batches.

The negative nutrition and professional-roster recovery suites also use
dedicated Playwright configurations and Expo ports. Their bundles intentionally
omit the corresponding positive fixture (`EXPO_PUBLIC_E2E_CUSTOM_MEALS_FIXTURE`
or `EXPO_PUBLIC_E2E_PRO_ROSTER_FIXTURE`) so a recoverable load error cannot be
masked by the success fixture used by the broader feature suites.

Run both local lanes with `yarn test:e2e:web:all-local`. They intentionally use separate Expo ports and clear Metro state so fixture configuration cannot leak into the real-server bundle or vice versa.

Run the manual mobile recovery proof with
`yarn test:e2e:web:manual-webview-recovery`. It uses the shared evidence runner,
true Playwright mobile emulation (`Pixel 5`, mobile context, touch input), an
isolated Expo port, and the same timestamped artifact contract as the other
batches; the generated screenshot, HTML/JSON/JUnit reports, metadata, and
manual checklist remain under the ignored `.artifacts/` directory.

The runner accepts extra Playwright arguments after the batch name. For example, `node scripts/run-web-e2e-batch.mjs evidence --headed` runs the evidence batch visibly.

The professional dashboard responsive proof uses an isolated Expo web server on
port `8086` and true Playwright Pixel 5 emulation. It runs once for each
supported locale, captures the 390 CSS px stacked state and the 412 CSS px
two-column state, and keeps the generated HTML/JSON reports and screenshots in
the ignored directory selected by `WEB_E2E_ARTIFACT_ROOT`.

## Artifact contract

Each command creates a timestamped directory under `.artifacts/web-e2e/<run-id>/`. `.artifacts/` is gitignored.

```text
.artifacts/web-e2e/<run-id>/
├── html-report/index.html
├── manual-validation.md
├── results.json
├── results.xml
├── run-metadata.json
├── screenshots/<browser>/*.png
├── screenshots/<browser>/*.json
└── test-results/**
```

- `run-metadata.json` records batch, command, timestamps, exit status, Git SHA, dirty-tree signal, and screenshot count.
- `html-report` contains test steps and attached screenshots; failures retain screenshots and traces according to `playwright.config.ts`.
- `results.json` supports later evidence-report generation and coverage summaries.
- `results.xml` supports CI test reporting.
- `screenshots` uses readable checkpoint names for manual comparison; these are evidence captures, not approved golden baselines.
- Each screenshot has a JSON triage record with the checkpoint, actual path,
  optional baseline, optional side-by-side and diff paths, verdict, diff
  percentage, changed-pixel bounding box, and explicit ignore rectangles.
  Without `WEB_E2E_VISUAL_BASELINE_ROOT` the verdict is `unbaselined`, not
  `pass`.
- `manual-validation.md` is generated after every batch and includes a review decision plus one row per explicit screenshot.

The authoritative feature-selective workflow validates the web export and runs
the affected registered deterministic and server-auth suites on the exact head.
It installs the branch-paired backend's locked Bun dependencies only when a
selected suite needs that configuration; Playwright then starts and stops the
in-memory backend on port `3401` and Expo web on port `8082`. No database,
provider credential, or production secret is required. Successful selective
runs upload no `.artifacts/web-e2e`, web export, test report, or GitHub Actions
cache. Only bounded `.artifacts/ci-diagnostics/web` failure evidence may be
uploaded, with one-day retention. The legacy `web-pr.yml` workflow is
manual-only.

## Complete flow atlas status

The complete mapping, exact flow/checkpoint inventory, documented-use-case coverage, and honest non-visual/specification gaps live in `docs/test-cases/complete-flow-screenshot-atlas.md`.

The registered `web:exercise-search` selective suite includes
`e2e/web/exercise-search-modal.spec.ts`, which uses real Playwright Pixel 5
mobile emulation to assert the initial dialog bounds, focus, named dialog
semantics, localized initial helper state, search result, and close behavior
before a query can mask an off-screen opening state. Its compact lane reduces
the visible height to model the keyboard-open state and fails on page errors or
console errors. It runs under its own `playwright.training.config.ts` (its own
dev-server fixture profile), kept as a separate suite from `web:training`
(which still covers `e2e/web/responsive-shell.spec.ts` under the default
config) specifically so the shared shell spec's other feature-tagged tests
(auth, student, professional, connections, nutrition) keep running with the
fixture environment they actually need instead of the narrower training one.

The atlas is deliberately separate from the three-engine regression batches. It uses Chromium at three responsive widths so the folder names describe product layout modes rather than browser engines. Provider-live, native-device, real assistive-technology, and production deployment validation remain deferred and are not represented as screenshot proof.

## Screenshot checkpoint rules

1. Assert the target state before capturing it; a screenshot alone is not proof.
2. Disable animation and hide the caret for deterministic evidence.
3. Use a semantic checkpoint name such as `desktop-subscription-handoff`.
4. Capture the smallest representative set: transitions and distinct responsive states, not every click.
5. Never include passwords, access/refresh tokens, personal health data, or production identifiers.
6. Treat screenshots as local artifacts. They do not become tracked baselines without explicit approval and a recorded reviewer.
7. A baseline refresh, if adopted later, must state who approved the visual change and why.

## Optional visual comparison

Set `WEB_E2E_VISUAL_BASELINE_ROOT` to a directory with the same project/flow
path layout as the generated screenshots to enable comparison. The comparator
uses exact RGBA pixels: a deliberate two-pixel shift fails, while a difference
fully contained by `WEB_E2E_VISUAL_IGNORE_RECTS` is masked and passes. The
ignore-rectangle value is JSON: either an array of `{x,y,width,height}` objects
for every checkpoint or an object keyed by checkpoint. Baselines are never
created or refreshed by a test run.

## Manual validation procedure

1. Run `yarn test:e2e:web:evidence` for the focused visual package, then run `yarn test:e2e:web:all-local` before final acceptance when the sibling server checkout is available.
2. Open the run's `html-report/index.html`; review retries, failures, traces, console/network symptoms, and screenshot attachments.
3. Open `manual-validation.md` and inspect each file under `screenshots/` at its captured size.
4. Mark layout/content and responsive/interaction state for every screenshot. Record OS/browser used for review.
5. Reject the run if content clips/overlaps, navigation uses the wrong breakpoint, focus/modal state is unclear, untranslated/debug copy appears, or restricted web actions are exposed.
6. Link every rejection to a reproducible issue/task. Fix and generate a new run; do not edit old generated evidence to look successful.
7. Record the reviewer and Accepted/Rejected decision in the checklist. If the evidence is used for a merge/release gate, copy the signed local decision into the task card/evidence report according to the team retention policy.

## BL-018 integration batch (local, In progress)

`MYCHAMPIONS_SERVER_ROOT=/absolute/path/to/server yarn test:e2e:web:integration --scenario=auth-session --project=chromium` selects
one real Postgres auth case. The integration runner requires an absolute,
canonical owning server checkout in `MYCHAMPIONS_SERVER_ROOT`; it validates the
server package, Git root and owned session entrypoint before Docker or browser
acquisition. Projects: desktop `chromium`, `firefox`, `webkit`,
and Chromium `mobile-en`, `mobile-pt`, `mobile-es`, `tablet-en`, `tablet-pt`,
`tablet-es`; suffixes map to en-US/pt-BR/es-ES. Default selection requests all five
scenarios/nine projects. Training is implemented; nine-project evidence is recorded in the task card.
Connection approval has nine-project proof with fresh repeats.
Save retry passes two fresh nine-project matrices. Unrelated denial has focused
Chromium proof and both combined matrices pass. All five scenarios are implemented;
two fresh complete matrices pass 90 cases and 702 assertions. Training fresh repeats pass in the recorded task-card scope.
Requesting unfinished cases blocks rather than narrowing. Only explicit scenario,
project and `--deadline-ms=<milliseconds>` arguments are accepted.

Private context/fixtures, observed request origin, resolved Expo config, actual
execution identities and every assertion are validated before public V1 receipts
under `.qa/artifacts/web-integration/<run-id>/`. Discovery is selection evidence.
`0` means all requested cases passed, `1` is an application/test failure, `2` is a
harness block; cancellation preserves 130/143 and original child status. Cleanup
failure prevents success. Raw logs/traces remain private and may contain test
credentials; public receipts are redacted.

Auth covers create/onboard/reload/sign-out/revocation and normal relogin through
real routes. Read the task card for current matrix/fingerprint evidence; this
supplies no native/provider/hosted claim. The direct owned T18
`playwright-integration` runner preserves explicit scenario/project selection
and exact server-root binding. The selective executor can render that
selection only with `--plan`/`--dry-run`; it rejects inactive integration
suites during executable selective runs. All five impact entries remain
`ci: false` until protected hosted evidence exists. The explicit
`yarn tsx scripts/testing/verify-web-integration.ts` verifier checks six rejection
probes, observed live-worker SIGINT/SIGTERM and whole-run deadline cleanup.

## Promotion gates

- Smoke can gate every browser-affecting pull request.
- Functional and accessibility should pass before browser-facing changes are reviewed.
- Full is the automated code-structure regression gate.
- Server auth is a required PR gate for the browser cookie-session contract.
- Evidence plus a named human reviewer is required when accepting visual behavior.
- Fixture success does not replace provider-live, server-backed, assistive-technology, or deployment evidence listed in `docs/discovery/web-pending-items-and-future-improvements.md`.
