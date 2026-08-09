import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveLatestSyncTimestamp } from './sync-timestamps.logic';

test('resolveLatestSyncTimestamp returns null when no valid timestamps exist', () => {
  assert.equal(resolveLatestSyncTimestamp([]), null);
  assert.equal(resolveLatestSyncTimestamp([null, undefined, '', 'not-a-date']), null);
});

test('resolveLatestSyncTimestamp returns the newest valid ISO timestamp', () => {
  const latest = resolveLatestSyncTimestamp([
    '2026-07-03T10:00:00.000Z',
    null,
    '2026-07-03T12:30:00.000Z',
    '2026-07-02T23:59:59.000Z',
  ]);

  assert.equal(latest, '2026-07-03T12:30:00.000Z');
});

test('resolveLatestSyncTimestamp ignores invalid timestamps while comparing valid ones', () => {
  assert.equal(
    resolveLatestSyncTimestamp([
      'bad-value',
      '2026-07-03T09:00:00.000Z',
      'also-bad',
      '2026-07-03T09:00:01.000Z',
    ]),
    '2026-07-03T09:00:01.000Z',
  );
});
