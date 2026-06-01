# Training Plan Governance Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align training-plan/session building with the domain model: professionals build Professional Library Plans and assigned plans for actively connected students; students build Self-Managed Plans only when they do not have an active fitness-coach Connection.

**Architecture:** Keep the existing shared training builder engine, but make creation mode explicit at the source/store/hook boundary. Firestore rules enforce plan ownership, draft visibility, student read-only assigned plans, and active-connection-gated professional writes. Student training tracking gets a distinct waiting-for-coach-plan state so immediate self-managed archival does not leak into self-guided editing.

**Tech Stack:** Expo Router, React Native, Zustand, Firebase JS SDK, Firestore Security Rules, node:test, TypeScript, Yarn.

---

## File Structure

- Modify: `features/plans/plan-builder.logic.ts` — add pure helper for training-plan creation metadata.
- Modify: `features/plans/plan-builder-source.ts` — accept explicit training creation mode and persist true `self_managed` student plans.
- Modify: `features/plans/plans-store.ts` — pass creation mode through store actions and avoid professional-library optimistic cache updates for Self-Managed Plans.
- Modify: `features/plans/use-plan-builder.ts` — expose training creation mode in `createPlan`, `savePlanWithSessions`, and draft-creation paths.
- Modify: `app/professional/training/plans/[planId].tsx` — use professional-library mode for professional builder, self-managed mode for student alias, and use draft assignment for single-student assignment.
- Modify: `app/student/training.tsx` — filter draft assigned plans, detect active fitness-coach Connection, and render waiting state instead of self-guided CTA when connected.
- Modify: `features/connections/connection-source.ts` — archive assigned plans and restore latest Self-Managed Plan when a same-specialty Connection ends.
- Modify: `firestore.rules` — enforce role/source-kind-specific training plan permissions and draft invisibility.
- Modify: `localization/en-US.ts`, `localization/pt-BR.ts`, `localization/es-ES.ts` — add waiting-state copy.
- Modify: `docs/screens/v2/localized-copy-table-v2.md` — document new copy keys.
- Test: `features/plans/plan-builder-source.test.ts` — pure metadata helper tests.
- Test: `features/connections/connection-archival.test.ts` — connection-end assigned archive/self-managed restore tests.
- Test: `features/plans/training-plan-rules.contract.test.ts` — static guard tests for Firestore rules until emulator rule tests exist.

---

### Task 1: Persist Student-Created Training Plans as Self-Managed Plans

**Files:**
- Modify: `features/plans/plan-builder.logic.ts`
- Modify: `features/plans/plan-builder-source.ts`
- Modify: `features/plans/plans-store.ts`
- Modify: `features/plans/use-plan-builder.ts`
- Test: `features/plans/plan-builder-source.test.ts`

- [ ] **Step 1: Write failing pure tests for training creation metadata**

Append to `features/plans/plan-builder-source.test.ts`:

```ts
import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
  resolveTrainingDraftCreationInput,
  resolveTrainingPlanCreationMetadata,
} from './plan-builder.logic';

describe('resolveTrainingPlanCreationMetadata', () => {
  it('returns Professional Library Plan metadata for professional builder mode', () => {
    assert.deepEqual(resolveTrainingPlanCreationMetadata('pro-1', 'professional_library'), {
      ownerProfessionalUid: 'pro-1',
      studentAuthUid: 'pro-1',
      sourceKind: 'predefined',
      isDraft: false,
    });
  });

  it('returns Self-Managed Plan metadata for student builder mode', () => {
    assert.deepEqual(resolveTrainingPlanCreationMetadata('student-1', 'self_managed'), {
      ownerProfessionalUid: null,
      studentAuthUid: 'student-1',
      sourceKind: 'self_managed',
      isDraft: false,
    });
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `yarn test:unit features/plans/plan-builder-source.test.ts`

Expected: FAIL with `resolveTrainingPlanCreationMetadata` not exported.

- [ ] **Step 3: Add creation mode helper**

In `features/plans/plan-builder.logic.ts`, add near the training plan types/helpers:

```ts
export type TrainingPlanCreationMode = 'professional_library' | 'self_managed';

export function resolveTrainingPlanCreationMetadata(
  authUid: string,
  mode: TrainingPlanCreationMode
): {
  ownerProfessionalUid: string | null;
  studentAuthUid: string;
  sourceKind: 'predefined' | 'self_managed';
  isDraft: false;
} {
  if (mode === 'self_managed') {
    return {
      ownerProfessionalUid: null,
      studentAuthUid: authUid,
      sourceKind: 'self_managed',
      isDraft: false,
    };
  }

  return {
    ownerProfessionalUid: authUid,
    studentAuthUid: authUid,
    sourceKind: 'predefined',
    isDraft: false,
  };
}
```

- [ ] **Step 4: Use explicit creation mode in Firestore source**

In `features/plans/plan-builder-source.ts`, update imports:

```ts
import type {
  NutritionPlanInput,
  NutritionMeal,
  NutritionMealInput,
  NutritionMealItem,
  NutritionMealItemInput,
  TrainingPlanInput,
  TrainingPlanCreationMode,
  TrainingSession,
  TrainingSessionInput,
  TrainingSessionItem,
  TrainingSessionItemInput,
  StarterTemplate,
  FoodSearchResult,
} from './plan-builder.logic';
import {
  deriveStarterTemplatePlanType,
  coalesceTemplateDescription,
  calculateTotalsFromItems,
  calculateTotalsFromMeals,
  resolveTrainingPlanCreationMetadata,
} from './plan-builder.logic';
```

Change `createTrainingPlan` signature and metadata block:

```ts
export async function createTrainingPlan(
  input: TrainingPlanInput,
  mode: TrainingPlanCreationMode = 'professional_library',
  deps: PlanBuilderSourceDeps = defaultDeps
): Promise<TrainingPlanDetail> {
  try {
    const firestore = deps.getFirestoreInstance();
    const uid = deps.getCurrentAuthUid();
    const id = generateId('training_plan');
    const timestamp = nowIso();
    const metadata = resolveTrainingPlanCreationMetadata(uid, mode);

    const plan: FirestoreTrainingPlan = {
      id,
      ...metadata,
      isArchived: false,
      name: input.name.trim(),
      sessions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };
```

- [ ] **Step 5: Pass creation mode through store actions**

In `features/plans/plans-store.ts`, update action types/interfaces for `createTrainingPlanAction`, `saveTrainingPlanWithSessionsAction`, and `addTrainingSessionAction` to accept optional mode:

```ts
import type { TrainingPlanCreationMode } from './plan-builder.logic';

createTrainingPlanAction: (
  isAuthenticated: boolean,
  input: TrainingPlanInput,
  mode?: TrainingPlanCreationMode
) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;

saveTrainingPlanWithSessionsAction: (
  isAuthenticated: boolean,
  planId: string,
  input: TrainingPlanInput,
  sessions: TrainingSession[],
  publish?: boolean,
  mode?: TrainingPlanCreationMode
) => Promise<{ id: string; plan: TrainingPlanDetail } | { error: PlanBuilderErrorReason }>;
```

Update implementations:

```ts
createTrainingPlanAction: async (isAuthenticated, input, mode = 'professional_library') => {
  // ...validation unchanged...
  const plan = await createTrainingPlan(input, mode);
  // ...state update unchanged...
  if (plan.sourceKind === 'predefined') {
    optimisticUpdatePredefinedPlan({
      id: plan.id,
      name: plan.name,
      planType: 'training',
      ownerProfessionalUid: plan.ownerProfessionalUid ?? '',
      createdAt: plan.createdAt,
      updatedAt: plan.updatedAt,
    });
  }
  return { id: plan.id };
},
```

In `saveTrainingPlanWithSessionsAction`, create new plans with the incoming mode and only update predefined cache for `sourceKind === 'predefined'`:

```ts
saveTrainingPlanWithSessionsAction: async (
  isAuthenticated,
  planId,
  input,
  sessions,
  publish,
  mode = 'professional_library'
) => {
  // ...validation unchanged...
  let currentPlanId = planId;
  if (planId === 'new') {
    const created = await createTrainingPlan(input, mode);
    currentPlanId = created.id;
  }

  await updateTrainingPlanWithSessions(currentPlanId, input, sessions, publish);
  const updated = await getTrainingPlanDetail(currentPlanId);

  if (updated.sourceKind === 'predefined') {
    optimisticUpdatePredefinedPlan({
      id: updated.id,
      name: updated.name,
      planType: 'training',
      ownerProfessionalUid: updated.ownerProfessionalUid ?? '',
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  }
```

- [ ] **Step 6: Pass creation mode through hook and builder**

In `features/plans/use-plan-builder.ts`, add `TrainingPlanCreationMode` to imports and signatures:

```ts
createPlan: (
  input: TrainingPlanInput,
  mode?: TrainingPlanCreationMode
) => Promise<{ id: string } | { error: PlanBuilderErrorReason }>;

savePlanWithSessions: (
  planId: string,
  input: TrainingPlanInput,
  sessions: TrainingSession[],
  publish?: boolean,
  mode?: TrainingPlanCreationMode
) => Promise<{ id: string; plan: TrainingPlanDetail } | { error: PlanBuilderErrorReason }>;
```

Update callbacks:

```ts
const createPlan = useCallback(
  (input: TrainingPlanInput, mode?: TrainingPlanCreationMode) =>
    createPlanFromStore(isAuthenticated, input, mode),
  [createPlanFromStore, isAuthenticated]
);

const savePlanWithSessions = useCallback(
  (planId, input, sessions, publish, mode?: TrainingPlanCreationMode) =>
    savePlanWithSessionsFromStore(isAuthenticated, planId, input, sessions, publish, mode),
  [isAuthenticated, savePlanWithSessionsFromStore]
);
```

In `app/professional/training/plans/[planId].tsx`, derive mode and pass it into save:

```ts
const creationMode = isStudentBuilder ? 'self_managed' : 'professional_library';

onSave: async (formValues) => {
  return savePlanWithSessions(
    planId ?? 'new',
    formValues,
    draftSessions,
    isDraftAssignment,
    creationMode
  );
},
```

- [ ] **Step 7: Run tests and typecheck**

Run: `yarn test:unit features/plans/plan-builder-source.test.ts && yarn tsc --noEmit`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add features/plans/plan-builder.logic.ts features/plans/plan-builder-source.ts features/plans/plans-store.ts features/plans/use-plan-builder.ts features/plans/plan-builder-source.test.ts app/professional/training/plans/[planId].tsx
git commit -m "fix(training-plans): persist student plans as self-managed"
```

---

### Task 2: Render Waiting-for-Coach State and Hide Drafts from Student Tracking

**Files:**
- Modify: `app/student/training.tsx`
- Modify: `localization/en-US.ts`
- Modify: `localization/pt-BR.ts`
- Modify: `localization/es-ES.ts`
- Modify: `docs/screens/v2/localized-copy-table-v2.md`

- [ ] **Step 1: Add localized copy keys**

Add these keys in all three localization bundles near existing `student.training.empty.*` keys:

```ts
'student.training.waiting.title': 'Your coach is preparing your plan',
'student.training.waiting.body': 'Your fitness coach connection is active. You will see your training sessions here once your coach sends the plan.',
'student.training.waiting.cta': 'View my coach',
```

Use translations:

```ts
// pt-BR
'student.training.waiting.title': 'Seu treinador está preparando seu plano',
'student.training.waiting.body': 'Sua conexão com o treinador está ativa. Você verá suas sessões de treino aqui quando o plano for enviado.',
'student.training.waiting.cta': 'Ver meu treinador',

// es-ES
'student.training.waiting.title': 'Tu entrenador está preparando tu plan',
'student.training.waiting.body': 'Tu conexión con el entrenador está activa. Verás tus sesiones de entrenamiento aquí cuando el plan sea enviado.',
'student.training.waiting.cta': 'Ver mi entrenador',
```

- [ ] **Step 2: Document copy keys**

Append rows to `docs/screens/v2/localized-copy-table-v2.md`:

```md
| student.training.waiting.title | Your coach is preparing your plan | Seu treinador está preparando seu plano | Tu entrenador está preparando tu plan |
| student.training.waiting.body | Your fitness coach connection is active. You will see your training sessions here once your coach sends the plan. | Sua conexão com o treinador está ativa. Você verá suas sessões de treino aqui quando o plano for enviado. | Tu conexión con el entrenador está activa. Verás tus sesiones de entrenamiento aquí cuando el plan sea enviado. |
| student.training.waiting.cta | View my coach | Ver meu treinador | Ver mi entrenador |
```

- [ ] **Step 3: Detect active fitness-coach connection in student training screen**

In `app/student/training.tsx`, import `useConnections`:

```ts
import { useConnections } from '@/features/connections/use-connections';
```

Add state derivation after `usePlans`:

```ts
const { state: connectionsState } = useConnections(Boolean(currentUser));
const hasActiveFitnessCoachConnection =
  connectionsState.kind === 'ready' &&
  connectionsState.connections.some(
    (connection) => connection.specialty === 'fitness_coach' && connection.status === 'active'
  );
```

Filter assigned plans to published plans only:

```ts
const assignedTrainingPlan =
  trainingPlans.find((plan) => plan.sourceKind === 'assigned' && !plan.isDraft) ?? null;
```

Add derived flag:

```ts
const isWaitingForCoachPlan =
  hasActiveFitnessCoachConnection && !hasActiveTrainingAssignment;
```

- [ ] **Step 4: Render waiting state before self-managed/empty branches**

In the JSX branch that currently checks `hasActiveTrainingAssignment ? ... : hasSelfManagedPlan ? ... : ...`, insert the waiting state before the self-managed branch:

```tsx
) : isWaitingForCoachPlan ? (
  <View style={styles.emptyStateWrap} testID="student.training.waitingForCoachPlan">
    <View style={styles.emptyHero}>
      <View
        style={[
          styles.emptyGlow,
          {
            backgroundColor:
              scheme === 'dark' ? 'rgba(30, 169, 90, 0.10)' : 'rgba(19, 236, 73, 0.12)',
          },
        ]}
      />
      <View
        style={[
          styles.emptyMainTile,
          DsShadow.floating,
          {
            backgroundColor: theme.color.surface,
            shadowColor: scheme === 'dark' ? '#000000' : '#1ea95a',
          },
        ]}>
        <MaterialIcons color="#13ec49" name="hourglass-top" size={58} />
      </View>
    </View>

    <View style={styles.emptyCopyBlock}>
      <Text style={[styles.emptyTitle, { color: theme.color.textPrimary }]}>
        {t('student.training.waiting.title')}
      </Text>
      <Text style={[styles.emptyBody, { color: theme.color.textSecondary }]}>
        {t('student.training.waiting.body')}
      </Text>
    </View>

    <DsPillButton
      scheme={scheme}
      label={t('student.training.waiting.cta')}
      onPress={() => router.push('/student/professionals')}
      disabled={isWriteLocked}
      contentColor="#f8fafc"
      testID="student.training.waitingCta"
      style={styles.emptyPrimaryCta}
      leftIcon={<MaterialIcons color="#f8fafc" name="person" size={20} />}
    />
  </View>
) : hasSelfManagedPlan ? (
```

- [ ] **Step 5: Run focused checks**

Run: `yarn tsc --noEmit && yarn lint`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/student/training.tsx localization/en-US.ts localization/pt-BR.ts localization/es-ES.ts docs/screens/v2/localized-copy-table-v2.md
git commit -m "fix(student-training): show waiting state for active coach without plan"
```

---

### Task 3: Make Single-Student Assignment Create Draft Assigned Plans

**Files:**
- Modify: `app/professional/training/plans/[planId].tsx`
- Modify: `features/plans/use-plans.ts` if needed

- [ ] **Step 1: Use draft assignment instead of bulk assignment for single-student picker**

In `app/professional/training/plans/[planId].tsx`, update the plans hook destructure:

```ts
const { createDraftAssignedPlan } = usePlans(Boolean(currentUser), { fetchOnMount: false });
```

Replace `handleAssignToStudent` body with:

```ts
const handleAssignToStudent = useCallback(async (studentUid: string) => {
  if (!planId) return;
  setIsStudentPickerVisible(false);
  setIsAssigning(true);
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

  const result = await createDraftAssignedPlan(planId, studentUid);
  setIsAssigning(false);

  if ('error' in result) {
    Alert.alert(t('pro.plan.assign.error') as string);
    return;
  }

  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  router.push(`/professional/training/plans/${result.id}`);
}, [createDraftAssignedPlan, planId, router, t]);
```

- [ ] **Step 2: Keep bulk assignment only for explicit send-unchanged UX**

If the current screen only has a single-student picker, remove `bulkAssign` from this route entirely. Do not add a multi-select send-unchanged UX in this task.

- [ ] **Step 3: Run focused checks**

Run: `yarn tsc --noEmit && yarn lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/professional/training/plans/[planId].tsx
git commit -m "fix(training-plans): route single assignment through draft customization"
```

---

### Task 4: Enforce Training Plan Governance in Firestore Rules

**Files:**
- Modify: `firestore.rules`
- Create: `features/plans/training-plan-rules.contract.test.ts`

- [ ] **Step 1: Add static contract tests for critical rule clauses**

Create `features/plans/training-plan-rules.contract.test.ts`:

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');

test('trainingPlans rules hide draft assigned plans from students', () => {
  assert.match(rules, /function isPublishedForStudentRead\(\)/);
  assert.match(rules, /resource\.data\.isDraft != true/);
});

test('trainingPlans rules keep assigned plans read-only for students', () => {
  assert.match(rules, /function canUpdateAssignedTrainingPlan\(\)/);
  assert.match(rules, /resource\.data\.ownerProfessionalUid == request\.auth\.uid/);
  assert.doesNotMatch(
    rules,
    /allow update, delete: if signedIn\(\) && \(\s*resource\.data\.studentAuthUid == request\.auth\.uid/
  );
});

test('trainingPlans rules require active fitness coach access for assigned writes', () => {
  assert.match(rules, /hasActiveFitnessCoachTrackingAccess\(request\.resource\.data\.studentAuthUid\)/);
  assert.match(rules, /hasActiveFitnessCoachTrackingAccess\(resource\.data\.studentAuthUid\)/);
});

test('trainingPlans rules distinguish self-managed and professional library creates', () => {
  assert.match(rules, /function canCreateSelfManagedTrainingPlan\(\)/);
  assert.match(rules, /request\.resource\.data\.sourceKind == 'self_managed'/);
  assert.match(rules, /function canCreateProfessionalLibraryTrainingPlan\(\)/);
  assert.match(rules, /request\.resource\.data\.sourceKind == 'predefined'/);
});
```

- [ ] **Step 2: Run failing contract tests**

Run: `yarn test:unit features/plans/training-plan-rules.contract.test.ts`

Expected: FAIL because helper functions do not exist yet.

- [ ] **Step 3: Replace broad trainingPlans rules with source-kind-specific rules**

In `firestore.rules`, add helper functions before `match /trainingPlans/{planId}`:

```js
    function trainingIdentityUnchanged() {
      return request.resource.data.id == resource.data.id &&
        request.resource.data.studentAuthUid == resource.data.studentAuthUid &&
        request.resource.data.ownerProfessionalUid == resource.data.ownerProfessionalUid &&
        request.resource.data.sourceKind == resource.data.sourceKind &&
        request.resource.data.createdAt == resource.data.createdAt;
    }

    function isPublishedForStudentRead() {
      return resource.data.studentAuthUid == request.auth.uid &&
        resource.data.isDraft != true;
    }

    function canCreateSelfManagedTrainingPlan() {
      return request.resource.data.studentAuthUid == request.auth.uid &&
        request.resource.data.ownerProfessionalUid == null &&
        request.resource.data.sourceKind == 'self_managed' &&
        request.resource.data.isDraft == false &&
        request.resource.data.isArchived == false;
    }

    function canCreateProfessionalLibraryTrainingPlan() {
      return request.resource.data.studentAuthUid == request.auth.uid &&
        request.resource.data.ownerProfessionalUid == request.auth.uid &&
        request.resource.data.sourceKind == 'predefined' &&
        request.resource.data.isDraft == false &&
        request.resource.data.isArchived == false;
    }

    function canCreateAssignedTrainingPlan() {
      return request.resource.data.ownerProfessionalUid == request.auth.uid &&
        request.resource.data.studentAuthUid != request.auth.uid &&
        request.resource.data.sourceKind == 'assigned' &&
        request.resource.data.isArchived == false &&
        hasActiveFitnessCoachTrackingAccess(request.resource.data.studentAuthUid);
    }

    function canUpdateSelfManagedTrainingPlan() {
      return resource.data.studentAuthUid == request.auth.uid &&
        resource.data.ownerProfessionalUid == null &&
        resource.data.sourceKind == 'self_managed' &&
        trainingIdentityUnchanged();
    }

    function canUpdateProfessionalLibraryTrainingPlan() {
      return resource.data.ownerProfessionalUid == request.auth.uid &&
        resource.data.studentAuthUid == request.auth.uid &&
        resource.data.sourceKind == 'predefined' &&
        trainingIdentityUnchanged();
    }

    function canUpdateAssignedTrainingPlan() {
      return resource.data.ownerProfessionalUid == request.auth.uid &&
        resource.data.sourceKind == 'assigned' &&
        trainingIdentityUnchanged() &&
        hasActiveFitnessCoachTrackingAccess(resource.data.studentAuthUid);
    }
```

Replace `match /trainingPlans/{planId}` with:

```js
    match /trainingPlans/{planId} {
      allow read: if signedIn() && (
        resource.data.ownerProfessionalUid == request.auth.uid ||
        isPublishedForStudentRead()
      );
      allow create: if signedIn() && (
        canCreateSelfManagedTrainingPlan() ||
        canCreateProfessionalLibraryTrainingPlan() ||
        canCreateAssignedTrainingPlan()
      );
      allow update: if signedIn() && (
        canUpdateSelfManagedTrainingPlan() ||
        canUpdateProfessionalLibraryTrainingPlan() ||
        canUpdateAssignedTrainingPlan()
      );
      allow delete: if signedIn() && (
        canUpdateSelfManagedTrainingPlan() ||
        canUpdateProfessionalLibraryTrainingPlan() ||
        canUpdateAssignedTrainingPlan()
      );
    }
```

- [ ] **Step 4: Run tests**

Run: `yarn test:unit features/plans/training-plan-rules.contract.test.ts && yarn test:unit features/connections/connection-archival.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules features/plans/training-plan-rules.contract.test.ts
git commit -m "fix(rules): enforce training plan governance"
```

---

### Task 5: Archive Assigned Plans and Restore Self-Managed Plans on Connection End

**Files:**
- Modify: `features/connections/connection-source.ts`
- Test: `features/connections/connection-archival.test.ts`

- [ ] **Step 1: Extend connection archival test mocks**

In `features/connections/connection-archival.test.ts`, update `mockGetDocs` to return distinct docs for ended assigned plans and archived self-managed plans when the query asks for them. Use query clauses to branch:

```ts
const getClause = (field: string) => queryClauses.find((clause) => clause.field === field)?.value;

const mockGetDocs = async (q: any) => {
  if (q.colRef && (q.colRef.path === 'nutritionPlans' || q.colRef.path === 'trainingPlans')) {
    const sourceKind = q.clauses.find((clause: any) => clause.field === 'sourceKind')?.value;
    const isArchived = q.clauses.find((clause: any) => clause.field === 'isArchived')?.value;

    if (sourceKind === 'assigned' && isArchived === false) {
      return {
        empty: false,
        docs: [
          {
            id: 'assigned-plan-123',
            ref: { type: 'doc_ref', path: `${q.colRef.path}/assigned-plan-123` },
            data: () => ({ id: 'assigned-plan-123', sourceKind: 'assigned', isArchived: false }),
          },
        ],
        forEach(cb: any) { this.docs.forEach(cb); },
      } as any;
    }

    if (sourceKind === 'self_managed' && isArchived === true) {
      return {
        empty: false,
        docs: [
          {
            id: 'self-managed-plan-123',
            ref: { type: 'doc_ref', path: `${q.colRef.path}/self-managed-plan-123` },
            data: () => ({ id: 'self-managed-plan-123', sourceKind: 'self_managed', isArchived: true }),
          },
        ],
        forEach(cb: any) { this.docs.forEach(cb); },
      } as any;
    }
  }

  return { empty: true, docs: [], forEach() {} } as any;
};
```

- [ ] **Step 2: Add failing test for connection-end plan lifecycle**

Append:

```ts
test('TDD: endConnection archives assigned training plan and restores self-managed training plan', async () => {
  currentSpecialty = 'fitness_coach';
  currentStatus = 'active';
  queriedCollection = null;
  queryClauses = [];
  txUpdates = [];
  txSets = [];

  const mockDeps = {
    getFirestoreInstance: () => ({}) as any,
    getCurrentAuthUid: () => 'student-456',
  };

  await endConnection('conn-123', mockDeps);

  const assignedUpdate = txUpdates.find((u) => u.ref.path === 'trainingPlans/assigned-plan-123');
  assert.ok(assignedUpdate, 'Should archive assigned training plan');
  assert.equal(assignedUpdate.data.isArchived, true);

  const selfManagedUpdate = txUpdates.find((u) => u.ref.path === 'trainingPlans/self-managed-plan-123');
  assert.ok(selfManagedUpdate, 'Should restore archived self-managed training plan');
  assert.equal(selfManagedUpdate.data.isArchived, false);
});
```

- [ ] **Step 3: Run failing test**

Run: `yarn test:unit features/connections/connection-archival.test.ts`

Expected: FAIL because `endConnection` does not update plan docs.

- [ ] **Step 4: Implement end-connection plan lifecycle**

In `features/connections/connection-source.ts`, add helper near `getTrackingAccessRef`:

```ts
function getPlanCollectionForSpecialty(connection: FirestoreConnection) {
  return connection.specialty === 'fitness_coach' ? 'trainingPlans' : 'nutritionPlans';
}
```

In `endConnection`, before `tx.update(ref, ...)`, query active assigned and archived self-managed plans:

```ts
      const targetCollection = getPlanCollectionForSpecialty(data);
      const assignedQuery = query(
        collection(firestore, targetCollection),
        where('studentAuthUid', '==', data.studentAuthUid),
        where('ownerProfessionalUid', '==', data.professionalAuthUid),
        where('sourceKind', '==', 'assigned'),
        where('isArchived', '==', false)
      );
      const selfManagedQuery = query(
        collection(firestore, targetCollection),
        where('studentAuthUid', '==', data.studentAuthUid),
        where('sourceKind', '==', 'self_managed'),
        where('isArchived', '==', true)
      );
      const [assignedSnaps, selfManagedSnaps] = await Promise.all([
        getDocs(assignedQuery),
        getDocs(selfManagedQuery),
      ]);
```

After tracking-access update, archive assigned plans and restore self-managed plans:

```ts
      assignedSnaps.forEach((docSnap) => {
        tx.update(docSnap.ref, { isArchived: true, updatedAt: nowIso() });
      });

      selfManagedSnaps.forEach((docSnap) => {
        tx.update(docSnap.ref, { isArchived: false, updatedAt: nowIso() });
      });
```

- [ ] **Step 5: Run tests**

Run: `yarn test:unit features/connections/connection-archival.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add features/connections/connection-source.ts features/connections/connection-archival.test.ts
git commit -m "fix(connections): restore self-managed plans when coaching ends"
```

---

### Task 6: Final Verification and Documentation Check

**Files:**
- Modify only if verification reveals drift: `docs/screens/v2/SC-208-training-plan-builder.md`, `docs/screens/v2/SC-210-student-training-tracking.md`, `CONTEXT.md`

- [ ] **Step 1: Run full root verification**

Run:

```bash
yarn tsc --noEmit
yarn lint
yarn test:unit
```

Expected: all pass, with `yarn test:unit` reporting `0` failures.

- [ ] **Step 2: Run Functions build with local engine workaround if needed**

Run:

```bash
yarn --cwd functions build
```

Expected on Node 20: PASS.

If local shell is still Node 24 and Yarn blocks on `engines`, run:

```bash
yarn --cwd functions --ignore-engines build
```

Expected: PASS TypeScript build.

- [ ] **Step 3: Re-read docs and code against decisions**

Check these exact decisions are represented in code and docs:

- `Professional Library Plan` is only a professional reusable library item.
- Student-created personal training plans persist as Self-Managed Plans.
- Draft assigned training plans are invisible to students.
- Single-student assignment creates draft assigned copy first.
- Published assigned training plans are editable by the owning professional only while the matching `fitness_coach` Connection is active.
- Active `fitness_coach` without published plan renders waiting state, not self-guided editing.
- Connection end archives assigned plan and restores the latest Self-Managed Plan.
- Plan lifecycle archive/restore writes use the `lifecycleConnectionId` marker.

- [ ] **Step 4: Commit any final doc/test adjustment**

If the listed docs align with final implementation after any minimal corrections, commit them:

```bash
git add CONTEXT.md docs/screens/v2/SC-208-training-plan-builder.md docs/screens/v2/SC-210-student-training-tracking.md docs/superpowers/plans/2026-05-31-training-plan-governance-fix.md
git commit -m "docs(training-plans): align governance follow-ups"
```

---

## Self-Review

**Spec coverage:** This plan covers Professional Library Plan creation, Self-Managed Plan creation, draft assigned plans, student waiting state, direct professional edits while connected, draft invisibility, Firestore rules, and connection-end restoration.

**Known limitation:** `features/plans/training-plan-rules.contract.test.ts` is a static guard, not a full Firestore Rules emulator test. It protects the most important rule text until the project adds `@firebase/rules-unit-testing` and emulator-backed rules tests.

**Execution order:** Do not skip Task 1. Later rules and connection lifecycle fixes assume student plans persist as `self_managed` instead of inferred self-guided `predefined` plans.
