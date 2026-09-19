import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSupportSubmissionGate } from './support-submission-gate';

describe('support submission gate', () => {
  it('rejects a second synchronous acquire until the active request releases it', () => {
    const gate = createSupportSubmissionGate();

    assert.equal(gate.tryAcquire(), true);
    assert.equal(gate.tryAcquire(), false);
    gate.release();
    assert.equal(gate.tryAcquire(), true);
  });
});
