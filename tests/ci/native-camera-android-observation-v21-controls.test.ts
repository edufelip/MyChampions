import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  requireAndroidCameraAppRoot,
  requireAndroidCameraManualEntry,
  requireAndroidCameraPendingGuidance,
  requireAndroidCameraPromptDismissed,
} from '../../scripts/testing/native-camera-android-observation';

const APP_ID = 'com.edufelip.mychampions.dev';
const MANUAL_CODE = 'QA-MANUAL-ONLY';
const CONNECTION_ID = 'demo-connection';
const DENIAL_GUIDANCE =
  'Camera access is required to scan a QR code. Grant permission in your device settings, or type the code manually.';
const PENDING_GUIDANCE = 'Waiting for professional confirmation to activate this connection.';
const FIXTURE_PATH = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../fixtures/native-camera-android-app-root-v21.json',
);

function fixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as Record<string, unknown>;
}

function tree(label: 'denied' | 'manual' | 'pending'): Record<string, unknown> {
  return structuredClone(fixture()[label]) as Record<string, unknown>;
}

function attrs(value: Record<string, unknown>): Record<string, unknown> {
  assert(value.attributes && typeof value.attributes === 'object');
  return value.attributes as Record<string, unknown>;
}

function children(value: Record<string, unknown>): Record<string, unknown>[] {
  assert(Array.isArray(value.children));
  return value.children as Record<string, unknown>[];
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

void test('V21 accepts missing visible attributes when the exact app root and positive bounds prove visibility', () => {
  const denied = tree('denied');
  const manual = tree('manual');
  const pending = tree('pending');

  assert.equal(requireAndroidCameraAppRoot({ tree: denied, appId: APP_ID }).path, 'root');
  assert.deepEqual(
    requireAndroidCameraPromptDismissed({
      treeAfterDenial: denied,
      appId: APP_ID,
      guidanceResourceId: 'student.professionals.submitError',
      expectedLocale: 'en-US',
    }),
    { guidancePath: 'root/0' },
  );
  assert.deepEqual(
    requireAndroidCameraManualEntry({
      tree: manual,
      appId: APP_ID,
      manualCodeSha256: hash(MANUAL_CODE),
      codeInputId: 'student.professionals.codeInput',
      connectButtonId: 'student.professionals.connectButton',
      qrModalId: 'student.professionals.qrModal',
    }),
    { codeInputPath: 'root/0', connectButtonPath: 'root/1' },
  );
  assert.deepEqual(
    requireAndroidCameraPendingGuidance({
      tree: pending,
      appId: APP_ID,
      connectionId: CONNECTION_ID,
      expectedLocale: 'en-US',
    }),
    { cardPath: 'root/0', guidancePath: 'root/0/0' },
  );
});

void test('pending guidance can belong to the exact ID-bearing Text node', () => {
  const pending = tree('pending');
  const node = children(pending)[0];
  attrs(node).text = PENDING_GUIDANCE;
  node.children = [];
  assert.deepEqual(
    requireAndroidCameraPendingGuidance({
      tree: pending,
      appId: APP_ID,
      connectionId: CONNECTION_ID,
      expectedLocale: 'en-US',
    }),
    { cardPath: 'root/0', guidancePath: 'root/0' },
  );
});

void test('pending self guidance still rejects duplicate descendants and unrelated guidance', () => {
  const pending = tree('pending');
  const node = children(pending)[0];
  attrs(node).text = PENDING_GUIDANCE;
  const input = {
    tree: pending,
    appId: APP_ID,
    connectionId: CONNECTION_ID,
    expectedLocale: 'en-US' as const,
  };
  assert.throws(() => requireAndroidCameraPendingGuidance(input), /absent or duplicated/i);
  attrs(node).text = '';
  const unrelated = structuredClone(children(node)[0]);
  node.children = [];
  children(pending).push(unrelated);
  assert.throws(() => requireAndroidCameraPendingGuidance(input), /absent or duplicated/i);
});

void test('V21 scopes unprefixed app controls below the exact app-qualified root', () => {
  const denied = tree('denied');
  const external = {
    attributes: {
      'resource-id': 'student.professionals.submitError',
      text: DENIAL_GUIDANCE,
      enabled: true,
      bounds: '[0,0][100,100]',
    },
    children: [],
  };
  const wrapped = {
    attributes: {},
    children: [denied, external],
  };
  assert.deepEqual(
    requireAndroidCameraPromptDismissed({
      treeAfterDenial: wrapped,
      appId: APP_ID,
      guidanceResourceId: 'student.professionals.submitError',
      expectedLocale: 'en-US',
    }),
    { guidancePath: 'root/0/0' },
  );
});

void test('V21 rejects missing, malformed, disabled, invisible, foreign, and duplicate app roots', () => {
  const cases: [string, (value: Record<string, unknown>) => void][] = [
    ['missing root', (value) => (attrs(value)['resource-id'] = 'student.professionals.screen')],
    ['missing bounds', (value) => delete attrs(value).bounds],
    ['malformed bounds', (value) => (attrs(value).bounds = '[0,0][0,0]')],
    ['disabled root', (value) => (attrs(value).enabled = false)],
    ['invisible root', (value) => (attrs(value).visible = false)],
    ['foreign root package', (value) => (attrs(value).package = 'com.example.foreign')],
  ];
  for (const [label, alter] of cases) {
    const denied = tree('denied');
    alter(denied);
    assert.throws(
      () =>
        requireAndroidCameraPromptDismissed({
          treeAfterDenial: denied,
          appId: APP_ID,
          guidanceResourceId: 'student.professionals.submitError',
          expectedLocale: 'en-US',
        }),
      /root|visible|enabled|bounds|foreign|missing|duplicated/i,
      label,
    );
  }

  const duplicate = tree('denied');
  const duplicateRoot = structuredClone(duplicate);
  const wrapped = { attributes: {}, children: [duplicate, duplicateRoot] };
  assert.throws(
    () => requireAndroidCameraAppRoot({ tree: wrapped, appId: APP_ID }),
    /missing or duplicated/i,
  );
  assert.throws(
    () => requireAndroidCameraAppRoot({ tree: tree('denied'), appId: 'com.example.foreign' }),
    /build-bound/i,
  );
});

void test('V21 rejects foreign descendants and every invalid app assertion state', () => {
  const foreignDescendant = tree('denied');
  attrs(children(foreignDescendant)[0]).package = 'com.example.foreign';
  assert.throws(
    () =>
      requireAndroidCameraPromptDismissed({
        treeAfterDenial: foreignDescendant,
        appId: APP_ID,
        guidanceResourceId: 'student.professionals.submitError',
        expectedLocale: 'en-US',
      }),
    /foreign package/i,
  );

  const invalidGuidanceStates: [string, (value: Record<string, unknown>) => void][] = [
    ['visible false', (value) => (attrs(children(value)[0]).visible = false)],
    ['disabled', (value) => (attrs(children(value)[0]).enabled = false)],
    ['missing bounds', (value) => delete attrs(children(value)[0]).bounds],
    ['malformed bounds', (value) => (attrs(children(value)[0]).bounds = '[0,0][0,0]')],
  ];
  for (const [label, alter] of invalidGuidanceStates) {
    const denied = tree('denied');
    alter(denied);
    assert.throws(
      () =>
        requireAndroidCameraPromptDismissed({
          treeAfterDenial: denied,
          appId: APP_ID,
          guidanceResourceId: 'student.professionals.submitError',
          expectedLocale: 'en-US',
        }),
      /absent or duplicated|visible|enabled/i,
      label,
    );
  }

  const duplicateGuidance = tree('denied');
  children(duplicateGuidance).push(structuredClone(children(duplicateGuidance)[0]));
  assert.throws(
    () =>
      requireAndroidCameraPromptDismissed({
        treeAfterDenial: duplicateGuidance,
        appId: APP_ID,
        guidanceResourceId: 'student.professionals.submitError',
        expectedLocale: 'en-US',
      }),
    /absent or duplicated/i,
  );

  const duplicatePending = tree('pending');
  children(duplicatePending).push(structuredClone(children(duplicatePending)[0]));
  assert.throws(
    () =>
      requireAndroidCameraPendingGuidance({
        tree: duplicatePending,
        appId: APP_ID,
        connectionId: CONNECTION_ID,
        expectedLocale: 'en-US',
      }),
    /absent or duplicated/i,
  );

  const duplicateInput = tree('manual');
  children(duplicateInput).push(structuredClone(children(duplicateInput)[0]));
  assert.throws(
    () =>
      requireAndroidCameraManualEntry({
        tree: duplicateInput,
        appId: APP_ID,
        manualCodeSha256: hash(MANUAL_CODE),
        codeInputId: 'student.professionals.codeInput',
        connectButtonId: 'student.professionals.connectButton',
        qrModalId: 'student.professionals.qrModal',
      }),
    /absent or duplicated/i,
  );

  const foreignOnly = {
    attributes: {},
    children: [
      {
        attributes: {
          'resource-id': 'com.example.foreign:id/action_bar_root',
          enabled: true,
          bounds: '[0,0][1080,2400]',
        },
        children: [],
      },
    ],
  };
  assert.throws(
    () => requireAndroidCameraAppRoot({ tree: foreignOnly, appId: APP_ID }),
    /missing or duplicated/i,
  );

  const unprefixedOnly = {
    attributes: {
      'resource-id': 'student.professionals.submitError',
      text: DENIAL_GUIDANCE,
      enabled: true,
      bounds: '[0,0][100,100]',
    },
    children: [],
  };
  assert.throws(
    () =>
      requireAndroidCameraPromptDismissed({
        treeAfterDenial: unprefixedOnly,
        appId: APP_ID,
        guidanceResourceId: 'student.professionals.submitError',
        expectedLocale: 'en-US',
      }),
    /missing or duplicated/i,
  );

  assert.equal(PENDING_GUIDANCE.length > 0, true);
});
