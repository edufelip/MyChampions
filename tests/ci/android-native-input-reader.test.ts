import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enUS } from '../../localization/en-US';
import {
  createOwnedAndroidInputReader,
  parseAndroidNativeInputObservation,
  requireAndroidNativeInputValue,
  requireAndroidInputReaderBadging,
} from '../../scripts/testing/android-native-input-reader';
import { requireAndroidClearedTrainingTitle } from '../../scripts/testing/native-training-maestro-driver';
import type { AndroidNativeInputObservation } from '../../scripts/testing/android-native-input-reader';

const capture = 'c'.repeat(24),
  label = 'journey-edit-title-cleared';
const hint = enUS['pro.plan.field.name.placeholder'];
const observed: AndroidNativeInputObservation = {
  schemaVersion: 1,
  kind: 'read-only-owned-android-input-observation',
  captureRunId: capture,
  label,
  matchingFields: 1,
  packageName: 'com.edufelip.mychampions.dev',
  selectorId: 'pro.training_plan.name',
  className: 'android.widget.EditText',
  enabled: true,
  editable: true,
  visible: true,
  isShowingHintText: true,
  nativeText: hint,
  hintText: hint,
  bounds: [32, 288, 288, 330],
  apiLevel: 35,
  readOnly: true,
};
const wire = (value: unknown, code = '-1') =>
  `INSTRUMENTATION_RESULT: nativeInput=${JSON.stringify(value)}\nINSTRUMENTATION_CODE: ${code}`;

void test('reader APK metadata uses the observed SDK36 minimum field and rejects ambiguous identity, wrong SDKs and added permissions', () => {
  const actual =
    "package: name='com.edufelip.mychampions.qa.inputreader' versionCode='' versionName='' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'\nminSdkVersion:'26'\ntargetSdkVersion:'36'\napplication: label='' icon=''\n";
  requireAndroidInputReaderBadging(actual);
  for (const wrong of [
    '',
    actual + actual,
    actual.replace('qa.inputreader', 'qa.inputreader.foreign'),
    actual.replace("minSdkVersion:'26'", "sdkVersion:'26'"),
    actual.replace("minSdkVersion:'26'", "minSdkVersion:'25'"),
    actual + "minSdkVersion:'26'\n",
    actual + "sdkVersion:'25'\n",
    actual.replace("targetSdkVersion:'36'", "targetSdkVersion:'35'"),
    actual + "targetSdkVersion:'36'\n",
    actual + "uses-permission: name='android.permission.INTERNET'\n",
  ])
    assert.throws(() => requireAndroidInputReaderBadging(wrong));
});

void test('raw Android wire requires one successful original result with exact capture, field and typed OS state', () => {
  const result = parseAndroidNativeInputObservation(wire(observed), capture, label);
  assert.deepEqual(result, observed);
  result.bounds[0] = 100;
  assert.equal(observed.bounds[0], 32);
  for (const patch of [
    { schemaVersion: 2 },
    { kind: 'Maestro hierarchy' },
    { captureRunId: 'd'.repeat(24) },
    { label: 'other-step' },
    { matchingFields: 0 },
    { matchingFields: 2 },
    { packageName: 'foreign.app' },
    { selectorId: 'foreign:id/pro.training_plan.name' },
    { className: 'android.widget.TextView' },
    { enabled: false },
    { editable: false },
    { visible: false },
    { readOnly: false },
    { isShowingHintText: undefined },
    { isShowingHintText: 'true' },
    { nativeText: null },
    { hintText: undefined },
    { bounds: [32, 330, 288, 288] },
    { bounds: [32, 288, 32, 330] },
    { bounds: [-1, 288, 288, 330] },
    { bounds: [32, 288.5, 288, 330] },
    { bounds: [32, 288, 288] },
    { apiLevel: 25 },
    { apiLevel: '35' },
    { unexpected: true },
  ])
    assert.throws(() =>
      parseAndroidNativeInputObservation(wire({ ...observed, ...patch }), capture, label),
    );
  for (const log of [
    '',
    wire(observed, '0'),
    wire(observed) + '\nINSTRUMENTATION_CODE: -1',
    wire(observed) + '\n' + wire(observed),
    'INSTRUMENTATION_RESULT: nativeInput={}\nINSTRUMENTATION_CODE: -1',
    wire(observed) + '\nINSTRUMENTATION_RESULT: nativeInputError=scoped-read-unavailable',
    'INSTRUMENTATION_RESULT: nativeInput=broken\nINSTRUMENTATION_CODE: -1',
  ])
    assert.throws(() => parseAndroidNativeInputObservation(log, capture, label));
});

void test('hint equality alone cannot prove an empty Android value; real input uses the OS discriminator', () => {
  requireAndroidNativeInputValue(observed, '', hint);
  requireAndroidNativeInputValue(
    { ...observed, isShowingHintText: false, nativeText: '' },
    '',
    hint,
  );
  requireAndroidNativeInputValue(
    { ...observed, isShowingHintText: false, nativeText: 'QA title' },
    'QA title',
    hint,
  );
  for (const value of [
    { ...observed, isShowingHintText: false },
    { ...observed, isShowingHintText: false, nativeText: ':first' },
    { ...observed, nativeText: ':first' },
    { ...observed, nativeText: '' },
    { ...observed, hintText: 'other hint' },
  ])
    assert.throws(() => requireAndroidNativeInputValue(value, '', hint));
  assert.throws(() => requireAndroidNativeInputValue(observed, 'QA title', hint));
});

void test('cleared Android field must match its raw observation, capture and exact cleared step', () => {
  const field = {
    attributes: {
      'resource-id': 'pro.training_plan.name',
      enabled: 'true',
      class: 'android.widget.EditText',
      text: hint,
      hintText: hint,
    },
  };
  requireAndroidClearedTrainingTitle(field, observed, capture);
  for (const tree of [
    {},
    { children: [field, field] },
    { attributes: { ...field.attributes, 'resource-id': 'foreign:id/pro.training_plan.name' } },
    { attributes: { ...field.attributes, enabled: 'false' } },
    { attributes: { ...field.attributes, class: 'android.widget.TextView' } },
    { attributes: { ...field.attributes, text: ':first' } },
    { attributes: { ...field.attributes, hintText: 'other hint' } },
  ])
    assert.throws(() => requireAndroidClearedTrainingTitle(tree, observed, capture));
  assert.throws(() =>
    requireAndroidClearedTrainingTitle(
      field,
      { ...observed, captureRunId: 'd'.repeat(24) },
      capture,
    ),
  );
  assert.throws(() =>
    requireAndroidClearedTrainingTitle(field, { ...observed, label: 'earlier-step' }, capture),
  );
  assert.throws(() =>
    requireAndroidClearedTrainingTitle(field, { ...observed, isShowingHintText: false }, capture),
  );
});

void test('raw reader rejects malformed, wrong-owner or aborted requests before files and commands', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'mc-input-reader-'));
  const controller = new AbortController();
  let commands = 0;
  const failCommand = () => {
    commands++;
    throw new Error('A rejected reader dispatched a command');
  };
  const options = {
    repositoryRoot: root,
    artifactRoot: path.join(root, '.qa/artifacts/native-pilot', capture),
    sdkRoot: root,
    javaHome: root,
    env: { NODE_ENV: 'test' as const },
    signal: controller.signal,
    run: failCommand,
    adb: failCommand,
  };
  try {
    for (const invalid of [
      null,
      [],
      {},
      { ...options, extra: true },
      { ...options, artifactRoot: path.join(root, capture) },
      { ...options, repositoryRoot: 'relative' },
      { ...options, signal: {} },
      { ...options, run: undefined },
      { ...options, adb: true },
      { ...options, env: [] },
    ])
      assert.throws(() => createOwnedAndroidInputReader(invalid as never));
    const read = createOwnedAndroidInputReader(options);
    for (const invalid of ['', '../title', 'title\n', 'a'.repeat(81)])
      await assert.rejects(read(invalid));
    controller.abort('original-stop');
    assert.throws(
      () => createOwnedAndroidInputReader(options),
      (error) => error === 'original-stop',
    );
    await assert.rejects(read(label), (error) => error === 'original-stop');
    assert.equal(commands, 0);
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true });
  }
});
