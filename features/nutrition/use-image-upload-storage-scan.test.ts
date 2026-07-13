import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('image upload hook does not contain legacy storage fallback', () => {
  const source = readFileSync(join(__dirname, 'use-image-upload.ts'), 'utf8');

  assert.equal(source.includes(['firebase', 'storage'].join('/')), false);
  assert.equal(source.includes(['get', 'Firebase', 'Storage'].join('')), false);
  assert.equal(source.includes(['upload', 'Bytes', 'Resumable'].join('')), false);
  assert.equal(source.includes(['get', 'Download', 'URL'].join('')), false);
  assert.equal(source.includes(['Firebase', 'Storage'].join(' ')), false);
});

test('image upload logic and source tests do not encode legacy storage error codes', () => {
  for (const relativePath of [
    'image-upload.logic.ts',
    'image-upload.logic.test.ts',
    'image-upload-source.test.ts',
  ]) {
    const source = readFileSync(join(__dirname, relativePath), 'utf8');
    const legacyQuotaCode = ['storage', 'quota-exceeded'].join('/');
    const legacyAuthCode = ['storage', 'unauthorized'].join('/');
    const providerSpecificCodePhrase = ['firebase', ' code'].join('');

    assert.equal(source.includes(legacyQuotaCode), false, `${relativePath} still contains legacy quota code`);
    assert.equal(source.includes(legacyAuthCode), false, `${relativePath} still contains legacy auth code`);
    assert.equal(source.includes(providerSpecificCodePhrase), false, `${relativePath} still describes provider-specific codes`);
  }
});

test('mobile image upload source does not build client-owned user storage paths', () => {
  for (const relativePath of [
    'image-upload-source.ts',
    'use-image-upload.ts',
  ]) {
    const source = readFileSync(join(__dirname, relativePath), 'utf8');

    assert.equal(source.includes('users/${'), false, `${relativePath} should not interpolate client-owned user paths`);
    assert.equal(
      source.includes('users/{uid}/meals'),
      false,
      `${relativePath} should not document a client-owned user storage path`
    );
    assert.equal(
      source.includes('User UID is required for image upload'),
      false,
      `${relativePath} should not require a client UID for server-owned image upload`
    );
  }
});
