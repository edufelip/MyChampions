import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { shouldBlockAndroidDetoxSessionOuterTerminal } from '../../scripts/testing/run-native-pilot';
import {
  blockAndroidDetoxSessionOuterReceiptForBridgeFailure,
  promoteAndroidDetoxSessionOuterReceiptAfterBridge,
  readAndroidDetoxSessionOuterPublicReceipt,
  reconcileT15AndroidDetoxSessionOuterReceipt,
  reconcileT15AndroidSessionSharedLifecycle,
} from '../../scripts/testing/t15-detox-android-session-public-receipt-bridge';

const runId = 'a'.repeat(24);
const attemptId = `${runId}:first`;
const hash = 'b'.repeat(64);

const selection = {
  arguments: {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-session-android',
    mode: 'integration',
  },
  scenario: {
    id: 'SCN-session-android',
    platform: 'android',
  },
  scenarioHash: hash,
  requirementHash: hash,
} as never;

function receipt() {
  return {
    schemaVersion: 1,
    runId,
    attemptId,
    scenarioId: 'SCN-session-android',
    phase: 'P4',
    layer: 'native',
    engine: 'detox',
    dataMode: 'postgres',
    platform: 'android',
    locale: null,
    repositories: [
      {
        name: 'client',
        sha: 'c'.repeat(40),
        dirty: false,
        workingTreeHash: null,
      },
    ],
    target: {
      deviceId: null,
      osVersion: null,
      appId: null,
      buildProfile: null,
      binaryHash: null,
      apiOrigin: null,
    },
    inputs: {
      scenarioHash: hash,
      requirementHash: hash,
      fixtureHash: null,
      flagsHash: null,
      toolVersions: { node: 'test' },
    },
    command: { executable: 'node', argv: [] },
    startedAt: '2026-10-05T06:00:00.000Z',
    finishedAt: '2026-10-05T06:00:01.000Z',
    result: 'harness-blocked',
    exitCode: 2,
    childExitCode: null,
    assertions: [],
    timingsMs: { build: 0, install: 0, reset: 0, scenario: 0, verify: 0, cleanup: 0 },
    cleanup: { status: 'not-acquired', ownedResourceIds: [], recoveryRecordPath: null },
    artifacts: [],
    blocker: {
      code: 'runtime-source-only',
      detail: 'source-only bridge fixture',
      owner: 'test',
      nextAction: 'retain source-only status',
    },
  };
}

void test('outer bridge rereads the exact public receipt and rejects private adapter JSON', async () => {
  const root = await mkdtemp('/private/tmp/t15-android-public-bridge-');
  await chmod(root, 0o700);
  try {
    const bytes = `${JSON.stringify(receipt(), null, 2)}\n`;
    await writeFile(path.join(root, 'receipt.json'), bytes, { mode: 0o600 });
    const result = readAndroidDetoxSessionOuterPublicReceipt({
      outputRoot: root,
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      selection,
      runtimeTarget: {
        deviceId: null,
        osVersion: null,
        appId: null,
        buildProfile: null,
        binaryHash: null,
        apiOrigin: null,
      },
      expectedFixtureHash: null,
      expectedFlagsHash: null,
      expectedToolVersions: { node: 'test' },
    });
    assert.equal(result.receipt.path, path.join(root, 'receipt.json'));
    assert.equal(result.receipt.artifactRoot, root);
    assert.equal(result.receipt.terminalPublicationBinding, null);
    assert.match(result.receipt.receiptHash, /^[a-f0-9]{64}$/u);

    await writeFile(
      path.join(root, 'receipt.json'),
      `${JSON.stringify({ kind: 'private-android-detox-session-public-adapter-not-public-receipt' })}\n`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        readAndroidDetoxSessionOuterPublicReceipt({
          outputRoot: root,
          requestedRunId: runId,
          requestedAttemptId: attemptId,
          selection,
          runtimeTarget: {
            deviceId: null,
            osVersion: null,
            appId: null,
            buildProfile: null,
            binaryHash: null,
            apiOrigin: null,
          },
          expectedFixtureHash: null,
          expectedFlagsHash: null,
          expectedToolVersions: { node: 'test' },
        }),
      /Invalid public-receipt-v1 document/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('shared lifecycle reconciliation reports split Android identities without remapping them', () => {
  const result = reconcileT15AndroidSessionSharedLifecycle({
    status: 'private-candidate',
    identity: {
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      captureRunId: 'd'.repeat(24),
      resourceOwnerRunId: 'e'.repeat(24),
      targetRunId: 'f'.repeat(24),
      backendRunId: '1'.repeat(24),
      backendAttemptId: `${'1'.repeat(24)}:first`,
      fixtureRunId: '1'.repeat(24),
      fixtureResetId: 'fixture-reset',
      target: {},
      backend: {},
      fixture: {},
      originalResetBinding: {},
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.identityMode, 'android-split');
  assert.match(result.blockers.join('\n'), /backend-run-to-equal-resource-owner/);
});

void test('outer candidate gate consumes private ledgers and blocks when the baseline is absent', async () => {
  const root = await mkdtemp('/private/tmp/t15-android-public-bridge-baseline-');
  await chmod(root, 0o700);
  try {
    const result = reconcileT15AndroidDetoxSessionOuterReceipt({
      outputRoot: root,
      requestedRunId: runId,
      requestedAttemptId: attemptId,
      selection,
      runtimeTarget: {
        deviceId: null,
        osVersion: null,
        appId: null,
        buildProfile: null,
        binaryHash: null,
        apiOrigin: null,
      },
      expectedFixtureHash: null,
      expectedFlagsHash: null,
      expectedToolVersions: { node: 'test' },
      runtime: {
        artifactRoot: root,
        captureRunId: 'd'.repeat(24),
        resourceOwnerRunId: 'e'.repeat(24),
        lifecycleNormalization: { status: 'blocked' },
      } as never,
      candidateReceipt: receipt(),
    });
    assert.equal(result.status, 'blocked');
    assert.equal(result.publicReceipt, null);
    assert.match(result.blockers.join('\n'), /outer-public-receipt-not-published/);
    assert.match(result.blockers.join('\n'), /baseline-report/);
    assert.equal(result.normalization.status, 'blocked');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

void test('outer terminal blocks an executed child when normalization or public binding is blocked', () => {
  assert.equal(
    shouldBlockAndroidDetoxSessionOuterTerminal({ nativeExecution: true } as never),
    true,
  );
  assert.equal(
    shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: true,
      lifecycleNormalization: { status: 'blocked' },
      publicReceiptBound: false,
      sharedLifecycleStatus: 'blocked',
    }),
    true,
  );
  assert.equal(
    shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: true,
      lifecycleNormalization: { status: 'private-candidate' },
      publicReceiptBound: true,
      sharedLifecycleStatus: 'sealed-contract-compatible',
    }),
    false,
  );
  assert.equal(
    shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: true,
      lifecycleNormalization: { status: 'private-candidate' },
      publicReceiptBound: true,
      sharedLifecycleStatus: 'blocked',
    }),
    true,
  );
  assert.equal(
    shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: true,
      lifecycleNormalization: { status: 'private-candidate' },
      publicReceiptBound: false,
      sharedLifecycleStatus: 'sealed-contract-compatible',
    }),
    true,
  );
  assert.equal(
    shouldBlockAndroidDetoxSessionOuterTerminal({
      nativeExecution: true,
      lifecycleNormalization: { status: 'blocked' },
      publicReceiptBound: true,
      sharedLifecycleStatus: 'sealed-contract-compatible',
    }),
    true,
  );
});

void test('a blocked protected reread rewrites a provisional pass into a durable blocked row', () => {
  const outer = {
    result: 'passed',
    exitCode: 0,
    assertions: [{ id: 'NAT-session-login' }],
    blocker: null,
  };
  const changed = blockAndroidDetoxSessionOuterReceiptForBridgeFailure(outer, {
    status: 'blocked',
    publicReceipt: null,
    normalization: { status: 'blocked' } as never,
    sharedLifecycle: { status: 'blocked' } as never,
    blockers: ['outer-public-receipt-not-published'],
  });
  assert.equal(changed, true);
  assert.equal(outer.result, 'harness-blocked');
  assert.equal(outer.exitCode, 2);
  assert.deepEqual(outer.assertions, []);
  assert.equal(
    (outer.blocker as unknown as { code: string }).code,
    'android-detox-session-outer-receipt-unverified',
  );
});

void test('only a qualified published reread promotes the explicit provisional row', () => {
  const outer = {
    result: 'harness-blocked',
    exitCode: 2,
    assertions: [{ id: 'NAT-session-login' }],
    blocker: {
      code: 'android-detox-session-outer-receipt-pending',
    },
  };
  const promoted = promoteAndroidDetoxSessionOuterReceiptAfterBridge(outer, {
    status: 'normalized',
    publicReceipt: {} as never,
    normalization: { status: 'private-candidate' } as never,
    sharedLifecycle: { status: 'sealed-contract-compatible' } as never,
    blockers: [],
  });
  assert.equal(promoted, true);
  assert.equal(outer.result, 'passed');
  assert.equal(outer.exitCode, 0);
  assert.deepEqual(outer.assertions, [{ id: 'NAT-session-login' }]);
  assert.equal(outer.blocker, null);
});
