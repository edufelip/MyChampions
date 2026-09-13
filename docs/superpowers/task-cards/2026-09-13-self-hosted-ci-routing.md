# Task Card: Self-hosted CI/CD routing

## Status

Current bucket: macOS local-runner acceptance repair in progress
Risk level: High (persistent runner trust boundary, signing, release delivery,
and exact-head enforcement)
Owner: Codex
Blocked by: The recovered Mac runner now completes its toolchain, Debug build,
and Detox launch. Run `34772832273` then exposed two legacy smoke-harness
defects: it reused default Metro port `8081` instead of the documented owned
port, and auth-entry disabled synchronization only after iOS had launched.
This change must validate the dedicated fresh Metro lifecycle and launch-time
synchronization setting.
Human approval required: Yes — explicitly directed by the user on 2026-09-13.

## Goal

Route every MyChampions GitHub Actions workflow job to the repository's local,
self-hosted runner labels, matching the GuiaBrecho approach. Linux/Android jobs
must use `self-hosted,Linux,X64,mychampions-ci,mychampions-android`; iOS jobs
must use `self-hosted,macOS,ARM64,mychampions-ci,mychampions-ios`; and web-only
jobs must use `self-hosted,Linux,X64,mychampions-ci,mychampions-web-only`.

## Non-Goals

- Change Firebase, Apple, Google Play, or production-server configuration.
- Treat a static workflow change as proof that a runner is online or a release
  can be delivered.
- Replace GitHub as source control or the GitHub Actions event/status control
  plane. That is a separate broker/orchestrator migration, not the
  GuiaBrecho-style self-hosted-runner topology.

## Docs-Backed Kickoff

Docs consulted: D-049, D-056, D-193, D-195, the CI secrets matrix, pending
wiring checklist, CI/CD setup checklist, selective CI test cases, and the
GuiaBrecho workflow runner labels.

Decision: no workflow may select `ubuntu-latest` or `macos-latest`. The
source-free preflight and protected status writers retain their no-checkout,
least-privilege rules while running on the Linux self-hosted runner.

## Acceptance Matrix

| ID  | Scenario          | Expected behavior                                                                       | Evidence required                                       | Status                                                                                                                                                                                                                      |
| --- | ----------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Workflow routing  | Every job uses one exact local runner label set.                                        | Workflow contract test plus no hosted `runs-on` search. | Done — focused contracts passed 115/115; no hosted `runs-on` remains.                                                                                                                                                       |
| R2  | Native delivery   | Android/iOS Firebase and release jobs select their local platform runner.               | Targeted workflow contracts.                            | Done — Firebase and Android release contracts cover the exact labels.                                                                                                                                                       |
| R3  | Trust boundary    | Source-free preflight and status writers remain no-checkout and minimally permissioned. | Selective-workflow contract test.                       | Done — source-free/no-checkout and the three status-writer constraints passed.                                                                                                                                              |
| R4  | Runner acceptance | A post-merge Linux and macOS workflow reaches the named local runner.                   | Live workflow logs.                                     | In progress — Linux jobs passed on `mychampions-ci-ubuntu`; run `34772832273` reached the Mac runner, reconciled AppleSimulatorUtils, and built successfully before exposing the isolated-smoke defects now being repaired. |

## Rollback

Revert only the runner-label commit. Do not alter provider secrets, distribution
credentials, production configuration, or the registered runner services.
