import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import {
  verifyAndroidCameraRuntimeEligibility,
  type AndroidCameraRuntimeEligibilityResult,
} from '../../scripts/testing/native-android-camera-runtime-eligibility';
import {
  finalizeAndroidCameraNativeRuntime,
  publishAndroidCameraNativeRuntimeFinalizerReceipt,
  type NativeFinalizerStageFile,
} from '../../scripts/testing/native-android-camera-runtime-finalizer';
import { writeAndroidCameraNativeRuntimeReceipt } from '../../scripts/testing/native-android-camera-runtime-receipt';
import { createAndroidCameraEligibilityFixture } from '../dependencies/android-camera-runtime-eligibility-fixture';
import type { AndroidCameraNativeRuntimeDriverResult } from '../../scripts/testing/native-android-camera-runtime-driver';
import type { AndroidCameraProducerReceipts } from '../../scripts/testing/native-camera-android-producer';
import type {
  NativePilotSelection,
  NativePilotTarget,
} from '../../scripts/testing/native-pilot-contract';

type Fixture = {
  captureParent: string;
  captureRoot: string;
  parentParent: string;
  outputParent: string;
  outputRoot: string;
  selection: NativePilotSelection;
  producer: AndroidCameraProducerReceipts;
  target: NativePilotTarget;
};

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

const OUTER_RUN_ID = 'eeeeeeeeeeeeeeeeeeeeeeee';

async function bindOuterAttempt(fixture: Fixture): Promise<void> {
  const outputRoot = `${fixture.outputParent}/${OUTER_RUN_ID}`;
  await rename(fixture.outputRoot, outputRoot);
  fixture.outputRoot = outputRoot;
}

async function writeNativeRuntimeProvenance(
  fixture: {
    captureRoot: string;
    producer: AndroidCameraProducerReceipts;
    target: NativePilotTarget;
    selection: NativePilotSelection;
  },
  deadlineAt: number,
): Promise<{
  provenance: {
    mode: 'native-runtime';
    receiptPath: string;
    receiptSha256: string;
  };
  driver: AndroidCameraNativeRuntimeDriverResult;
}> {
  const runId = OUTER_RUN_ID;
  const fixtureRunId = fixture.producer.identity.backendRunId;
  const reportBytes = await readFile(path.join(fixture.captureRoot, 'capture.private.json'));
  const report = JSON.parse(reportBytes.toString('utf8')) as Record<string, unknown>;
  const source = report.source as Record<string, unknown>;
  const helperInputs = report.helperInputsBefore as readonly {
    path: string;
    sha256: string;
  }[];
  const driver: AndroidCameraNativeRuntimeDriverResult = {
    kind: 'private-owned-android-camera-native-runtime-driver-result-not-public-receipt',
    status: 'native-observed',
    platform: 'android',
    engine: 'maestro',
    requestedRunId: runId,
    requestedAttemptId: `${runId}:first`,
    captureRunId: fixture.producer.captureRunId,
    fixtureRunId,
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
      sha256: sha256(reportBytes),
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
    sqlParents: fixture.producer.sqlReceipts.map((row) => ({
      parentRoot: row.parentSnapshotRoot,
      parentManifestPath: row.parentManifestPath,
      parentManifestRetainedPath: row.parentManifestRetainedPath,
      parentManifestRetainedKind: row.parentManifestRetainedKind,
      parentManifestRetainedSha256: row.parentManifestRetainedSha256,
      parentManifestRetainedSizeBytes: row.parentManifestRetainedSizeBytes,
      parentManifestRetainedOwnerUid: row.parentManifestRetainedOwnerUid,
      parentManifestRetainedMode: row.parentManifestRetainedMode,
      parentManifestRetainedVerification: row.parentManifestRetainedVerification,
      parentManifestSizeBytes: row.parentManifestSizeBytes,
      retainedPath: row.parentSnapshotRetainedPath,
      retainedKind: row.parentSnapshotRetainedKind,
      retainedSha256: row.parentSnapshotRetainedSha256,
      retainedSizeBytes: row.parentSnapshotRetainedSizeBytes,
      retainedOwnerUid: row.parentSnapshotRetainedOwnerUid,
      retainedMode: row.parentSnapshotRetainedMode,
      retainedVerification: row.parentSnapshotRetainedVerification,
      parentApiLedgerPath: row.parentApiLedgerPath,
      parentApiLedgerRetainedPath: row.parentApiLedgerRetainedPath,
      parentApiLedgerRetainedKind: row.parentApiLedgerRetainedKind,
      parentApiLedgerRetainedSha256: row.parentApiLedgerRetainedSha256,
      parentApiLedgerRetainedSizeBytes: row.parentApiLedgerRetainedSizeBytes,
      parentApiLedgerRetainedOwnerUid: row.parentApiLedgerRetainedOwnerUid,
      parentApiLedgerRetainedMode: row.parentApiLedgerRetainedMode,
      parentApiLedgerRetainedVerification: row.parentApiLedgerRetainedVerification,
      parentApiLedgerSizeBytes: row.parentApiLedgerSizeBytes,
      path: row.parentSnapshotPath,
      sha256: row.parentSnapshotSha256,
      runId: row.parentRunId,
      attemptId: row.parentBackendAttemptId,
      apiOrigin: row.parentApiOrigin,
      apiPid: row.parentApiPid,
      apiStarted: row.parentApiStarted,
      apiScript: row.parentApiScript,
      manifestSha256: row.parentManifestSha256,
      apiAttempt: row.parentApiAttempt,
      apiLedgerSha256: row.parentApiLedgerSha256,
    })),
    deadlineAt,
  };
  const provenance = await writeAndroidCameraNativeRuntimeReceipt({
    artifactRoot: fixture.captureRoot,
    driver,
    producer: fixture.producer,
    selection: fixture.selection,
    deadlineAt,
  });
  return { provenance, driver };
}

async function nativeEligibility(fixture: Fixture): Promise<{
  eligibility: AndroidCameraRuntimeEligibilityResult;
  deadlineAt: number;
}> {
  const deadlineAt = performance.now() + 300_000;
  const { provenance, driver } = await writeNativeRuntimeProvenance(fixture, deadlineAt);
  await rm(fixture.parentParent, { recursive: true, force: true });
  const eligibility = await verifyAndroidCameraRuntimeEligibility({
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
  assert.equal(eligibility.nativePassingCases, 4);
  assert.equal(eligibility.publicPassingCases, 0);
  assert.equal(eligibility.publicPromotionEligible, false);
  return { eligibility, deadlineAt };
}

async function withFixture(
  callback: (
    fixture: Fixture,
    eligibility: AndroidCameraRuntimeEligibilityResult,
    deadlineAt: number,
  ) => Promise<void>,
): Promise<void> {
  const fixture = await createAndroidCameraEligibilityFixture();
  try {
    await bindOuterAttempt(fixture);
    const { eligibility, deadlineAt } = await nativeEligibility(fixture);
    await callback(fixture, eligibility, deadlineAt);
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.outputParent, { recursive: true, force: true });
    await rm(fixture.parentParent, { recursive: true, force: true });
  }
}

async function publish(
  fixture: Fixture,
  eligibility: AndroidCameraRuntimeEligibilityResult,
  deadlineAt: number,
): Promise<void> {
  await publishAndroidCameraNativeRuntimeFinalizerReceipt({
    repositoryRoot: process.cwd(),
    eligibility,
    captureRoot: fixture.captureRoot,
    outputRoot: fixture.outputRoot,
    deadlineAt,
  });
}

async function rewriteManifest(
  fixture: Fixture,
  eligibility: AndroidCameraRuntimeEligibilityResult,
  files: readonly NativeFinalizerStageFile[],
): Promise<AndroidCameraRuntimeEligibilityResult> {
  const manifestPath = path.join(fixture.outputRoot, eligibility.stage.copyManifest.path);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  manifest.files = files;
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await writeFile(manifestPath, bytes);
  return {
    ...eligibility,
    stage: {
      ...eligibility.stage,
      copyManifest: {
        ...eligibility.stage.copyManifest,
        sha256: sha256(bytes),
      },
    },
  };
}

async function manifestFiles(
  fixture: Fixture,
  eligibility: AndroidCameraRuntimeEligibilityResult,
): Promise<NativeFinalizerStageFile[]> {
  const manifestPath = path.join(fixture.outputRoot, eligibility.stage.copyManifest.path);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
    files: NativeFinalizerStageFile[];
  };
  return manifest.files;
}

void test('V32 native finalizer closes the full canonical producer graph', async () => {
  await withFixture(async (fixture, eligibility, deadlineAt) => {
    await publish(fixture, eligibility, deadlineAt);
    const result = await finalizeAndroidCameraNativeRuntime({
      repositoryRoot: process.cwd(),
      eligibility,
      captureRoot: fixture.captureRoot,
      outputRoot: fixture.outputRoot,
      deadlineAt,
    });
    assert.equal(result.nativePassingCases, 4);
    assert.equal(result.publicPassingCases, 4);
    assert.equal(result.publicPromotionEligible, true);
  });
});

void test('V32 native finalizer rejects a missing non-SQL canonical artifact', async () => {
  await withFixture(async (fixture, eligibility, deadlineAt) => {
    await publish(fixture, eligibility, deadlineAt);
    const files = await manifestFiles(fixture, eligibility);
    const mutated = await rewriteManifest(
      fixture,
      eligibility,
      files.filter((file) => file.path !== 'external-cleanup.private.json'),
    );
    await assert.rejects(
      finalizeAndroidCameraNativeRuntime({
        repositoryRoot: process.cwd(),
        eligibility: mutated,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        deadlineAt,
      }),
      /artifact set|omits canonical artifact|canonical source graph/i,
    );
  });
});

void test('V32 native finalizer rejects an arbitrary non-reserved extra artifact', async () => {
  await withFixture(async (fixture, eligibility, deadlineAt) => {
    await publish(fixture, eligibility, deadlineAt);
    const files = await manifestFiles(fixture, eligibility);
    const first = files[0];
    assert(first);
    const mutated = await rewriteManifest(fixture, eligibility, [
      ...files,
      { ...first, path: 'arbitrary-private-extra.json' },
    ]);
    await assert.rejects(
      finalizeAndroidCameraNativeRuntime({
        repositoryRoot: process.cwd(),
        eligibility: mutated,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        deadlineAt,
      }),
      /artifact set|unrecognized artifact|canonical source graph/i,
    );
  });
});

void test('V32 native finalizer rejects an actual duplicate staged path', async () => {
  await withFixture(async (fixture, eligibility, deadlineAt) => {
    await publish(fixture, eligibility, deadlineAt);
    const files = await manifestFiles(fixture, eligibility);
    const first = files[0];
    assert(first);
    const mutated = await rewriteManifest(fixture, eligibility, [...files, { ...first }]);
    await assert.rejects(
      finalizeAndroidCameraNativeRuntime({
        repositoryRoot: process.cwd(),
        eligibility: mutated,
        captureRoot: fixture.captureRoot,
        outputRoot: fixture.outputRoot,
        deadlineAt,
      }),
      /repeats|duplicate/i,
    );
  });
});
