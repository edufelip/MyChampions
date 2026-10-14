import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  observeIosAuthMetadata,
  requireRetainedNativeSessionIdentity,
  type NativeAuthMetadataObservation,
} from '../../scripts/testing/native-auth-observation';

void test('native auth reader hashes the actual persisted profile UID without exposing values', async () => {
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

    for (const profile of [{ authUid: 123 }, { authUid: '' }, { authUid: null }, [{ authUid }]]) {
      await writeFile(
        manifest,
        JSON.stringify({ 'auth.server.session': JSON.stringify({ profile }) }),
      );
      const malformed = await observeIosAuthMetadata(root, bundle);
      assert.equal('profileAuthUidHash' in malformed, false);
    }
    const anotherUid = 'another-owned-actor';
    await writeFile(
      manifest,
      JSON.stringify({
        'auth.server.session': JSON.stringify({ profile: { authUid: anotherUid } }),
      }),
    );
    const another = await observeIosAuthMetadata(root, bundle);
    assert.equal(
      (another as { profileAuthUidHash?: unknown }).profileAuthUidHash,
      createHash('sha256').update(anotherUid).digest('hex'),
    );
    assert.notEqual(
      (another as { profileAuthUidHash?: unknown }).profileAuthUidHash,
      createHash('sha256').update(authUid).digest('hex'),
    );

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

void test('cancel retention rejects a different actor, missing session, or changed auth shape', () => {
  const expected = 'a'.repeat(64);
  const before: NativeAuthMetadataObservation = {
    status: 'session-present',
    sessionPresent: true,
    profilePresent: true,
    expiryPresent: true,
    plaintextAccessTokenPresent: false,
    plaintextRefreshTokenPresent: false,
    profileAuthUidHash: expected,
  };
  assert.doesNotThrow(() => requireRetainedNativeSessionIdentity(before, { ...before }, expected));
  assert.throws(() =>
    requireRetainedNativeSessionIdentity(
      before,
      { ...before, profileAuthUidHash: 'b'.repeat(64) },
      expected,
    ),
  );
  assert.throws(() =>
    requireRetainedNativeSessionIdentity(
      before,
      { status: 'session-absent', sessionPresent: false },
      expected,
    ),
  );
  assert.throws(() =>
    requireRetainedNativeSessionIdentity(before, { ...before, expiryPresent: false }, expected),
  );
  assert.throws(() =>
    requireRetainedNativeSessionIdentity(
      { ...before, profileAuthUidHash: 'b'.repeat(64) },
      before,
      expected,
    ),
  );
});

void test('native persisted auth reader stops on an already aborted signal', async () => {
  const controller = new AbortController();
  controller.abort('test cancellation');
  await assert.rejects(
    observeIosAuthMetadata(
      '/nonexistent-container',
      'com.edufelip.mychampions.dev',
      controller.signal,
    ),
  );
});
