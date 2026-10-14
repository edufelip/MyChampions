import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  nativeTrainingHelperPathsFromSource,
  requireNativeTrainingHelperDeclaration,
  requireNativeTrainingHelperInputs,
} from '../../scripts/testing/native-training-pilot-evidence';

type HelperRow = { path: string; sha256: string };

// CI resolves this from the test location. The optional root is only for a disposable
// symlink overlay; it is not a product input or a private evidence path.
const repositoryRoot = realpathSync(
  process.env.NATIVE_HELPER_TEST_ROOT ??
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'),
);
const currentPaths = nativeTrainingHelperPathsFromSource(repositoryRoot, 'ios');
const currentRows: HelperRow[] = currentPaths.map((relative) => ({
  path: relative,
  sha256: createHash('sha256')
    .update(readFileSync(path.join(repositoryRoot, relative)))
    .digest('hex'),
}));
const ownerPaths = [...currentPaths];

void test('the iOS producer keeps root package.json repo-relative', () => {
  assert.equal(currentPaths.includes('package.json'), true);
  assert.equal(currentPaths.includes('scripts/testing/package.json'), false);
  assert.equal(
    currentRows.some((row) => row.path === 'package.json'),
    true,
  );
});

void test('selection binds every current iOS producer helper before native acquisition', () => {
  assert.deepEqual(
    requireNativeTrainingHelperDeclaration(repositoryRoot, 'ios', ownerPaths),
    currentPaths,
  );
  assert.throws(
    () => requireNativeTrainingHelperDeclaration(repositoryRoot, 'ios', ownerPaths.slice(1)),
    /omits producer helper/,
  );
  assert.throws(
    () =>
      requireNativeTrainingHelperDeclaration(repositoryRoot, 'ios', ['../secret', ...ownerPaths]),
    /escapes its root/,
  );
  assert.throws(
    () =>
      requireNativeTrainingHelperDeclaration(repositoryRoot, 'ios', [
        currentPaths[0],
        ...ownerPaths,
      ]),
    /owner paths contain duplicates/,
  );
});

void test('current source-derived rows pass exact owner, order and byte binding', async () => {
  await requireNativeTrainingHelperInputs({
    repositoryRoot,
    platform: 'ios',
    helpers: currentRows,
    ownerPaths,
  });
});

void test('the five historical non-TypeScript paths stay declared instead of being filtered by extension', () => {
  const historicalPaths = [
    'scripts/ci/android-runner-slot.ts',
    'scripts/testing/android-input-reader/AndroidManifest.xml',
    'scripts/testing/android-input-reader/InputReader.java',
    'scripts/testing/schemas/connection-snapshot-v1.schema.json',
    'scripts/testing/validate-native-inventory.mjs',
  ];
  assert.deepEqual(
    historicalPaths.filter((relative) => currentPaths.includes(relative)),
    historicalPaths,
  );
  assert.equal(
    historicalPaths.every((relative) => !/^scripts\/testing\/[a-z0-9-]+\.ts$/i.test(relative)),
    true,
  );
});

void test('Android producer rows use the same exact source and owner binding, including Java/XML readers', async () => {
  const androidPaths = nativeTrainingHelperPathsFromSource(repositoryRoot, 'android');
  const androidRows: HelperRow[] = androidPaths.map((relative) => ({
    path: relative,
    sha256: createHash('sha256')
      .update(readFileSync(path.join(repositoryRoot, relative)))
      .digest('hex'),
  }));
  assert(androidPaths.includes('scripts/testing/android-input-reader/InputReader.java'));
  assert(androidPaths.includes('scripts/testing/android-input-reader/AndroidManifest.xml'));
  await requireNativeTrainingHelperInputs({
    repositoryRoot,
    platform: 'android',
    helpers: androidRows,
    ownerPaths: androidPaths,
  });
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'android',
        helpers: [
          {
            ...androidRows[0],
            path: 'scripts/testing/android-input-reader/../unknown.ts',
          },
          ...androidRows.slice(1),
        ],
        ownerPaths: androidPaths,
      }),
    /escapes its root/,
  );
});

void test('omitted, reordered, duplicated and tampered rows fail closed', async () => {
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: currentRows,
        ownerPaths: currentPaths.slice(1),
      }),
    /omits producer helper/,
  );
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: [currentRows[1], currentRows[0], ...currentRows.slice(2)],
        ownerPaths,
      }),
    /Runtime helper list differs/,
  );
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: [currentRows[0], ...currentRows],
        ownerPaths,
      }),
    /Runtime helper list differs/,
  );
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: currentRows.map((row, index) =>
          index === 0 ? { ...row, sha256: '0'.repeat(64) } : row,
        ),
        ownerPaths,
      }),
    /Runtime helper changed/,
  );
});

void test('absolute, traversal and unknown paths cannot widen the producer declaration', async () => {
  for (const invalidPath of ['/tmp/helper.ts', 'scripts/testing/../secret.ts', 'tmp/helper.txt']) {
    await assert.rejects(
      () =>
        requireNativeTrainingHelperInputs({
          repositoryRoot,
          platform: 'ios',
          helpers: [{ ...currentRows[0], path: invalidPath }, ...currentRows.slice(1)],
          ownerPaths,
        }),
      invalidPath.includes('..')
        ? /escapes its root/
        : invalidPath.startsWith('/')
          ? /absolute/
          : /outside the owned script roots/,
    );
  }
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: [
          { ...currentRows[0], path: 'scripts/testing/not-captured.ts' },
          ...currentRows.slice(1),
        ],
        ownerPaths,
      }),
    /Runtime helper list differs/,
  );
});
