# Plan Customization Lifecycle and Student Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement professional draft assigned plan customization, connection-activation immediate archival, student-side inline plan details viewing, daily check-off logs for nutrition and workouts, and specialty-scoped read rules.

**Architecture:** Use a `Draft Assigned Plan` lifecycle where predefined templates are cloned with `isDraft: true` and edited in the builder before being published (`isDraft: false`) by the professional. Daily logging uses a zero-friction check-off system that creates `portionLogs` and a new `workoutLogs` collection in Firestore, protected by specialty-scoped connection rules.

**Tech Stack:** React Native 0.81.5, Expo SDK 54, Zustand, Firebase JS SDK 10 (Firestore)

---

### Task 1: Firestore Security Rules & `workoutLogs` Collection Setup

**Files:**
- Modify: `firestore.rules`
- Test: `scripts/validate-firestore-smoke.mjs`

- [ ] **Step 1: Write the updated rules**
  Add the `/workoutLogs` collection rule and update `portionLogs`, `waterLogs`, and `waterGoals` read rules to allow professional access based on active connection specialty.
  
  Replace lines 105-147 in `firestore.rules` with the following:
  ```javascript
    function hasActiveSpecialtyConnection(ownerUid, specialtyStr) {
      return signedIn() && exists(/databases/$(database)/documents/connections) && 
        (
          getDocs(/databases/$(database)/documents/connections, 
            where('studentAuthUid', '==', ownerUid),
            where('professionalAuthUid', '==', request.auth.uid),
            where('specialty', '==', specialtyStr),
            where('status', '==', 'active')
          ).size > 0
        );
    }

    match /waterLogs/{logId} {
      allow read: if signedIn() && (
        resource.data.ownerUid == request.auth.uid ||
        hasActiveSpecialtyConnection(resource.data.ownerUid, 'nutritionist')
      );
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.ownerUid == request.auth.uid;
    }

    match /waterGoals/{goalId} {
      allow read: if signedIn() && (
        goalId == request.auth.uid ||
        hasActiveSpecialtyConnection(goalId, 'nutritionist')
      );
      allow create: if signedIn() && (
        goalId == request.auth.uid && request.resource.data.ownerUid == request.auth.uid
      );
      allow update, delete: if signedIn() && (
        goalId == request.auth.uid ||
        hasActiveSpecialtyConnection(goalId, 'nutritionist')
      );
    }

    match /customMeals/{mealId} {
      allow read, update, delete: if signedIn() && resource.data.ownerUid == request.auth.uid;
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
    }

    match /mealShareLinks/{shareToken} {
      allow read: if true;
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.ownerUid == request.auth.uid;
    }

    match /portionLogs/{logId} {
      allow read: if signedIn() && (
        resource.data.ownerUid == request.auth.uid ||
        hasActiveSpecialtyConnection(resource.data.ownerUid, 'nutritionist')
      );
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.ownerUid == request.auth.uid;
    }

    match /workoutLogs/{logId} {
      allow read: if signedIn() && (
        resource.data.ownerUid == request.auth.uid ||
        hasActiveSpecialtyConnection(resource.data.ownerUid, 'fitness_coach')
      );
      allow create: if signedIn() && request.resource.data.ownerUid == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.ownerUid == request.auth.uid;
    }
  ```

- [ ] **Step 2: Add validation check in smoke script**
  Modify `scripts/validate-firestore-smoke.mjs` to execute a basic write and read test on `workoutLogs`.
  
  Add to smoke validations:
  ```javascript
  console.log("Verifying workoutLogs REST read/write...");
  // Write mock workoutLog doc
  // Read back and assert success
  ```

- [ ] **Step 3: Run the smoke script and verify rules deploy**
  Run: `npm run validate:firestore:smoke`  
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add firestore.rules scripts/validate-firestore-smoke.mjs
  git commit -m "feat: setup workoutLogs rules and professional specialty connections access"
  ```

---

### Task 2: Immediate Self-Managed Plan Archival in Connection Source

**Files:**
- Modify: `features/connections/connection-source.ts`
- Test: `features/connections/connection-source.test.ts`

- [ ] **Step 1: Write test case for connection-activation self-managed archival**
  Add a unit test in `features/connections/connection-source.test.ts` asserting that confirming a pending connection triggers archival of existing student self-managed plans.

- [ ] **Step 2: Update `confirmPendingConnection`**
  Modify `confirmPendingConnection` inside `features/connections/connection-source.ts:163-198` to find any active, non-archived `self_managed` plans owned by the student under the connection specialty, and write `isArchived: true` within the same transaction.

  ```typescript
      await runTransaction(firestore, async (tx) => {
        const ref = doc(firestore, 'connections', connectionId);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new ConnectionSourceError('graphql', 'Connection not found.');
        }

        const data = snap.data() as FirestoreConnection;
        if (data.professionalAuthUid !== professionalUid) {
          throw new ConnectionSourceError('graphql', 'Permission denied for connection confirmation.');
        }
        if (data.status !== 'pending_confirmation') {
          throw new ConnectionSourceError('graphql', 'Invalid connection transition.');
        }

        tx.update(ref, {
          status: 'active',
          canceledReason: null,
          endedAt: null,
          updatedAt: nowIso(),
        });

        // Archive student self-managed plans for this connection specialty
        const targetCollection = data.specialty === 'nutritionist' ? 'nutritionPlans' : 'trainingPlans';
        const selfManagedQuery = query(
          collection(firestore, targetCollection),
          where('studentAuthUid', '==', data.studentAuthUid),
          where('sourceKind', '==', 'self_managed'),
          where('isArchived', '==', false)
        );
        const selfManagedSnaps = await getDocs(selfManagedQuery);
        selfManagedSnaps.forEach((doc) => {
          tx.update(doc.ref, { isArchived: true, updatedAt: nowIso() });
        });
      });
  ```

- [ ] **Step 3: Run the connection-source unit tests**
  Run: `npm test features/connections/connection-source`  
  Expected: PASS

- [ ] **Step 4: Commit**
  ```bash
  git add features/connections/connection-source.ts
  git commit -m "feat: archive self-managed plans immediately on connection confirmation"
  ```

---

### Task 3: Draft Assigned Plan Backend & Store Actions

**Files:**
- Modify: `features/plans/plan-source.ts`
- Modify: `features/plans/plans-store.ts`
- Test: `features/plans/plan-source.test.ts`

- [ ] **Step 1: Add unit tests for draft clone and publish actions**
  Add unit tests in `features/plans/plan-source.test.ts` for:
  - `createDraftAssignedPlan(templateId, studentUid)`: clones predefined plan to assigned but retains `isDraft: true`.
  - `updateNutritionPlan` / `updateTrainingPlan` supporting optional `isDraft` update.

- [ ] **Step 2: Create draft assignment operations in `plan-source.ts`**
  Add a single-student draft cloning function inside `features/plans/plan-source.ts`:
  ```typescript
  export async function createDraftAssignedPlan(
    predefinedPlanId: string,
    studentUid: string,
    deps = defaultDeps
  ): Promise<{ id: string }> {
    const firestore = deps.getFirestoreInstance();
    const professionalUid = deps.getCurrentAuthUid();

    const [nutritionSourceSnap, trainingSourceSnap] = await Promise.all([
      getDoc(doc(firestore, 'nutritionPlans', predefinedPlanId)),
      getDoc(doc(firestore, 'trainingPlans', predefinedPlanId)),
    ]);

    const timestamp = nowIso();
    if (nutritionSourceSnap.exists()) {
      const source = nutritionSourceSnap.data() as FirestoreNutritionPlan;
      const id = generateId('nutrition_plan');
      await runTransaction(firestore, async (tx) => {
        tx.set(doc(firestore, 'nutritionPlans', id), {
          ...source,
          id,
          ownerProfessionalUid: professionalUid,
          studentAuthUid: studentUid,
          sourceKind: 'assigned',
          isArchived: false,
          isDraft: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies FirestoreNutritionPlan);
      });
      return { id };
    } else if (trainingSourceSnap.exists()) {
      const source = trainingSourceSnap.data() as FirestoreTrainingPlan;
      const id = generateId('training_plan');
      await runTransaction(firestore, async (tx) => {
        tx.set(doc(firestore, 'trainingPlans', id), {
          ...source,
          id,
          ownerProfessionalUid: professionalUid,
          studentAuthUid: studentUid,
          sourceKind: 'assigned',
          isArchived: false,
          isDraft: true,
          createdAt: timestamp,
          updatedAt: timestamp,
        } satisfies FirestoreTrainingPlan);
      });
      return { id };
    }
    throw new PlanSourceError('graphql', 'Predefined template not found.');
  }
  ```

- [ ] **Step 3: Modify `updateNutritionPlan` & `updateTrainingPlan` to support optional publish**
  Update signatures to:
  `updateNutritionPlan(planId, input, publish?: boolean)`
  Update Firestore transaction to update `isDraft: false` when `publish` is true.

- [ ] **Step 4: Update Zustand store (`plans-store.ts`)**
  - Add `createDraftAssignedPlanAction` to Zustand state interface.
  - Implement actions that route template clones to drafts, and support `publish` on plan saves.
  
- [ ] **Step 5: Run tests**
  Run: `npm test features/plans/plan-source`  
  Expected: PASS

- [ ] **Step 6: Commit**
  ```bash
  git add features/plans/plan-source.ts features/plans/plans-store.ts
  git commit -m "feat: implement createDraftAssignedPlan and publish integration in Zustand"
  ```

---

### Task 4: Student Profile Screen (SC-206) Updates

**Files:**
- Modify: `app/professional/student-profile.tsx`

- [ ] **Step 1: Retrieve draft assignments in profile**
  Update `loadAssignments` inside `app/professional/student-profile.tsx` to query plans where `studentAuthUid == studentId` and check if there are documents with `isDraft: true`.
  
- [ ] **Step 2: Add Draft Status & CTAs to Assignment Cards**
  - Under `AssignmentCard` where specialty connection status is `active`, check if a Draft Assignment exists.
  - If a Draft exists: show **"Draft Assignment (Pending Send)"** with CTAs to **"Resume Draft"** (routes to builder) and **"Discard Draft"** (deletes the draft plan).
  - If a published plan exists: show **"Active: [Plan Name]"** along with a **"View/Edit Assigned Plan"** CTA routing to the builder.
  - If no plan is assigned: show **"Assign Predefined Plan"** (triggering modal).

- [ ] **Step 3: Wire CTAs**
  - Resume/View button: routes to `/professional/nutrition/plans/[planId]` (or `/professional/training/plans/[planId]`).
  - Discard CTA: calls `deleteNutritionPlan` / `deleteTrainingPlan` from store, then refreshes assignments.
  - Picker modal confirm: calls `createDraftAssignedPlanAction` and immediately routes the professional to the builder with the newly created draft plan ID.

- [ ] **Step 4: Verify UI**
  Launch Expo dev tools or run unit/integration checks on student profile transitions.

- [ ] **Step 5: Commit**
  ```bash
  git add app/professional/student-profile.tsx
  git commit -m "ui: integrate draft assignment lifecycles on professional student oversight profile"
  ```

---

### Task 5: Plan Builder Screen (SC-207/208) Publishing Support

**Files:**
- Modify: `app/professional/nutrition/plans/[planId].tsx`
- Modify: `app/professional/training/plans/[planId].tsx`

- [ ] **Step 1: Add Draft Assignment Banner & Save Label in Nutrition Builder**
  Inside `app/professional/nutrition/plans/[planId].tsx`:
  - Check if `state.plan.isDraft` and `state.plan.sourceKind === 'assigned'`.
  - If true: render a top-banner card alert: *"Draft Assignment: Customize this plan for student before sending."*
  - Change header DsPillButton label to **"Assign & Send"** (translated via new key `pro.plan.cta.assign_and_send`).
  - Modify save handler to trigger store save with `publish: true`.

- [ ] **Step 2: Apply same changes to Training Builder**
  Inside `app/professional/training/plans/[planId].tsx`, replicate draft checks and banner, changing header CTA to **"Assign & Send"** with `publish: true`.

- [ ] **Step 3: Verify Screen Flow**
  Expected: Professional selects a template on SC-206, lands in draft builder mode, tweaks items, taps "Assign & Send", and returns to profile screen with plan now published.

- [ ] **Step 4: Commit**
  ```bash
  git add app/professional/nutrition/plans/[planId].tsx app/professional/training/plans/[planId].tsx
  git commit -m "ui: add draft customized publishing banner and Assign & Send action to builders"
  ```

---

### Task 6: Student Nutrition Tracking Inline Viewer and Logging

**Files:**
- Modify: `app/student/nutrition.tsx`
- Create: `features/nutrition/workout-logger-source.ts` (if needed, otherwise leverage custom-meals logPortion)

- [ ] **Step 1: Write test case for inline active plan meals list**
  Write a test case in `features/plans/use-plans.test.ts` asserting that active, non-draft assigned nutrition plans are retrieved correctly on student tracking mount.

- [ ] **Step 2: Build Inline Plan details viewer in `app/student/nutrition.tsx`**
  Inside `app/student/nutrition.tsx:83-115`:
  - Replace the single `ReadOnlyNoticeCard` with a daily tracking dashboard showing:
    - Calories target card, carbs, proteins, and fats summary.
    - An interactive list of today's assigned meals. Tapping a meal expands it inline or opens a details card showing its individual food items.

- [ ] **Step 3: Implement Check-Off "Log Meal" button**
  - Add a check-off button (**"Log Meal"**) next to each meal.
  - Wire it to trigger `logPortion` in store using the meal's calculated macro totals, logging it directly to `portionLogs`.
  - Disable button and show a completed check icon once checked off.

- [ ] **Step 4: Test local integration**
  Run: `npm test features/plans/use-plans`  
  Expected: PASS

- [ ] **Step 5: Commit**
  ```bash
  git add app/student/nutrition.tsx
  git commit -m "ui: render inline active nutrition plan details and log meal check-off action for students"
  ```

---

### Task 7: Student Workout Tracking Inline Viewer and Logging

**Files:**
- Modify: `app/student/training.tsx`
- Create: `features/training/workout-log-source.ts`

- [ ] **Step 1: Create `workout-log-source.ts`**
  Implement `logWorkoutSession(sessionId, sessionName)` writing to `/workoutLogs` in Firestore.
  ```typescript
  import { collection, doc, runTransaction } from 'firebase/firestore';
  import { getFirestoreInstance, getCurrentAuthUid, nowIso, generateId } from '../firestore';
  
  export async function logWorkoutSession(sessionId: string, sessionName: string): Promise<void> {
    const firestore = getFirestoreInstance();
    const uid = getCurrentAuthUid();
    const logId = generateId('workout_log');
    const timestamp = nowIso();
    
    await runTransaction(firestore, async (tx) => {
      tx.set(doc(firestore, 'workoutLogs', logId), {
        id: logId,
        ownerUid: uid,
        sessionId,
        sessionName,
        createdAt: timestamp,
      });
    });
  }
  ```

- [ ] **Step 2: Build Inline Plan sessions viewer in `app/student/training.tsx`**
  Inside `app/student/training.tsx`:
  - Replace the generic `ReadOnlyNoticeCard` and session card with a daily sessions viewer displaying the training sessions from their active plan.
  - Tapping a session expands it inline to reveal its individual exercise items (rep targets, notes).

- [ ] **Step 3: Implement Check-Off "Log Workout" button**
  - Add a **"Log Workout"** check-off button next to each session.
  - On click, execute `logWorkoutSession`, tracking it to the `/workoutLogs` collection.
  - Show a completed green check once session is logged for today.

- [ ] **Step 4: Verify test suite**
  Ensure entire test suite compiles and runs cleanly.
  Run: `npm test`  
  Expected: 0 failures

- [ ] **Step 5: Commit**
  ```bash
  git add app/student/training.tsx features/training/workout-log-source.ts
  git commit -m "ui: add inline assigned workout sessions list and log session check-off actions for student training"
  ```
