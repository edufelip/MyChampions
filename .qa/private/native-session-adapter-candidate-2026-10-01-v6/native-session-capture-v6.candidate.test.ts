import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const packetRoot = path.resolve(__dirname);
const capturePatchPath = path.join(
  packetRoot,
  'capture-native-testability.session-charter.v6.patch',
);
const authPatchPath = path.join(packetRoot, 'native-auth-observation.v6.patch');

void test('v6 capture patch acquires and publishes all ordered session checkpoints', async () => {
  const patch = await readFile(capturePatchPath, 'utf8');
  assert.match(patch, /verifyNativeSessionProfileCheckpoints/);
  assert.match(patch, /native-session-profile-checkpoints/);
  assert.match(patch, /sessionDataContainer/);
  assert.match(patch, /sessionLoginBeforeRequestId/);
  assert.match(patch, /sessionProfileLoginWindow/);
  assert.match(patch, /sessionProfileRestorationWindow/);
  assert.match(patch, /sessionProfileCheckpointVerification/);
  assert.match(patch, /transportEvidence/);
  assert.match(patch, /sessionEvidencePublication = 'aborted-before-complete'/);
  assert.equal((patch.match(/connectionSnapshot\('native-entry-ios'\)/g) ?? []).length, 4);
  for (const file of [
    'session-profile-before-login.private.json',
    'session-profile-after-login.private.json',
    'session-profile-after-restoration.private.json',
    'session-profile-after-signed-out-relaunch.private.json',
    'session-domain-before-login.private.json',
    'session-domain-after-login.private.json',
    'session-domain-after-restoration.private.json',
    'session-domain-after-signed-out-relaunch.private.json',
  ])
    assert.match(patch, new RegExp(file.replaceAll('.', '\\.'), 'u'));
  assert.match(patch, /session-transport-write/);
  assert.match(patch, /session-transport-read/);
  assert.match(patch, /controller\.signal/);
});

void test('v6 auth patch exposes only a hashed cached profile identity', async () => {
  const patch = await readFile(authPatchPath, 'utf8');
  assert.match(patch, /profile\.authUid/);
  assert.match(patch, /profileAuthUidHash/);
  assert.match(patch, /createHash\('sha256'\)/);
  assert.equal(patch.includes('...(profileAuthUidHash ? { profileAuthUidHash } : {})'), true);
  assert.doesNotMatch(patch, /return \{[^}]*authUid\s*:/u);
});
