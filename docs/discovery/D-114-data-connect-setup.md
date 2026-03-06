# D-114: Legacy Data Connect Setup (Deprecated)

**Status**: Deprecated on 2026-03-06
**Superseded By**: Firestore cutover decisions `D-126`, `D-133`, `D-137`

## Summary
This document previously tracked Firebase Data Connect/Cloud SQL setup for starter templates.
That architecture is no longer active in the app runtime.

## Current Baseline
- App-domain persistence now uses Firebase Cloud Firestore via Firebase JS SDK (`firebase/firestore`).
- Data Connect runtime artifacts were removed from the app (`features/dataconnect.ts`, `features/dataconnect-generated/`, `dataconnect/`).
- Source modules use Firestore collections/documents directly behind source-layer boundaries.

## Validation
- Current smoke validation command: `npm run validate:firestore:smoke`.
- Firestore auth/profile/connection/plan/water/custom-meal contracts are tracked in:
  - `docs/specs/firebase-firestore-integration-spec.md`
  - `docs/discovery/pending-wiring-checklist-v1.md`

## Historical Note
Any Data Connect references in older commits should be treated as legacy context only.
