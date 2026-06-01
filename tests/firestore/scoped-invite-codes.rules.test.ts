import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collectionGroup, doc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';

import {
  authedDb,
  clearRulesData,
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

const inviteCode = {
  professionalAuthUid: 'professional-uid',
  specialty: 'nutritionist',
  codeValue: 'NUT123',
  status: 'active',
  rotatedAt: null,
  expiresAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

test('old top-level inviteCodes writes are denied', async () => {
  await assertFails(setDoc(doc(authedDb(testEnv, 'professional-uid'), 'inviteCodes/professional-uid'), inviteCode));
});

test('professional can write own specialty-scoped invite code', async () => {
  await assertSucceeds(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'professionals/professional-uid/inviteCodes/nutritionist'),
    inviteCode
  ));
});

test('student can resolve active specialty-scoped invite code with collection group lookup', async () => {
  await assertSucceeds(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'professionals/professional-uid/inviteCodes/nutritionist'),
    inviteCode
  ));

  await assertSucceeds(getDocs(query(
    collectionGroup(authedDb(testEnv, 'student-uid'), 'inviteCodes'),
    where('codeValue', '==', 'NUT123'),
    where('specialty', '==', 'nutritionist'),
    where('status', '==', 'active'),
    limit(1)
  )));
});
