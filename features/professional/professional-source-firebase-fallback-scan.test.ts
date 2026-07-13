import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('professional source does not keep a Firebase Firestore fallback', () => {
  const source = readFileSync(join(__dirname, 'professional-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/firestore'), false);
  assert.equal(source.includes("require('../firestore')"), false);
  assert.equal(source.includes('getProfessionalFirestoreModule'), false);
  assert.equal(source.includes('ProfessionalFirestore'), false);
  assert.equal(source.includes('FirestoreInviteCode'), false);
  assert.equal(source.includes('FirestoreSpecialty'), false);
  assert.equal(source.includes('FirestoreCredential'), false);
  assert.equal(source.includes('FirestoreConnection'), false);
  assert.equal(source.includes('FirestoreUserProfile'), false);
  assert.equal(source.includes('getFirestoreInstance'), false);
  assert.equal(source.includes('getCurrentAuthUid'), false);
  assert.equal(source.includes('classifyFirestoreError'), false);
  assert.equal(source.includes('buildPendingInviteRelease'), false);
  assert.equal(source.includes('applyPendingInviteRelease'), false);
});
