# Nutritionist Experience Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring nutritionist planning, assignment, tracking review, invite-code, and CustomMeal behavior into the resolved domain model before release.

**Architecture:** Nutrition governance should mirror the hardened TrainingPlan model: explicit source-kind helpers, draft invisibility, active-specialty sentinels, and lifecycle-mediated archive/restore. InviteCodes become specialty-scoped with no compatibility path. CustomMeals remain user-owned reusable records; NutritionPlans and TrackingLogs carry stable snapshots/provenance rather than cross-user live references.

**Tech Stack:** Expo Router, React Native, TypeScript, Firebase Auth/Firestore/Storage, Firestore Security Rules, Node test runner via `tsx --test`, Yarn.

---

## Cross-Cutting Decisions

- No migration or compatibility for old Firestore shapes because the app is not live.
- Student-created NutritionPlans persist as Self-Managed Plans, not same-user Professional Library Plans.
- Draft assigned NutritionPlans are invisible to Students and cannot become Effective Plans.
- Active `nutritionist` Connections block student Self-Managed NutritionPlan create/edit and show a waiting state until a published assigned plan exists.
- Assigned NutritionPlan creation/send/bulk assignment requires an active `nutritionist` Connection to the target Student.
- Professional unbind and Student unbind must use the same connection-end lifecycle semantics.
- Nutritionist tracking review is read-only and lives on Professional Student Profile.
- CustomMeal assignment happens only through NutritionPlans as stable snapshots.

---

## Task 1: Commit Resolved Domain Decisions And Docs Baseline

**Files:**
- Modify: `CONTEXT.md`
- Modify: `docs/adr/0001-scoped-invite-codes-per-specialty.md`
- Create: `docs/adr/0005-nutrition-governance-and-custom-meal-snapshots.md`
- Modify: `docs/specs/firebase-firestore-integration-spec.md`
- Modify: `docs/business-rules/BR-002-role-assignment-and-plan-governance.md`
- Modify: `docs/functional-requirements/FR-001-domain-role-and-care-plans.md`
- Modify: `docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md`
- Modify: `docs/use-cases/UC-002-role-onboarding-and-care-management.md`
- Modify: `docs/test-cases/TC-002-role-and-assignment-controls.md`
- Modify: `docs/screens/v2/SC-207-nutrition-plan-builder.md`
- Modify: `docs/screens/v2/SC-209-student-nutrition-tracking.md`
- Modify: `docs/screens/v2/SC-206-student-profile-professional-view.md`
- Modify: `docs/screens/v2/localized-copy-table-v2.md`
- Modify: `docs/specs/custom-meals-and-portion-logging-spec.md`
- Modify: `docs/specs/student-professional-network-spec.md`
- Modify: `docs/discovery/decisions-log-v1.md`

- [x] **Step 1: Verify docs baseline compiles as intended**

Run: `git diff -- CONTEXT.md docs/adr/0001-scoped-invite-codes-per-specialty.md docs/adr/0005-nutrition-governance-and-custom-meal-snapshots.md`

Expected: shows the resolved glossary and ADR decisions from the grilling session.

- [x] **Step 2: Update governance docs**

Add or amend docs so they state these exact behaviors:

```md
- Student-created NutritionPlans are Self-Managed Plans.
- Active nutritionist Connections block Self-Managed NutritionPlan create/edit.
- Draft assigned NutritionPlans are invisible to Students.
- Published assigned NutritionPlans remain editable by the owning Professional while the matching active nutritionist Connection exists.
- Nutrition assignment/bulk assignment requires active nutritionist Connection to each target Student.
- Connection end archives assigned NutritionPlans and restores latest Self-Managed NutritionPlan tied to the ending Connection; no plan is auto-created.
- InviteCodes are scoped per Specialty and stored under `professionals/{professionalUid}/inviteCodes/{specialty}`.
- Nutritionist tracking review is read-only on Professional Student Profile.
- CustomMeals are user-owned reusable records; plans/logs carry snapshots/provenance.
```

- [x] **Step 3: Verify docs terminology**

Run: `yarn lint`

Expected: pass. Lint does not validate docs, but catches accidental TS/JS damage from adjacent edits.

- [x] **Step 4: Commit**

Run:

```bash
git add CONTEXT.md docs/adr/0001-scoped-invite-codes-per-specialty.md docs/adr/0005-nutrition-governance-and-custom-meal-snapshots.md docs/specs/firebase-firestore-integration-spec.md docs/business-rules/BR-002-role-assignment-and-plan-governance.md docs/functional-requirements/FR-001-domain-role-and-care-plans.md docs/acceptance-criteria/AC-002-role-journeys-and-plan-ownership.md docs/use-cases/UC-002-role-onboarding-and-care-management.md docs/test-cases/TC-002-role-and-assignment-controls.md docs/screens/v2/SC-207-nutrition-plan-builder.md docs/screens/v2/SC-209-student-nutrition-tracking.md docs/screens/v2/SC-206-student-profile-professional-view.md docs/screens/v2/localized-copy-table-v2.md docs/specs/custom-meals-and-portion-logging-spec.md docs/specs/student-professional-network-spec.md docs/discovery/decisions-log-v1.md docs/superpowers/plans/2026-06-01-nutritionist-experience-governance.md
git commit -m "docs(nutrition): define nutritionist governance model"
```

Expected: one docs commit.

---

## Task 2: Add Executable Firestore Rules Harness

**Files:**
- Modify: `package.json`
- Modify: `.gitignore` if emulator artifacts appear
- Create: `tests/firestore/rules-test-helpers.ts`
- Create: `tests/firestore/nutrition-governance.rules.test.ts`

- [ ] **Step 1: Install rules test dependencies**

Run: `yarn add -D @firebase/rules-unit-testing firebase-tools`

Expected: `package.json` updates only. Lockfiles remain untracked per repo policy.

- [ ] **Step 2: Add scripts**

Add to root `package.json`:

```json
"test:rules": "firebase emulators:exec --project demo-mychampions --only firestore \"yarn tsx --test tests/firestore/**/*.test.ts\"",
"test:all": "yarn test:unit && yarn test:rules"
```

- [ ] **Step 3: Add rules test helper**

Create `tests/firestore/rules-test-helpers.ts` with helper functions for `initializeTestEnvironment`, authenticated/unauthenticated contexts, disabled-rule seeding, and cleanup.

- [ ] **Step 4: Write failing nutrition governance rules tests**

In `tests/firestore/nutrition-governance.rules.test.ts`, cover:
- Student cannot read draft assigned NutritionPlan.
- Student cannot create Self-Managed NutritionPlan while `activeSpecialties/nutritionist` is active.
- Student cannot update Self-Managed NutritionPlan while `activeSpecialties/nutritionist` is active.
- Professional cannot create assigned NutritionPlan without active nutritionist tracking access.
- Professional can update published assigned NutritionPlan with active nutritionist tracking access.
- Connection lifecycle archive/restore writes require valid `lifecycleConnectionId` and connection transition.

- [ ] **Step 5: Run red test**

Run: `yarn test:rules`

Expected: fails on current broad nutrition rules.

- [ ] **Step 6: Commit harness and failing tests only if useful**

Do not commit failing tests alone unless the next task will immediately make them pass in the same session.

---

## Task 3: Mirror Training Governance In Nutrition Firestore Rules

**Files:**
- Modify: `firestore.rules`
- Modify: `features/plans/training-plan-rules.contract.test.ts`
- Test: `tests/firestore/nutrition-governance.rules.test.ts`

- [ ] **Step 1: Add static contract assertions**

Extend `features/plans/training-plan-rules.contract.test.ts` to assert nutrition has explicit helpers equivalent to training:
- `canCreateSelfManagedNutritionPlan`
- `canCreateProfessionalLibraryNutritionPlan`
- `canCreateAssignedNutritionPlan`
- `canUpdateAssignedNutritionPlan`
- nutrition draft read helper
- nutrition delete helpers

- [ ] **Step 2: Update `firestore.rules`**

Refactor `/nutritionPlans/{planId}` to:
- hide draft assigned NutritionPlans from student reads,
- block self-managed nutrition create/edit while active `nutritionist` sentinel exists,
- require active nutritionist tracking access for assigned creates/updates,
- preserve `isArchived` and `lifecycleConnectionId` on normal edits,
- use delete-specific helpers.

- [ ] **Step 3: Verify rules**

Run:

```bash
yarn test:rules
```

Expected: both pass.

- [ ] **Step 4: Commit**

Run:

```bash
git add package.json tests/firestore/rules-test-helpers.ts tests/firestore/nutrition-governance.rules.test.ts firestore.rules features/plans/training-plan-rules.contract.test.ts
git commit -m "test(rules): add nutrition governance rules coverage"
```

Expected: rules harness and nutrition governance rules committed together.

---

## Task 4: Persist Nutrition Self-Managed Plans Correctly

**Files:**
- Modify: `features/plans/plan-builder.logic.ts`
- Modify: `features/plans/plan-builder-source.ts`
- Modify: `features/plans/plans-store.ts`
- Modify: `features/plans/use-plan-builder.ts`
- Modify: `app/professional/nutrition/plans/[planId].tsx`
- Test: add/modify `features/plans/plan-builder.logic.test.ts`

- [ ] **Step 1: Write failing creation-mode test**

Add tests mirroring training metadata:
- professional nutrition builder creates `sourceKind: 'predefined'`, `ownerProfessionalUid: uid`, `studentAuthUid: uid`.
- student nutrition builder creates `sourceKind: 'self_managed'`, `ownerProfessionalUid: null`, `studentAuthUid: uid`.

- [ ] **Step 2: Add nutrition creation mode**

Add `NutritionPlanCreationMode = 'self_managed' | 'professional_library'` and pass it through `useNutritionPlanBuilder` to `createNutritionPlan`.

- [ ] **Step 3: Update source persistence**

Make `createNutritionPlan(input, creationMode)` write source fields according to mode. No compatibility handling for same-user `predefined` as self-managed.

- [ ] **Step 4: Verify**

Run:

```bash
yarn test:unit features/plans/plan-builder.logic.test.ts
```

- [ ] **Step 5: Commit**

Run:

```bash
git add features/plans/plan-builder.logic.ts features/plans/plan-builder-source.ts features/plans/plans-store.ts features/plans/use-plan-builder.ts app/professional/nutrition/plans/[planId].tsx features/plans/plan-builder.logic.test.ts
git commit -m "fix(nutrition): persist student plans as self-managed"
```

---

## Task 5: Student Nutrition Waiting State And Draft Filtering

**Files:**
- Modify: `app/student/nutrition.tsx`
- Modify: `features/plans/plan-source.ts`
- Modify: `localization/en-US.ts`
- Modify: `localization/pt-BR.ts`
- Modify: `localization/es-ES.ts`
- Modify: `docs/screens/v2/localized-copy-table-v2.md`

- [ ] **Step 1: Add logic tests if extractable**

Extract or test a pure resolver for student nutrition state:
- active nutritionist + no published assigned plan => waiting state.
- active nutritionist + draft assigned plan only => waiting state.
- no active nutritionist + self-managed plan => self-managed state.
- no active nutritionist + no plan => self-guided empty state.

- [ ] **Step 2: Filter draft assigned nutrition from student plan selection**

Ensure student-side `getMyPlans()` and `app/student/nutrition.tsx` do not treat drafts as assigned plans.

- [ ] **Step 3: Add waiting copy and UI**

Add localized copy equivalent to training waiting copy.

- [ ] **Step 4: Verify**

Run:

```bash
yarn test:unit
```

- [ ] **Step 5: Commit**

Run: `git commit -m "fix(student-nutrition): wait for nutritionist plan while connected"`

---

## Task 6: Specialty-Scoped InviteCodes

**Files:**
- Modify: `features/professional/professional-source.ts`
- Modify: `features/professional/use-professional.ts`
- Modify: `features/professional/connection-invite.logic.ts`
- Modify: `features/connections/connection-source.ts`
- Modify: `firestore.rules`
- Modify: relevant screens using invite code hooks
- Test: `features/professional/connection-invite.logic.test.ts`
- Test: add source tests for professional/invite and connection submission
- Test: add `tests/firestore/scoped-invite-codes.rules.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- `getOrCreateActiveInviteCode('nutritionist')` path is `professionals/{uid}/inviteCodes/nutritionist`.
- `getOrCreateActiveInviteCode('fitness_coach')` path is `professionals/{uid}/inviteCodes/fitness_coach`.
- `submitInviteCode` creates a Connection with the specialty from the invite code.
- `submitInviteCode` uses deterministic duplicate guards and ten fixed pending-student slots so concurrent submissions cannot bypass duplicate or unique-student pending-cap checks.
- `rotateInviteCode(specialty)` only cancels pending requests for the same specialty/code.
- Pending confirmation, denial/end, and code-rotation cancellation release pending guard/slot state only when the referenced Connection leaves `pending_confirmation`.
- old top-level `inviteCodes/{professionalUid}` writes are denied by rules.

- [ ] **Step 2: Implement specialty-scoped source functions**

Update hook signatures and callers to pass specialty explicitly.

- [ ] **Step 3: Verify**

Run:

```bash
yarn test:rules
```

- [ ] **Step 4: Commit**

Run: `git commit -m "fix(invites): scope invite codes by specialty"`

---

## Task 7: Assignment Guards And Bulk Specialty Filtering

**Files:**
- Modify: `features/plans/plan-source.ts`
- Modify: `app/professional/students.tsx`
- Modify: `app/professional/student-profile.tsx`
- Modify: `components/ds/patterns/PlanPickerModal.tsx` if needed
- Test: add/modify plan source and roster/bulk assignment tests

- [ ] **Step 1: Write failing tests**

Cover:
- Nutrition draft assignment fails without active nutritionist Connection.
- Nutrition bulk assignment rejects targets without active nutritionist Connection.
- Bulk nutrition plan picker only offers nutrition plans and nutrition-active Students.
- Training behavior remains fitness-coach scoped.

- [ ] **Step 2: Implement source-layer active connection checks**

Use exact `connections` or `trackingAccess` validation before assigning.

- [ ] **Step 3: Implement UI filtering**

Ensure professional bulk assignment and student-profile assignment CTA only target active matching Specialty.

- [ ] **Step 4: Verify and commit**

Run:

```bash
yarn test:unit
```

Commit: `fix(plans): require active specialty connection for assignment`

---

## Task 8: Lifecycle-Safe Professional Unbind

**Files:**
- Modify: `features/professional/professional-source.ts`
- Modify: `app/professional/student-profile.tsx`
- Modify: tests around connection archival/unbind

- [ ] **Step 1: Write failing test**

Professional unbind must call lifecycle semantics that:
- end tracking access,
- update active specialty sentinel only when owned by ending connection,
- archive assigned plans,
- restore latest same-connection self-managed plan.

- [ ] **Step 2: Refactor unbind path**

Remove direct `updateDoc(status: 'ended')` path. Route through shared connection-end function or a shared helper that both Student and Professional unbind use.

- [ ] **Step 3: Verify and commit**

Run:

```bash
yarn test:unit features/connections/connection-archival.test.ts
```

Commit: `fix(connections): route professional unbind through lifecycle`

---

## Task 9: Professional Nutrition Specialty Gate

**Files:**
- Modify: `app/(tabs)/_layout.tsx`
- Modify: `app/(tabs)/nutrition/index.tsx`
- Modify: `app/professional/nutrition.tsx`
- Modify: localization files for locked copy if needed
- Test: route/specialty logic tests if extractable

- [x] **Step 1: Write failing logic test**

Add a pure resolver that says Nutrition tab/screen is available only to Students or Professionals with `nutritionist` Specialty.

- [x] **Step 2: Implement tab/screen gate**

Hide or lock the nutrition surface for non-nutritionist Professionals. Direct routes should redirect or show locked state.

- [x] **Step 3: Verify and commit**

Run:

```bash
yarn test:unit
```

Commit: `fix(navigation): gate nutrition by specialty`

---

## Task 10: CustomMeal Snapshots In NutritionPlan Meal Builder

**Files:**
- Modify: `features/nutrition/custom-meal.logic.ts`
- Modify: `features/nutrition/custom-meal-source.ts`
- Modify: `features/plans/plan-builder.logic.ts`
- Modify: `features/plans/plan-builder-source.ts`
- Modify: `features/plans/components/AddItemForm.tsx`
- Modify: `app/professional/nutrition/plans/[planId]/meals/[mealId].tsx`
- Test: `features/nutrition/custom-meal.logic.test.ts`
- Test: add plan-builder CustomMeal snapshot tests

- [ ] **Step 1: Write failing snapshot tests**

Cover:
- snapshot includes meal name, serving, calories/macros, source kind.
- snapshot excludes private mutable fields and does not grant direct reusable meal access.
- plan item keeps stable snapshot after source meal changes.

- [ ] **Step 2: Add CustomMeal picker path**

In meal builder, allow adding a CustomMeal snapshot from current user's CustomMeal library.

- [ ] **Step 3: Verify and commit**

Run:

```bash
yarn test:unit features/nutrition/custom-meal.logic.test.ts
```

Commit: `feat(nutrition): add custom meal snapshots to plans`

---

## Task 11: Tracking Provenance And Nutritionist Review

**Files:**
- Modify: `features/nutrition/custom-meal-source.ts`
- Add: `features/professional/student-tracking-review.logic.ts`
- Add: `features/professional/student-tracking-review-source.ts`
- Add tests for both new files
- Modify: `app/student/nutrition.tsx`
- Modify: `app/professional/student-profile.tsx`
- Modify: `firestore.rules` if needed for read coverage
- Test: `tests/firestore/nutritionist-tracking-review.rules.test.ts`

- [ ] **Step 1: Write failing tests**

Cover:
- assigned meal logs include `planId`, `planType`, `sourceKind`, `ownerProfessionalUid`, `connectionId` when available.
- nutritionist review reads water logs and portion logs for a Student.
- nutritionist cannot mutate logs.
- ended/unrelated nutritionist cannot read logs in rules tests.

- [ ] **Step 2: Implement provenance writes**

Update student logging calls to pass plan/connection provenance.

- [ ] **Step 3: Implement Professional Student Profile read-only review**

Show today water progress, seven-day hydration summary, today meal check-offs, and recent seven-day portion logs.

- [ ] **Step 4: Verify and commit**

Run:

```bash
yarn test:rules
```

Commit: `feat(nutrition): show nutritionist tracking review`

---

## Task 12: Final Whole-Branch Review And Verification

**Files:**
- All changed files

- [ ] **Step 1: Request final code review**

Review all commits from `fdb01ac` to HEAD for nutritionist governance regressions, missing docs/tests, and security issues.

- [ ] **Step 2: Full verification**

Run:

```bash
yarn tsc --noEmit
```

If local Node is still `24.x`, `yarn --cwd functions build` is expected to fail on engines. Then run:

```bash
yarn --cwd functions --ignore-engines build
```

- [ ] **Step 3: Fix findings**

Any Critical/Important review finding or failed verification must be fixed before completion.

---

## Self-Review

- Spec coverage: all grilling decisions are represented by tasks 1-11.
- Placeholder scan: no `TBD` or deferred implementation placeholders are intentionally left in this plan; CustomMeal-in-plan and tracking review are included because the user required them now.
- Type consistency: plan consistently uses `nutritionist`, `fitness_coach`, `Self-Managed Plan`, `Professional Library Plan`, `Draft Assigned Plan`, `TrackingLog`, and `CustomMeal` per `CONTEXT.md`.
