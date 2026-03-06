# Backend Provider Migration V1

## Purpose
Track every planning/documentation touchpoint impacted by backend provider replacement to Firebase.

## Decision
- Backend baseline is Firebase (`Auth`, `Firestore`, `Cloud Storage`).
- Legacy backend-provider references are deprecated in product planning docs.

## Migration Inventory

| Area | File | Status | Notes |
|---|---|---|---|
| Decisions | `docs/discovery/decisions-log-v1.md` | Done | D-050/D-051/D-053/D-057/D-086/D-088/D-090 updated; D-089 and D-095 added. |
| Pending wiring | `docs/discovery/pending-wiring-checklist-v1.md` | Done | Auth, profile source-of-truth, and storage wiring items switched to Firebase Firestore terminology. |
| Functional requirements | `docs/functional-requirements/FR-001-domain-role-and-care-plans.md` | Done | FR-197 switched to Firebase Cloud Storage. |
| Business rules | `docs/business-rules/BR-002-role-assignment-and-plan-governance.md` | Done | BR-257 switched to Firebase Cloud Storage. |
| Acceptance criteria | `docs/acceptance-criteria/AC-005-mobile-platform-and-delivery-nfr.md` | Done | AC-506 switched to Firebase Cloud Storage. |
| Mobile stack spec | `docs/specs/mobile-nfr-tech-stack-spec.md` | Done | Backend architecture, constraints, options, and references switched to Firebase. |
| Firestore integration spec | `docs/specs/firebase-firestore-integration-spec.md` | Done | Data Connect integration spec replaced by Firestore collection/security contract. |
| Data Connect runtime artifacts | `features/dataconnect.ts`, `features/dataconnect-generated/`, `dataconnect/` | Done | Removed from runtime; app persistence now uses `firebase/firestore` via source modules. |
| Firebase CLI config | `firebase.json` | Done | Removed stale `dataconnect.source` entry that referenced deleted `dataconnect/sql`. |
| Firestore security/index baseline | `firestore.rules`, `firestore.indexes.json` | Done | Baseline rules and required composite indexes are now source-controlled and deployable via Firebase CLI. |
| Validation scripts | `scripts/validate-firestore-smoke.mjs` | Done | Firestore smoke validation replaces Data Connect validation/repair scripts. |
| Architecture diagram | `docs/diagrams/mobile-stack-high-level-v1.md` | Done | Service nodes switched to Firebase backend services. |
| Screen specs | `docs/screens/v2/SC-218-auth-create-account.md` | Done | Backend auth wiring note switched to Firebase Auth. |
| Screen specs | `docs/screens/v2/SC-201-auth-role-selection.md` | Done | Session/profile source note switched to Firebase Firestore-backed integration wording. |

## New Guardrail
- Any newly added backend planning text must use Firebase terminology.
- If legacy provider terminology is mentioned in future drafts, it must be either:
  - historical context in this migration log, or
  - explicitly marked as deprecated/legacy.
