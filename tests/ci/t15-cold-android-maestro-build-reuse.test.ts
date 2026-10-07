import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, realpath, rm, symlink, writeFile, link } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  copyQualifiedAndroidMaestroApk,
  type AndroidMaestroQualifiedBuildReuse,
} from '../../scripts/testing/t15-cold-android-maestro-build-reuse';

const runId = 'a'.repeat(24);
const deadline = () => performance.now() + 60_000;

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 't15-android-build-')));
  await mkdir(path.join(root, 'source'), { mode: 0o700 });
  await mkdir(path.join(root, 'output'), { mode: 0o700 });
  const binaryPath = path.join(root, 'source', 'app-dev-debug.apk');
  const bytes = Buffer.from('bounded-qualified-android-apk');
  await writeFile(binaryPath, bytes, { mode: 0o600 });
  const stat = await lstat(binaryPath);
  const reuse: AndroidMaestroQualifiedBuildReuse = {
    kind: 'qualified-android-maestro-build-reuse',
    buildId: runId,
    buildProfile: 'Metro-attached devDebug arm64',
    sourceFingerprint: 'b'.repeat(64),
    helperFingerprint: 'c'.repeat(64),
    flagsFingerprint: 'd'.repeat(64),
    binaryHash: createHash('sha256').update(bytes).digest('hex'),
    binaryPath,
    binarySizeBytes: bytes.length,
    binaryIdentity: {
      dev: Number(stat.dev),
      ino: Number(stat.ino),
      uid: Number(stat.uid),
      gid: Number(stat.gid),
      mode: Number(stat.mode & 0o777),
      nlink: Number(stat.nlink),
      size: Number(stat.size),
      mtimeMs: Number(stat.mtimeMs),
      ctimeMs: Number(stat.ctimeMs),
    },
    artifactRoot: path.join(root, 'source'),
    appId: 'com.edufelip.mychampions.dev',
    launcher: 'com.edufelip.mychampions.MainActivity',
    environmentHash: 'e'.repeat(64),
    originalPorts: { api: 41001, metro: 41002, proxy: 41003 },
    originalOrigins: {
      api: 'http://127.0.0.1:41001',
      metro: 'http://127.0.0.1:41002',
      proxy: 'http://127.0.0.1:41003',
    },
    sourceRunId: runId,
    current: true,
  };
  return { root, binaryPath, reuse };
}

void test('copies qualified Android APK bytes into a fresh private attempt file', async () => {
  const input = await fixture();
  try {
    const result = await copyQualifiedAndroidMaestroApk({
      reuse: input.reuse,
      destination: path.join(input.root, 'output', 'app-dev-debug.apk'),
      deadlineAtMonotonicMs: deadline(),
    });
    assert.equal(result.sha256, input.reuse.binaryHash);
    assert.equal(result.sizeBytes, input.reuse.binarySizeBytes);
    assert.equal((await lstat(result.path)).nlink, 1);
    assert.equal((await lstat(result.path)).mode & 0o777, 0o600);
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('rejects a qualified Android APK symlink', async () => {
  const input = await fixture();
  try {
    const linkPath = path.join(input.root, 'source', 'link.apk');
    await symlink(input.binaryPath, linkPath);
    await assert.rejects(
      copyQualifiedAndroidMaestroApk({
        reuse: { ...input.reuse, binaryPath: linkPath },
        destination: path.join(input.root, 'output', 'app-dev-debug.apk'),
        deadlineAtMonotonicMs: deadline(),
      }),
      /single-link regular file|canonical/,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('rejects a qualified Android APK hardlink', async () => {
  const input = await fixture();
  try {
    const linkPath = path.join(input.root, 'source', 'hardlink.apk');
    await link(input.binaryPath, linkPath);
    await assert.rejects(
      copyQualifiedAndroidMaestroApk({
        reuse: { ...input.reuse, binaryPath: linkPath },
        destination: path.join(input.root, 'output', 'app-dev-debug.apk'),
        deadlineAtMonotonicMs: deadline(),
      }),
      /single-link regular file/,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('rejects same-bytes APK replacement after descriptor qualification', async () => {
  const input = await fixture();
  try {
    const bytes = Buffer.from('bounded-qualified-android-apk');
    await rm(input.binaryPath);
    await writeFile(input.binaryPath, bytes, { mode: 0o600 });
    await assert.rejects(
      copyQualifiedAndroidMaestroApk({
        reuse: input.reuse,
        destination: path.join(input.root, 'output', 'app-dev-debug.apk'),
        deadlineAtMonotonicMs: deadline(),
      }),
      /source identity differs from the qualified reuse descriptor/,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});

void test('cancellation wins before qualified APK reuse reads bytes', async () => {
  const input = await fixture();
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      copyQualifiedAndroidMaestroApk({
        reuse: input.reuse,
        destination: path.join(input.root, 'output', 'app-dev-debug.apk'),
        signal: controller.signal,
        deadlineAtMonotonicMs: deadline(),
      }),
      /aborted/,
    );
  } finally {
    await rm(input.root, { recursive: true, force: true });
  }
});
