import test, { after, before, beforeEach } from 'node:test';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

import {
  authedDb,
  clearRulesData,
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
  await assertSucceeds(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'professionals/professional-uid/inviteCodes/nutritionist'),
    scopedInviteCode
  ));
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
  await assertSucceeds(setDoc(
    doc(authedDb(testEnv, 'professional-uid'), 'inviteCodeLookups/NUT123'),
    inviteCodeLookup
  ));
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
