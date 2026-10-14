import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { requireNativeConnectionHelperInputs } from '../../scripts/testing/native-connection-public-evidence-core';
import {
  nativeSessionHelperInputPaths,
  readNativeSessionHelperInputs,
} from '../../scripts/testing/native-session-helper-ledger';
import {
  nativeTrainingHelperPathsFromSource,
  requireNativeTrainingHelperInputs,
} from '../../scripts/testing/native-training-pilot-evidence';

const repositoryRoot = realpathSync(
  path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'),
);

void test('producer read, source ledger and both consumers retain the root package helper', async () => {
  const produced = await readNativeSessionHelperInputs(repositoryRoot);
  const declared = nativeTrainingHelperPathsFromSource(repositoryRoot, 'ios');
  assert.deepEqual(declared, [...nativeSessionHelperInputPaths]);
  assert.equal(declared.includes('package.json'), true);
  assert.equal((declared as readonly string[]).includes('scripts/testing/package.json'), false);
  assert.deepEqual(
    produced.map((row) => row.path),
    declared,
    'capture producer rows must preserve the source ledger paths',
  );

  await requireNativeTrainingHelperInputs({
    repositoryRoot,
    platform: 'ios',
    helpers: produced,
    ownerPaths: declared,
  });
  const connectionRows = requireNativeConnectionHelperInputs(produced, 'ios');
  assert.equal(
    connectionRows.some((row) => row.path === 'package.json'),
    true,
  );
});

void test('path aliases cannot turn the root package into a nested or escaping helper', async () => {
  const produced = await readNativeSessionHelperInputs(repositoryRoot);
  const nested = produced.map((row) =>
    row.path === 'package.json' ? { ...row, path: 'scripts/testing/package.json' } : row,
  );
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: nested,
        ownerPaths: nested.map((row) => row.path),
      }),
    /Runtime helper list differs|Native declaration omits producer helper|ENOENT/,
  );
  assert.throws(
    () => requireNativeConnectionHelperInputs(nested, 'ios'),
    /outside the declared source boundary/,
  );
  const escaping = produced.map((row) =>
    row.path === 'package.json' ? { ...row, path: '../package.json' } : row,
  );
  await assert.rejects(
    () =>
      requireNativeTrainingHelperInputs({
        repositoryRoot,
        platform: 'ios',
        helpers: escaping,
        ownerPaths: escaping.map((row) => row.path),
      }),
    /escapes its root/,
  );
});
