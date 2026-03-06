# Firebase Firestore Integration Spec (V1)

## Purpose
Define the implementation contract for app-domain persistence in Firebase Cloud Firestore.

## Scope
- Auth-to-profile bootstrap (Firebase Auth + Firestore).
- Role-lock/profile source of truth.
- Core entity model for assignments, plans, meals, hydration, and sharing.
- Firestore security and ownership boundaries.

## Architecture Baseline
1. Firebase Auth manages identity (`auth.uid`).
2. Firestore stores domain entities in collections/documents.
3. Mobile app source modules call Firestore through `features/*-source.ts` boundaries.
4. Firebase Cloud Storage remains media store.

## Collection Model (App-Facing)
- `userProfiles/{uid}`: role lock, account basics, terms acceptance metadata.
- `inviteCodes/{professionalUid}`: active invite code lifecycle.
- `connections/{connectionId}`: student-professional lifecycle state.
- `specialties/{specialtyId}` and `credentials/{specialtyId}`.
- `nutritionPlans/{planId}` and `trainingPlans/{planId}`.
- `planChangeRequests/{requestId}`.
- `starterTemplates/{templateId}` (optional remote templates; local fallback allowed).
- `waterLogs/{uid_dateKey}` and `waterGoals/{uid}`.
- `customMeals/{mealId}`, `mealShareLinks/{shareToken}`, `portionLogs/{logId}`.

## Ownership And Authorization Contract
- Every user-owned document includes `ownerUid` or equivalent role-specific uid fields.
- Reads/writes must be restricted to the authenticated user context and role-specific ownership.
- Role-lock is immutable after first successful set.
- Connection transitions are validated in source-layer transactions.

## Role-Lock Routing Contract
1. Resolve Firebase Auth session.
2. Read `userProfiles/{uid}`.
3. Route by `lockedRole`.
4. If profile is missing, upsert baseline row and continue lockedRole=null flow.

## Runtime And Validation
- App variant still selects Firebase project credentials via `APP_VARIANT` and `FIREBASE_DEV_*` / `FIREBASE_PROD_*`.
- Current project mapping contract:
  - `APP_VARIANT=dev` (`com.edufelip.mychampions.dev`) -> Firestore project `mychampions-fb928`, database `(default)`.
  - `APP_VARIANT=prod` (`com.edufelip.mychampions`) -> Firestore project `mychampions-fb928`, database `(default)`.
- Firestore smoke validation command:
  - `npm run validate:firestore:smoke`
  - Requires `FIRESTORE_ID_TOKEN` and variant project id env vars.

## Test Strategy
- Unit: source-level behavior and pure logic modules.
- Integration: role-lock persistence, connection lifecycle, plan change request flow, water goal precedence, shared recipe import idempotency.
- E2E smoke: auth -> role lock -> protected route guards.

## Traceability
- FR: FR-102, FR-118, FR-173, FR-174, FR-175, FR-179, FR-180, FR-209, FR-223, FR-224, FR-225, FR-226
- BR: BR-201, BR-211, BR-230, BR-238, BR-241, BR-242, BR-267, BR-281, BR-282, BR-283
- AC: AC-201, AC-224, AC-233, AC-253, AC-254, AC-258, AC-264, AC-265
- TC: TC-201, TC-225, TC-235, TC-256, TC-257, TC-262, TC-268, TC-269, TC-270
