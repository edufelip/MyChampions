import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packetRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

void test('Android Detox instrumentation uses the application package namespace', async () => {
  const javaRoot = path.join(
    packetRoot,
    'android/app/src/androidTest/java/com/edufelip/mychampions',
  );
  const [bridge, suite] = await Promise.all([
    readFile(path.join(javaRoot, 'DetoxCameraPermissionBridge.java'), 'utf8'),
    readFile(
      path.join(
        packetRoot,
        'android/app/src/androidTest/java/com/eduardo880/mychampions/DetoxTest.java',
      ),
      'utf8',
    ),
  ]);
  assert.match(bridge, /^package com\.edufelip\.mychampions;/m);
  assert.match(suite, /^package com\.edufelip\.mychampions;/m);
  assert.doesNotMatch(bridge, /com\.eduardo880/);
  assert.doesNotMatch(suite, /com\.eduardo880/);
  assert.match(suite, /CAMERA_BOOTSTRAP_PREFERENCES = "detox\.camera\.bootstrap\.v1"/u);
  assert.match(suite, /publishCameraBootstrap\(targetContext, "entered"\)/u);
  assert.match(suite, /"detox-failed-" \+ error\.getClass\(\)\.getSimpleName\(\)/u);
});

void test('Android camera capture and protected writer inputs are current-Q guarded regular files', async () => {
  const capture = path.join(packetRoot, 'scripts/testing/capture-android-testability.ts');
  const ancestorWriter = path.join(packetRoot, 'scripts/testing/detox-connection-ancestor-safe.py');
  const [captureStat, writerStat] = await Promise.all([lstat(capture), lstat(ancestorWriter)]);
  assert.equal(captureStat.isFile(), true);
  assert.equal(captureStat.mode & 0o777, 0o600);
  assert.equal(
    await sha256(capture),
    'e3061bd674998492db56eff8648c180c3b200922e80d8cf9b975af0abe8c9346',
  );
  assert.equal(writerStat.isFile(), true);
  assert.equal(writerStat.mode & 0o777, 0o644);
  assert.equal(
    (
      await readFile(
        path.join(packetRoot, 'scripts/testing/native-detox-camera-android-q-adapter.ts'),
        'utf8',
      )
    ).includes('worktrees/testing-native'),
    false,
  );
});

void test('Android camera staging uses descriptor-safe publication and records rollback', async () => {
  const [staging, dispatch, bridge] = await Promise.all([
    readFile(
      path.join(packetRoot, 'scripts/testing/native-android-camera-public-staging.ts'),
      'utf8',
    ),
    readFile(
      path.join(packetRoot, 'scripts/testing/native-detox-camera-android-public-dispatch.ts'),
      'utf8',
    ),
    readFile(
      path.join(
        packetRoot,
        'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
      ),
      'utf8',
    ),
  ]);
  assert.match(staging, /writeAndroidCameraAnchoredFile/);
  assert.match(dispatch, /private-owned-android-detox-camera-staging-rollback-v1/);
  assert.match(bridge, /O_NOFOLLOW/);
  assert.match(bridge, /Os\.fstat/);
  assert.match(bridge, /sameIdentity\(before, after\)/);
});

void test('Android Detox camera terminal verification owns its runtime projection branch', async () => {
  const runner = await readFile(
    path.join(packetRoot, 'scripts/testing/run-native-pilot.ts'),
    'utf8',
  );
  const cameraBranch = runner.search(/executionAdapter === ['"]android-detox-camera['"]/u);
  const cameraBranches = [
    ...runner.matchAll(/\}\s+else if \(executionAdapter === ['"]android-detox-camera['"]\) \{/gu),
  ].map((match) => match.index ?? -1);
  const stagingCameraBranch =
    cameraBranches.find((index) => index > runner.indexOf('let androidDetoxCameraSourceOnly')) ??
    -1;
  const finalSources = runner.indexOf(
    'const finalSources = await readRepositorySources',
    stagingCameraBranch,
  );
  const terminalCameraBranch = cameraBranches.find((index) => index > finalSources) ?? -1;
  const genericVerifier = runner.indexOf(
    'verifyStagedNativeTrainingEvidence',
    terminalCameraBranch,
  );
  assert(cameraBranch >= 0);
  assert(stagingCameraBranch >= 0);
  assert(finalSources > stagingCameraBranch);
  assert(terminalCameraBranch >= 0);
  assert(genericVerifier > terminalCameraBranch);
  assert.match(
    runner.slice(stagingCameraBranch, finalSources),
    /detoxCameraRuntime\.buildIdentity\.binaryHash/,
  );
  assert.match(
    runner.slice(stagingCameraBranch, finalSources),
    /detoxCameraRuntime\.assertionContractSha256/,
  );
  assert.match(
    runner.slice(terminalCameraBranch, genericVerifier),
    /androidDetoxCameraSourceOnly \|\| androidDetoxCameraVerified/,
  );
});

void test('Android camera scenario provisions a virtual back camera before requesting permission', async () => {
  const emulator = await readFile(
    path.join(packetRoot, 'scripts/testing/owned-android-emulator.ts'),
    'utf8',
  );
  const scenario = await readFile(
    path.join(packetRoot, 'e2e/detox-android-camera-denied.e2e.test.js'),
    'utf8',
  );
  assert.match(emulator, /'-camera-back',\s*'virtualscene'/u);
  assert.doesNotMatch(emulator, /'-camera-back',\s*'none'/u);
  assert.match(scenario, /Camera access is required to scan a QR code/u);
  assert.doesNotMatch(scenario, /resumeCameraAppAfterSystemPermission/u);
  assert.match(scenario, /await device\.launchApp\(\{\s+newInstance: true/u);
  assert.match(scenario, /no app connection until the test explicitly\s+\/\/ launches the activity/u);
});

void test('Android camera test preserves target-private bridge evidence between actors', async () => {
  const scenario = await readFile(
    path.join(packetRoot, 'e2e/detox-android-camera-denied.e2e.test.js'),
    'utf8',
  );
  assert.match(scenario, /async function signOutForNextActor\(\)/);
  assert.match(scenario, /await signOutForNextActor\(\);/);
  assert.match(scenario, /whileElement\(by\.id\('settings\.account\.screen'\)\)/);
  assert.doesNotMatch(scenario, /launchCameraApp\(true\)/);
});

void test('Android Detox camera bridge supports both bounded PermissionController packages', async () => {
  const [bridge, contract, reader, owner] = await Promise.all([
    readFile(
      path.join(
        packetRoot,
        'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
      ),
      'utf8',
    ),
    readFile(
      path.join(packetRoot, 'scripts/testing/native-detox-camera-android-contract.ts'),
      'utf8',
    ),
    readFile(
      path.join(packetRoot, 'scripts/testing/native-detox-camera-android-bridge.ts'),
      'utf8',
    ),
    readFile(
      path.join(packetRoot, 'scripts/testing/native-detox-camera-android-owned-session.ts'),
      'utf8',
    ),
  ]);
  for (const systemPackage of [
    'com.android.permissioncontroller',
    'com.google.android.permissioncontroller',
  ]) {
    assert.match(bridge, new RegExp(`"${systemPackage.replace(/\\./gu, '\\\\.')}`));
    assert.match(contract, new RegExp(`'${systemPackage.replace(/\\./gu, '\\\\.')}'`));
  }
  assert.match(bridge, /targetContext\.getFilesDir\(\)/u);
  assert.doesNotMatch(bridge, /artifactContext\.getFilesDir\(\)/u);
  assert.match(bridge, /for \(String systemPackage : PERMISSION_CONTROLLERS\)/u);
  assert.match(bridge, /title\.getApplicationPackage\(\)/u);
  assert.match(bridge, /deny\.getApplicationPackage\(\)/u);
  assert.doesNotMatch(bridge, /packageSelector\.text\(/u);
  assert.match(bridge, /waitForPromptGone\(candidate\.systemPackage\)/u);
  assert.match(bridge, /waiting-for-dismissal[\s\S]*waitForPromptGone\(candidate\.systemPackage\)[\s\S]*checking-permission-after/u);
  assert.doesNotMatch(bridge, /resuming-target-activity|resumeTargetActivity|waitForWindowUpdate|FLAG_ACTIVITY_REORDER_TO_FRONT/u);
  assert.doesNotMatch(bridge, /StaleObjectException/u);
  assert.match(bridge, /!frameExists\(entryHierarchy\) \|\| !frameExists\(entryScreenshot\)/u);
  assert.match(bridge, /SystemClock\.sleep\(250L\)/u);
  assert.match(bridge, /System\.currentTimeMillis\(\) \+ 2000L/u);
  assert.match(bridge, /Android screenshot capture remained unavailable/u);
  assert.match(bridge, /newFile\(label \+ "-" \+ attempt \+ "\.png"\)/u);
  assert.match(bridge, /state = BridgeState\.COMPLETE;\s+writeReceipt\(\);\s+return;/u);
  assert.match(bridge, /if \(receiptWritten \|\| current == null\) return;/u);
  assert.match(bridge, /bridgeStage = "denying-prompt"/u);
  assert.match(bridge, /bridgeErrorClass = error\.getClass\(\)\.getSimpleName\(\)/u);
  assert.match(bridge, /root\.put\("bridgeStage", bridgeStage\)/u);
  assert.match(bridge, /writeReceiptFailureDiagnostic\(current\)/u);
  assert.match(bridge, /writeUnconfiguredReceiptFailureDiagnostic\(\)/u);
  assert.match(bridge, /configuration == null\) writeUnconfiguredReceiptFailureDiagnostic\(\)/u);
  assert.match(bridge, /configuration = launched;\s+mkdirPrivate\(launched\.artifactRoot\)/u);
  assert.match(bridge, /camera-prompt-observation-error\.private\.json/u);
  assert.match(bridge, /root\.put\("bridgeErrorClass", bridgeErrorClass\)/u);
  assert.match(bridge, /root\.put\("childFailureClass", childFailure == null \? "none"/u);
  assert.match(bridge, /prompt == null \? PERMISSION_CONTROLLERS\[0\] : prompt\.systemPackage/u);
  assert.match(reader, /probeDeviceFile/u);
  assert.match(reader, /'shell',\s*'run-as',\s*ANDROID_DETOX_CAMERA_APP_ID/u);
  assert.match(reader, /'find',\s*'files',\s*'-maxdepth',\s*'3'/u);
  assert.match(reader, /bridgeDevicePath\(relativePath\)/u);
  assert.match(reader, /receipt\.childResult !== 'completed'/u);
  assert.match(reader, /terminal receipt or failure diagnostic/u);
  assert.match(reader, /requireReceiptFailureDiagnostic/u);
  assert.match(reader, /camera-prompt-observation-error\.private\.json/u);
  assert.match(reader, /'run-as',\s*ANDROID_DETOX_CAMERA_APP_ID/u);
  assert.match(reader, /readDeadlineAtEpochMs \?\? input\.deadlineAtEpochMs/u);
  assert.match(reader, /readDeadlineAtEpochMs <= input\.deadlineAtEpochMs/u);
  assert.match(owner, /Date\.now\(\) \+ 30_000/u);
  assert.match(owner, /buildAndroidCameraPermissionCommands\(appId\)/u);
  assert.match(owner, /android-camera-revoke-permission/u);
  assert.match(owner, /parseAndroidCameraPermissionStatus\(permissionBefore\.bytes/u);
  assert.match(owner, /'denied'/u);
  assert.match(owner, /'--reuse'/u);
  assert.match(owner, /input\.child\.capture\(false\)/u);
  assert.match(owner, /SUBMIT_READY/u);
  assert.match(owner, /private-owned-android-detox-camera-submit-ready/u);
  assert.match(owner, /writeAtomicDetoxConnectionBytes\(\s*input\.root,\s*SUBMIT_READY/u);
  assert.match(owner, /process group disappeared before its owned submit intent/u);
  assert.match(owner, /bridgeFailure=\$\{bridge\.receipt\.childFailureClass\}/u);
  assert.match(owner, /readLatestAndroidCameraStage/u);
  assert.match(owner, /detox-training-camera-stage-\(\[1-9\]\[0-9\]\*\)\\\.private\\\.json/u);
  assert.match(owner, /detox\.camera\.bootstrap\.v1\.xml/u);
  assert.match(owner, /android-camera-failure-logcat\.private\.log/u);
  assert.match(owner, /'logcat', '-d', '-v', 'brief', '\*:V'/u);
  assert.match(owner, /bytes\.subarray\(Math\.max\(0, bytes\.length - 256 \* 1024\)\)/u);
  assert.match(owner, /async function warmAndroidMetroBundle/u);
  assert.match(owner, /android-metro-bundle-warmup\.private\.json/u);
  assert.match(owner, /url\.searchParams\.set\('platform', 'android'\)/u);
  assert.match(
    owner,
    /proxy\.waitForQuiescence\(Math\.min\(5_000, remaining\(input\.deadlineAt\)\), input\.signal\)/u,
  );
});

void test('Android camera bridge receives only validated run-bound launch configuration', async () => {
  const [activity, bridge, sessionBaseline, detoxConfig, owner] = await Promise.all([
    readFile(
      path.join(packetRoot, 'android/app/src/main/java/com/eduardo880/mychampions/MainActivity.kt'),
      'utf8',
    ),
    readFile(
      path.join(
        packetRoot,
        'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
      ),
      'utf8',
    ),
    readFile(path.join(packetRoot, 'scripts/testing/detox-integrated-session-baseline.ts'), 'utf8'),
    readFile(path.join(packetRoot, '.detoxrc.js'), 'utf8'),
    readFile(
      path.join(packetRoot, 'scripts/testing/native-detox-camera-android-owned-session.ts'),
      'utf8',
    ),
  ]);
  for (const key of [
    'detoxCameraBridge',
    'detoxCameraCaptureRunId',
    'detoxCameraOwnerRunId',
    'detoxCameraAttemptId',
    'detoxCameraSerial',
    'detoxCameraAppId',
    'detoxCameraLocale',
    'detoxCameraDeadlineAtEpochMs',
    'detoxCameraCancelRelativePath',
  ]) {
    assert.match(activity, new RegExp(`"${key}"`, 'u'));
    assert.match(bridge, new RegExp(`"${key}"`, 'u'));
    assert.match(detoxConfig, new RegExp(`\\b${key}\\b`, 'u'));
  }
  assert.match(activity, /getSharedPreferences\(DETOX_CAMERA_BRIDGE_PREFERENCES, MODE_PRIVATE\)/u);
  assert.match(activity, /preferences\.edit\(\)\.clear\(\)/u);
  assert.match(activity, /editor\.commit\(\)/u);
  assert.match(activity, /getBundleExtra\(DETOX_CAMERA_BRIDGE_LAUNCH_ARGS\)/u);
  assert.match(bridge, /PREFERENCES_NAME = "detox\.camera\.bridge\.v1"/u);
  assert.doesNotMatch(bridge, /preferences\.edit\(\)\.clear\(\)\.commit\(\)/u);
  assert.match(detoxConfig, /launchArgs: androidDebugLaunchArgs/u);
  assert.match(detoxConfig, /ownedAndroidCameraLaunchArgs\(\)/u);
  assert.match(detoxConfig, /DETOX_ANDROID_CAMERA_SCENARIO !== 'denied'/u);
  assert.match(detoxConfig, /reinstallApp: false/u);
  assert.match(owner, /androidCameraBridgePreference\(/u);
  assert.match(owner, /persistAndroidCameraBridgePreference\(/u);
  assert.match(owner, /android-camera-bridge-prefs/u);
  assert.match(owner, /shared_prefs\/detox\.camera\.bridge\.v1\.xml/u);
  assert.match(owner, /Android camera bridge configuration was not persisted exactly/u);
  assert.match(bridge, /waiting-for-launch-config/u);
  assert.doesNotMatch(bridge, /FLAG_ACTIVITY_REORDER_TO_FRONT/u);
  assert.doesNotMatch(bridge, /waitForWindowUpdate\(/u);
  assert.match(bridge, /loadLaunchConfiguration\(\)/u);
  assert.match(bridge, /configuration == null\) return;/u);
  assert.match(bridge, /configurationFromValues\(targetContext/u);
  assert.match(
    sessionBaseline,
    /'android\/app\/src\/main\/java\/com\/eduardo880\/mychampions\/MainActivity\.kt'/u,
  );
});
