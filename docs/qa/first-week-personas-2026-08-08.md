# First-week persona QA report — 2026-08-08

## Run record

| Field                  | Evidence                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| QA run                 | [ET-25](https://linear.app/edulyta/issue/ET-25/qa-run-webfirst-week-personas-local-2026-08-08)           |
| Tested app head        | `df48a33` (`codex/testing-strategy-app`)                                                                 |
| Date and timezone      | 2026-08-08, America/Sao_Paulo                                                                            |
| Charter                | Browser-first first-week personas across the documented feature manifest                                 |
| Local browser evidence | `.artifacts/web-e2e/2026-08-09T02-19-23Z-full/`                                                          |
| Local browser result   | `yarn test:e2e:web`: 74 passed, 4 expected skips                                                         |
| Native result          | Unverified in this session; protected iOS/Android workflow is wired but no approved runner was available |
| Provider result        | Blocked before build/provider access; no approved RevenueCat Test Store `test_*` SDK key was available   |

This run used the repository Playwright surface because the connected in-app browser was unavailable. The local browser evidence is valid for browser-observable behavior; it does not replace native touch, permission, simulator/emulator, or provider-live evidence.

## Persona coverage

| Persona                             | Feature families exercised                                                                  | Result                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New Student                         | `auth`, `student`, `connections`, `nutrition`, `training`, `platform`                       | Browser shell/onboarding and manual invite fallback passed. Native role-persistence, malformed QR, and camera-permission scenarios remain unverified.                              |
| Professional managing care          | `auth`, `professional`, `plans`, `nutrition`, `training`, `subscription`                    | Professional dashboard and fail-closed subscription presentation passed in browser. Deep plan/support flows, native execution, and provider-live reconciliation remain unverified. |
| Returning Student tracking progress | `auth`, `student`, `nutrition`, `training`, `support`, `offline`, `platform`, `connections` | Browser shell/accessibility/core paths passed. Support submission, offline device behavior, native execution, and provider-live state remain unverified.                           |

## Manifest traceability

The original manifest has twelve feature families. `detox:auth-role-persistence` is recorded as a nested auth phase, not as a thirteenth product family.

| Manifest family                           | Documentation trace                                                                                                               | Run disposition                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `auth` (including role persistence phase) | UC-002.1, UC-002.8, UC-002.18; AC-248, AC-249B, AC-512; TC-249, TC-296, TC-512                                                    | Browser auth/shell passed. Native relaunch persistence is covered by the protected lane but unverified here.             |
| `connections`                             | UC-002.3, UC-002.9–UC-002.11; AC-249, AC-249A, AC-250–AC-253; TC-250, TC-251, TC-253–TC-255                                       | Browser manual-code fallback passed. Valid and malformed native QR paths are unverified here.                            |
| `nutrition`                               | UC-002.4, UC-002.13, UC-002.17, UC-002.19, UC-003.2; AC-255, AC-257, AC-259–AC-263, AC-426; TC-259, TC-261, TC-264–TC-267, TC-426 | Browser nutrition surfaces and contract coverage passed. Camera-permission-denied native path is unverified here.        |
| `training`                                | UC-002.4, UC-002.17; AC-257; TC-210, TC-216, TC-261                                                                               | Included in the full browser matrix; deep native builder proof is unverified here.                                       |
| `plans`                                   | UC-002.14, UC-002.20; AC-256, AC-264, AC-265, AC-541; TC-260, TC-268–TC-280                                                       | Included in the full browser matrix; deep assignment/builder and native proof are unverified here.                       |
| `professional`                            | UC-002.2, UC-002.12, UC-002.15, UC-002.17, UC-002.18; AC-254, AC-257, AC-312, AC-512; TC-257, TC-258, TC-261, TC-311, TC-512      | Professional dashboard and critical path passed in browser. Native and deeper care-management paths are unverified here. |
| `subscription`                            | UC-002.6, UC-002.15; AC-301–AC-312; TC-301–TC-311, TC-434, TC-512                                                                 | Browser fail-closed behavior passed. Deterministic native fixtures are not provider-live evidence.                       |
| `revenuecat-live`                         | UC-002.6; AC-301–AC-312; TC-435, TC-436                                                                                           | Blocked at preflight with exit 2 because the approved `test_*` SDK key was unavailable.                                  |
| `support`                                 | UC-002.5; AC-006; TC-304                                                                                                          | Not a targeted browser persona assertion in this run; native/provider evidence remains unverified.                       |
| `student`                                 | UC-002.3, UC-002.4, UC-002.17–UC-002.19; AC-209, AC-210, AC-257, AC-259–AC-263, AC-512; TC-249, TC-261, TC-512                    | Student shell/onboarding paths passed in browser. Native device and deeper assigned-state proof are unverified here.     |
| `offline`                                 | UC-002.17; AC-257; TC-261                                                                                                         | Browser contract coverage exists; offline device behavior is unverified here.                                            |
| `platform`                                | UC-002.18; AC-512; TC-512, TC-518                                                                                                 | Browser responsive/fallback coverage passed. Native permission and platform-specific behavior are unverified here.       |

## Evidence and triage

- Full Playwright evidence includes Chromium mobile/tablet coverage and Firefox/WebKit coverage where the manifest allows it. The run produced `results.json`, `results.xml`, `run-metadata.json`, an HTML report, and `manual-validation.md` under the run root.
- Visual evidence metadata was generated for the browser suite. All 16 captured states were `unbaselined`; no baseline was invented or refreshed, so no visual pass is claimed.
- The RevenueCat preflight was run with distinct non-secret proof identities and no SDK key. It correctly stopped with: `EXPO_PUBLIC_REVENUECAT_API_KEY_TEST_STORE must be a test_* SDK key.`
- No Bug was filed. The charter requires two independent reproductions plus a control before creating a Bug; this run produced no such defect evidence.

## Follow-up gates

1. Run `.github/workflows/detox-protected-full.yml` on approved iOS and Android self-hosted runners and attach the platform-specific reports.
2. Run `.github/workflows/provider-validation.yml` only after approved Test Store credentials, catalog identifiers, and read-only reconciliation access are available.
3. Establish reviewed visual baselines and ignore rectangles before turning `unbaselined` into a visual pass.
4. Repeat this report on the recurring schedule after the hosted exact-head status publisher and runner cleanup SLO have produced evidence.
