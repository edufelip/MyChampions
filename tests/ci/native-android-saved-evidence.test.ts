import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import { androidInputReaderPackage } from '../../scripts/testing/android-native-input-reader';
import {
  validateAndroidSavedTrainingTitleEvidence,
  validateAndroidSavedTrainingJourneyPreparation,
  validateIosSavedTrainingJourneyPreparation,
} from '../../scripts/testing/native-view-evidence';

void test('Android saved title binds original OS result, signed/installed reader bytes and unique capture identity', async () => {
  // Synthetic file/OS-result rejection controls only; not native execution or public qualification.
  const temporary = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mc-saved-android-')));
  const captureRunId = 'a'.repeat(24);
  const root = path.join(temporary, captureRunId);
  await mkdir(root, { mode: 0o700 });
  await mkdir(path.join(root, 'android-input-reader'), { mode: 0o700 });
  const label = 'journey-edit-title-cleared';
  const logPath = `android-input-reader-${label}-read.private.log`;
  const bindingPath = `${label}-native-input.private.json`;
  const identityPath = 'android-input-reader-identity.private.json';
  const binary = Buffer.from('synthetic-bound-reader-bytes');
  const binaryHash = createHash('sha256').update(binary).digest('hex');
  const observation = {
    schemaVersion: 1,
    kind: 'read-only-owned-android-input-observation',
    captureRunId,
    label,
    matchingFields: 1,
    packageName: 'com.edufelip.mychampions.dev',
    selectorId: 'pro.training_plan.name',
    className: 'android.widget.EditText',
    enabled: true,
    editable: true,
    visible: true,
    isShowingHintText: true,
    nativeText: enUS['pro.plan.field.name.placeholder'],
    hintText: enUS['pro.plan.field.name.placeholder'],
    bounds: [0, 0, 100, 40],
    apiLevel: 36,
    readOnly: true,
  };
  const tree = {
    attributes: {
      'resource-id': 'pro.training_plan.name',
      class: observation.className,
      enabled: 'true',
      text: observation.nativeText,
      hintText: observation.hintText,
    },
  };
  const identity = {
    kind: 'read-only auxiliary Android input reader identity',
    captureRunId,
    packageName: androidInputReaderPackage,
    binaryPath: path.join(root, 'android-input-reader/input-reader.apk'),
    binaryHash,
    installedBinaryHash: binaryHash,
    installedPath: '/data/app/qa/base.apk',
    disposableSigningKeyDeleted: true,
    setupElapsedMs: 1,
    sources: Array.from({ length: 10 }, (_, index) => ({
      path: `/synthetic/source-${index}`,
      sha256: 'b'.repeat(64),
    })),
  };
  const binding = {
    kind: 'private original Android raw input observation binding',
    observation,
    readerBinaryHash: binaryHash,
    originalLogPath: logPath,
  };
  const save = (name: string, value: unknown) =>
    writeFile(path.join(root, name), JSON.stringify(value), { mode: 0o600 });
  const log = (value: unknown, code = -1) =>
    writeFile(
      path.join(root, logPath),
      `INSTRUMENTATION_RESULT: nativeInput=${JSON.stringify(value)}\nINSTRUMENTATION_CODE: ${code}\n`,
      { mode: 0o600 },
    );
  try {
    await writeFile(identity.binaryPath, binary, { mode: 0o600 });
    await save(identityPath, identity);
    await save(bindingPath, binding);
    await log(observation);
    const expected = [identityPath, 'android-input-reader/input-reader.apk', bindingPath, logPath];
    assert.deepEqual(validateAndroidSavedTrainingTitleEvidence(root, tree), expected);
    for (const patch of [
      { captureRunId: 'c'.repeat(24) },
      { installedBinaryHash: '0'.repeat(64) },
      { binaryPath: '/foreign/input-reader.apk' },
      { disposableSigningKeyDeleted: false },
      { sources: [...identity.sources.slice(1), identity.sources[1]] },
      { setupElapsedMs: 0 },
    ]) {
      await save(identityPath, { ...identity, ...patch });
      assert.throws(() => validateAndroidSavedTrainingTitleEvidence(root, tree));
    }
    await save(identityPath, identity);
    for (const patch of [
      { readerBinaryHash: '0'.repeat(64) },
      { originalLogPath: '../foreign.log' },
      { observation: { ...observation, isShowingHintText: false } },
      { kind: 'generated-value' },
    ]) {
      await save(bindingPath, { ...binding, ...patch });
      assert.throws(() => validateAndroidSavedTrainingTitleEvidence(root, tree));
    }
    await save(bindingPath, binding);
    for (const value of [
      { ...observation, captureRunId: 'd'.repeat(24) },
      { ...observation, label: 'other' },
      { ...observation, isShowingHintText: false },
      { ...observation, enabled: false },
    ]) {
      await log(value);
      assert.throws(() => validateAndroidSavedTrainingTitleEvidence(root, tree));
    }
    await log(observation, 0);
    assert.throws(() => validateAndroidSavedTrainingTitleEvidence(root, tree));
    await log(observation);
    await writeFile(identity.binaryPath, Buffer.from('changed'), { mode: 0o600 });
    assert.throws(() => validateAndroidSavedTrainingTitleEvidence(root, tree));
    await writeFile(identity.binaryPath, binary, { mode: 0o600 });
    const key = path.join(root, 'android-input-reader/disposable-signing.p12');
    await writeFile(key, 'retained-key', { mode: 0o600 });
    assert.throws(() => validateAndroidSavedTrainingTitleEvidence(root, tree));
    await rm(key);
    assert.throws(() =>
      validateAndroidSavedTrainingTitleEvidence(root, {
        attributes: { ...tree.attributes, text: 'still contains title' },
      }),
    );
    assert.deepEqual(validateAndroidSavedTrainingTitleEvidence(root, tree), expected);
    assert.deepEqual(
      JSON.parse((await readFile(path.join(root, bindingPath))).toString()),
      binding,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

void test('saved journey platform entry points reject crossed platform and incomplete metadata before evidence reads', () => {
  for (const [validator, platform, other] of [
    [validateAndroidSavedTrainingJourneyPreparation, 'android', 'ios'],
    [validateIosSavedTrainingJourneyPreparation, 'ios', 'android'],
  ] as const) {
    const metadata = {
      input: { platform, runId: 'a'.repeat(24) },
      sixSqlCheckpoints: true,
      threeAuthenticatedApiReads: true,
      savedPlanDurableAfterRestart: true,
      publicNativePassingCases: 0,
    };
    for (const patch of [
      { input: { platform: other, runId: 'a'.repeat(24) } },
      { input: { platform, runId: 'b'.repeat(24) } },
      { sixSqlCheckpoints: false },
      { threeAuthenticatedApiReads: false },
      { savedPlanDurableAfterRestart: false },
      { publicNativePassingCases: 1 },
    ])
      assert.throws(
        () => validator('/no-evidence-is-read', 'a'.repeat(24), { ...metadata, ...patch }, [], []),
        /metadata is incomplete/,
      );
  }
});
