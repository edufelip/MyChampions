import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  readActualDetoxRuntimeMetadata,
  requireDetoxRuntimeBuildMetadata,
  revalidateDetoxRuntimeBuildMetadata,
} from '../../scripts/testing/detox-runtime-build-metadata';

const DETOX_VERSION = '20.47.0';
const ENVIRONMENT_HASH = 'a'.repeat(64);

async function writeDetoxPackage(root: string, version = DETOX_VERSION): Promise<string> {
  const file = path.join(root, 'node_modules/detox/package.json');
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, `${JSON.stringify({ name: 'detox', version })}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return file;
}

void test('reads actual Detox package bytes and binds the runtime metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-metadata-positive-'));
  try {
    const packagePath = await writeDetoxPackage(root);
    const metadata = await readActualDetoxRuntimeMetadata(root, ENVIRONMENT_HASH);
    requireDetoxRuntimeBuildMetadata(metadata);
    assert.equal(metadata.environmentHash, ENVIRONMENT_HASH);
    assert.deepEqual(metadata.toolVersions, {
      node: process.version,
      detox: DETOX_VERSION,
    });
    assert.equal(metadata.toolVersionEvidence.path, 'node_modules/detox/package.json');
    assert.equal(metadata.toolVersionEvidence.packageName, 'detox');
    assert.equal(metadata.toolVersionEvidence.packageVersion, DETOX_VERSION);
    assert.equal(metadata.toolVersionEvidence.bytes, (await readFile(packagePath)).byteLength);
    assert.equal(metadata.toolVersionEvidence.identity.nlink, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('rejects the old placeholder engine version before qualification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-metadata-placeholder-'));
  try {
    await writeDetoxPackage(root, 'owned-driver-contract');
    await assert.rejects(
      readActualDetoxRuntimeMetadata(root, ENVIRONMENT_HASH),
      /Installed Detox package version is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('rejects changed installed package evidence after qualification', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-metadata-drift-'));
  try {
    const packagePath = await writeDetoxPackage(root);
    const metadata = await readActualDetoxRuntimeMetadata(root, ENVIRONMENT_HASH);
    await writeDetoxPackage(root, '20.47.1');
    await assert.rejects(
      revalidateDetoxRuntimeBuildMetadata(root, metadata),
      /tool versions changed after qualification|tool evidence changed after qualification/,
    );
    assert.equal((await readFile(packagePath)).toString().includes('20.47.1'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('rejects structurally valid metadata that carries a placeholder tool version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'detox-runtime-metadata-structural-'));
  try {
    await writeDetoxPackage(root);
    const metadata = await readActualDetoxRuntimeMetadata(root, ENVIRONMENT_HASH);
    assert.throws(
      () =>
        requireDetoxRuntimeBuildMetadata({
          ...metadata,
          toolVersions: { ...metadata.toolVersions, detox: 'owned-driver-contract' },
        }),
      /toolVersions\.detox is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
