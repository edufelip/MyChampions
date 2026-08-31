import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAuthSubmissionGate } from './auth-submission-gate';

test('createAuthSubmissionGate allows a single acquire while locked', () => {
  const gate = createAuthSubmissionGate();

  assert.equal(gate.tryAcquire(), true, 'first acquire should succeed');
  assert.equal(gate.tryAcquire(), false, 'second acquire while locked should fail');
  assert.equal(gate.tryAcquire(), false, 'third acquire while locked should also fail');
});

test('createAuthSubmissionGate allows re-acquiring after release', () => {
  const gate = createAuthSubmissionGate();

  assert.equal(gate.tryAcquire(), true);
  gate.release();
  assert.equal(gate.tryAcquire(), true, 'acquire should succeed again after release');
});

test('createAuthSubmissionGate instances are independent', () => {
  const gateA = createAuthSubmissionGate();
  const gateB = createAuthSubmissionGate();

  assert.equal(gateA.tryAcquire(), true);
  assert.equal(gateB.tryAcquire(), true, 'a separate gate instance must not share lock state');
});
