import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(process.cwd());
const source = (name: string) => path.join(root, 'scripts/testing', name);
const javaSource = (name: string) => path.join(root, 'android/app/src/androidTest/java', name);

async function text(name: string): Promise<string> {
  return readFile(source(name), 'utf8');
}

void test('Android Detox camera graft preserves SESSION27 terminal gate and bridge', async () => {
  const runner = await text('run-native-pilot.ts');
  assert.match(runner, /isAndroidDetoxCameraPublicArguments/);
  assert.match(runner, /runAndroidDetoxCameraAttemptForNativePilot/);
  assert.match(runner, /lifecycleNormalization: \{ status: string \}/);
  assert.match(runner, /publicReceiptBound: boolean/);
  assert.match(runner, /sharedLifecycleStatus: string/);
  assert.match(runner, /status !== ["']private-candidate["']/);
  assert.match(runner, /publicReceiptBound !== true/);
  assert.match(runner, /sharedLifecycleStatus !== ["']sealed-contract-compatible["']/);
  assert.match(runner, /reconcileT15AndroidDetoxSessionOuterReceipt/);
  assert.match(runner, /blockAndroidDetoxSessionOuterReceiptForBridgeFailure/);
  assert.match(runner, /promoteAndroidDetoxSessionOuterReceiptAfterBridge/);
  assert.match(runner, /Android Detox blocked bridge replacement did not persist its result/);
  assert.match(runner, /Android Detox blocked bridge replacement did not persist its exit code/);
});

void test('Android Detox camera route preserves current cold producer and connection producer', async () => {
  const runner = await text('run-native-pilot.ts');
  const owner = await text('native-detox-camera-android-owned-session.ts');
  const cold = await text('t15-cold-android-reset-producer.ts');
  const connection = await text('detox-android-connection-producer.ts');
  assert.match(runner, /coldReset: coldResetExpectation \?\? undefined/);
  assert.match(owner, /deadlineAtMonotonicMs: input\.deadlineAt/);
  assert.match(owner, /const coldResetExpectation = input\.coldReset/);
  assert.match(owner, /resetId: coldResetExpectation\.fixtureResetId/);
  assert.match(owner, /fixtures: resetFixtures/);
  assert.match(owner, /produceAndroidColdReset\(/);
  assert.match(owner, /fixtureResetId: reset\.fixtureResetId/);
  assert.match(cold, /fixtures: Row & \{ runId: string; scope: string; resetId: string \}/);
  assert.match(cold, /context\.fixtures\.resetId !== expectation\.fixtureResetId/);
  assert.match(cold, /ownership: structuredClone\(ownership\)/);
  assert.match(connection, /createOwnedAndroidDetoxConnectionProducer/);
  assert.match(connection, /androidTargetRunId: device\.runId/);
  assert.match(connection, /androidOsVersion: device\.osVersion/);
  assert.match(connection, /runId: device\.runId/);
  assert.match(connection, /identity: device\.identity/);
  assert.match(connection, /osVersion: device\.osVersion/);
  assert.match(connection, /adbRead: device\.adbRead/);
  assert.match(connection, /verifyOwnedAndroidDetoxConnectionCleanup/);
  assert.doesNotMatch(
    runner,
    /t15-cold-android-reset-producer.*from ['"]\.\/t15-cold-android-reset-producer['"]/,
  );
});

void test('Android Detox camera route cannot promote a source-only candidate', async () => {
  const runner = await text('run-native-pilot.ts');
  const route = await text('native-detox-camera-android-native-pilot-route.ts');
  const finalizer = await text('native-detox-camera-android-public-finalizer.ts');
  assert.match(runner, /androidDetoxCameraSourceOnly/);
  assert.match(runner, /androidDetoxCameraVerified/);
  assert.match(runner, /detoxCameraRuntime\.nativeFinalization/);
  assert.match(runner, /verificationResult,\s*["']verified-native["']/);
  assert.match(runner, /publicPromotionEligible,\s*true/);
  assert.match(route, /sourceControlOnly/);
  assert.match(route, /nativeFinalizer: sourceControlOnly/);
  assert.match(finalizer, /publicPromotionEligible: true/);
});

void test('Android Detox camera candidate files are regular private copies', async () => {
  const names = [
    'run-native-pilot.ts',
    'native-detox-camera-android-native-pilot-route.ts',
    'native-detox-camera-android-owned-session.ts',
    'native-detox-camera-android-public-dispatch.ts',
    'native-detox-camera-android-public-finalizer.ts',
    't15-cold-android-reset-producer.ts',
    'detox-android-connection-producer.ts',
  ];
  for (const name of names) {
    const info = await lstat(source(name));
    assert.equal(info.isFile(), true, `${name} is not a regular file`);
    assert.equal(info.isSymbolicLink(), false, `${name} is an alias`);
  }
});

void test('Android Detox Java closure has one current-Q DetoxTest FQCN', async () => {
  const currentQReplacement = await readFile(
    javaSource('com/eduardo880/mychampions/DetoxTest.java'),
    'utf8',
  );
  assert.match(currentQReplacement, /^package com\.edufelip\.mychampions;/m);
  assert.match(currentQReplacement, /DetoxCameraPermissionBridge/);
  await assert.rejects(lstat(javaSource('com/edufelip/mychampions/DetoxTest.java')), /ENOENT/);
  const permissionBridge = await readFile(
    javaSource('com/edufelip/mychampions/DetoxCameraPermissionBridge.java'),
    'utf8',
  );
  assert.equal((permissionBridge.match(/class DetoxCameraPermissionBridge/g) ?? []).length, 1);
});
