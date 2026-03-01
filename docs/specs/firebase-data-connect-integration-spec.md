# Firebase Data Connect Integration Spec (V1)

## Purpose
Define the implementation contract for moving app domain persistence to Firebase Data Connect.

## Scope
- Auth-to-profile bootstrap (Firebase Auth + Data Connect).
- Role-lock/profile source of truth.
- Core entity model for student/professional assignments and plans.
- Connector operation contracts used by mobile app.
- Authorization and environment strategy.

## Out Of Scope
- Full SQL physical schema tuning/index plan.
- BI/reporting pipelines.
- Legacy migration scripts from non-Firebase providers.

## Architecture Baseline
1. Firebase Auth handles identity (`uid`) and provider linking.
2. Firebase Data Connect exposes typed GraphQL operations backed by Cloud SQL.
3. Mobile app calls Data Connect operations for profile, assignment, and plan domain state.
4. Firebase Cloud Storage remains media store (recipe/profile images).

## Identity And Ownership Model
- `auth_uid` is the global principal key from Firebase Auth.
- Every user-owned row must include `owner_uid` or equivalent relationship to `auth_uid`.
- Role lock and profile are read from Data Connect, not AsyncStorage, once wiring is complete.

## Domain Entity Model (MVP-Ready)

### `user_profiles`
- `id` (UUIDv7, PK)
- `auth_uid` (unique)
- `account_type` (`student` | `professional`)
- `locked_role` (`student` | `professional`)
- `display_name`
- `email_normalized`
- `created_at`
- `updated_at`

### `professional_specialties`
- `id` (UUIDv7, PK)
- `professional_auth_uid`
- `specialty` (`nutritionist` | `fitness_coach`)
- `is_active`
- `created_at`
- `updated_at`

### `professional_credentials`
- `id` (UUIDv7, PK)
- `professional_auth_uid`
- `specialty`
- `credential_type` (`professional_registry`)
- `registry_id`
- `authority`
- `country`
- `created_at`
- `updated_at`

### `connections`
- `id` (UUIDv7, PK)
- `student_auth_uid`
- `professional_auth_uid`
- `specialty`
- `status` (`invited` | `pending_confirmation` | `active` | `ended`)
- `source_invite_code_id`
- `canceled_reason` (nullable, includes `code_rotated`)
- `created_at`
- `updated_at`
- `ended_at` (nullable)

### `professional_invite_codes`
- `id` (UUIDv7, PK)
- `professional_auth_uid`
- `code_value`
- `is_active`
- `expires_at` (nullable)
- `rotated_at` (nullable)
- `created_at`
- `updated_at`

### `nutrition_plans` / `training_plans` (high-level)
- `id` (UUIDv7, PK)
- `owner_professional_auth_uid` (nullable for self-managed)
- `student_auth_uid`
- `source_kind` (`predefined` | `assigned` | `self_managed`)
- `is_archived`
- `created_at`
- `updated_at`

## Connector Contracts (Mobile-Facing)

### Auth/Profile
- `upsertUserProfile(input)`:
  - Creates profile on first login.
  - Enforces immutable `locked_role` after first set.
- `getMyProfile()`:
  - Returns role-lock + account basics for routing.
- `setLockedRole(role)`:
  - Allowed only when role is not previously set.

### Professional Setup
- `setProfessionalSpecialties(list)`
- `addProfessionalSpecialty(specialty)`
- `removeProfessionalSpecialty(specialty)`:
  - Must fail when active/pending students exist for that specialty.

### Invite/Connection
- `getOrCreateActiveInviteCode()`
- `rotateInviteCode()`
- `submitInviteCode(code)` -> `pending_confirmation`
- `confirmPendingConnection(connection_id)` -> `active`
- `endConnection(connection_id)`

### Plan Ownership
- `archiveSelfManagedPlanOnActivation(student_uid, specialty)`
- `assignPlanFromTemplate(...)`
- `cloneAndBulkAssignPlan(...)`

## Authorization Rules (Connector-Level)
- Users can read/write only their own profile by `auth_uid`.
- Students can only read credential fields for currently active assigned professionals.
- Professionals can manage only their own invite codes, specialties, templates, and assigned student plans.
- Connection transition validation is server-side and deterministic.

## Role-Lock Routing Contract
- App startup sequence:
  1. Resolve Firebase Auth session.
  2. Query `getMyProfile()`.
  3. Route by `locked_role`.

## Environment Strategy
- Data Connect endpoints/config must be environment-scoped:
  - `dev` (package/bundle `.dev`)
  - `prod` (release package/bundle)
- CI must inject environment-specific Data Connect config (same pattern used for Firebase service config).
- Live operation validation command:
  - `npm run validate:data-connect:profile`
  - Requires `EXPO_PUBLIC_DATA_CONNECT_GRAPHQL_ENDPOINT` and `DATA_CONNECT_ID_TOKEN`.
  - Optional mutation validation via `DATA_CONNECT_TEST_SET_ROLE=student|professional`.

## Migration Plan (Current App State -> Data Connect)
1. Introduce `getMyProfile` + `upsertUserProfile` connector.
2. Replace local role-lock persistence with Data Connect `locked_role`.
3. Keep existing route guard logic, but switch data source from local profile to Data Connect profile.
4. Expand connectors for invite/connection and plan operations.

## Current Implementation Snapshot
- App-side profile source boundary exists in `features/auth/profile-source.ts`.
- `AuthSessionProvider` now hydrates/locks role through this profile source boundary.
- Current behavior is remote-only Data Connect role/profile sourcing (`getMyProfile`, `upsertUserProfile`, `setLockedRole` contract shape).
- Pending finalization is connector schema/runtime compatibility in deployed Data Connect environments.
- Repository validation utility exists at `scripts/validate-data-connect-profile-ops.mjs` for live endpoint contract checks.

### Connection Lifecycle (In Progress)
- Pure connection logic module at `features/connections/connection.logic.ts`:
  - Types: `ConnectionStatus`, `CanceledReason`, `ConnectionRecord`, `ConnectionDisplayState`.
  - Functions: `normalizeConnectionStatus`, `normalizeCanceledReason`, `normalizeConnectionSpecialty`, `resolveConnectionDisplayState`, `normalizeInviteSubmitError`, `normalizeConnectionActionError`.
  - `resolveConnectionDisplayState` maps `status + canceled_reason` to a discriminated `ConnectionDisplayState` union, including `canceled_code_rotated` display state for code-rotation auto-cancellations.
- Data Connect source module at `features/connections/connection-source.ts`:
  - `submitInviteCode(user, code)` → `{ connectionId, status: 'pending_confirmation' }`
  - `confirmPendingConnection(user, connectionId)` → `{ connectionId, status: 'active' }`
  - `endConnection(user, connectionId)` → `void`
  - `getMyConnections(user)` → `ConnectionRecord[]` (exposes `canceled_reason` for `code_rotated` handling)
- Done: connection-source wired into:
  - `app/student/professionals.tsx` (SC-211): invite entry, connection status list (`canceled_code_rotated` included), unbind.
  - `app/professional/pending.tsx` (SC-204/SC-205): pending queue with search, accept/deny, bulk deny.
  - `features/connections/use-connections.ts`: React hook adapter (no Firebase deps in screen components).
- Pending: live endpoint compatibility validation for connection operations.

## Test Strategy (Must Have Before Release)
- Unit tests:
  - role-lock immutability
  - specialty removal blocking with active/pending connections
  - invite code rotation cancel semantics
- Integration tests:
  - auth login -> profile bootstrap -> role routing
  - invite submit/confirm lifecycle transitions
- E2E smoke:
  - first login role selection persisted remotely
  - wrong-role route hard redirect using remote profile

## Traceability
- FR: `FR-102`, `FR-118`, `FR-173`, `FR-174`, `FR-175`, `FR-179`, `FR-180`, `FR-209`, `FR-223`, `FR-224`, `FR-225`, `FR-226`
- BR: `BR-201`, `BR-211`, `BR-230`, `BR-238`, `BR-241`, `BR-242`, `BR-267`, `BR-281`, `BR-282`, `BR-283`
- AC: `AC-201`, `AC-224`, `AC-233`, `AC-253`, `AC-254`, `AC-258`, `AC-264`, `AC-265`
- TC: `TC-201`, `TC-225`, `TC-235`, `TC-256`, `TC-257`, `TC-262`, `TC-268`, `TC-269`, `TC-270`
