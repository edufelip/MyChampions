import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  readOwnedAndroidBoundedFile,
  writeOwnedAndroidPrivateFile,
} from '../../scripts/testing/native-android-session-adapter';

async function privateRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'android-camera-owner-lifecycle-'));
  await chmod(root, 0o700);
  return realpath(root);
}

void test('Android owner bounded reads stop at the caller deadline', async () => {
  const root = await privateRoot();
  try {
    const filePath = path.join(root, 'owned.private.json');
    const controller = new AbortController();
    controller.abort(new Error('deadline elapsed'));
    await writeFile(filePath, '{"owned":true}\n', { mode: 0o600 });
    await assert.rejects(
      readOwnedAndroidBoundedFile({
        artifactRoot: root,
        filePath,
        label: 'Android lifecycle fixture',
        maxBytes: 1024,
        signal: controller.signal,
      }),
      /deadline elapsed/i,
    );
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android owner private writes do not publish after an expired deadline', async () => {
  const root = await privateRoot();
  try {
    const controller = new AbortController();
    controller.abort(new Error('deadline elapsed'));
    await assert.rejects(
      writeOwnedAndroidPrivateFile({
        artifactRoot: root,
        relativePath: 'expired.private.json',
        bytes: '{"owned":true}\n',
        kind: 'query',
        signal: controller.signal,
      }),
      /deadline elapsed/i,
    );
    await assert.rejects(stat(path.join(root, 'expired.private.json')), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android camera owner threads lifecycle into every owner receipt boundary', async () => {
  const owner = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/native-detox-camera-android-owned-session.ts'),
    'utf8',
  );
  const adapter = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/native-android-session-adapter.ts'),
    'utf8',
  );
  const sql = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/native-camera-android-sql-source.ts'),
    'utf8',
  );
  const javaPath = path.resolve(
    process.cwd(),
    'android/app/src/androidTest/java/com/eduardo880/mychampions/DetoxTest.java',
  );
  const bridgeJavaPath = path.resolve(
    process.cwd(),
    'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxCameraPermissionBridge.java',
  );
  const duplicateJavaPath = path.resolve(
    process.cwd(),
    'android/app/src/androidTest/java/com/edufelip/mychampions/DetoxTest.java',
  );
  const java = await readFile(javaPath, 'utf8');
  const bridgeJava = await readFile(bridgeJavaPath, 'utf8');
  const ownedExpo = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/owned-expo.ts'),
    'utf8',
  );
  const ownedCommand = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/owned-native-command.ts'),
    'utf8',
  );
  const detoxConfig = await readFile(path.resolve(process.cwd(), '.detoxrc.js'), 'utf8');
  const cameraTest = await readFile(
    path.resolve(process.cwd(), 'e2e/detox-android-camera-denied.e2e.test.js'),
    'utf8',
  );

  assert.match(owner, /readOwnedDetoxConnectionFile\(/u);
  assert.match(owner, /readOwnedDetoxConnectionFile\([\s\S]*?lifecycle\s*,?\s*\)/u);
  assert.match(owner, /acquireOwnedTarget: producer\.acquireOwnedTarget/u);
  assert.match(owner, /detox-camera-owner-failure\.private\.json/u);
  assert.match(
    owner,
    /readOwnedChildIdentity[\s\S]*?catch \(error\)[\s\S]*?\.code !== 'ENOENT'[\s\S]*?await new Promise/u,
  );
  assert.match(owner, /label:\s*'android-camera-os-version'/u);
  assert.match(owner, /label:\s*'android-camera-locale'/u);
  assert.match(owner, /label:\s*'android-camera-product-locale'/u);
  assert.match(owner, /property:\s*'ro\.product\.locale'/u);
  assert.match(owner, /MAX_ANDROID_CAMERA_BRIDGE_WINDOW_MS = 9 \* 60 \* 1000/u);
  assert.match(
    owner,
    /childDeadlineAtEpochMs =\s*Date\.now\(\) \+\s*Math\.min\(\s*MAX_ANDROID_CAMERA_BRIDGE_WINDOW_MS,/u,
  );
  assert.match(owner, /path\.join\(root, '\.detoxrc\.js'\)/u);
  assert.match(owner, /DETOX_JEST_CONFIG:\s*runnerPaths\.jestConfigPath/u);
  assert.match(
    owner,
    /build\.configuration === 'android\.emu\.debug' \? 'android\.att\.debug' : build\.configuration/u,
  );
  assert.match(owner, /DETOX_ANDROID_DEVICE:\s*storage\.serial/u);
  assert.match(owner, /ADB_SERVER_SOCKET:\s*`tcp:\$\{storage\.adbServerPort\}`/u);
  assert.match(owner, /NODE_OPTIONS:\s*`\$\{input\.parentEnv\?\.NODE_OPTIONS/u);
  assert.match(owner, /--experimental-vm-modules/u);
  assert.match(owner, /command:\s*path\.join\(root, 'node_modules', '\.bin', 'detox'\)/u);
  assert.doesNotMatch(owner, /command:\s*'yarn'/u);
  assert.match(cameraTest, /attributes\.private\.json/u);
  assert.doesNotMatch(cameraTest, /attributes\.json`/u);
  assert.match(cameraTest, /async function launchCameraApp\(resetAppState = false\)/u);
  assert.match(cameraTest, /resetAppState \? \{ resetAppState: true \} : \{\}/u);
  assert.match(cameraTest, /await launchCameraApp\(true\);/u);
  assert.doesNotMatch(owner, /'--no-start'/u);
  assert.match(detoxConfig, /behavior:\s*\{[\s\S]*?reinstallApp:\s*true/u);
  assert.match(owner, /label:\s*'android-detox-app-install'/u);
  assert.match(owner, /argv:\s*\['install', '-r', '-d', build\.binaryPath\]/u);
  assert.match(owner, /label:\s*'android-detox-test-install'/u);
  assert.match(owner, /argv:\s*\['install', '-r', '-d', build\.testBinaryPath!\]/u);
  assert.match(owner, /\['shell', 'pm', 'path', appId\]/u);
  assert.match(owner, /\['shell', 'pm', 'path', `\$\{appId\}\.test`\]/u);
  assert.match(owner, /if \(!coldResetExpectation\)[\s\S]*?android-reverse-\$\{label\}/u);
  assert.match(
    owner,
    /if \(!coldResetExpectation\)[\s\S]*?androidMetroPreference\(appId, metroPort\)/u,
  );
  assert.match(owner, /'android-reverse\.private\.json'/u);
  assert.doesNotMatch(owner, /'android-reverse\.private\.log'/u);
  assert.match(owner, /'mkdir -p shared_prefs && printf %s \$\{encodedPreference\}/u);
  assert.match(
    owner,
    /requestedPort:\s*Number\(new URL\(build\.embeddedRuntime\.apiOrigin\)\.port\)/u,
  );
  assert.match(owner, /resourceOwnerRunId/u);
  assert.match(owner, /target\.runId/u);
  assert.match(owner, /native-detox-camera-android-reset-independent/u);
  assert.match(owner, /produceAndroidColdReset\(/u);
  assert.match(owner, /label:\s*["']android-install["']/u);
  assert.match(owner, /label:\s*["']android-installed-build["']/u);
  assert.match(owner, /label:\s*`android-reverse-\$\{label\}`/u);
  assert.match(owner, /\[["']metro["'],\s*metroPort\]/u);
  assert.match(owner, /\[["']api["'],\s*apiPort\]/u);
  assert.match(owner, /label:\s*["']android-prefs-directory["']/u);
  assert.match(owner, /label:\s*["']android-metro-prefs["']/u);
  assert.doesNotMatch(owner, /input\.coldResetBinding/u);
  assert.match(owner, /ro\.build\.version\.release/u);
  assert.match(owner, /targetOsVersion = await readOsVersionReceipt/u);
  assert.match(owner, /readOwnedAndroidBoundedFile\(\{[\s\S]*?signal: input\.signal,/u);
  assert.match(
    owner,
    /writeAtomicDetoxConnectionBytes\([\s\S]*?MAX_INTENT_BYTES,[\s\S]*?\{ signal, deadlineAt \},/u,
  );
  assert.match(owner, /writeAndroidCameraSqlSourceReceipts\(\{[\s\S]*?signal: input\.signal,/u);
  assert.match(
    owner,
    /TRANSPORT_RECEIPT,[\s\S]*?MAX_INTENT_BYTES \* 4,[\s\S]*?signal:\s*input\.signal,[\s\S]*?deadlineAt:\s*input\.deadlineAt/u,
  );
  assert.match(adapter, /signal\?: AbortSignal;/u);
  assert.match(adapter, /assertAbort\(options\.signal\)/u);
  assert.match(sql, /signal\?: AbortSignal;/u);
  assert.match(sql, /signal: input\.signal/u);
  assert.match(java, /^package com\.edufelip\.mychampions;/mu);
  assert.match(bridgeJava, /canonicalFiles = files\.getCanonicalFile\(\);/u);
  assert.match(bridgeJava, /requirePrivateDirectory\(canonicalFiles\);/u);
  assert.match(bridgeJava, /containedChild\(canonicalFiles, "detox-camera\/" \+ captureRunId\)/u);
  assert.doesNotMatch(
    bridgeJava,
    /getCanonicalFile\(\)\.equals\(directory\.getAbsoluteFile\(\)\)/u,
  );
  assert.match(bridgeJava, /stat\.st_uid != android\.os\.Process\.myUid\(\)/u);
  assert.doesNotMatch(bridgeJava, /\(stat\.st_mode & 0007\) != 0/u);
  assert.doesNotMatch(bridgeJava, /\(stat\.st_mode & 0777\) != 0700/u);
  assert.match(
    ownedExpo,
    /Process-group absence is the ownership boundary[\s\S]*?delay\(1000\)\.then\(\(\) => false\)/u,
  );
  assert.match(ownedExpo, /if \(!closed\) child\.unref\(\);/u);
  assert.match(
    ownedCommand,
    /child\.once\('exit', \(code, signal\) => resolve\(\{ code, signal \}\)\)/u,
  );
  assert.match(ownedCommand, /Promise\.race\(\[closed, exited, bound, outputFailurePromise\]\)/u);
  await assert.rejects(readFile(duplicateJavaPath, 'utf8'), /ENOENT/);
});
