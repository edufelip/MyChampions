import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { observeIosAuthMetadata } from './native-auth-observation.candidate';

void test('v6 auth reader returns only a redacted cached profile identity hash', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-native-auth-v6-')));
  const bundle = 'com.edufelip.mychampions.dev';
  const storage = path.join(root, 'Library/Application Support', bundle, 'RCTAsyncLocalStorage_V1');
  const authUid = 'coach-auth-uid-owned';
  const secret = 'must-never-appear-in-v6-observation';
  try {
    await mkdir(storage, { recursive: true });
    const manifest = path.join(storage, 'manifest.json');
    await writeFile(
      manifest,
      JSON.stringify({
        'auth.server.session': JSON.stringify({
          profile: { authUid, email: secret },
          expiresAt: secret,
          accessToken: secret,
          refreshToken: secret,
        }),
      }),
    );
    const observed = await observeIosAuthMetadata(root, bundle);
    assert.deepEqual(observed, {
      status: 'session-present',
      sessionPresent: true,
      profilePresent: true,
      expiryPresent: true,
      plaintextAccessTokenPresent: true,
      plaintextRefreshTokenPresent: true,
      profileAuthUidHash: createHash('sha256').update(authUid).digest('hex'),
    });
    assert.equal(JSON.stringify(observed).includes(authUid), false);
    assert.equal(JSON.stringify(observed).includes(secret), false);

    await writeFile(
      manifest,
      JSON.stringify({
        'auth.server.session': JSON.stringify({ profile: { email: secret } }),
      }),
    );
    const withoutAuthUid = await observeIosAuthMetadata(root, bundle);
    assert.equal('profileAuthUidHash' in withoutAuthUid, false);
    assert.equal(JSON.stringify(withoutAuthUid).includes(secret), false);

    const digest = createHash('md5').update('auth.server.session').digest('hex');
    await writeFile(manifest, JSON.stringify({ 'auth.server.session': null }));
    await writeFile(
      path.join(storage, digest),
      JSON.stringify({ profile: { authUid }, accessToken: secret }),
    );
    const hashedExternalRecord = await observeIosAuthMetadata(root, bundle);
    assert.equal(
      (hashedExternalRecord as { profileAuthUidHash?: unknown }).profileAuthUidHash,
      createHash('sha256').update(authUid).digest('hex'),
    );
    assert.equal(JSON.stringify(hashedExternalRecord).includes(authUid), false);

    const outside = path.join(root, 'foreign-session');
    await writeFile(outside, JSON.stringify({ profile: { authUid } }));
    await rm(path.join(storage, digest));
    await symlink(outside, path.join(storage, digest));
    await assert.rejects(observeIosAuthMetadata(root, bundle), /escaped/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
