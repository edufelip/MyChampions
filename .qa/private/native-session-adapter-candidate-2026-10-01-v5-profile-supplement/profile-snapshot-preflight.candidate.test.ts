import assert from 'node:assert/strict';
import test from 'node:test';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadActualSessionProfileSnapshotEvidence } from './profile-snapshot-preflight.candidate';

const legacyCaptureRoot = '.qa/artifacts/native-pilot/50ddeb1f3d43a32fd441b065';

void test('v5 profile preflight preserves the sealed legacy capture as incomplete', async () => {
  const loaded = await loadActualSessionProfileSnapshotEvidence({ captureRoot: legacyCaptureRoot });
  assert.equal(loaded.status, 'incomplete');
  assert.equal(loaded.captureId, '50ddeb1f3d43a32fd441b065');
  assert.equal((loaded.files.capture?.value as { charter?: string }).charter, 'auth-account');
  assert.deepEqual(
    loaded.missing.filter((entry) => entry.startsWith('capture.sessionSql')),
    [
      'capture.sessionSqlBeforeLogin',
      'capture.sessionSqlAfterInitialLogin',
      'capture.sessionSqlAfterRestore',
      'capture.sessionSqlAfterSignedoutRelaunch',
    ],
  );
  assert.equal(loaded.profileEvidence, undefined);
});

void test('v5 profile preflight rejects a declared absolute snapshot path before reading it', async () => {
  const captureRoot = mkdtempSync(path.join('/tmp', 'mychampions-v5-profile-preflight-'));
  chmodSync(captureRoot, 0o700);
  try {
    writeFileSync(
      path.join(captureRoot, 'capture.private.json'),
      JSON.stringify({ sessionSqlBeforeLogin: { path: '/etc/passwd' } }),
      { mode: 0o600 },
    );
    const loaded = await loadActualSessionProfileSnapshotEvidence({
      captureRoot: realpathSync(captureRoot),
    });
    assert.equal(loaded.status, 'incomplete');
    assert(loaded.missing.includes('capture.sessionSqlBeforeLogin.path'));
    assert.equal(loaded.files.beforeLogin, null);
  } finally {
    rmSync(captureRoot, { recursive: true, force: true });
  }
});
