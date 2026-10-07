import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  requireNativeConnectionHelperInputs,
  type NativeConnectionEvidencePlatform,
} from '../../scripts/testing/native-connection-public-evidence-core';
import { nativeSessionHelperInputPaths } from '../../scripts/testing/native-session-helper-ledger';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const inventoryValidatorPath = 'scripts/testing/validate-native-inventory.mjs';
const syntheticSha256 = 'a'.repeat(64);

function canonicalHelperPath(value: string): string {
  const normalized = value.replaceAll('\\', '/');
  if (normalized === 'package.json') return normalized;
  return normalized.startsWith('scripts/') || normalized.startsWith('.maestro/')
    ? normalized
    : `scripts/testing/${normalized}`;
}

async function producerHelperRows(platform: NativeConnectionEvidencePlatform) {
  if (platform === 'ios') {
    const source = await readFile(
      path.join(repositoryRoot, 'scripts/testing/capture-native-testability.ts'),
      'utf8',
    );
    assert.match(
      source,
      /readNativeSessionHelperInputs\(root\)/,
      'iOS producer must consume the shared session helper ledger',
    );
    const paths = [...nativeSessionHelperInputPaths];
    assert.equal(new Set(paths).size, paths.length, 'iOS session helper ledger is duplicated');
    assert(paths.includes(inventoryValidatorPath), `ios producer omits ${inventoryValidatorPath}`);
    return paths.map((helperPath) => ({ path: helperPath, sha256: syntheticSha256 }));
  }
  const relative = 'scripts/testing/capture-android-testability.ts';
  const source = await readFile(path.join(repositoryRoot, relative), 'utf8');
  const startMarker = 'const helperPaths = [';
  const endMarker = '\n  ];\n  const helperIdentity';
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${platform} producer helper start is missing`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${platform} producer helper end is missing`);
  const paths = [
    ...source.slice(start + startMarker.length, end).matchAll(/["']([^"']+)["']/g),
  ].map((match) => canonicalHelperPath(match[1]));
  assert(
    paths.includes(inventoryValidatorPath),
    `${platform} producer omits ${inventoryValidatorPath}`,
  );
  return paths.map((helperPath) => ({ path: helperPath, sha256: syntheticSha256 }));
}

void test('accepts the complete producer helper inventories for iOS and Android', async () => {
  for (const platform of ['ios', 'android'] as const) {
    const rows = await producerHelperRows(platform);
    const accepted = requireNativeConnectionHelperInputs(rows, platform);
    assert.deepEqual(
      accepted.map((row) => row.path),
      rows.map((row) => row.path),
    );
  }
});

void test('rejects omission of the exact inventory validator from either producer list', async () => {
  for (const platform of ['ios', 'android'] as const) {
    const rows = await producerHelperRows(platform);
    const omitted = rows.filter((row) => row.path !== inventoryValidatorPath);
    assert.throws(
      () => requireNativeConnectionHelperInputs(omitted, platform),
      /Native connection helper identity is absent: scripts\/testing\/validate-native-inventory\.mjs/,
    );
  }
});

void test('rejects an unrelated mjs helper instead of broadening the source boundary', async () => {
  for (const platform of ['ios', 'android'] as const) {
    const rows = await producerHelperRows(platform);
    const forged = rows.map((row) =>
      row.path === inventoryValidatorPath
        ? { ...row, path: 'scripts/testing/forged-native-helper.mjs' }
        : row,
    );
    assert.throws(
      () => requireNativeConnectionHelperInputs(forged, platform),
      /Native connection helper path is outside the declared source boundary/,
    );
  }
});
