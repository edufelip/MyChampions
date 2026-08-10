import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const pendingScreenSource = readFileSync(
  join(__dirname, '../../app/professional/pending.tsx'),
  'utf8',
);

test('professional pending queue imports analytics builders and hook', () => {
  assert.match(pendingScreenSource, /useAnalytics/);
  assert.match(pendingScreenSource, /buildInvitePendingConfirmed/);
  assert.match(pendingScreenSource, /buildInvitePendingDenied/);
  assert.match(pendingScreenSource, /buildInvitePendingBulkDenied/);
});

test('professional pending queue emits analytics after successful accept and deny actions', () => {
  assert.match(
    pendingScreenSource,
    /if \(!err\) \{\s*emitEvent\(buildInvitePendingConfirmed\(\)\);/s,
  );
  assert.match(pendingScreenSource, /if \(!err\) \{\s*emitEvent\(buildInvitePendingDenied\(\)\);/s);
});

test('professional pending queue emits bulk deny analytics with selected count after successful bulk action', () => {
  assert.match(pendingScreenSource, /emitEvent\(buildInvitePendingBulkDenied\(ids\.length\)\);/s);
});
