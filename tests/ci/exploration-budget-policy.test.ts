import assert from 'node:assert/strict';
import test from 'node:test';
import { ExplorationBudgetPolicy } from '../../scripts/testing/exploration-budget-policy';

const key = { branchId: 'save', inputSha256: 'a'.repeat(64), observationSha256: 'b'.repeat(64) };

void test('all UI attempts count and action 101 cannot be issued', () => {
  const policy = new ExplorationBudgetPolicy(() => 0);
  for (let index = 0; index < 100; index++) {
    const permit = policy.beginAction({ ...key, branchId: `branch-${index}` });
    assert.ok(permit);
    policy.finishAction(
      permit,
      index % 3 === 0 ? 'blocked' : index % 3 === 1 ? 'failed' : 'passed',
    );
  }
  assert.deepEqual(policy.snapshot(), {
    issuedActions: 100,
    settledActions: 100,
    inFlight: false,
    stopReason: 'action-limit',
  });
  assert.equal(policy.beginAction(key), null);
});

void test('stop immediately after two unchanged failures; changed input permits recovery', () => {
  const policy = new ExplorationBudgetPolicy(() => 0);
  const first = policy.beginAction(key);
  assert.ok(first);
  policy.finishAction(first, 'failed');
  const changed = policy.beginAction({ ...key, inputSha256: 'c'.repeat(64) });
  assert.ok(changed);
  policy.finishAction(changed, 'blocked');
  assert.equal(policy.snapshot().stopReason, null);
  const second = policy.beginAction({ ...key, inputSha256: 'c'.repeat(64) });
  assert.ok(second);
  policy.finishAction(second, 'failed');
  assert.equal(policy.snapshot().stopReason, 'unchanged-failure-limit');
  assert.equal(policy.beginAction({ ...key, branchId: 'other' }), null);
});

void test('deadline is inclusive; late completion cannot reopen the budget', () => {
  let now = 0;
  const policy = new ExplorationBudgetPolicy(() => now);
  const permit = policy.beginAction(key);
  assert.ok(permit);
  now = 30 * 60 * 1000;
  assert.equal(policy.snapshot().stopReason, 'duration-limit');
  policy.finishAction(permit, 'passed');
  assert.equal(policy.snapshot().settledActions, 1);
  assert.equal(policy.beginAction(key), null);
});

void test('cancelled attempts count and foreign, duplicate or overlapping actions reject', () => {
  const policy = new ExplorationBudgetPolicy(() => 0);
  const permit = policy.beginAction(key);
  assert.ok(permit);
  assert.throws(() => policy.beginAction(key), /in flight/);
  assert.throws(() => policy.finishAction({ sequence: permit.sequence }, 'passed'), /matching/);
  policy.cancel();
  policy.finishAction(permit, 'cancelled');
  assert.deepEqual(policy.snapshot(), {
    issuedActions: 1,
    settledActions: 1,
    inFlight: false,
    stopReason: 'cancelled',
  });
  assert.throws(() => policy.finishAction(permit, 'passed'), /matching/);
  assert.equal(policy.beginAction(key), null);
});

void test('invalid monotonic clocks fail closed and invalid input spends no action', () => {
  assert.throws(() => new ExplorationBudgetPolicy(() => Number.NaN), /clock/);
  let now = 10;
  const policy = new ExplorationBudgetPolicy(() => now);
  assert.throws(() => policy.beginAction({ ...key, inputSha256: '' }), /hashes/);
  assert.equal(policy.snapshot().issuedActions, 0);
  now = 9;
  assert.equal(policy.beginAction(key), null);
  assert.equal(policy.snapshot().stopReason, 'invalid-clock');
});

void test('a successful control resets the branch failure count', () => {
  const policy = new ExplorationBudgetPolicy(() => 0);
  for (const outcome of ['failed', 'passed', 'failed'] as const) {
    const permit = policy.beginAction(key);
    assert.ok(permit);
    policy.finishAction(permit, outcome);
  }
  assert.equal(policy.snapshot().stopReason, null);
});

void test('a cancelled response stops as cancellation rather than a product branch failure', () => {
  const policy = new ExplorationBudgetPolicy(() => 0);
  for (const outcome of ['failed', 'cancelled'] as const) {
    const permit = policy.beginAction(key);
    assert.ok(permit);
    policy.finishAction(permit, outcome);
  }
  assert.equal(policy.snapshot().issuedActions, 2);
  assert.equal(policy.snapshot().stopReason, 'cancelled');
});
