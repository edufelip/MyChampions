# Web Playwright batches and manual validation

## Purpose

Define repeatable browser test batches and a reviewable evidence package for MyChampions web. The suite remains local/build-only: it starts Expo web on `127.0.0.1:8081`, uses deterministic E2E auth/entitlement fixtures, writes ignored artifacts, and does not deploy or mutate provider or production state.

## Executable batches

| Batch                   | Command                                     | Engines                              | Intended use                                            | Current coverage                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------- | ------------------------------------ | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Smoke                   | `yarn test:e2e:web:smoke`                   | Chromium                             | Fast local/PR signal                                    | Mobile, tablet, and desktop role onboarding; navigation geometry; horizontal overflow.                                                                                                                                                                                                                                                                    |
| Functional              | `yarn test:e2e:web:functional`              | Chromium, Firefox, WebKit            | Platform-specific behavior                              | Camera-denied manual invite fallback and subscription mobile-handoff surface.                                                                                                                                                                                                                                                                             |
| Accessibility           | `yarn test:e2e:web:accessibility`           | Chromium, Firefox, WebKit            | Keyboard, contrast, and dialog regression               | Explicit readable enabled/disabled controls, visible focus, logical role-option order, focus containment, Escape close, and focus restoration.                                                                                                                                                                                                            |
| Evidence                | `yarn test:e2e:web:evidence`                | Chromium                             | Screenshot package for human review                     | Role selection, student home, and student account shell at three widths, professional home/unknown-entitlement handoff, and manual invite fallback.                                                                                                                                                                                                       |
| Complete flow atlas     | `yarn test:e2e:web:flow-atlas`              | Chromium at mobile/tablet/web widths | Exhaustive implemented-flow evidence and manual review  | 13 flow folders, 65 base checkpoints per platform plus 4 mobile-only auth checkpoints (199 total), exact-name verifier, auth/app HTML reports. The auth flow atlas is also a required selective-CI suite on Pixel 5 projects for en-US, pt-BR, and es-ES; the broader atlas remains local/manual evidence.                                                |
| Mobile WebView recovery | `yarn test:e2e:web:manual-webview-recovery` | Pixel 5 mobile Chromium              | Manual runtime proof for malformed shared-link recovery | Authenticated mobile fixture verifies duplicate URL query parameters render the localized invalid-link state, keep the Back action in view, prevent external-link exposure, return to the professional app shell, and allow an exact configured legal URL on a custom trusted host. Local/manual only.                                                    |
| Professional dashboard responsive | `yarn playwright test --config=playwright.professional-home.config.ts e2e/web/professional-home-responsive.spec.ts` | Pixel 5 mobile Chromium, en-US/pt-BR/es-ES | Compact dashboard regression | Authenticated professional fixture verifies no horizontal overflow, readable full-width cards below 400 CSS px, a wrapped task CTA, and the two-column summary layout at 412 CSS px. Evidence is local/manual unless selected by the feature-impact runner. |
| Student nutrition tab error recovery | `yarn playwright test --config=playwright.student-nutrition-error.config.ts` | Chromium at 390x844 and 412x915 | Load-error retry regression (ET-163) | Authenticated student fixture forces a settled plans/connections load failure and verifies the `student.nutrition.loadError` card renders a real `role="button"` Retry control (`student.nutrition.loadError.retry`) that re-invokes the plans and connections reload and settles back into the same actionable error state. Registered as `web:student-nutrition-error` and selected by the feature-impact runner. |
| Server auth             | `yarn test:e2e:web:server`                  | Chromium, Firefox, WebKit            | Real client/server browser contract and PR gate         | Email create/sign-in, terms, role onboarding, HttpOnly cookie attributes, refresh rotation, ready-home restoration with error-state rejection, and logout. Local runs default to sibling `server`; CI passes the coordinated backend checkout through `MYCHAMPIONS_SERVER_ROOT`. The backend uses in-memory auth state and never runs against production. |
| Full                    | `yarn test:e2e:web`                         | Chromium, Firefox, WebKit            | Build-only CI/regression gate                           | All current tests, failure diagnostics, and cross-engine screenshot attachments.                                                                                                                                                                                                                                                                          |

The critical-path batch is registered as `web:critical-paths` and runs the
critical product-path spec on Chromium, Firefox, and WebKit. Its Chromium lane
also exercises mobile (390x844) and tablet (820x1000) viewports for student
onboarding, camera-denied/manual invite fallback, and overflow safety. It does
not replace the existing smoke, functional, accessibility, server-auth, or
flow-atlas batches.

The authentication flow atlas is registered as `web:flow-atlas-auth` with the
standard Playwright runner. Its required CI projects are `mobile-auth`,
`mobile-auth-pt`, and `mobile-auth-es`; each uses true Pixel 5 mobile
emulation with touch input and the corresponding locale. The local auth-flow
config retains the same three mobile lanes plus tablet and desktop review
lanes. This keeps the first-run auth redesign covered by a required mobile
regression signal while preserving the larger screenshot package for manual
review. The atlas is also mapped to the `auth` feature so every auth-impact
change selects all three localized mobile projects even when the atlas spec
itself is unchanged.
The atlas also verifies localized Google/Apple accessible names and confirms
sign-in password validation renders between the password field and the primary
CTA.

The training search suite runs with an isolated Playwright configuration and
Pixel 5 mobile emulation. It covers the initial, loading, empty, error with
retry, and successful-result states, one named dialog root, compact keyboard-
safe geometry, and expected error logging without exposing training fixtures to
unrelated browser batches.

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

## Promotion gates

- Smoke can gate every browser-affecting pull request.
- Functional and accessibility should pass before browser-facing changes are reviewed.
- Full is the automated code-structure regression gate.
- Server auth is a required PR gate for the browser cookie-session contract.
- Evidence plus a named human reviewer is required when accepting visual behavior.
- Fixture success does not replace provider-live, server-backed, assistive-technology, or deployment evidence listed in `docs/discovery/web-pending-items-and-future-improvements.md`.
