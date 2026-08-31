import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAuthSubmissionGate } from './auth-submission-gate';

describe('auth-submission-gate', () => {
  it('allows a single acquire while locked', () => {
    const gate = createAuthSubmissionGate();

    assert.equal(gate.tryAcquire(), true, 'first acquire should succeed');
    assert.equal(gate.tryAcquire(), false, 'second acquire while locked should fail');
    assert.equal(gate.tryAcquire(), false, 'third acquire while locked should also fail');
  });

  it('allows re-acquiring after release', () => {
    const gate = createAuthSubmissionGate();

    assert.equal(gate.tryAcquire(), true);
    gate.release();
    assert.equal(gate.tryAcquire(), true, 'acquire should succeed again after release');
  });

  it('keeps separate gate instances independent', () => {
    const gateA = createAuthSubmissionGate();
    const gateB = createAuthSubmissionGate();

    assert.equal(gateA.tryAcquire(), true);
    assert.equal(gateB.tryAcquire(), true, 'a separate gate instance must not share lock state');
  });
});
