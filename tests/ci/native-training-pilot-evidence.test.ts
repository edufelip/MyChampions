import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { selectNativePilotScenario } from '../../scripts/testing/native-pilot-contract';
import {
  prepareIosTrainingPilotEvidence,
  prepareAndroidTrainingPilotEvidence,
  requireFullAndroidTrainingCleanupEvidence,
  requireAndroidTrainingReaderFreshness,
  writeAndroidTrainingRuntimeFrames,
  writeIosTrainingRuntimeFrames,
} from '../../scripts/testing/native-training-pilot-evidence';
import {
  nativeSavedTrainingFrameCheckpoints,
  nativeObservedSelectors,
} from '../../scripts/testing/native-view-evidence';

void test('completed Android training rejects partial, crossed and unavailable cleanup instead of promoting an early control', () => {
  // Pure receipt boundary only; no cleanup census or application execution is claimed.
  const artifactRoot = '/private/capture/' + 'a'.repeat(24);
  const cleanup = {
    kind: 'independent android native cleanup proof',
    runId: path.basename(artifactRoot),
    result: 'passed',
    captureResult: 'observed',
    captureCleanupClean: true,
    nativePassingCases: 0,
    acquisitions: ['adb', 'emulator', 'backend', 'proxy', 'expo'],
    pidStartPairs: 2,
    survivors: [],
    unknownProcessQueries: [],
    missingForeignDevices: [],
    unavailablePorts: [],
    ownedDeviceAbsent: true,
    cacheAbsent: true,
    defaultAdbPreserved: true,
    foreignAvdsPreserved: true,
    deletedOwnedDirectories: 6,
    docker: { container: [], network: [], volume: [] },
  };
  requireFullAndroidTrainingCleanupEvidence(artifactRoot, cleanup);
  for (const patch of [
    { kind: 'independent ios native cleanup proof' },
    { runId: 'b'.repeat(24) },
    { result: 'failed' },
    { captureResult: 'harness-blocked' },
    { captureCleanupClean: false },
    { nativePassingCases: 1 },
    { acquisitions: ['adb', 'emulator'] },
    { acquisitions: ['emulator', 'adb', 'backend', 'proxy', 'expo'] },
    { pidStartPairs: 0 },
    { survivors: [{}] },
    { unknownProcessQueries: [123] },
    { missingForeignDevices: ['foreign'] },
    { unavailablePorts: [8081] },
    { ownedDeviceAbsent: false },
    { cacheAbsent: null },
    { defaultAdbPreserved: false },
    { foreignAvdsPreserved: false },
    { deletedOwnedDirectories: 5 },
    { docker: null },
    { docker: { container: [], network: ['owned'], volume: [] } },
  ])
    assert.throws(() =>
      requireFullAndroidTrainingCleanupEvidence(artifactRoot, { ...cleanup, ...patch }),
    );
});

void test('Android reader freshness binds all ten current canonical compiler inputs and rejects substitutions, drift and symlinks', async () => {
  // Owned synthetic files test identity rejection, never actual APK or OS-reader execution.
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-reader-freshness-')));
  const repositoryRoot = path.join(root, 'repository');
  const artifactRoot = path.join(root, 'artifacts');
  const sdkRoot = path.join(root, 'sdk'),
    javaHome = path.join(root, 'jdk');
  const expected = [
    path.join(repositoryRoot, 'scripts/testing/android-input-reader/InputReader.java'),
    path.join(repositoryRoot, 'scripts/testing/android-input-reader/AndroidManifest.xml'),
    path.join(sdkRoot, 'platforms/android-36/android.jar'),
    ...['aapt2', 'd8', 'zipalign', 'apksigner'].map((name) =>
      path.join(sdkRoot, 'build-tools/36.0.0', name),
    ),
    ...['javac', 'jar', 'keytool'].map((name) => path.join(javaHome, 'bin', name)),
  ];
  const identityPath = path.join(artifactRoot, 'android-input-reader-identity.private.json');
  const sources = expected.map((file, index) => ({
    path: file,
    sha256: createHash('sha256').update(`input-${index}`).digest('hex'),
  }));
  const save = (value: unknown) => writeFile(identityPath, JSON.stringify(value), { mode: 0o600 });
  const verify = () =>
    requireAndroidTrainingReaderFreshness({ repositoryRoot, artifactRoot, sdkRoot, javaHome });
  try {
    for (const dir of [repositoryRoot, artifactRoot, sdkRoot, javaHome])
      await mkdir(dir, { mode: 0o700 });
    for (const [index, file] of expected.entries()) {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeFile(file, `input-${index}`, { mode: 0o600 });
    }
    await save({ sources });
    await verify();
    for (const rows of [
      sources.slice(1),
      [...sources.slice(1), sources[1]],
      [...sources].reverse(),
      sources.map((row, index) =>
        index === 3 ? { ...row, path: path.join(root, 'foreign') } : row,
      ),
    ]) {
      await save({ sources: rows });
      await assert.rejects(verify(), /paths differ/);
    }
    await save({ sources });
    for (const [index, file] of expected.entries()) {
      await writeFile(file, 'changed-input');
      await assert.rejects(verify(), /source\/tool changed/);
      await writeFile(file, `input-${index}`);
    }
    const file = expected[3];
    const foreign = path.join(root, 'foreign');
    await writeFile(foreign, 'input-3', { mode: 0o600 });
    await rm(file);
    await symlink(foreign, file);
    await assert.rejects(verify());
    await rm(file);
    await writeFile(file, 'input-3', { mode: 0o600 });
    await verify();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('Android runtime mapper rejects crossed selection, stale declaration and historical inventory without writing assertions', async () => {
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const selection = await selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-training-android',
      mode: 'integration',
    },
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-android-mapper-')));
  const options = {
    repositoryRoot,
    artifactRoot: root,
    selection,
    purpose: 'runtime' as const,
    requestedRunId: 'a'.repeat(24),
  };
  try {
    const stale = structuredClone(selection);
    stale.requirementHash = '0'.repeat(64);
    await assert.rejects(
      prepareAndroidTrainingPilotEvidence({ ...options, selection: stale }),
      /stale or altered/,
    );
    for (const patch of [
      { platform: 'ios' as const },
      { mode: 'fixture' as const },
      { engine: 'detox' as const },
    ]) {
      const crossed = structuredClone(selection);
      Object.assign(crossed.arguments, patch);
      await assert.rejects(prepareAndroidTrainingPilotEvidence({ ...options, selection: crossed }));
    }
    assert.deepEqual(await readdir(root), []);
    await writeFile(path.join(root, 'capture.private.json'), JSON.stringify({ platform: 'ios' }), {
      mode: 0o600,
    });
    await assert.rejects(prepareAndroidTrainingPilotEvidence(options));
    assert.deepEqual(await readdir(root), ['capture.private.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('training mapper rejects stale selection and inventory promotion before creating assertion artifacts', async () => {
  // Synthetic boundary controls only; no native execution or cleanup qualification.
  const repositoryRoot = await realpath(path.resolve(__dirname, '../..'));
  const selection = await selectNativePilotScenario(
    { platform: 'ios', engine: 'maestro', scenario: 'SCN-training-ios', mode: 'integration' },
    JSON.parse(
      await readFile(path.join(repositoryRoot, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
    ),
    repositoryRoot,
  );
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'training-mapper-')));
  const artifactRoot = path.join(temporary, 'capture');
  await mkdir(artifactRoot, { mode: 0o700 });
  const options = {
    repositoryRoot,
    artifactRoot,
    selection,
    purpose: 'runtime' as const,
    requestedRunId: 'f'.repeat(24),
  };
  try {
    const stale = structuredClone(selection);
    stale.scenarioHash = '0'.repeat(64);
    await assert.rejects(
      prepareIosTrainingPilotEvidence({ ...options, selection: stale }),
      /stale or altered/,
    );
    assert.deepEqual(await readdir(artifactRoot), []);
    for (const argumentsPatch of [
      { engine: 'detox' as const },
      { platform: 'android' as const },
      { mode: 'fixture' as const },
    ]) {
      const unsupported = structuredClone(selection);
      Object.assign(unsupported.arguments, argumentsPatch);
      await assert.rejects(prepareIosTrainingPilotEvidence({ ...options, selection: unsupported }));
      assert.deepEqual(await readdir(artifactRoot), []);
    }
    const privateJson = (name: string, value: unknown) =>
      writeFile(path.join(artifactRoot, name), JSON.stringify(value), { mode: 0o600, flag: 'wx' });
    await privateJson('capture.private.json', {
      kind: 'private-native-inventory-observation-not-behavior-attempt',
      mode: 'inventory',
      platform: 'ios',
      charter: 'training-journey',
      result: 'observed',
      cleanup: 'cleaned',
      nativePassingCases: 0,
      source: {},
      sourceAfter: {},
      helperInputsBefore: [],
      helperInputsAfter: [],
    });
    await privateJson('external-cleanup.private.json', {
      result: 'passed',
      runId: 'capture',
      pidStartPairs: 1,
      survivors: [],
      unknownProcessQueries: [],
      missingForeignDevices: [],
      ownedDeviceAbsent: true,
      cacheAbsent: true,
      docker: { container: [], network: [], volume: [] },
    });
    await assert.rejects(
      prepareIosTrainingPilotEvidence(options),
      /private-owned-native-training-execution/,
    );
    assert.deepEqual((await readdir(artifactRoot)).sort(), [
      'capture.private.json',
      'external-cleanup.private.json',
    ]);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

for (const platform of ['ios', 'android'] as const) {
  void test(`${platform} runtime checkpoint fingerprints require every captured frame and cannot claim visual review or overwrite evidence`, async () => {
    // Synthetic file boundary only; no native journey or visual acceptance claim.
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-runtime-frames-')));
    const writeFrames =
      platform === 'ios' ? writeIosTrainingRuntimeFrames : writeAndroidTrainingRuntimeFrames;
    const observations = nativeSavedTrainingFrameCheckpoints(platform).map(({ label, viewId }) => ({
      viewId,
      screenshotPath: `${label}.png`,
      hierarchyPath: `${label}-hierarchy.json`,
    }));
    const capture = {
      kind: 'private-owned-native-training-execution-not-public-receipt',
      mode: 'integration',
      platform,
      charter: 'training-journey',
      result: 'observed',
      cleanup: 'cleaned',
      observations,
    };
    const file = path.join(root, 'capture.private.json');
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD3sAAAAASUVORK5CYII=',
      'base64',
    );
    try {
      for (const row of observations) {
        const selector =
          platform === 'android' &&
          ['STATE-native-text-edit-menu', 'STATE-item-removal-confirm'].includes(row.viewId)
            ? {
                attribute: 'text',
                value:
                  row.viewId === 'STATE-native-text-edit-menu'
                    ? 'Select all'
                    : nativeObservedSelectors[row.viewId].value,
              }
            : nativeObservedSelectors[row.viewId];
        // The removal prompt names the exercise; the frame check matches the template.
        const actual =
          row.viewId === 'STATE-item-removal-confirm'
            ? 'Remove en QA Exercise 1 from this session?'
            : selector.value;
        await writeFile(path.join(root, row.screenshotPath), png, { mode: 0o600 });
        await writeFile(
          path.join(root, row.hierarchyPath),
          JSON.stringify({
            attributes: { [selector.attribute]: actual },
            children: [],
          }),
          { mode: 0o600 },
        );
      }
      await writeFile(file, JSON.stringify({ ...capture, observations: observations.slice(1) }), {
        mode: 0o600,
      });
      await assert.rejects(writeFrames(root), /captured exactly once/);
      assert(!(await readdir(root)).includes('training-journey-runtime-frames.private.json'));
      await writeFile(file, JSON.stringify(capture), { mode: 0o600 });
      const otherPlatform =
        platform === 'ios' ? writeAndroidTrainingRuntimeFrames : writeIosTrainingRuntimeFrames;
      await assert.rejects(otherPlatform(root));
      assert(!(await readdir(root)).includes('training-journey-runtime-frames.private.json'));
      await writeFile(
        file,
        JSON.stringify({ ...capture, observations: [...observations, observations[0]] }),
        { mode: 0o600 },
      );
      await assert.rejects(writeFrames(root), /captured exactly once/);
      await writeFile(file, JSON.stringify(capture), { mode: 0o600 });
      if (platform === 'android') {
        const menu = path.join(root, 'journey-edit-title-selection-menu-hierarchy.json');
        const original = await readFile(menu);
        for (const attributes of [{ text: 'Select All' }, { accessibilityText: 'Select all' }]) {
          await writeFile(menu, JSON.stringify({ attributes, children: [] }), { mode: 0o600 });
          await assert.rejects(writeFrames(root), /exact actual-tree selector/);
          assert(!(await readdir(root)).includes('training-journey-runtime-frames.private.json'));
        }
        await writeFile(menu, original, { mode: 0o600 });
      }
      const frames = await writeFrames(root);
      assert.equal(frames.length, 9);
      assert(frames.every((row) => row.reviewed === false));
      const output = path.join(root, 'training-journey-runtime-frames.private.json');
      const saved = await readFile(output);
      await assert.rejects(writeFrames(root), /EEXIST/);
      assert.deepEqual(await readFile(output), saved);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
}
