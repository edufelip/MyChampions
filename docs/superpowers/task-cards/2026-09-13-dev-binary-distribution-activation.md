# Task Card: Firebase Dev distribution activation

## Status

Current bucket: Implementation
Risk level: High (CI release workflow, credentials, external provider, Dev API/DB, and cross-repository delivery)
Owner: Codex
Blocked by: None
Human approval required: Yes — explicitly approved by the user on 2026-09-13: create the CI key, provision a non-production backend, merge PR #89, establish `develop`, and run the first distribution.

## Goal

Deliver Android and iOS `MyChampions Dev` builds to Firebase App Distribution's `base-group` on a `develop` push or manual dispatch, backed by an isolated non-production MyChampions API/database rather than the production environment.

## Non-Goals

- Change the production API, production database, or production mobile binary.
- Restore Firebase as a mobile runtime/backend dependency.
- Treat a green build as device or store-release evidence.

## Affected Surfaces

| Surface | Files/Systems | Owner | Notes |
|---|---|---|---|
| App/UI | Dev Android/iOS binaries | Mobile | `com.edufelip.mychampions.dev` only. |
| Service/API | Isolated VM API and database | Server | Must not share production data or credentials. |
| Data/storage | Dedicated development PostgreSQL and object storage | Server | No production database, bucket, or signing material. |
| CI/deploy | PR #89, GitHub secrets, `develop` | Platform | Workflows fail closed for empty/production API URL. |
| Docs | Delivery, QA environment, server deployment documentation | Mobile and Server | Update final environment and rollback facts. |
| External providers | Firebase App Distribution, Google Cloud IAM, DNS/TLS | Platform | Delivery-only Firebase access; least privilege and removable credentials. |

## Docs-Backed Kickoff

Risk rule: CI/deploy, secrets, release workflows, external providers, and cross-repository work are high risk under the evidence adapter.
Docs consulted: evidence-delivery workflow, project adapter, task-card template, QA environment registry, pending-wiring checklist, decisions D-056/D-174, CI secret matrix, Android/iOS distribution workflow contract tests, and server README/deploy configuration.
Business rules found or updated: Development delivery must be Firebase transport only; production API URLs are rejected.
Requirements found or updated: `FR-195`, `AC-504`, `BR-256`, and TC-521 define the delivery boundary.
Use cases found or updated: No user-facing flow changes.
Test cases found or updated: Existing Firebase-runtime-removal and Android-release contracts cover the mobile change; Dev API health and Firebase release receipt are added to this card's acceptance matrix.
ADRs found or updated: D-056 governs development delivery. No new ADR is required if the Dev environment remains isolated and reversible.
Terminology gaps: “Dev” means a separate API/database runtime; it is not a production API with a Dev bundle ID.
Contradictions: The registry documented Dev as a placeholder; activation must replace that with the actual isolated endpoint and test-account policy.
Decision: Use a separately named host, database, credentials, and deployment directory; preserve the existing production VM stack untouched.

## Acceptance Matrix

| ID | Scenario | Expected Behavior | Evidence Required | Status | Evidence |
|---|---|---|---|---|---|
| A1 | Firebase credentials | CI has a dedicated least-privileged credential in a repository secret; no key is committed or left on disk. | Firebase/Google Cloud identity and `gh secret list` names. | In progress | App-ID secrets configured before this task card. |
| A2 | Dev backend isolation | Dev API uses a distinct host, database, runtime environment, and credentials; production containers and data remain unchanged. | VM/container/database inspection and Dev `/health`. | In progress | Server change is in `edufelip/mychampions-api` PR #15; activation awaits its merge and deployment receipt. |
| A3 | CI configuration | `ENV_FILE` names the Dev API and correct Dev public OAuth/RevenueCat inputs; workflows reject wrong env. | Secret inventory plus hosted configuration validation. | Pending | |
| A4 | Android delivery | The Android workflow produces a signed Dev APK and Firebase shows the release assigned to `base-group`. | Hosted run and Firebase console release record. | Pending | Local build and APK signature verification passed before activation. |
| A5 | iOS delivery | The iOS workflow produces an Ad Hoc Dev IPA and Firebase shows the release assigned to `base-group`. | Hosted run and Firebase console release record. | Pending | |
| A6 | Rollback | Disabling the Dev workflow or removing its dedicated secret/host does not affect production. | Configuration separation review and documented rollback. | Pending | |

## Edge Cases

- stale data: Dev starts from a separate empty database; no production data copy is taken.
- repeated action: deployments and CI runs use immutable builds/version codes and idempotent infrastructure operations.
- skipped flow: Android and iOS report independently; one green lane does not imply the other passed.
- expired token/session: Firebase service-account key is stored only in GitHub Secrets and can be revoked independently.
- wrong environment: workflows reject missing or production API URL before native builds.
- missing config: missing secrets, DNS/TLS, signing assets, or backend health fail closed.
- network/provider failure: upload failure leaves the prior Firebase release untouched.
- old app/client version: Dev bundle ID prevents overwrite of production installs.
- unauthenticated/authenticated mismatch: Dev has its own auth JWT material and test accounts.
- concurrency/race condition: Android/iOS workflow concurrency is per ref; server deployment must never reuse production slots.
- deploy ordering: activate Dev API and verify health before setting CI environment; merge only after workflow review.
- rollback behavior: remove Dev CI secret/workflows or Dev VM service/DNS without changing production.

## Risks

| Risk | Impact | Mitigation | Status |
|---|---|---|---|
| Production data or API reuse | Testers affect production | Separate host, database, runtime secrets, and deployment namespace; verify no production resources are addressed. | Open |
| Overprivileged Firebase credential | Unauthorized release actions | Dedicated delivery identity, minimum role, GitHub secret only, revocation path. | Open |
| iOS profile lacks Dev tester device | iOS lane fails | Hosted profile/entitlement validation runs before archive/upload. | Open |
| Secret leakage | Credential exposure | Never print secret values; delete locally generated/downloading key immediately after GitHub secret ingestion. | Open |

## Commands Run

| Command | Result | Notes |
|---|---|---|
| Focused mobile contract tests | Passed (90 tests) | Recorded before this card; rerun after workflow changes. |
| Local Android Dev release build + `apksigner verify` | Passed | `com.edufelip.mychampions.dev`, local-only configuration. |

## Human Approval

Required: Yes
Approver: User
Decision: Approved credential creation, non-production backend provisioning, PR #89 merge, `develop` creation, and first Firebase distribution.
Timestamp: 2026-09-13
Notes: The request explicitly includes external provider, infrastructure, merge, and hosted distribution actions.

## Final Evidence Report

Pending activation and verification.
