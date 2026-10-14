import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { observeIosAuthMetadata } from '../../scripts/testing/native-auth-observation';

void test('native storage observations distinguish missing records and redact inline/large session values', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-storage-')));
  const bundle = 'com.edufelip.mychampions.dev';
  const storage = path.join(root, 'Library/Application Support', bundle, 'RCTAsyncLocalStorage_V1');
  try {
    assert.deepEqual(await observeIosAuthMetadata(root, bundle), {
      status: 'manifest-absent',
      sessionPresent: false,
    });
    await mkdir(storage, { recursive: true });
    const manifest = path.join(storage, 'manifest.json');
    await writeFile(manifest, '{}');
    assert.deepEqual(await observeIosAuthMetadata(root, bundle), {
      status: 'session-absent',
      sessionPresent: false,
    });
    const secret = 'must-never-appear-in-observation';
    const record = JSON.stringify({ profile: { email: secret }, expiresAt: secret });
    await writeFile(manifest, JSON.stringify({ 'auth.server.session': record }));
    const expected = {
      status: 'session-present',
      sessionPresent: true,
      profilePresent: true,
      expiryPresent: true,
      plaintextAccessTokenPresent: false,
      plaintextRefreshTokenPresent: false,
    };
    assert.deepEqual(await observeIosAuthMetadata(root, bundle), expected);
    const digest = createHash('md5').update('auth.server.session').digest('hex');
    await writeFile(manifest, JSON.stringify({ 'auth.server.session': null }));
    await writeFile(path.join(storage, digest), record);
    assert.deepEqual(await observeIosAuthMetadata(root, bundle), expected);
    await writeFile(
      path.join(storage, digest),
      JSON.stringify({ accessToken: secret, refreshToken: secret }),
    );
    const legacy = await observeIosAuthMetadata(root, bundle);
    assert.equal(legacy.plaintextAccessTokenPresent, true);
    assert.equal(legacy.plaintextRefreshTokenPresent, true);
    assert.equal(JSON.stringify(legacy).includes(secret), false);
    await assert.rejects(observeIosAuthMetadata(root, 'com.production.app'), /dev app/);
    await rm(path.join(storage, digest));
    const outside = path.join(root, 'foreign-session');
    await writeFile(outside, record);
    await symlink(outside, path.join(storage, digest));
    await assert.rejects(observeIosAuthMetadata(root, bundle), /escaped/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
