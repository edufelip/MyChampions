import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
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

test('student can create pending invite-backed nutritionist connection', async () => {
  await seedDoc(testEnv, 'inviteCodeLookups/NUT123', {
    scope: 'invite_code_lookup',
    codeValue: 'NUT123',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    inviteCodeId: 'nutritionist',
    status: 'active',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'professionals/nutritionist-uid/inviteCodes/nutritionist', {
    scope: 'professional_specialty',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    codeValue: 'NUT123',
    status: 'active',
    rotatedAt: null,
    expiresAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });

  await assertSucceeds(setDoc(doc(authedDb(testEnv, 'student-uid'), 'connections/pending-invite'), {
    id: 'pending-invite',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    sourceInviteCodeId: 'nutritionist',
    sourceInviteCodeValue: 'NUT123',
    status: 'pending_confirmation',
    canceledReason: null,
    endedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }));
});

test('student cannot end nutritionist connection without lifecycle side effects', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedDoc(testEnv, 'trackingAccess/student-uid/activeSpecialties/nutritionist', {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'active',
  });

  await assertFails(updateDoc(
    doc(authedDb(testEnv, 'student-uid'), 'connections/student-uid-nutritionist-uid-nutritionist'),
    {
      status: 'ended',
      endedAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    }
  ));
});

test('student can end nutritionist connection with lifecycle side effects', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedDoc(testEnv, 'trackingAccess/student-uid/activeSpecialties/nutritionist', {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'active',
  });

  const db = authedDb(testEnv, 'student-uid');
  const batch = writeBatch(db);
  batch.update(doc(db, 'connections/student-uid-nutritionist-uid-nutritionist'), {
    status: 'ended',
    endedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  batch.set(doc(db, 'trackingAccess/student-uid/nutritionists/nutritionist-uid'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, { merge: true });
  batch.set(doc(db, 'trackingAccess/student-uid/activeSpecialties/nutritionist'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, { merge: true });

  await assertSucceeds(batch.commit());
});

test('student cannot read assigned nutrition plan after lifecycle connection end', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedDoc(testEnv, 'trackingAccess/student-uid/activeSpecialties/nutritionist', {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'active',
  });
  await seedDoc(testEnv, 'nutritionPlans/assigned-published', {
    id: 'assigned-published',
    studentAuthUid: 'student-uid',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: false,
    isArchived: false,
    lifecycleConnectionId: null,
    title: 'Assigned Nutrition',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const db = authedDb(testEnv, 'student-uid');
  const batch = writeBatch(db);
  batch.update(doc(db, 'connections/student-uid-nutritionist-uid-nutritionist'), {
    status: 'ended',
    endedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  batch.set(doc(db, 'trackingAccess/student-uid/nutritionists/nutritionist-uid'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, { merge: true });
  batch.set(doc(db, 'trackingAccess/student-uid/activeSpecialties/nutritionist'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, { merge: true });
  await assertSucceeds(batch.commit());

  await assertFails(getDoc(doc(db, 'nutritionPlans/assigned-published')));
});

test('connection-end plan lifecycle can be reconciled after access side effects', async () => {
  await seedActiveNutritionistAccess(testEnv, 'student-uid', 'nutritionist-uid');
  await seedDoc(testEnv, 'trackingAccess/student-uid/activeSpecialties/nutritionist', {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'active',
  });
  await seedDoc(testEnv, 'nutritionPlans/assigned-published', {
    id: 'assigned-published',
    studentAuthUid: 'student-uid',
    ownerProfessionalUid: 'nutritionist-uid',
    sourceKind: 'assigned',
    isDraft: false,
    isArchived: false,
    lifecycleConnectionId: null,
    title: 'Assigned Nutrition',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'nutritionPlans/self-archived', {
    id: 'self-archived',
    studentAuthUid: 'student-uid',
    ownerProfessionalUid: null,
    sourceKind: 'self_managed',
    isDraft: false,
    isArchived: true,
    lifecycleConnectionId: 'student-uid-nutritionist-uid-nutritionist',
    title: 'Self Managed Nutrition',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });

  const db = authedDb(testEnv, 'student-uid');
  const batch = writeBatch(db);
  batch.update(doc(db, 'connections/student-uid-nutritionist-uid-nutritionist'), {
    status: 'ended',
    endedAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  batch.set(doc(db, 'trackingAccess/student-uid/nutritionists/nutritionist-uid'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, { merge: true });
  batch.set(doc(db, 'trackingAccess/student-uid/activeSpecialties/nutritionist'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'student-uid-nutritionist-uid-nutritionist',
    status: 'ended',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }, { merge: true });
  await assertSucceeds(batch.commit());

  await assertSucceeds(updateDoc(doc(db, 'nutritionPlans/assigned-published'), {
    isArchived: true,
    lifecycleConnectionId: 'student-uid-nutritionist-uid-nutritionist',
    updatedAt: '2026-06-01T00:01:00.000Z',
  }));
  await assertSucceeds(updateDoc(doc(db, 'nutritionPlans/self-archived'), {
    isArchived: false,
    lifecycleConnectionId: 'student-uid-nutritionist-uid-nutritionist',
    updatedAt: '2026-06-01T00:02:00.000Z',
  }));
});

test('student cannot forge active nutritionist connection and tracking access', async () => {
  const db = authedDb(testEnv, 'student-uid');
  const forgedConnection = {
    id: 'forged-active',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    sourceInviteCodeId: 'nutritionist',
    sourceInviteCodeValue: 'NUT123',
    status: 'active',
    canceledReason: null,
    endedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
  };

  await assertFails(setDoc(doc(db, 'connections/forged-active'), forgedConnection));
  await seedDoc(testEnv, 'connections/forged-active', forgedConnection);

  await assertFails(setDoc(doc(db, 'trackingAccess/student-uid/nutritionists/nutritionist-uid'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'forged-active',
    status: 'active',
  }));
  await assertFails(setDoc(doc(db, 'trackingAccess/student-uid/activeSpecialties/nutritionist'), {
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'nutritionist-uid',
    specialty: 'nutritionist',
    connectionId: 'forged-active',
    status: 'active',
  }));
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
