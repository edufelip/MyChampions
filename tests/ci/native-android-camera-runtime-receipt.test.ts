import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { verifyAndroidCameraRuntimeEligibility } from '../../scripts/testing/native-android-camera-runtime-eligibility';
import {
  finalizeAndroidCameraNativeRuntime,
  FINALIZER_RECEIPT_PATH,
  publishAndroidCameraNativeRuntimeFinalizerReceipt,
} from '../../scripts/testing/native-android-camera-runtime-finalizer';
import { writeAndroidCameraNativeRuntimeReceipt } from '../../scripts/testing/native-android-camera-runtime-receipt';
import { createAndroidCameraEligibilityFixture } from '../dependencies/android-camera-runtime-eligibility-fixture';
import type { AndroidCameraNativeRuntimeDriverResult } from '../../scripts/testing/native-android-camera-runtime-driver';

function digest(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

const OUTER_RUN_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

async function bindOuterAttempt(
  fixture: Awaited<ReturnType<typeof createAndroidCameraEligibilityFixture>>,
): Promise<void> {
  const outputRoot = `${fixture.outputParent}/${OUTER_RUN_ID}`;
  await rename(fixture.outputRoot, outputRoot);
  fixture.outputRoot = outputRoot;
}

async function driverFor(
  fixture: Awaited<ReturnType<typeof createAndroidCameraEligibilityFixture>>,
  deadlineAt: number,
): Promise<AndroidCameraNativeRuntimeDriverResult> {
  const reportBytes = await readFile(`${fixture.captureRoot}/capture.private.json`);
  const report = JSON.parse(reportBytes.toString('utf8')) as Record<string, unknown>;
  const source = report.source as Record<string, unknown>;
  const helperInputs = report.helperInputsBefore as readonly {
    path: string;
    sha256: string;
  }[];
  return {
    kind: 'private-owned-android-camera-native-runtime-driver-result-not-public-receipt',
    status: 'native-observed',
    platform: 'android',
    engine: 'maestro',
    requestedRunId: OUTER_RUN_ID,
    requestedAttemptId: `${OUTER_RUN_ID}:first`,
    captureRunId: fixture.producer.captureRunId,
    fixtureRunId: fixture.producer.identity.backendRunId,
    ownerRunId: fixture.producer.identity.ownerRunId,
    target: fixture.target,
    process: {
      apiPid: fixture.producer.identity.apiPid,
      pgid: fixture.producer.identity.apiPid,
      apiStarted: fixture.producer.identity.apiStarted,
      apiOrigin: fixture.producer.identity.apiOrigin,
      ownerRunId: fixture.producer.identity.ownerRunId,
      targetDeviceId: fixture.producer.identity.serial,
    },
    acquisition: {
      status: 'acquired',
      result: 'observed',
      cleanup: 'cleaned',
      externalCleanup: 'passed',
      commandDiagnostics: [
        {
          label: 'android-camera-native-session',
          pid: fixture.producer.identity.apiPid,
          pgid: fixture.producer.identity.apiPid,
          startedAt: fixture.producer.identity.apiStarted,
          execution: 'completed',
          cleanup: 'cleaned',
        },
      ],
    },
    sourceTreeHash: source.sourceTreeHash as string,
    helperInputs,
    captureReport: {
      path: 'capture.private.json',
      sha256: digest(reportBytes),
    },
    frames: fixture.producer.frames.map((frame) => ({
      label: frame.label,
      path: frame.path,
      sha256: frame.sha256,
      sizeBytes: frame.sizeBytes,
      invocationId: frame.action.invocationId,
      ordinal: frame.action.ordinal,
      commandOrdinal: frame.action.commandOrdinal,
      commandLabel: frame.action.commandLabel,
    })),
    sqlParents: fixture.producer.sqlReceipts.map((receipt) => ({
      parentRoot: receipt.parentSnapshotRoot,
      parentManifestPath: receipt.parentManifestPath,
      parentManifestRetainedPath: receipt.parentManifestRetainedPath,
      parentManifestRetainedKind: receipt.parentManifestRetainedKind,
      parentManifestRetainedSha256: receipt.parentManifestRetainedSha256,
      parentManifestRetainedSizeBytes: receipt.parentManifestRetainedSizeBytes,
      parentManifestRetainedOwnerUid: receipt.parentManifestRetainedOwnerUid,
      parentManifestRetainedMode: receipt.parentManifestRetainedMode,
      parentManifestRetainedVerification: receipt.parentManifestRetainedVerification,
      parentManifestSizeBytes: receipt.parentManifestSizeBytes,
      retainedPath: receipt.parentSnapshotRetainedPath,
      retainedKind: receipt.parentSnapshotRetainedKind,
      retainedSha256: receipt.parentSnapshotRetainedSha256,
      retainedSizeBytes: receipt.parentSnapshotRetainedSizeBytes,
      retainedOwnerUid: receipt.parentSnapshotRetainedOwnerUid,
      retainedMode: receipt.parentSnapshotRetainedMode,
      retainedVerification: receipt.parentSnapshotRetainedVerification,
      parentApiLedgerPath: receipt.parentApiLedgerPath,
      parentApiLedgerRetainedPath: receipt.parentApiLedgerRetainedPath,
      parentApiLedgerRetainedKind: receipt.parentApiLedgerRetainedKind,
      parentApiLedgerRetainedSha256: receipt.parentApiLedgerRetainedSha256,
      parentApiLedgerRetainedSizeBytes: receipt.parentApiLedgerRetainedSizeBytes,
      parentApiLedgerRetainedOwnerUid: receipt.parentApiLedgerRetainedOwnerUid,
      parentApiLedgerRetainedMode: receipt.parentApiLedgerRetainedMode,
      parentApiLedgerRetainedVerification: receipt.parentApiLedgerRetainedVerification,
      parentApiLedgerSizeBytes: receipt.parentApiLedgerSizeBytes,
      path: receipt.parentSnapshotPath,
      sha256: receipt.parentSnapshotSha256,
      runId: receipt.parentRunId,
      attemptId: receipt.parentBackendAttemptId,
      apiOrigin: receipt.parentApiOrigin,
      apiPid: receipt.parentApiPid,
      apiStarted: receipt.parentApiStarted,
      apiScript: receipt.parentApiScript,
      manifestSha256: receipt.parentManifestSha256,
      apiAttempt: receipt.parentApiAttempt,
      apiLedgerSha256: receipt.parentApiLedgerSha256,
    })),
    deadlineAt,
  };
}

void test('Android producer adapter writes a verifier-consumable receipt from actual capture files', async () => {
  const fixture = await createAndroidCameraEligibilityFixture();
  await bindOuterAttempt(fixture);
  const deadlineAt = performance.now() + 120_000;
  const driver = await driverFor(fixture, deadlineAt);
  try {
    const provenance = await writeAndroidCameraNativeRuntimeReceipt({
      artifactRoot: fixture.captureRoot,
      driver,
      producer: fixture.producer,
      selection: fixture.selection,
      deadlineAt,
    });
    assert.deepEqual(provenance, {
      mode: 'native-runtime',
      receiptPath: 'android-camera-native-runtime-receipt.private.json',
      receiptSha256: provenance.receiptSha256,
    });
    const captureBytes = await readFile(`${fixture.captureRoot}/capture.private.json`);
    const capture = JSON.parse(captureBytes.toString('utf8')) as Record<string, unknown>;
    const receiptBytes = await readFile(`${fixture.captureRoot}/${provenance.receiptPath}`);
    const receipt = JSON.parse(receiptBytes.toString('utf8')) as Record<string, unknown>;
    assert.equal(receipt.captureRunId, fixture.producer.captureRunId);
    assert.equal(receipt.ownerRunId, fixture.producer.identity.ownerRunId);
    assert.equal(
      receipt.sourceTreeHash,
      (capture.source as Record<string, unknown>).sourceTreeHash,
    );
    assert.deepEqual(receipt.helperInputs, capture.helperInputsBefore);
    assert(Array.isArray(receipt.frameActions));
    assert.equal(receipt.frameActions.length, fixture.producer.frames.length);
    assert(Array.isArray(receipt.sqlParents));
    assert.equal(receipt.sqlParents.length, fixture.producer.sqlReceipts.length);
    await rm(fixture.parentParent, { recursive: true, force: true });
    const verified = await verifyAndroidCameraRuntimeEligibility({
      repositoryRoot: process.cwd(),
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      requestedRunId: OUTER_RUN_ID,
      requestedAttemptId: `${OUTER_RUN_ID}:first`,
      captureRunId: fixture.producer.captureRunId,
      fixtureRunId: fixture.producer.identity.backendRunId,
      selection: fixture.selection,
      target: fixture.target,
      expectedLocale: 'en-US',
      runtime: null,
      nativeDriver: driver,
      producer: fixture.producer,
      deadlineAt,
      runtimeProvenance: provenance,
    });
    assert.equal(verified.verificationMode, 'native-runtime');
    assert.equal(verified.nativePassingCases, 4);
    assert.equal(verified.publicPassingCases, 0);
    assert.equal(verified.publicPromotionEligible, false);
    assert.equal(verified.assertionBindings.length, 4);

    const publishedFinalizer = await publishAndroidCameraNativeRuntimeFinalizerReceipt({
      repositoryRoot: process.cwd(),
      eligibility: verified,
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      deadlineAt,
    });
    assert.equal(publishedFinalizer.path, FINALIZER_RECEIPT_PATH);
    const finalizerReceipt = publishedFinalizer.receipt;
    const finalized = await finalizeAndroidCameraNativeRuntime({
      repositoryRoot: process.cwd(),
      eligibility: verified,
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      deadlineAt,
    });
    assert.equal(finalized.publicPassingCases, 4);
    assert.equal(finalized.publicPromotionEligible, true);
    assert.equal(finalized.status, 'validated-native-finalizer');
    const tamperedFinalizer = {
      ...finalizerReceipt,
      stageManifest: {
        ...finalizerReceipt.stageManifest,
        sha256: 'f'.repeat(64),
      },
    };
    await writeFile(
      `${fixture.outputRoot}/${FINALIZER_RECEIPT_PATH}`,
      JSON.stringify(tamperedFinalizer) + '\n',
    );
    await assert.rejects(
      finalizeAndroidCameraNativeRuntime({
        repositoryRoot: process.cwd(),
        eligibility: verified,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        deadlineAt,
      }),
      /stage manifest hash differs|Expected values|stage manifest/,
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.parentParent, { recursive: true, force: true });
    await rm(fixture.outputParent, { recursive: true, force: true });
  }
});

void test('Android producer adapter refuses an invalid native driver before creating runtime provenance', async () => {
  const fixture = await createAndroidCameraEligibilityFixture();
  await bindOuterAttempt(fixture);
  const driver = await driverFor(fixture, performance.now() + 120_000);
  driver.process.apiPid = 1;
  try {
    await assert.rejects(
      writeAndroidCameraNativeRuntimeReceipt({
        artifactRoot: fixture.captureRoot,
        driver,
        producer: fixture.producer,
        selection: fixture.selection,
        deadlineAt: performance.now() + 120_000,
      }),
      /PID|invalid|native driver|Expected values/,
    );
    await assert.rejects(
      stat(`${fixture.captureRoot}/android-camera-native-runtime-receipt.private.json`),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.parentParent, { recursive: true, force: true });
    await rm(fixture.outputParent, { recursive: true, force: true });
  }
});
