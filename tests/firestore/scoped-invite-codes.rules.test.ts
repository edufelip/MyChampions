import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, runTransaction, setDoc, updateDoc } from 'firebase/firestore';

import {
  authedDb,
  clearRulesData,
  seedProfessionalRoleAndSpecialty,
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

const scopedInviteCode = {
  scope: 'professional_specialty',
  professionalAuthUid: 'professional-uid',
  specialty: 'nutritionist',
  codeValue: 'NUT123',
  status: 'active',
  rotatedAt: null,
  expiresAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const legacyInviteCode = {
  professionalAuthUid: 'professional-uid',
  specialty: 'nutritionist',
  codeValue: 'NUT123',
  status: 'active',
  rotatedAt: null,
  expiresAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const inviteCodeLookup = {
  scope: 'invite_code_lookup',
  codeValue: 'NUT123',
  professionalAuthUid: 'professional-uid',
  specialty: 'nutritionist',
  inviteCodeId: 'nutritionist',
  status: 'active',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

test('old top-level inviteCodes writes are denied', async () => {
  await assertFails(setDoc(doc(authedDb(testEnv, 'professional-uid'), 'inviteCodes/professional-uid'), legacyInviteCode));
});

test('professional can write own specialty-scoped invite code', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');

  await assertSucceeds(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'professionals/professional-uid/inviteCodes/nutritionist'),
    scopedInviteCode
  ));
});

test('student cannot write own specialty-scoped invite code', async () => {
  await seedDoc(testEnv, 'userProfiles/student-uid', {
    authUid: 'student-uid',
    lockedRole: 'student',
  });

  await assertFails(setDoc(
    doc(authedDb(testEnv, 'student-uid'), 'professionals/student-uid/inviteCodes/nutritionist'),
    { ...scopedInviteCode, professionalAuthUid: 'student-uid' }
  ));
});

test('professional cannot write invite code for inactive specialty', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'fitness_coach');

  await assertFails(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'professionals/professional-uid/inviteCodes/nutritionist'),
    scopedInviteCode
  ));
});

test('professional cannot directly delete specialty and bypass governed removal', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');

  await assertFails(deleteDoc(doc(authedDb(testEnv, 'professional-uid'), 'specialties/professional-uid_nutritionist')));
});

test('professional cannot directly deactivate specialty and bypass governed removal', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');

  await assertFails(updateDoc(doc(authedDb(testEnv, 'professional-uid'), 'specialties/professional-uid_nutritionist'), {
    isActive: false,
    updatedAt: '2026-06-01T00:01:00.000Z',
  }));
});

test('student can resolve active invite code through lookup index', async () => {
  await seedDoc(testEnv, 'inviteCodeLookups/NUT123', inviteCodeLookup);

  await assertSucceeds(getDoc(doc(authedDb(testEnv, 'student-uid'), 'inviteCodeLookups/NUT123')));
});

test('student cannot resolve old top-level invite code directly', async () => {
  await seedDoc(testEnv, 'inviteCodes/professional-uid', legacyInviteCode);

  await assertFails(getDoc(doc(authedDb(testEnv, 'student-uid'), 'inviteCodes/professional-uid')));
});

test('professional can maintain own invite code lookup index', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');

  await assertSucceeds(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'inviteCodeLookups/NUT123'),
    inviteCodeLookup
  ));
});

test('student cannot create invite code lookup index', async () => {
  await seedDoc(testEnv, 'userProfiles/student-uid', {
    authUid: 'student-uid',
    lockedRole: 'student',
  });

  await assertFails(setDoc(
    doc(authedDb(testEnv, 'student-uid'), 'inviteCodeLookups/NUT123'),
    { ...inviteCodeLookup, professionalAuthUid: 'student-uid' }
  ));
});

test('student cannot create connection from stale invite after specialty removal', async () => {
  await seedDoc(testEnv, 'userProfiles/professional-uid', {
    authUid: 'professional-uid',
    lockedRole: 'professional',
  });
  await seedDoc(testEnv, 'inviteCodeLookups/NUT123', inviteCodeLookup);
  await seedDoc(testEnv, 'professionals/professional-uid/inviteCodes/nutritionist', scopedInviteCode);

  await assertFails(setDoc(doc(authedDb(testEnv, 'student-uid'), 'connections/stale-invite'), {
    id: 'stale-invite',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
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

test('professional can cancel pending connection when invite code rotates', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');
  await seedDoc(testEnv, 'connections/pending-rotated', {
    id: 'pending-rotated',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    specialty: 'nutritionist',
    sourceInviteCodeId: 'nutritionist',
    sourceInviteCodeValue: 'NUT123',
    status: 'pending_confirmation',
    canceledReason: null,
    endedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });

  await assertSucceeds(updateDoc(doc(authedDb(testEnv, 'professional-uid'), 'connections/pending-rotated'), {
    status: 'ended',
    canceledReason: 'code_rotated',
    endedAt: '2026-06-01T00:01:00.000Z',
    updatedAt: '2026-06-01T00:01:00.000Z',
  }));
});

test('professional cannot cancel guarded pending connection without releasing invite guard state', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');
  await seedDoc(testEnv, 'connections/pending-rotated', {
    id: 'pending-rotated',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    specialty: 'nutritionist',
    sourceInviteCodeId: 'nutritionist',
    sourceInviteCodeValue: 'NUT123',
    status: 'pending_confirmation',
    canceledReason: null,
    endedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'connectionInviteGuards/professional-uid_student-uid_nutritionist', {
    id: 'professional-uid_student-uid_nutritionist',
    connectionId: 'pending-rotated',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    specialty: 'nutritionist',
    status: 'pending_confirmation',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'professionals/professional-uid/pendingStudents/student-uid', {
    id: 'student-uid',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    slotId: 'slot_01',
    nutritionistConnectionId: 'pending-rotated',
    fitnessCoachConnectionId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'professionals/professional-uid/pendingStudentSlots/slot_01', {
    id: 'slot_01',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });

  await assertFails(updateDoc(doc(authedDb(testEnv, 'professional-uid'), 'connections/pending-rotated'), {
    status: 'ended',
    canceledReason: 'code_rotated',
    endedAt: '2026-06-01T00:01:00.000Z',
    updatedAt: '2026-06-01T00:01:00.000Z',
  }));
});

test('professional can release pending invite guard and slot when invite code rotates', async () => {
  await seedProfessionalRoleAndSpecialty(testEnv, 'professional-uid', 'nutritionist');
  await seedDoc(testEnv, 'connections/pending-rotated', {
    id: 'pending-rotated',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    specialty: 'nutritionist',
    sourceInviteCodeId: 'nutritionist',
    sourceInviteCodeValue: 'NUT123',
    status: 'pending_confirmation',
    canceledReason: null,
    endedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'connectionInviteGuards/professional-uid_student-uid_nutritionist', {
    id: 'professional-uid_student-uid_nutritionist',
    connectionId: 'pending-rotated',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    specialty: 'nutritionist',
    status: 'pending_confirmation',
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'professionals/professional-uid/pendingStudents/student-uid', {
    id: 'student-uid',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    slotId: 'slot_01',
    nutritionistConnectionId: 'pending-rotated',
    fitnessCoachConnectionId: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });
  await seedDoc(testEnv, 'professionals/professional-uid/pendingStudentSlots/slot_01', {
    id: 'slot_01',
    studentAuthUid: 'student-uid',
    professionalAuthUid: 'professional-uid',
    updatedAt: '2026-06-01T00:00:00.000Z',
  });

  const db = authedDb(testEnv, 'professional-uid');
  await assertSucceeds(runTransaction(db, async (tx) => {
    tx.update(doc(db, 'connections/pending-rotated'), {
      status: 'ended',
      canceledReason: 'code_rotated',
      endedAt: '2026-06-01T00:01:00.000Z',
      updatedAt: '2026-06-01T00:01:00.000Z',
    });
    tx.delete(doc(db, 'connectionInviteGuards/professional-uid_student-uid_nutritionist'));
    tx.update(doc(db, 'professionals/professional-uid/pendingStudents/student-uid'), {
      nutritionistConnectionId: null,
      updatedAt: '2026-06-01T00:01:00.000Z',
    });
    tx.update(doc(db, 'professionals/professional-uid/pendingStudentSlots/slot_01'), {
      studentAuthUid: null,
      updatedAt: '2026-06-01T00:01:00.000Z',
    });
  }));
});

test('professional cannot overwrite another professionals invite code lookup index', async () => {
  await seedDoc(testEnv, 'inviteCodeLookups/NUT123', inviteCodeLookup);

  await assertFails(setDoc(
    doc(authedDb(testEnv, 'other-professional-uid'), 'inviteCodeLookups/NUT123'),
    {
      ...inviteCodeLookup,
      professionalAuthUid: 'other-professional-uid',
    }
  ));
});
