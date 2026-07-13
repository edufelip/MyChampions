import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('connection source does not keep a Firebase Firestore fallback', () => {
  const source = readFileSync(join(__dirname, 'connection-source.ts'), 'utf8');

  assert.equal(source.includes('firebase/firestore'), false);
  assert.equal(source.includes("require('../firestore')"), false);
  assert.equal(source.includes('classifyFirestoreError'), false);
  assert.equal(source.includes('ConnectionFirestore'), false);
  assert.equal(source.includes('FirestoreConnection'), false);
  assert.equal(source.includes('FirestoreInviteCode'), false);
  assert.equal(source.includes('FirestoreInviteCodeLookup'), false);
  assert.equal(source.includes('getFirestoreInstance'), false);
  assert.equal(source.includes('getCurrentAuthUid'), false);
  assert.equal(source.includes('buildPendingInviteRelease'), false);
  assert.equal(source.includes('applyPendingInviteRelease'), false);
  assert.equal(source.includes('getTrackingAccessRef'), false);
  assert.equal(source.includes('getActiveSpecialtyRef'), false);
  assert.equal(source.includes('getPendingInviteGuardRef'), false);
});
