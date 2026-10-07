import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWorkerRequest } from '../../scripts/testing/worker-control';

const request = {
  schemaVersion: 1,
  id: 'a'.repeat(24),
  attemptId: 'training-durable--chromium',
  capability: 'b'.repeat(64),
  operation: { kind: 'snapshot' },
};
void test('worker protocol admits fixed operations with explicit run-attempt capability', () => {
  for (const operation of [
    { kind: 'snapshot' },
    { kind: 'restart' },
    { kind: 'clear-save-fault' },
    {
      kind: 'arm-save-fault',
      method: 'POST',
      path: '/plans/training',
      accessToken: 'private-bearer',
    },
  ])
    assert.doesNotThrow(() => validateWorkerRequest({ ...request, operation }));
});
void test('worker protocol rejects arbitrary SQL, URL, identity, method and extra operation fields before dispatch', () => {
  for (const operation of [
    { kind: 'sql', query: 'delete from profiles' },
    { kind: 'snapshot', authUid: 'foreign' },
    { kind: 'restart', url: 'https://example.test' },
    { kind: 'snapshot', scope: 'other-scope' },
    {
      kind: 'arm-save-fault',
      method: 'POST',
      path: 'https://example.test/plans/training',
      accessToken: 'private',
    },
    { kind: 'arm-save-fault', method: 'DELETE', path: '/plans/training', accessToken: 'private' },
    {
      kind: 'arm-save-fault',
      method: 'POST',
      path: '/plans/training',
      accessToken: 'private\nheader',
    },
    {
      kind: 'arm-save-fault',
      method: 'POST',
      path: '/plans/training',
      accessToken: 'private',
      accountUid: 'foreign',
    },
  ])
    assert.throws(() => validateWorkerRequest({ ...request, operation }));
});
void test('malformed capability, request identity and unknown request fields are not accepted', () => {
  for (const row of [
    null,
    [],
    { ...request, capability: '' },
    { ...request, id: '../escape' },
    { ...request, capability: 'z'.repeat(64) },
    { ...request, extra: true },
    { ...request, operation: null },
  ])
    assert.throws(() => validateWorkerRequest(row));
});
