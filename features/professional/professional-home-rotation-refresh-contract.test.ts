import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('invite rotation refreshes connection state after a successful rotation', () => {
  const source = readFileSync(join(process.cwd(), 'app/professional/home.tsx'), 'utf8');
  const successIndex = source.indexOf('setRotateSuccess(true);');
  const successEventIndex = source.indexOf(
    'emitEvent(buildInviteCodeRotationSucceeded());',
    successIndex,
  );

  assert.notEqual(successIndex, -1);
  assert.notEqual(successEventIndex, -1);
  assert.match(source.slice(successIndex, successEventIndex), /reloadConnections\(\);/);
});
