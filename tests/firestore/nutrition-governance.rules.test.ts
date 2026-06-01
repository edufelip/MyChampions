import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import {
  authedDb,
  clearRulesData,
  nutritionPlan,
  seedActiveNutritionistAccess,
  seedActiveNutritionistSpecialty,
  seedDoc,
  setupRulesTestEnvironment,
} from './rules-test-helpers';

let testEnv: RulesTestEnvironment;

before(async () => {
  testEnv = await setupRulesTestEnvironment();
});

beforeEach(async () => {
  await clearRulesData(testEnv);
});

after(async () => {
  await testEnv.cleanup();
});

test('student cannot read draft assigned NutritionPlan', async () => {
  await seedDoc(testEnv, 'nutritionPlans/assigned-draft', nutritionPlan({
    id: 'assigned-draft',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: true,
  }));

  await assertFails(getDoc(doc(authedDb(testEnv, 'student-uid'), 'nutritionPlans/assigned-draft')));
});

test('student can read published assigned NutritionPlan', async () => {
  await seedDoc(testEnv, 'nutritionPlans/assigned-published', nutritionPlan({
    id: 'assigned-published',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: false,
  }));

  await assertSucceeds(getDoc(doc(authedDb(testEnv, 'student-uid'), 'nutritionPlans/assigned-published')));
});

test('student cannot create self_managed NutritionPlan when activeSpecialties/nutritionist is active', async () => {
  await seedActiveNutritionistSpecialty(testEnv, 'student-uid');

  await assertFails(setDoc(doc(authedDb(testEnv, 'student-uid'), 'nutritionPlans/self-blocked'), nutritionPlan({
    id: 'self-blocked',
  })));
});

test('student can create self_managed NutritionPlan when no active nutritionist sentinel exists', async () => {
  await assertSucceeds(setDoc(doc(authedDb(testEnv, 'student-uid'), 'nutritionPlans/self-allowed'), nutritionPlan({
    id: 'self-allowed',
  })));
});

test('student cannot update self_managed NutritionPlan when active nutritionist sentinel exists', async () => {
  await seedDoc(testEnv, 'nutritionPlans/self-existing', nutritionPlan({
    id: 'self-existing',
  }));
  await seedActiveNutritionistSpecialty(testEnv, 'student-uid');

  await assertFails(updateDoc(doc(authedDb(testEnv, 'student-uid'), 'nutritionPlans/self-existing'), {
    title: 'Updated title',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }));
});

test('professional cannot create assigned NutritionPlan without active nutritionist tracking access', async () => {
  await assertFails(setDoc(doc(authedDb(testEnv, 'nutritionist-uid'), 'nutritionPlans/assigned-blocked'), nutritionPlan({
    id: 'assigned-blocked',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: false,
  })));
});

test('professional can create assigned NutritionPlan with active nutritionist tracking access', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');

  await assertSucceeds(setDoc(doc(authedDb(testEnv, 'nutritionist-uid'), 'nutritionPlans/assigned-allowed'), nutritionPlan({
    id: 'assigned-allowed',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: true,
  })));
});

test('professional can update published assigned NutritionPlan with active nutritionist tracking access', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedDoc(testEnv, 'nutritionPlans/assigned-existing', nutritionPlan({
    id: 'assigned-existing',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: false,
  }));

  await assertSucceeds(updateDoc(doc(authedDb(testEnv, 'nutritionist-uid'), 'nutritionPlans/assigned-existing'), {
    title: 'Updated assigned title',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }));
});

test('unrelated professional cannot update assigned NutritionPlan', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedDoc(testEnv, 'nutritionPlans/assigned-existing', nutritionPlan({
    id: 'assigned-existing',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: false,
  }));

  await assertFails(updateDoc(doc(authedDb(testEnv, 'other-nutritionist-uid'), 'nutritionPlans/assigned-existing'), {
    title: 'Unrelated update',
    updatedAt: '2026-01-02T00:00:00.000Z',
  }));
});
