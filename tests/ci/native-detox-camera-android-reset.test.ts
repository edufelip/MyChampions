import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readAndroidDetoxCameraResetProof,
  requireAndroidDetoxCameraResetRuntimeMatch,
  type AndroidDetoxCameraResetBinding,
} from '../../scripts/testing/native-detox-camera-android-reset';
import { readNativeEvidenceObservation } from '../../scripts/testing/native-view-evidence';

const RUN_ID = '0123456789abcdef01234567';
const ATTEMPT_ID = `${RUN_ID}:first`;
const BACKEND_RUN_ID = '89abcdef0123456789abcdef';
const SOURCE_HASH = 'a'.repeat(64);
const HELPER_HASH = 'b'.repeat(64);
const COHORT_HASH = 'c'.repeat(64);
const FIXTURE_HASH = 'd'.repeat(64);
const APP_HASH = 'e'.repeat(64);

async function privateRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), `android-detox-reset-${label}-`));
  await chmod(root, 0o700);
  return realpath(root);
}

function receiptValue(overrides: Record<string, unknown> = {}) {
  const target = {
    platform: 'android',
    deviceId: 'emulator-5554',
    deviceName: 'Pixel_7_API_35',
    osVersion: '35',
    deviceTypeIdentifier: 'pixel_7',
    appId: 'com.edufelip.mychampions.dev',
    binaryHash: 'f'.repeat(64),
    apiOrigin: 'http://127.0.0.1:43001',
    buildProfile: 'android.emu.debug',
    captureRunId: RUN_ID,
    ownerRunId: RUN_ID,
    phase: 'installed-before-ui',
  };
  const backend = {
    runId: BACKEND_RUN_ID,
    ownerRunId: RUN_ID,
    captureRunId: RUN_ID,
    composeProject: 'mychampions-private-reset',
    artifactRoot: '/private/backend-artifacts/android-reset',
    apiOrigin: 'http://127.0.0.1:43000',
    apiPid: 4321,
    apiStarted: 'backend-start',
    apiScript: 'server/dev',
    backendAttemptId: `${BACKEND_RUN_ID}:first`,
    manifestSha256: '1'.repeat(64),
  };
  return {
    kind: 'private-t15-cold-reset-original-from-owned-android-session',
    schemaVersion: 1,
    status: 'fresh',
    requestedRunId: RUN_ID,
    requestedAttemptId: ATTEMPT_ID,
    fixtureResetId: 'android-camera-reset-1',
    ownerRunId: RUN_ID,
    captureRunId: RUN_ID,
    startedAt: '2026-10-05T10:00:00.000Z',
    finishedAt: '2026-10-05T10:00:01.000Z',
    target,
    backend,
    fixture: {
      runId: BACKEND_RUN_ID,
      scope: 'native-entry-android',
      fixtureSha256: '2'.repeat(64),
      snapshotSha256: '3'.repeat(64),
      snapshotReceiptSha256: '4'.repeat(64),
    },
    appStateFingerprint: APP_HASH,
    fixtureStateFingerprint: FIXTURE_HASH,
    sourceFingerprint: SOURCE_HASH,
    helperFingerprint: HELPER_HASH,
    cohortFixtureFingerprint: COHORT_HASH,
    ownership: {},
    cleanupStatus: 'cleaned',
    resourceCleanupStatus: 'deferred-to-capture-finalizer',
    blocker: null,
    ...overrides,
  };
}

async function fixture() {
  const sourceRoot = await privateRoot('source');
  const finalRoot = await privateRoot('final');
  const receiptPath = path.join(sourceRoot, 'reset-original.private.json');
  const bytes = Buffer.from(`${JSON.stringify(receiptValue())}\n`);
  await writeFile(receiptPath, bytes, { flag: 'wx', mode: 0o600 });
  await chmod(receiptPath, 0o600);
  const sourceObservation = readNativeEvidenceObservation(
    sourceRoot,
    'reset-original.private.json',
    true,
  );
  await writeFile(path.join(finalRoot, 'reset-original.private.json'), bytes, {
    flag: 'wx',
    mode: 0o600,
  });
  await chmod(path.join(finalRoot, 'reset-original.private.json'), 0o600);
  const binding: AndroidDetoxCameraResetBinding = {
    artifactRoot: sourceRoot,
    receiptPath,
    receiptHash: createHash('sha256').update(bytes).digest('hex'),
    fixtureResetId: 'android-camera-reset-1',
    ownerRunId: RUN_ID,
    attemptId: ATTEMPT_ID,
    cohortFixtureFingerprint: COHORT_HASH,
    appStateFingerprint: APP_HASH,
    fixtureStateFingerprint: FIXTURE_HASH,
    sourceFingerprint: SOURCE_HASH,
    helperFingerprint: HELPER_HASH,
    cleanupStatus: 'cleaned',
    target: receiptValue().target,
    backend: receiptValue().backend,
    sourceIdentity: sourceObservation.identity,
  };
  return {
    sourceRoot,
    finalRoot,
    binding,
    expected: {
      requestedRunId: RUN_ID,
      requestedAttemptId: ATTEMPT_ID,
      fixtureResetId: 'android-camera-reset-1',
      cohortFixtureFingerprint: COHORT_HASH,
      sourceFingerprint: SOURCE_HASH,
      helperFingerprint: HELPER_HASH,
    },
  };
}

async function validFixture() {
  return fixture();
}

void test('Android Detox cold reset reads the exact shared handoff and binds runtime identities', async () => {
  const value = await validFixture();
  try {
    const proof = readAndroidDetoxCameraResetProof({
      artifactRoot: value.finalRoot,
      expectation: value.expected,
      binding: value.binding,
    });
    assert.equal(proof.status, 'verified');
    assert.equal(proof.receiptHash, value.binding.receiptHash);
    assert.equal(proof.originalReceiptBinding.status, 'verified');
    assert.equal(proof.originalReceiptBinding.receiptPath, value.binding.receiptPath);
    assert.equal(proof.originalReceiptBinding.receiptHash, value.binding.receiptHash);
    assert.equal(proof.target.platform, 'android');
    assert.equal(proof.fixture.scope, 'native-entry-android');
    requireAndroidDetoxCameraResetRuntimeMatch({
      proof,
      runtime: {
        captureRunId: RUN_ID,
        ownerRunId: RUN_ID,
        fixtureRunId: BACKEND_RUN_ID,
        target: {
          deviceId: 'emulator-5554',
          osVersion: '35',
          appId: 'com.edufelip.mychampions.dev',
          buildProfile: 'android.emu.debug',
          binaryHash: 'f'.repeat(64),
          apiOrigin: 'http://127.0.0.1:43001',
        },
        build: {
          sourceTreeHash: SOURCE_HASH,
          helperInputsHash: HELPER_HASH,
          binaryHash: 'f'.repeat(64),
        },
        backend: {
          runId: BACKEND_RUN_ID,
          artifactRoot: '/private/backend-artifacts/android-reset',
          apiOrigin: 'http://127.0.0.1:43000',
          apiPid: 4321,
          apiStarted: 'backend-start',
          apiScript: 'server/dev',
          backendAttemptId: `${BACKEND_RUN_ID}:first`,
          manifestSha256: '1'.repeat(64),
        },
      },
    });
  } finally {
    await Promise.all([
      rm(value.sourceRoot, { recursive: true, force: true }),
      rm(value.finalRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('Android Detox cold reset rejects a missing process binding and an iOS receipt', async () => {
  const missing = await validFixture();
  try {
    assert.throws(
      () =>
        readAndroidDetoxCameraResetProof({
          artifactRoot: missing.finalRoot,
          expectation: missing.expected,
          binding: undefined,
        }),
      /binding must be an object/i,
    );
  } finally {
    await Promise.all([
      rm(missing.sourceRoot, { recursive: true, force: true }),
      rm(missing.finalRoot, { recursive: true, force: true }),
    ]);
  }
  const ios = await validFixture();
  try {
    const iosBytes = Buffer.from(
      `${JSON.stringify(receiptValue({ target: { ...receiptValue().target, platform: 'ios' } }))}\n`,
    );
    await writeFile(path.join(ios.finalRoot, 'reset-original.private.json'), iosBytes, {
      flag: 'w',
      mode: 0o600,
    });
    await chmod(path.join(ios.finalRoot, 'reset-original.private.json'), 0o600);
    assert.throws(
      () =>
        readAndroidDetoxCameraResetProof({
          artifactRoot: ios.finalRoot,
          expectation: ios.expected,
          binding: ios.binding,
        }),
      /hash differs|target\.platform|is foreign/i,
    );
  } finally {
    await Promise.all([
      rm(ios.sourceRoot, { recursive: true, force: true }),
      rm(ios.finalRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('Android Detox cold reset rejects a target/build mismatch at runtime binding', async () => {
  const value = await validFixture();
  try {
    const proof = readAndroidDetoxCameraResetProof({
      artifactRoot: value.finalRoot,
      expectation: value.expected,
      binding: value.binding,
    });
    assert.throws(
      () =>
        requireAndroidDetoxCameraResetRuntimeMatch({
          proof,
          runtime: {
            captureRunId: RUN_ID,
            ownerRunId: RUN_ID,
            fixtureRunId: BACKEND_RUN_ID,
            target: {
              deviceId: 'foreign-device',
              osVersion: '35',
              appId: 'com.edufelip.mychampions.dev',
              buildProfile: 'android.emu.debug',
              binaryHash: 'f'.repeat(64),
              apiOrigin: 'http://127.0.0.1:43001',
            },
            build: {
              sourceTreeHash: SOURCE_HASH,
              helperInputsHash: HELPER_HASH,
              binaryHash: 'f'.repeat(64),
            },
            backend: {
              runId: BACKEND_RUN_ID,
              artifactRoot: '/private/backend-artifacts/android-reset',
              apiOrigin: 'http://127.0.0.1:43000',
              apiPid: 4321,
              apiStarted: 'backend-start',
              apiScript: 'server/dev',
              backendAttemptId: `${BACKEND_RUN_ID}:first`,
              manifestSha256: '1'.repeat(64),
            },
          },
        }),
      /Expected values|foreign/i,
    );
  } finally {
    await Promise.all([
      rm(value.sourceRoot, { recursive: true, force: true }),
      rm(value.finalRoot, { recursive: true, force: true }),
    ]);
  }
});

void test('Android Detox camera child retains native permission reset and forbids bypasses', async () => {
  const child = await readFile(
    path.resolve(process.cwd(), 'e2e/detox-android-camera-denied.e2e.test.js'),
    'utf8',
  );
  const owner = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/native-detox-camera-android-owned-session.ts'),
    'utf8',
  );
  const bridge = await readFile(
    path.resolve(
      process.cwd(),
      'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
    ),
    'utf8',
  );
  assert.match(bridge, /permissionState\(\)|permissionBefore|permissionAfter/iu);
  assert.match(bridge, /UiDevice|UiObject2|\.click\(\)/u);
  assert.doesNotMatch(bridge, /Runtime\.exec|ProcessBuilder|pm\s+(?:grant|revoke)/iu);
  assert.match(child, /permission-controller|real\s+Android\s+permission/iu);
  assert.doesNotMatch(child, /grantPermissions|mock.*permission|skip.*permission/iu);
  assert.doesNotMatch(child, /device\.tap\(\s*\{?\s*x:/iu);
  assert.match(owner, /Android Detox camera/iu);
  assert.doesNotMatch(owner, /seed.*connection|client.*shortcut|device\.tap\(\s*\{?\s*x:/iu);
});
