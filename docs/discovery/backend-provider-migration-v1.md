# Retired Backend Provider Migration V1

## Purpose
Track the older backend-provider replacement pass and record that it has been superseded by the local MyChampions server/Postgres migration.

## Decision
- Active backend baseline is the root-level MyChampions server with local Postgres/Drizzle persistence, self-managed bearer auth, and local filesystem image storage; production storage is private GCS when configured.
- Older provider-replacement notes in this file are historical context only; current product planning docs must point to the MyChampions server migration path.

## Migration Inventory

| Area | File | Status | Notes |
|---|---|---|---|
| Decisions | `docs/discovery/decisions-log-v1.md` | Superseded | Current decisions point to the MyChampions server, server-owned Postgres, local bearer auth, and route/repository tests. |
| Pending wiring | `docs/discovery/pending-wiring-checklist-v1.md` | Superseded | Active wiring items track the self-managed MyChampions server migration and fail-closed source boundaries. |
| Functional requirements | `docs/functional-requirements/FR-001-domain-role-and-care-plans.md` | Superseded | Current requirements describe server-owned persistence and provider-neutral auth/session boundaries. |
| Business rules | `docs/business-rules/BR-002-role-assignment-and-plan-governance.md` | Superseded | Current business rules describe server-owned role, connection, plan, and media behavior. |
| Acceptance criteria | `docs/acceptance-criteria/AC-005-mobile-platform-and-delivery-nfr.md` | Superseded | Current acceptance criteria no longer require mobile-owned provider config, distribution, or storage surfaces. |
| Mobile stack spec | `docs/specs/mobile-nfr-tech-stack-spec.md` | Superseded | Current stack direction is the MyChampions server plus local-first Postgres, direct provider verification, and GCS storage. |
| Retired app-domain persistence contract | `docs/specs/retired-app-domain-persistence-contract-v1.md` | Retired | The file remains only as a pointer for older discovery notes; current contracts live in server tests and product docs. |
| Removed runtime artifacts | `features/dataconnect.ts`, `features/dataconnect-generated/`, `dataconnect/` | Retired | Removed from runtime; app persistence now uses MyChampions server source modules. |
| Removed provider project config | `firebase.json`, `firestore.rules`, `firestore.indexes.json`, `.firebaserc` | Retired | Removed with the mobile-owned provider project files. |
| Validation scripts | `scripts/validate-firestore-smoke.mjs` | Retired | Replaced by local server Bun tests, Postgres repository tests, focused mobile source tests, and typecheck. |
| Architecture diagram | `docs/diagrams/mobile-stack-high-level-v1.md` | Superseded | Current diagram shows the MyChampions server, local Postgres, local image storage, catalog integrations, and future auth/storage bridge. |
| Screen specs | `docs/screens/v2/SC-218-auth-create-account.md` | Superseded | Current auth wiring notes point to the MyChampions server email-auth boundary with local Postgres credentials and direct provider-token verification. |
| Screen specs | `docs/screens/v2/SC-201-auth-role-selection.md` | Superseded | Current session/profile source notes point to MyChampions server-backed role-lock/profile persistence. |

## New Guardrail
- Any newly added backend planning text must use MyChampions server/Postgres terminology for active app-domain behavior.
- If retired provider terminology is mentioned in future drafts, it must be historical context only and explicitly marked as retired, superseded, or legacy.
