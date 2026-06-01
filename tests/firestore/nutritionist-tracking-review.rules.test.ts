import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import {
  authedDb,
  clearRulesData,
  seedActiveNutritionistAccess,
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

test('active nutritionist can read student water and portion logs for review', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedTrackingLogs();

  const db = authedDb(testEnv, 'nutritionist-uid');
  await assertSucceeds(getDoc(doc(db, 'waterLogs/student-uid_2026-06-01')));
  await assertSucceeds(getDoc(doc(db, 'portionLogs/portion-log-1')));
});

test('nutritionist cannot create, update, or delete student water or portion logs', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedTrackingLogs();

  const db = authedDb(testEnv, 'nutritionist-uid');
  await assertFails(updateDoc(doc(db, 'waterLogs/student-uid_2026-06-01'), { totalMl: 2500 }));
  await assertFails(updateDoc(doc(db, 'portionLogs/portion-log-1'), { consumedGrams: 100 }));
  await assertFails(deleteDoc(doc(db, 'waterLogs/student-uid_2026-06-01')));
  await assertFails(deleteDoc(doc(db, 'portionLogs/portion-log-1')));
  await assertFails(setDoc(doc(db, 'waterLogs/pro-created'), {
    id: 'pro-created',
    ownerUid: 'student-uid',
    dateKey: '2026-06-01',
    totalMl: 100,
    loggedAt: '2026-06-01T12:00:00.000Z',
  }));
});

test('ended nutritionist cannot read student water or portion logs', async () => {
  await seedEndedNutritionistAccess();
  await seedTrackingLogs();

  const db = authedDb(testEnv, 'nutritionist-uid');
  await assertFails(getDoc(doc(db, 'waterLogs/student-uid_2026-06-01')));
  await assertFails(getDoc(doc(db, 'portionLogs/portion-log-1')));
});

test('unrelated nutritionist cannot read student water or portion logs', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedTrackingLogs();

  const db = authedDb(testEnv, 'other-nutritionist-uid');
  await assertFails(getDoc(doc(db, 'waterLogs/student-uid_2026-06-01')));
  await assertFails(getDoc(doc(db, 'portionLogs/portion-log-1')));
});

async function seedTrackingLogs() {
  await seedDoc(testEnv, 'waterLogs/student-uid_2026-06-01', {
    id: 'student-uid_2026-06-01',
    ownerUid: 'student-uid',
    dateKey: '2026-06-01',
    totalMl: 1800,
    loggedAt: '2026-06-01T12:00:00.000Z',
  });
  await seedDoc(testEnv, 'portionLogs/portion-log-1', {
    id: 'portion-log-1',
    ownerUid: 'student-uid',
    mealId: 'meal-1',
    consumedGrams: 0,
    snapshot: { calories: 420, carbs: 50, proteins: 32, fats: 12 },
    loggedAt: '2026-06-01T12:00:00.000Z',
    planId: 'nutrition-plan-1',
    planType: 'nutrition',
    sourceKind: 'assigned',
    ownerProfessionalUid: 'nutritionist-uid',
    connectionId: 'connection-1',
  });
}

async function seedEndedNutritionistAccess() {
  await seedDoc(testEnv, 'connections/student-uid-nutritionist-uid-nutritionist', {
    id: 'student-uid-nutritionist-uid-nutritionist',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    sourceInviteCodeId: 'invite-code-id',
    status: 'ended',
    canceledReason: null,
    endedAt: '2026-06-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'trackingAccess/student-uid/nutritionists/nutritionist-uid', {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
  });
}
