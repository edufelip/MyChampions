import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import {
  ANDROID_CAMERA_APP_ID,
  androidCameraSelectionHash,
} from '../../scripts/testing/native-camera-android-contract';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import {
  runAndroidCameraAttemptV4Core,
  type AndroidCameraExecutionResult,
} from '../../scripts/testing/run-android-camera-attempt-core';

const Q = path.resolve(__dirname, '../..');
const OUTER_PARENT_RUN_ID = '4c1ed65afdead71df08c7380';
const CAPTURE_RUN_ID = 'ddb4fdf29242c06db2bac96e';
const TARGET_OWNER_RUN_ID = '5566778899aabbccddeeff00';
const BACKEND_RUN_ID = 'aabbccddeeff001122334455';
const SERIAL = 'emulator-5554';
const BINARY_HASH = 'a'.repeat(64);

async function selection(): Promise<NativePilotSelection> {
  const inventory = JSON.parse(
    await readFile(`${Q}/docs/qa/native-pilot/inventory.json`, 'utf8'),
  ) as unknown;
  return selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
    },
    inventory,
    Q,
  );
}

function identity(overrides: Record<string, unknown> = {}) {
  return {
    captureRunId: CAPTURE_RUN_ID,
    ownerRunId: TARGET_OWNER_RUN_ID,
    backendRunId: BACKEND_RUN_ID,
    backendAttemptId: `${BACKEND_RUN_ID}:first`,
    serial: SERIAL,
    appId: ANDROID_CAMERA_APP_ID,
    apiOrigin: 'http://127.0.0.1:18080',
    apiPid: 4321,
    apiStarted: '2026-10-05T00:00:00.000Z',
    apiScript: 'scripts/testing/owned-session.ts',
    target: {
      deviceId: SERIAL,
      osVersion: '35',
      appId: ANDROID_CAMERA_APP_ID,
      buildProfile: 'dev-debug-arm64',
      binaryHash: BINARY_HASH,
      apiOrigin: 'http://127.0.0.1:18081',
    },
    locale: {
      binding: { target: { platform: 'android' } },
    },
    ...overrides,
  } as never;
}

function execution(
  currentSelection: NativePilotSelection,
  overrides: Partial<AndroidCameraExecutionResult> = {},
): AndroidCameraExecutionResult {
  return {
    requestedRunId: OUTER_PARENT_RUN_ID,
    captureRunId: CAPTURE_RUN_ID,
    identity: identity(),
    producerStatus: 'receipts-bound',
    sourceSelectionHash: androidCameraSelectionHash(currentSelection),
    localeStatus: 'qualified',
    cleanup: {
      status: 'cleaned',
      verified: true,
      runId: BACKEND_RUN_ID,
      ownerRunId: TARGET_OWNER_RUN_ID,
      resources: [],
      independentCensus: { status: 'complete', foreignResources: [] },
    },
    ...overrides,
  };
}

async function run(currentSelection: NativePilotSelection, value: AndroidCameraExecutionResult) {
  return runAndroidCameraAttemptV4Core({
    repositoryRoot: Q,
    requestedRunId: OUTER_PARENT_RUN_ID,
    selection: currentSelection,
    signal: new AbortController().signal,
    execute: () => Promise.resolve(value),
  });
}

void test('accepts the actual distinct outer parent and capture identities', async () => {
  const current = await selection();
  const result = await run(current, execution(current));
  assert.equal(result.status, 'source-only');
  assert.equal(result.requestedRunId, OUTER_PARENT_RUN_ID);
  assert.equal(result.captureRunId, CAPTURE_RUN_ID);
  assert.equal(result.callbackInvocations, 1);
  assert.equal(result.cleanup, 'cleaned');
});

void test('rejects a capture identity crossed with a foreign capture root', async () => {
  const current = await selection();
  const result = await run(
    current,
    execution(current, {
      identity: identity({ captureRunId: '11223344556677889900aabb' }),
    }),
  );
  assert.equal(result.status, 'harness-blocked');
  assert.equal(result.errorName, 'AssertionError');
});

void test('rejects a target owner relabeled to the requested outer parent', async () => {
  const current = await selection();
  const result = await run(
    current,
    execution(current, {
      identity: identity({ ownerRunId: OUTER_PARENT_RUN_ID }),
    }),
  );
  assert.equal(result.status, 'harness-blocked');
  assert.equal(result.errorName, 'AssertionError');
});

void test('rejects a producer forged requested outer identity', async () => {
  const current = await selection();
  const result = await run(
    current,
    execution(current, { requestedRunId: '11223344556677889900aabb' }),
  );
  assert.equal(result.status, 'harness-blocked');
  assert.equal(result.errorName, 'AssertionError');
});

void test('rejects cleanup evidence crossed with a foreign target owner', async () => {
  const current = await selection();
  const result = await run(
    current,
    execution(current, {
      cleanup: {
        status: 'cleaned',
        verified: true,
        runId: BACKEND_RUN_ID,
        ownerRunId: 'ffeeddccbbaa009988776655',
        resources: [],
        independentCensus: { status: 'complete', foreignResources: [] },
      },
    }),
  );
  assert.equal(result.status, 'harness-blocked');
  assert.equal(result.errorName, 'AssertionError');
});
