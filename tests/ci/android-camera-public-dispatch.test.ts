import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import {
  AndroidCameraAnchoredOperationError,
  AndroidCameraPublicStageError,
  androidCameraPublicStageMustRemainBlocked,
  removeAndroidCameraAnchoredDirectory,
  removeAndroidCameraAnchoredFile,
  stageAndroidCameraPublicEvidence,
  writeAndroidCameraAnchoredFile,
} from '../../scripts/testing/native-android-camera-public-staging';
import {
  ANDROID_CAMERA_ASSERTION_IDS,
  androidCameraSelectionHash,
} from '../../scripts/testing/native-camera-android-contract';
import {
  selectNativePilotScenario,
  type NativePilotSelection,
} from '../../scripts/testing/native-pilot-contract';
import {
  finalizeAndroidCameraPublicEvidence,
  type AndroidCameraPublicAttemptResult,
} from '../../scripts/testing/run-android-camera-public-attempt';
import {
  androidCameraPublicExecutionAdapter,
  androidCameraPublicRequiredDeclarationPath,
  androidCameraPublicRequiredSourcePaths,
  createAndroidCameraOwnedSessionBridge,
  isAndroidCameraPublicArguments,
  runAndroidCameraPublicAttempt,
} from '../../scripts/testing/run-android-camera-public-attempt';
import { createAndroidCameraEligibilityFixture } from '../dependencies/android-camera-runtime-eligibility-fixture';
import type { AndroidCameraProducerReceipts } from '../../scripts/testing/native-camera-android-producer';
import type { AndroidCameraAttemptResultV4 } from '../../scripts/testing/run-android-camera-attempt';

const testRootOverride: unknown = process.env.MYCHAMPIONS_CAMERA_TEST_ROOT;
const ROOT = typeof testRootOverride === 'string' ? testRootOverride : process.cwd();
const RUN_ID = '0123456789abcdef01234567';

async function currentInventory(): Promise<unknown> {
  return JSON.parse(
    await readFile(path.join(ROOT, 'docs/qa/native-pilot/inventory.json'), 'utf8'),
  ) as unknown;
}

async function selection(): Promise<NativePilotSelection> {
  const inventory = await currentInventory();
  return selectNativePilotScenario(
    {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
    },
    inventory,
    ROOT,
  );
}

/**
 * Deterministic source-fixture selection for staging/abort controls.  The
 * finalizer tests above use `selection()` so its current-inventory recheck is
 * still exercised; these producer fixtures intentionally do not claim a
 * current native qualification.
 */
async function fixtureSelection(): Promise<NativePilotSelection> {
  const inventory = (await currentInventory()) as {
    scenarios?: NativePilotSelection['scenario'][];
  };
  const scenario = inventory.scenarios?.find((row) => row.id === 'SCN-camera-denied-android');
  if (!scenario) throw new Error('Android camera fixture declaration is unavailable');
  return {
    arguments: {
      platform: 'android',
      engine: 'maestro',
      scenario: 'SCN-camera-denied-android',
      mode: 'integration',
    },
    scenario: structuredClone(scenario),
    scenarioHash: 'a'.repeat(64),
    requirementHash: 'b'.repeat(64),
  };
}

async function privateOutput(): Promise<{ parent: string; root: string }> {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'mc-camera-public-')));
  const root = path.join(parent, RUN_ID);
  await mkdir(root, { mode: 0o700 });
  return { parent, root };
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function actualStagingFixture(current: NativePilotSelection): Promise<{
  captureParent: string;
  captureRoot: string;
  output: { parent: string; root: string };
  producer: AndroidCameraProducerReceipts;
  fixtureRunId: string;
}> {
  const fixture = await createAndroidCameraEligibilityFixture();
  const sourceSelectionHash = androidCameraSelectionHash(current);
  fixture.producer.sourceSelectionHash = sourceSelectionHash;
  const reportPath = path.join(fixture.captureRoot, 'capture.private.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
  const producerReport = report.androidCameraProducer as Record<string, unknown>;
  producerReport.sourceSelectionHash = sourceSelectionHash;
  const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
  await writeFile(reportPath, reportBytes, { mode: 0o600 });
  const receiptPath = path.join(fixture.captureRoot, 'capture-receipt.private.json');
  const receiptEnvelope = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const receipt = receiptEnvelope.receipt as Record<string, unknown>;
  receipt.sizeBytes = reportBytes.byteLength;
  receipt.sha256 = sha256(reportBytes);
  await writeFile(receiptPath, `${JSON.stringify(receiptEnvelope)}\n`, {
    mode: 0o600,
  });
  return {
    captureParent: fixture.captureParent,
    captureRoot: fixture.captureRoot,
    output: { parent: fixture.outputParent, root: fixture.outputRoot },
    producer: fixture.producer,
    fixtureRunId: fixture.producer.identity.backendRunId,
  };
}

function blockedAttempt(): AndroidCameraAttemptResultV4 {
  return {
    kind: 'private-owned-android-camera-v4-attempt',
    status: 'harness-blocked',
    requestedRunId: RUN_ID,
    captureRunId: null,
    callbackInvocations: 0,
    runtimeQualification: 'Pending',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    cleanup: 'not-acquired',
    blockedGates: [],
    errorName: 'AndroidCameraProducerUnavailable',
    selectionRevalidated: true,
    bridgeInvoked: false,
    producerOutput: 'not-run',
  };
}

function completeRuntime(): AndroidCameraPublicAttemptResult {
  return {
    kind: 'private-owned-android-camera-public-attempt-not-public-receipt',
    requestedRunId: RUN_ID,
    requestedAttemptId: `${RUN_ID}:first`,
    captureRunId: RUN_ID,
    backendRunId: RUN_ID,
    backendAttemptId: `${RUN_ID}:first`,
    captureExitCode: 0,
    childExitCode: 0,
    childSignal: null,
    childClassification: 'completed',
    captureResult: 'observed',
    captureCleanup: 'cleaned',
    captureTimeout: null,
    cancellation: null,
    callbackInvocations: 1,
    callbackCompleted: true,
    captureInvocation: {
      count: 1,
      returned: true,
      exitCode: 0,
      result: 'observed',
    },
    captureCompleted: true,
    externalCleanupResult: 'passed',
    verificationResult: 'source-only',
    verificationFailure: null,
    postCaptureFailure: null,
    deadline: null,
    commandDiagnostics: [
      {
        label: 'android-camera-source-fixture',
        phase: 'step',
        execution: 'completed',
        cleanup: 'cleaned',
        deadlineMs: 1_000,
      },
    ] as never,
    censusFailures: [],
    outputFailures: [],
    assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
    assertionContractSha256: null,
    fixtureRunId: RUN_ID,
    fixtureHash: null,
    flagsHash: null,
    toolVersions: {},
    timingsMs: {
      build: 0,
      install: 0,
      reset: 0,
      scenario: 0,
      verify: 0,
      cleanup: 0,
    },
    stagedManifestPath: null,
    nativePassingCases: 0,
    publicPassingCases: 0,
    publicPromotionEligible: false,
    artifactRoot: '/private/capture',
    cameraProducer: { identity: { backendRunId: RUN_ID } } as never,
    nativeRuntime: null,
    nativeRuntimeFailure: null,
    nativeRuntimeEligibility: null,
    nativeRuntimeFinalizerReceipt: null,
  };
}

void test('Android public adapter selects only the exact Maestro camera cell', () => {
  const cameraSelection = {
    arguments: {
      platform: 'android' as const,
      engine: 'maestro' as const,
      scenario: 'SCN-camera-denied-android',
      mode: 'integration' as const,
    },
  } as NativePilotSelection;
  assert.equal(isAndroidCameraPublicArguments(cameraSelection.arguments), true);
  assert.equal(androidCameraPublicExecutionAdapter(cameraSelection), true);
  assert.equal(
    androidCameraPublicExecutionAdapter({
      ...cameraSelection,
      arguments: {
        ...cameraSelection.arguments,
        platform: 'ios',
        scenario: 'SCN-camera-denied-ios',
      },
    }),
    false,
  );
  assert.equal(
    androidCameraPublicExecutionAdapter({
      ...cameraSelection,
      arguments: { ...cameraSelection.arguments, engine: 'detox' as never },
    }),
    false,
  );
});

void test('Android public declaration guard uses the current four assertion IDs and both public helpers', () => {
  assert.deepEqual(
    [...ANDROID_CAMERA_ASSERTION_IDS],
    [
      'NAT-camera-normal-entry',
      'NAT-camera-denial-guidance',
      'NAT-camera-manual-submit',
      'NAT-camera-unrelated-state',
    ],
  );
  assert.equal(
    androidCameraPublicRequiredDeclarationPath,
    'scripts/testing/run-android-camera-public-attempt.ts',
  );
  assert(
    androidCameraPublicRequiredSourcePaths.includes(androidCameraPublicRequiredDeclarationPath),
  );
  assert(
    androidCameraPublicRequiredSourcePaths.includes(
      'scripts/testing/native-android-camera-public-staging.ts',
    ),
  );
});

void test('Android finalizer calls the Android staging seam and preserves source-only status', async () => {
  const current = await selection();
  const observed: { value: Record<string, unknown> | null } = { value: null };
  const result = await finalizeAndroidCameraPublicEvidence({
    captureRoot: path.join(ROOT, 'capture'),
    outputRoot: path.join(ROOT, 'output'),
    repositoryRoot: ROOT,
    inventory: await currentInventory(),
    requestedRunId: RUN_ID,
    captureRunId: RUN_ID,
    fixtureRunId: RUN_ID,
    selection: current,
    runtime: completeRuntime(),
    stage: (options) => {
      observed.value = options;
      return Promise.resolve({
        copyManifest: {
          path: `evidence/${RUN_ID}/copy-manifest.private.json`,
          sha256: 'a'.repeat(64),
        },
        artifacts: [`evidence/${RUN_ID}/copy-manifest.private.json`],
        assertions: [],
        status: 'validated-source-only',
        assertionIds: [
          'NAT-camera-normal-entry',
          'NAT-camera-denial-guidance',
          'NAT-camera-manual-submit',
          'NAT-camera-unrelated-state',
        ],
        nativePassingCases: 0,
        publicPassingCases: 0,
        publicPromotionEligible: false,
        selectionBinding: {
          arguments: current.arguments,
          scenario: current.scenario,
          scenarioHash: current.scenarioHash,
          requirementHash: current.requirementHash,
          assertionIds: [
            'NAT-camera-normal-entry',
            'NAT-camera-denial-guidance',
            'NAT-camera-manual-submit',
            'NAT-camera-unrelated-state',
          ],
        },
      });
    },
  });
  if (!observed.value) throw new Error('Android staging seam was not called');
  assert.equal(observed.value.captureRunId, RUN_ID);
  assert.equal((observed.value.selection as NativePilotSelection).arguments.platform, 'android');
  assert.equal(result.sourceOnly, true);
  assert.equal(result.publicPromotionEligible, false);
  assert.deepEqual(result.stage.assertions, []);
});

void test('Android finalizer refuses a source-only result without producer receipts', async () => {
  const current = await selection();
  await assert.rejects(
    finalizeAndroidCameraPublicEvidence({
      captureRoot: path.join(ROOT, 'capture'),
      outputRoot: path.join(ROOT, 'output'),
      repositoryRoot: ROOT,
      inventory: await currentInventory(),
      requestedRunId: RUN_ID,
      captureRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      selection: current,
      runtime: { ...completeRuntime(), cameraProducer: null },
      stage: () => Promise.reject(new Error('stager must not run without producer receipts')),
    }),
    /Android camera producer output is missing/,
  );
});

void test('Android finalizer rejects a staging seam that tries to promote native metadata', async () => {
  const current = await selection();
  await assert.rejects(
    finalizeAndroidCameraPublicEvidence({
      captureRoot: path.join(ROOT, 'capture'),
      outputRoot: path.join(ROOT, 'output'),
      repositoryRoot: ROOT,
      inventory: await currentInventory(),
      requestedRunId: RUN_ID,
      captureRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      selection: current,
      runtime: completeRuntime(),
      stage: () =>
        Promise.resolve({
          status: 'native-qualified',
          publicPromotionEligible: true,
          nativePassingCases: 4,
          publicPassingCases: 4,
          assertions: [],
          assertionIds: [...ANDROID_CAMERA_ASSERTION_IDS],
        } as never),
    }),
    /validated-source-only/,
  );
});

void test('bridge binds one owned camera session and rejects missing producer receipts', async () => {
  const current = await fixtureSelection();
  const output = await privateOutput();
  let observed: Record<string, unknown> | null = null;
  let callbackCalled = false;
  const bridge = createAndroidCameraOwnedSessionBridge({
    expectedLocale: 'en-US',
    sessionRunner: (options) => {
      observed = options;
      return Promise.resolve({
        artifactRoot: output.root,
        exitCode: 2,
        report: {
          platform: 'android',
          charter: 'camera-denied',
          result: 'harness-blocked',
        },
      });
    },
  });
  await assert.rejects(
    bridge.run({
      requestedRunId: RUN_ID,
      selection: current,
      signal: new AbortController().signal,
      executeCamera: () => {
        callbackCalled = true;
        return Promise.reject(
          new Error('callback should not be reached by a blocked owned session'),
        );
      },
    }),
    /producer callback did not return receipts/,
  );
  assert.equal(callbackCalled, false);
  const observedAfter = observed as Record<string, unknown> | null;
  assert(observedAfter);
  assert.equal(observedAfter.charter, 'camera-denied');
  assert.equal(observedAfter.expectedLocale, 'en-US');
  assert.deepEqual(observedAfter.selection, current);
  await rm(output.parent, { recursive: true, force: true });
});

void test('aborted bridge stops before the owned session runner', async () => {
  const current = await fixtureSelection();
  const controller = new AbortController();
  controller.abort('SIGTERM');
  let started = false;
  const bridge = createAndroidCameraOwnedSessionBridge({
    expectedLocale: 'en-US',
    sessionRunner: () => {
      started = true;
      return Promise.reject(new Error('owned session must not start after abort'));
    },
  });
  await assert.rejects(
    bridge.run({
      requestedRunId: RUN_ID,
      selection: current,
      signal: controller.signal,
      executeCamera: () => Promise.reject(new Error('camera callback must not run')),
    }),
  );
  assert.equal(started, false);
});

void test('public attempt retains blocked status when the attempt adapter cannot acquire', async () => {
  const current = await fixtureSelection();
  const output = await privateOutput();
  let received: AndroidCameraAttemptResultV4 | null = null;
  const result = await runAndroidCameraPublicAttempt({
    repositoryRoot: ROOT,
    outputRoot: output.root,
    requestedRunId: RUN_ID,
    selection: current,
    signal: new AbortController().signal,
    attemptRunner: (options) => {
      received = blockedAttempt();
      assert.equal(options.requestedRunId, RUN_ID);
      assert.equal(options.requiredDeclarationPath, androidCameraPublicRequiredDeclarationPath);
      assert.deepEqual(options.requiredSourcePaths, androidCameraPublicRequiredSourcePaths);
      assert(options.bridge);
      return Promise.resolve(received);
    },
    sessionRunner: () =>
      Promise.reject(new Error('session runner must not run for injected blocked attempt')),
  });
  assert(received);
  assert.equal(result.verificationResult, 'blocked');
  assert.equal(result.publicPromotionEligible, false);
  assert.equal(result.nativePassingCases, 0);
  assert.equal(result.artifactRoot, output.root);
  await rm(output.parent, { recursive: true, force: true });
});

void test('public attempt classifies an already-aborted adapter without acquisition', async () => {
  const current = await fixtureSelection();
  const output = await privateOutput();
  const controller = new AbortController();
  controller.abort('SIGINT');
  const result = await runAndroidCameraPublicAttempt({
    repositoryRoot: ROOT,
    outputRoot: output.root,
    requestedRunId: RUN_ID,
    selection: current,
    signal: controller.signal,
    attemptRunner: () => Promise.resolve(blockedAttempt()),
    sessionRunner: () =>
      Promise.reject(new Error('session runner must not run for an aborted adapter')),
  });
  assert.equal(result.verificationResult, 'blocked');
  assert.equal(result.captureRunId, null);
  assert.equal(result.externalCleanupResult, 'failed');
  assert.equal(result.publicPromotionEligible, false);
  await rm(output.parent, { recursive: true, force: true });
});

void test('camera stager rejects before reading a missing capture report', async () => {
  const current = await fixtureSelection();
  const output = await privateOutput();
  const captureParent = await mkdtemp(path.join(tmpdir(), 'mc-camera-capture-'));
  const captureRoot = path.join(captureParent, RUN_ID);
  await mkdir(captureRoot, { mode: 0o700 });
  const incompleteProducer = {} as AndroidCameraProducerReceipts;
  await assert.rejects(
    stageAndroidCameraPublicEvidence({
      captureRoot,
      outputRoot: output.root,
      requestedRunId: RUN_ID,
      captureRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      selection: current,
      producer: incompleteProducer,
    }),
  );
  await rm(captureParent, { recursive: true, force: true });
  await rm(output.parent, { recursive: true, force: true });
});

void test('camera stager aborts before creating a private staging directory', async () => {
  const current = await fixtureSelection();
  const output = await privateOutput();
  const controller = new AbortController();
  controller.abort('SIGTERM');
  await assert.rejects(
    stageAndroidCameraPublicEvidence({
      captureRoot: path.join(output.parent, 'missing-capture'),
      outputRoot: output.root,
      requestedRunId: RUN_ID,
      captureRunId: RUN_ID,
      fixtureRunId: RUN_ID,
      selection: current,
      producer: {} as AndroidCameraProducerReceipts,
      signal: controller.signal,
    }),
    /SIGTERM/,
  );
  await rm(output.parent, { recursive: true, force: true });
});

void test('camera stager copies the actual protected bundle and preserves a foreign destination', async () => {
  const current = await fixtureSelection();
  const fixture = await actualStagingFixture(current);
  const collision = await privateOutput();
  const deadlineAt = performance.now() + 120_000;
  try {
    const staged = await stageAndroidCameraPublicEvidence({
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.output.root,
      requestedRunId: RUN_ID,
      captureRunId: RUN_ID,
      fixtureRunId: fixture.fixtureRunId,
      selection: current,
      producer: fixture.producer,
      deadlineAt,
    });
    assert.equal(staged.status, 'validated-source-only');
    assert.equal(staged.publicPromotionEligible, false);
    assert.deepEqual(staged.assertionIds, [...ANDROID_CAMERA_ASSERTION_IDS]);
    assert(staged.artifacts.includes(`evidence/${RUN_ID}/copy-manifest.private.json`));

    await mkdir(path.join(collision.root, 'evidence', RUN_ID), {
      recursive: true,
      mode: 0o700,
    });
    const foreignPath = path.join(collision.root, 'evidence', RUN_ID, 'foreign.txt');
    const foreignBytes = Buffer.from('foreign destination\n');
    await writeFile(foreignPath, foreignBytes, { flag: 'wx', mode: 0o600 });
    await assert.rejects(
      stageAndroidCameraPublicEvidence({
        captureRoot: fixture.captureRoot,
        outputRoot: collision.root,
        requestedRunId: RUN_ID,
        captureRunId: RUN_ID,
        fixtureRunId: fixture.fixtureRunId,
        selection: current,
        producer: fixture.producer,
        deadlineAt,
      }),
      /already exists/,
    );
    assert.deepEqual(await readFile(foreignPath), foreignBytes);
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
    await rm(collision.parent, { recursive: true, force: true });
  }
});

void test('real finalizer retains partial stage ownership after a late abort', async () => {
  const current = await selection();
  const fixture = await actualStagingFixture(current);
  const controller = new AbortController();
  let firstWritten: string | null = null;
  try {
    await assert.rejects(
      finalizeAndroidCameraPublicEvidence({
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.output.root,
        repositoryRoot: ROOT,
        inventory: await currentInventory(),
        requestedRunId: RUN_ID,
        captureRunId: RUN_ID,
        fixtureRunId: fixture.fixtureRunId,
        selection: current,
        runtime: {
          ...completeRuntime(),
          fixtureRunId: fixture.fixtureRunId,
          backendRunId: fixture.fixtureRunId,
          artifactRoot: fixture.captureRoot,
          cameraProducer: fixture.producer,
        },
        signal: controller.signal,
        onStagedFileWritten: (relativePath) => {
          firstWritten = relativePath;
          controller.abort('late-stage-abort');
        },
      }),
      (error: unknown) => {
        assert(error instanceof AndroidCameraPublicStageError);
        assert.equal(error.recoveryStatus, 'failed-recovery-ledger-retained');
        assert(error.recoveryRecordPath);
        assert(error.retainedPaths.length > 0);
        assert(error.recoveryFailures.length > 0);
        return true;
      },
    );
    assert(firstWritten);
    const recoveryPath = path.join(
      fixture.output.root,
      'android-camera-staging-recovery.private.json',
    );
    const recovery = JSON.parse(await readFile(recoveryPath, 'utf8')) as Record<string, unknown>;
    assert.equal(recovery.status, 'blocked-recovery');
    assert.equal(recovery.requestedRunId, RUN_ID);
    assert.equal(recovery.captureRunId, RUN_ID);
    assert(Array.isArray(recovery.remaining));
    assert(!(recovery.remaining as unknown[]).includes(''));
    const firstWrittenPath = firstWritten;
    if (typeof firstWrittenPath !== 'string') throw new Error('first staged path was not recorded');
    const retainedOutputPath = 'evidence/' + RUN_ID + '/' + String(firstWrittenPath);
    assert((recovery.remaining as unknown[]).some((value) => value === retainedOutputPath));
    await assert.doesNotReject(
      lstat(path.join(fixture.output.root, 'evidence', RUN_ID, firstWrittenPath)),
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
  }
});

void test('camera stager rejects an ancestor replacement at the anchored directory boundary', async () => {
  const current = await fixtureSelection();
  const fixture = await actualStagingFixture(current);
  const original = process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
  const parentPath = fixture.output.root;
  const movedParentPath = `${parentPath}.moved`;
  process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT = JSON.stringify({
    current: parentPath,
    moved: movedParentPath,
    replacementMode: 0o755,
  });
  try {
    await assert.rejects(
      stageAndroidCameraPublicEvidence({
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.output.root,
        requestedRunId: RUN_ID,
        captureRunId: RUN_ID,
        fixtureRunId: fixture.fixtureRunId,
        selection: current,
        producer: fixture.producer,
      }),
    );
    assert((await lstat(parentPath)).isDirectory());
    assert.equal((await lstat(parentPath)).mode & 0o777, 0o755);
    assert((await lstat(movedParentPath)).isDirectory());
  } finally {
    if (original === undefined) delete process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
    else process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT = original;
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
  }
});

void test('camera stager retains the moved publication inode on a file-boundary replacement', async () => {
  const current = await fixtureSelection();
  const fixture = await actualStagingFixture(current);
  const stagePath = path.join(fixture.output.root, 'evidence', RUN_ID);
  const movedStagePath = `${stagePath}.moved`;
  const original = process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
  process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT = JSON.stringify({
    current: stagePath,
    moved: movedStagePath,
    replacementMode: 0o755,
  });
  try {
    await assert.rejects(
      stageAndroidCameraPublicEvidence({
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.output.root,
        requestedRunId: RUN_ID,
        captureRunId: RUN_ID,
        fixtureRunId: fixture.fixtureRunId,
        selection: current,
        producer: fixture.producer,
      }),
    );
    assert((await lstat(stagePath)).isDirectory());
    assert.equal((await lstat(stagePath)).mode & 0o777, 0o755);
    assert((await lstat(movedStagePath)).isDirectory());
  } finally {
    if (original === undefined) delete process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
    else process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT = original;
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
  }
});

void test('camera stager leaves the caller cwd unchanged while anchoring mutations', async () => {
  const current = await fixtureSelection();
  const fixture = await actualStagingFixture(current);
  const originalCwd = process.cwd();
  try {
    const staged = await stageAndroidCameraPublicEvidence({
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.output.root,
      requestedRunId: RUN_ID,
      captureRunId: RUN_ID,
      fixtureRunId: fixture.fixtureRunId,
      selection: current,
      producer: fixture.producer,
      // This checks cwd isolation; explicit deadline controls below check time bounds.
      deadlineAt: performance.now() + 120_000,
    });
    assert.equal(staged.status, 'validated-source-only');
    assert.equal(process.cwd(), originalCwd);
  } finally {
    assert.equal(process.cwd(), originalCwd);
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
  }
});

void test('anchored child abort is bounded and leaves recovery evidence instead of publishing', async () => {
  const output = await privateOutput();
  const originalDelay = process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS;
  process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS = '250';
  const controller = new AbortController();
  const target = path.join(output.root, 'aborted.private.json');
  const abortTimer = setTimeout(() => controller.abort('SIGTERM'), 10);
  try {
    await assert.rejects(
      writeAndroidCameraAnchoredFile({
        root: output.root,
        relativePath: 'aborted.private.json',
        bytes: Buffer.from('must not publish\n'),
        signal: controller.signal,
        deadlineAt: performance.now() + 5_000,
      }),
      (error: unknown) => {
        assert(error instanceof AndroidCameraAnchoredOperationError);
        assert.equal(error.command.execution, 'cancelled');
        assert(
          error.command.cleanup === 'cleaned' ||
            error.command.cleanup === 'failed-recovery-ledger-retained',
        );
        assert(error.operationRoot.length > 0);
        return true;
      },
    );
    await assert.rejects(lstat(target), { code: 'ENOENT' });
  } finally {
    clearTimeout(abortTimer);
    if (originalDelay === undefined) delete process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS;
    else process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS = originalDelay;
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored child deadline rejects a slow writer before it can publish', async () => {
  const output = await privateOutput();
  const originalDelay = process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS;
  process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS = '1000';
  const target = path.join(output.root, 'deadline.private.json');
  try {
    await assert.rejects(
      writeAndroidCameraAnchoredFile({
        root: output.root,
        relativePath: 'deadline.private.json',
        bytes: Buffer.from('must not publish\n'),
        deadlineAt: performance.now() + 200,
      }),
      (error: unknown) => {
        assert(error instanceof AndroidCameraAnchoredOperationError);
        assert.equal(error.command.execution, 'deadline');
        assert(
          error.command.cleanup === 'cleaned' ||
            error.command.cleanup === 'failed-recovery-ledger-retained',
        );
        return true;
      },
    );
    await assert.rejects(lstat(target), { code: 'ENOENT' });
  } finally {
    if (originalDelay === undefined) delete process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS;
    else process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS = originalDelay;
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored child bounds a long whole-run deadline to the configured step budget', async () => {
  const output = await privateOutput();
  const target = path.join(output.root, 'long-whole-budget.private.json');
  const bytes = Buffer.from('bounded anchored command\n');
  try {
    const created = await writeAndroidCameraAnchoredFile({
      root: output.root,
      relativePath: 'long-whole-budget.private.json',
      bytes,
      // This exceeds the per-command step cap. It must be retained as the
      // caller-owned absolute upper bound while the child receives a bounded
      // relative step budget.
      deadlineAt: performance.now() + 900_000,
    });
    assert.equal(created.absolutePath, target);
    assert.deepEqual(await readFile(target), bytes);
  } finally {
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored child honors a configured step budget under a long whole-run deadline', async () => {
  const output = await privateOutput();
  const originalStep = process.env.MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS;
  const originalDelay = process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS;
  process.env.MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS = '1000';
  process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS = '1500';
  const target = path.join(output.root, 'configured-step-budget.private.json');
  try {
    await assert.rejects(
      writeAndroidCameraAnchoredFile({
        root: output.root,
        relativePath: 'configured-step-budget.private.json',
        bytes: Buffer.from('must not publish\n'),
        deadlineAt: performance.now() + 600_000,
      }),
      (error: unknown) => {
        assert(error instanceof AndroidCameraAnchoredOperationError);
        assert.equal(error.command.execution, 'deadline');
        return true;
      },
    );
    await assert.rejects(lstat(target), { code: 'ENOENT' });
  } finally {
    if (originalStep === undefined) delete process.env.MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS;
    else process.env.MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS = originalStep;
    if (originalDelay === undefined) delete process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS;
    else process.env.MYCHAMPIONS_CAMERA_TEST_CHILD_DELAY_MS = originalDelay;
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored child refuses an expired caller deadline instead of renewing it', async () => {
  const output = await privateOutput();
  const target = path.join(output.root, 'expired-caller-deadline.private.json');
  try {
    await assert.rejects(
      writeAndroidCameraAnchoredFile({
        root: output.root,
        relativePath: 'expired-caller-deadline.private.json',
        bytes: Buffer.from('must not publish\n'),
        deadlineAt: performance.now() - 1,
      }),
      (error: unknown) => {
        assert(error instanceof AndroidCameraAnchoredOperationError);
        assert.match(error.message, /deadline elapsed before acquisition/u);
        return true;
      },
    );
    await assert.rejects(lstat(target), { code: 'ENOENT' });
  } finally {
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored child rejects non-finite caller deadlines before command acquisition', async () => {
  for (const [label, deadlineAt] of [
    ['positive-infinity', Number.POSITIVE_INFINITY],
    ['not-a-number', Number.NaN],
  ] as const) {
    const output = await privateOutput();
    const target = path.join(output.root, `${label}.private.json`);
    let retainedOperationRoot: string | undefined;
    try {
      await assert.rejects(
        writeAndroidCameraAnchoredFile({
          root: output.root,
          relativePath: `${label}.private.json`,
          bytes: Buffer.from('must not publish\n'),
          deadlineAt,
        }),
        (error: unknown) => {
          assert(error instanceof AndroidCameraAnchoredOperationError);
          assert.match(error.message, /deadline must be finite/u);
          assert.equal(error.command.execution, 'harness-blocked');
          assert.equal(error.command.cleanup, 'unknown');
          assert.equal(error.command.pid, null);
          assert.equal(error.command.pgid, null);
          retainedOperationRoot = error.operationRoot;
          return true;
        },
      );
      await assert.rejects(lstat(target), { code: 'ENOENT' });
      assert(retainedOperationRoot);
      assert.equal((await lstat(retainedOperationRoot)).isDirectory(), true);
    } finally {
      if (retainedOperationRoot) await rm(retainedOperationRoot, { recursive: true, force: true });
      await rm(output.parent, { recursive: true, force: true });
    }
  }
});

void test('anchored child preserves the optional 30-second default at runtime', async () => {
  const output = await privateOutput();
  const bytes = Buffer.from('default deadline anchored command\n');
  const target = path.join(output.root, 'default-deadline.private.json');
  try {
    const created = await writeAndroidCameraAnchoredFile({
      root: output.root,
      relativePath: 'default-deadline.private.json',
      bytes,
      deadlineAt: undefined,
    });
    assert.equal(created.absolutePath, target);
    assert.deepEqual(await readFile(target), bytes);
    assert.equal(
      await removeAndroidCameraAnchoredFile({
        parent: created.parent,
        name: created.name,
        parentIdentity: created.parentIdentity,
        identity: created.identity,
        deadlineAt: undefined,
      }),
      false,
    );
    assert.deepEqual(await readFile(target), bytes);
  } finally {
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored child keeps the short default when its optional caller deadline is absent', async () => {
  const source = await readFile(
    path.resolve(process.cwd(), 'scripts/testing/native-android-camera-public-staging.ts'),
    'utf8',
  );
  assert.match(source, /options\.deadlineAt \?\? performance\.now\(\) \+ 30_000/u);
  assert.doesNotMatch(source, /options\.deadlineAt \?\? performance\.now\(\) \+ 2_400_000/u);
  const finiteGuard = source.indexOf('if (!Number.isFinite(deadlineAt))');
  const commandCall = source.indexOf('executeOwnedNativeCommand({');
  assert(finiteGuard >= 0 && finiteGuard < commandCall);
});

void test('anchored cleanup retains a foreign replacement after the first identity observation', async () => {
  const output = await privateOutput();
  const originalBytes = Buffer.from('owned camera sidecar\n');
  const originalReplacement = process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
  const created = await writeAndroidCameraAnchoredFile({
    root: output.root,
    relativePath: 'cleanup-race.private.json',
    bytes: originalBytes,
  });
  const moved = `${created.absolutePath}.moved`;
  process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT = JSON.stringify({
    current: created.absolutePath,
    moved,
    replacementMode: 0o600,
    kind: 'file',
    when: 'after-remove-identity',
  });
  try {
    assert.equal(
      await removeAndroidCameraAnchoredFile({
        parent: created.parent,
        name: created.name,
        parentIdentity: created.parentIdentity,
        identity: created.identity,
      }),
      false,
    );
    assert.deepEqual(await readFile(created.absolutePath), Buffer.from('foreign camera entry\n'));
    assert.deepEqual(await readFile(moved), originalBytes);
    assert.equal((await lstat(created.absolutePath)).mode & 0o777, 0o600);
    assert.equal((await lstat(moved)).mode & 0o777, 0o600);
  } finally {
    if (originalReplacement === undefined)
      delete process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT;
    else process.env.MYCHAMPIONS_CAMERA_TEST_REPLACE_PARENT = originalReplacement;
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored file and directory cleanup retain uncertain ownership without a final delete syscall', async () => {
  const output = await privateOutput();
  const originalFile = Buffer.from('owned camera sidecar\n');
  const file = await writeAndroidCameraAnchoredFile({
    root: output.root,
    relativePath: 'retained-file.private.json',
    bytes: originalFile,
  });
  const rootInfo = await lstat(output.root);
  const directoryPath = path.join(output.root, 'retained-directory');
  await mkdir(directoryPath, { mode: 0o700 });
  const directoryInfo = await lstat(directoryPath);
  const directoryIdentity = {
    path: directoryPath,
    dev: directoryInfo.dev,
    ino: directoryInfo.ino,
    uid: directoryInfo.uid,
    gid: directoryInfo.gid,
    mode: directoryInfo.mode & 0o777,
    nlink: directoryInfo.nlink,
  };
  const originalSource = await readFile(
    path.resolve(ROOT, 'scripts/testing/native-android-camera-public-staging.ts'),
    'utf8',
  );
  const marker = 'const ANCHORED_OPERATION_SCRIPT = String.raw`';
  const scriptStart = originalSource.indexOf(marker) + marker.length;
  const scriptEnd = originalSource.indexOf('\n`;', scriptStart);
  assert(scriptStart >= marker.length && scriptEnd > scriptStart);
  const script = originalSource.slice(scriptStart, scriptEnd);
  const intercept =
    "const reviewFs=require('node:fs');const reviewFail=(name)=>{process.stderr.write('FINAL_BOUNDARY_INTERCEPTED:'+name+'\\n');throw new Error(name+' must not be called');};reviewFs.unlinkSync=()=>reviewFail('unlinkSync');reviewFs.rmdirSync=()=>reviewFail('rmdirSync');\n";
  const run = (operation: string, childIdentity: unknown, name: string) =>
    spawnSync(
      process.execPath,
      [
        '-e',
        intercept + script,
        JSON.stringify({
          parent: output.root,
          parentIdentity: {
            dev: rootInfo.dev,
            ino: rootInfo.ino,
            uid: rootInfo.uid,
            gid: rootInfo.gid,
            mode: rootInfo.mode & 0o777,
            nlink: rootInfo.nlink,
          },
          name,
          childIdentity,
          operation,
          maxBytes: 64 * 1024,
        }),
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
  try {
    for (const [operation, childIdentity, name] of [
      [
        'remove-file',
        {
          dev: file.identity.dev,
          ino: file.identity.ino,
          uid: file.identity.uid,
          gid: file.identity.gid,
          mode: file.identity.mode,
          nlink: file.identity.nlink,
        },
        file.name,
      ],
      [
        'remove-directory',
        {
          dev: directoryIdentity.dev,
          ino: directoryIdentity.ino,
          uid: directoryIdentity.uid,
          gid: directoryIdentity.gid,
          mode: directoryIdentity.mode,
          nlink: directoryIdentity.nlink,
        },
        path.basename(directoryPath),
      ],
    ] as const) {
      const result = run(operation, childIdentity, name);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      assert.equal(
        result.stdout,
        JSON.stringify({
          removed: false,
          reason: 'conditional-removal-retained',
        }),
      );
    }
    assert.equal(
      await removeAndroidCameraAnchoredFile({
        parent: file.parent,
        name: file.name,
        parentIdentity: file.parentIdentity,
        identity: file.identity,
      }),
      false,
    );
    assert.equal(
      await removeAndroidCameraAnchoredDirectory({
        parent: output.root,
        name: path.basename(directoryPath),
        parentIdentity: {
          path: output.root,
          dev: rootInfo.dev,
          ino: rootInfo.ino,
          uid: rootInfo.uid,
          gid: rootInfo.gid,
          mode: rootInfo.mode & 0o777,
          nlink: rootInfo.nlink,
        },
        identity: directoryIdentity,
      }),
      false,
    );
    assert.deepEqual(await readFile(file.absolutePath), originalFile);
    assert((await lstat(directoryPath)).isDirectory());
    assert.doesNotMatch(originalSource, /fs\.(?:unlinkSync|rmdirSync)\s*\(/u);
  } finally {
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('anchored acquisition rollback retains a file or directory when publication fails', async () => {
  const output = await privateOutput();
  const rootInfo = await lstat(output.root);
  const inputPath = path.join(output.root, 'rollback-input.private.bin');
  await writeFile(inputPath, Buffer.from('rollback payload\n'), {
    flag: 'wx',
    mode: 0o600,
  });
  const source = await readFile(
    path.resolve(ROOT, 'scripts/testing/native-android-camera-public-staging.ts'),
    'utf8',
  );
  const marker = 'const ANCHORED_OPERATION_SCRIPT = String.raw`';
  const scriptStart = source.indexOf(marker) + marker.length;
  const scriptEnd = source.indexOf('\n`;', scriptStart);
  assert(scriptStart >= marker.length && scriptEnd > scriptStart);
  const script = source.slice(scriptStart, scriptEnd);
  const parentIdentity = {
    dev: rootInfo.dev,
    ino: rootInfo.ino,
    uid: rootInfo.uid,
    gid: rootInfo.gid,
    mode: rootInfo.mode & 0o777,
    nlink: rootInfo.nlink,
  };
  const run = (prefix: string, input: Record<string, unknown>) =>
    spawnSync(process.execPath, ['-e', prefix + script, JSON.stringify(input)], {
      encoding: 'utf8',
      timeout: 10_000,
    });
  try {
    const filePath = path.join(output.root, 'rollback-file.private.json');
    const filePrefix =
      "const reviewFs=require('node:fs');reviewFs.fsyncSync=()=>{throw new Error('forced publication failure');};reviewFs.unlinkSync=()=>{process.stderr.write('UNSAFE_ROLLBACK_UNLINK\\n');throw new Error('unlink must not run');};\n";
    const fileResult = run(filePrefix, {
      parent: output.root,
      parentIdentity,
      name: path.basename(filePath),
      operation: 'write-file',
      inputPath,
      maxBytes: 64 * 1024,
    });
    assert.notEqual(fileResult.status, 0);
    assert.doesNotMatch(fileResult.stderr, /UNSAFE_ROLLBACK_UNLINK/u);
    assert((await lstat(filePath)).isFile());

    const directoryPath = path.join(output.root, 'rollback-directory');
    const directoryPrefix =
      "const reviewFs=require('node:fs');const originalLstat=reviewFs.lstatSync;let injected=false;reviewFs.lstatSync=(value,...args)=>{if(!injected && String(value).endsWith('rollback-directory')){injected=true;throw new Error('forced publication failure');}return originalLstat.call(reviewFs,value,...args);};reviewFs.rmdirSync=()=>{process.stderr.write('UNSAFE_ROLLBACK_RMDIR\\n');throw new Error('rmdir must not run');};\n";
    const directoryResult = run(directoryPrefix, {
      parent: output.root,
      parentIdentity,
      name: path.basename(directoryPath),
      operation: 'create-directory',
      maxBytes: 64 * 1024,
    });
    assert.notEqual(directoryResult.status, 0);
    assert.doesNotMatch(directoryResult.stderr, /UNSAFE_ROLLBACK_RMDIR/u);
    assert((await lstat(directoryPath)).isDirectory());
  } finally {
    await rm(output.parent, { recursive: true, force: true });
  }
});

void test('camera stager rejects an incomplete external cleanup census', async () => {
  const current = await fixtureSelection();
  const fixture = await actualStagingFixture(current);
  try {
    const cleanupPath = path.join(fixture.captureRoot, 'external-cleanup.private.json');
    const cleanup = JSON.parse(await readFile(cleanupPath, 'utf8')) as Record<string, unknown>;
    cleanup.survivors = [4321];
    const cleanupBytes = Buffer.from(JSON.stringify(cleanup) + '\n');
    await writeFile(cleanupPath, cleanupBytes);
    const cleanupReceipt = {
      path: 'external-cleanup.private.json',
      kind: 'sidecar',
      verification: 'owned-stable-reader-v6',
      sizeBytes: cleanupBytes.byteLength,
      sha256: sha256(cleanupBytes),
      ownerUid: process.getuid?.() ?? -1,
      mode: 0o600,
    };
    const linkPath = path.join(fixture.captureRoot, 'camera-independent-cleanup-link.private.json');
    const link = JSON.parse(await readFile(linkPath, 'utf8')) as Record<string, unknown>;
    link.cleanupReceipt = cleanupReceipt;
    await writeFile(linkPath, JSON.stringify(link) + '\n');
    const envelopePath = path.join(fixture.captureRoot, 'external-cleanup-receipt.private.json');
    const envelope = JSON.parse(await readFile(envelopePath, 'utf8')) as Record<string, unknown>;
    envelope.receipt = cleanupReceipt;
    await writeFile(envelopePath, JSON.stringify(envelope) + '\n');
    await assert.rejects(
      stageAndroidCameraPublicEvidence({
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.output.root,
        requestedRunId: RUN_ID,
        captureRunId: RUN_ID,
        fixtureRunId: fixture.fixtureRunId,
        selection: current,
        producer: fixture.producer,
      }),
      /process survivors/,
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
  }
});

void test('camera stager rejects an empty transport history instead of accepting metadata only', async () => {
  const current = await fixtureSelection();
  const fixture = await actualStagingFixture(current);
  try {
    await writeFile(path.join(fixture.captureRoot, 'transport-observations.private.json'), '[]\n');
    await assert.rejects(
      stageAndroidCameraPublicEvidence({
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.output.root,
        requestedRunId: RUN_ID,
        captureRunId: RUN_ID,
        fixtureRunId: fixture.fixtureRunId,
        selection: current,
        producer: fixture.producer,
      }),
      /history is empty/,
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.output.parent, { recursive: true, force: true });
  }
});

void test('source-only staging cannot claim a public promotion', () => {
  assert.equal(
    androidCameraPublicStageMustRemainBlocked({
      status: 'validated-source-only',
      publicPromotionEligible: false,
      nativePassingCases: 0,
    }),
    true,
  );
  assert.equal(
    androidCameraPublicStageMustRemainBlocked({
      status: 'native-qualified',
      publicPromotionEligible: true,
      nativePassingCases: 4,
    }),
    false,
  );
});
