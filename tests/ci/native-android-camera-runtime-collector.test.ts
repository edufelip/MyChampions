import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { collectAndVerifyAndroidCameraNativeRuntime } from '../../scripts/testing/native-android-camera-runtime-collector';
import {
  androidCameraExpectedAppLabel,
  androidCameraSelectionHash,
} from '../../scripts/testing/native-camera-android-contract';
import {
  loadAndroidCameraSavedFlow,
  type AndroidCameraSavedFlow,
} from '../../scripts/testing/native-camera-android-saved-flow';
import {
  runAndroidCameraPublicAttempt,
  type AndroidCameraPublicSessionRunner,
} from '../../scripts/testing/run-android-camera-public-attempt';
import { createAndroidCameraEligibilityFixture } from '../dependencies/android-camera-runtime-eligibility-fixture';
import type { OwnedAndroidNativeSessionResult } from '../../scripts/testing/capture-android-testability';
import type { AndroidCameraCaptureBoundary } from '../../scripts/testing/native-camera-android-capture-adapter';
import type { AndroidCameraAttemptOptionsV4 } from '../../scripts/testing/run-android-camera-attempt';

const REQUESTED_RUN_ID = 'cccccccccccccccccccccccc';

const COMMAND_LABELS = [
  'camera-entry',
  'camera-prompt',
  'camera-denied',
  'camera-manual',
  'camera-pending',
] as const;

type Fixture = Awaited<ReturnType<typeof createAndroidCameraEligibilityFixture>>;

async function publicOutputRoot(fixture: Fixture): Promise<string> {
  const root = `${fixture.outputParent}/${REQUESTED_RUN_ID}`;
  await mkdir(root, { mode: 0o700 });
  return root;
}

async function readReport(fixture: Fixture): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(`${fixture.captureRoot}/capture.private.json`, 'utf8'),
  ) as Record<string, unknown>;
}

async function writeReportAndReceipt(
  fixture: Fixture,
  report: Record<string, unknown>,
): Promise<void> {
  const reportBytes = Buffer.from(`${JSON.stringify(report)}\n`);
  await writeFile(`${fixture.captureRoot}/capture.private.json`, reportBytes, {
    mode: 0o600,
  });
  const receiptPath = `${fixture.captureRoot}/capture-receipt.private.json`;
  const receiptEnvelope = JSON.parse(await readFile(receiptPath, 'utf8')) as Record<
    string,
    unknown
  >;
  const receipt = receiptEnvelope.receipt as Record<string, unknown>;
  receipt.path = 'capture.private.json';
  receipt.sizeBytes = reportBytes.byteLength;
  receipt.sha256 = createHash('sha256').update(reportBytes).digest('hex');
  receipt.ownerUid = process.getuid?.() ?? -1;
  receipt.mode = 0o600;
  await writeFile(receiptPath, `${JSON.stringify(receiptEnvelope)}\n`, {
    mode: 0o600,
  });
}

async function writeActualCommandHistory(fixture: Fixture): Promise<Record<string, unknown>> {
  const report = await readReport(fixture);
  const commandExecutions = [] as Record<string, unknown>[];
  for (const [index, label] of COMMAND_LABELS.entries()) {
    const ownershipPath = `${fixture.captureRoot}/${label}.ownership.json`;
    const logPath = `${fixture.captureRoot}/${label}.private.log`;
    const pid = process.pid;
    const pgid = process.pid;
    const started = new Date(Date.now() + index).toISOString();
    await writeFile(logPath, `owned command ${label}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
    await writeFile(
      ownershipPath,
      `${JSON.stringify({
        kind: 'private worker process ownership',
        pid,
        pgid,
        cleanup: 'cleaned',
        processes: [{ pid, pgid, started, commandHash: 'a'.repeat(64) }],
        leaderExecutions: [{ pid, pgid, started, execution: 'completed' }],
      })}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    // Maestro's screenshot command is an owned binary stdout capture. Keep
    // this discovery row on the exact command-labelled PNG path so the
    // collector exercises the real binary/text distinction.
    const stdoutPath = index === 0 ? `${fixture.captureRoot}/${label}.png` : null;
    commandExecutions.push({
      label,
      phase: 'step',
      execution: 'completed',
      cleanup: 'cleaned',
      childExitCode: 0,
      childSignal: null,
      pid,
      pgid,
      logPath,
      stdoutPath,
      ownershipPath,
      elapsedMs: 1,
      cleanupMs: 1,
      censusFailure: null,
      outputFailure: null,
      deadlineMs: 600_000,
    });
  }
  report.commandExecutions = commandExecutions;
  await writeReportAndReceipt(fixture, report);
  return report;
}

function boundaryFor(
  fixture: Fixture,
  savedFlow: AndroidCameraSavedFlow,
): AndroidCameraCaptureBoundary {
  const producer = fixture.producer;
  return {
    output: fixture.captureRoot,
    fixtures: {} as never,
    selection: fixture.selection,
    // The owned capture always hands the adapter the saved Maestro flow it
    // loaded for this selection; load the same repository flow here.
    savedFlow,
    selectionHash: androidCameraSelectionHash(fixture.selection),
    captureRunId: producer.captureRunId,
    ownerRunId: producer.identity.ownerRunId,
    backendRunId: producer.identity.backendRunId,
    backendAttemptId: producer.identity.backendAttemptId,
    serial: producer.identity.serial,
    appId: producer.identity.appId,
    expectedAppLabel: androidCameraExpectedAppLabel(producer.identity.appId),
    apiOrigin: producer.identity.apiOrigin,
    apiPid: producer.identity.apiPid,
    apiStarted: producer.identity.apiStarted,
    apiScript: producer.identity.apiScript,
    target: fixture.target,
    binaryHash: producer.identity.target.binaryHash,
    buildProfile: producer.identity.target.buildProfile,
    expectedLocale: 'en-US',
    expectedLocaleBinding: producer.identity.locale.binding,
    signal: new AbortController().signal,
    commands: {} as never,
    observe: {} as never,
    frameDescriptors: {} as never,
    localeProperties: {} as never,
    proxy: {} as never,
    snapshots: {} as never,
    readManualCodeReceipt: () =>
      Promise.reject(new Error('controlled collector test does not invoke manual-code reader')),
    readSubmissionBinding: () =>
      Promise.reject(new Error('controlled collector test does not invoke submission reader')),
    prepareStudent: () => Promise.resolve(),
  } as unknown as AndroidCameraCaptureBoundary;
}

function attemptResult(
  options: AndroidCameraAttemptOptionsV4,
  capture: OwnedAndroidNativeSessionResult,
) {
  return {
    kind: 'private-owned-android-camera-v4-attempt' as const,
    status: 'source-only' as const,
    requestedRunId: options.requestedRunId,
    captureRunId: capture.report.captureRunId as string,
    callbackInvocations: 1,
    runtimeQualification: 'Pending' as const,
    publicPromotionEligible: false as const,
    nativePassingCases: 0 as const,
    cleanup: 'cleaned' as const,
    blockedGates: [],
    errorName: null,
    selectionRevalidated: true,
    bridgeInvoked: true,
    producerOutput: 'receipts-bound' as const,
  };
}

function sessionRunnerFor(
  fixture: Fixture,
  report: Record<string, unknown>,
): AndroidCameraPublicSessionRunner {
  return async (options) => {
    assert(options.executeCamera);
    const savedFlow = await loadAndroidCameraSavedFlow({
      repositoryRoot: process.cwd(),
      selection: fixture.selection,
      deadlineAtMonotonicMs: performance.now() + 60_000,
      signal: options.signal,
    });
    await options.executeCamera(boundaryFor(fixture, savedFlow));
    return { artifactRoot: fixture.captureRoot, exitCode: 0, report };
  };
}

void test('Android camera public callsite composes owned capture, collector, writer, and verifier while staying public-zero', async () => {
  const fixture = await createAndroidCameraEligibilityFixture();
  try {
    const report = await writeActualCommandHistory(fixture);
    const outputRoot = await publicOutputRoot(fixture);
    const controller = new AbortController();
    const outcome = await runAndroidCameraPublicAttempt({
      repositoryRoot: process.cwd(),
      outputRoot,
      requestedRunId: REQUESTED_RUN_ID,
      selection: fixture.selection,
      signal: controller.signal,
      deadlineAt: performance.now() + 120_000,
      deadlines: { buildMs: 120_000, stepMs: 120_000, wholeRunMs: 120_000 },
      expectedLocale: 'en-US',
      requiredSourcePaths: [],
      requiredDeclarationPath: '',
      sessionRunner: sessionRunnerFor(fixture, report),
      attemptRunner: async (options) => {
        assert(options.bridge);
        await options.bridge.run({
          requestedRunId: options.requestedRunId,
          selection: options.selection,
          signal: options.signal,
          executeCamera: () => Promise.resolve(fixture.producer),
        });
        return attemptResult(options, {
          artifactRoot: fixture.captureRoot,
          exitCode: 0,
          report,
        });
      },
    });
    assert.equal(outcome.verificationResult, 'source-only');
    assert.equal(outcome.nativeRuntimeFailure, null);
    assert.equal(outcome.nativeRuntime?.nativePassingCases, 4);
    assert.equal(outcome.nativeRuntime?.publicPassingCases, 0);
    assert.equal(outcome.nativeRuntime?.publicPromotionEligible, false);
    assert.equal(outcome.nativePassingCases, 0);
    assert.equal(outcome.publicPassingCases, 0);
    assert.equal(outcome.publicPromotionEligible, false);
    await stat(`${fixture.captureRoot}/android-camera-native-runtime-receipt.private.json`);
    await stat(
      `${outputRoot}/evidence/${fixture.producer.captureRunId}/copy-manifest.private.json`,
    );
    await stat(`${fixture.captureRoot}/android-camera-runtime-adapter.private.json`);
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.outputParent, { recursive: true, force: true });
  }
});

void test('Android camera collector rejects a command ownership identity mismatch before writing native provenance', async () => {
  const fixture = await createAndroidCameraEligibilityFixture();
  try {
    const report = await writeActualCommandHistory(fixture);
    const outputRoot = await publicOutputRoot(fixture);
    const rows = report.commandExecutions as Record<string, unknown>[];
    rows[0].pid = 1;
    await writeFile(`${fixture.captureRoot}/capture.private.json`, `${JSON.stringify(report)}\n`, {
      mode: 0o600,
    });
    await assert.rejects(
      collectAndVerifyAndroidCameraNativeRuntime({
        capture: { artifactRoot: fixture.captureRoot, exitCode: 0, report },
        producer: fixture.producer,
        repositoryRoot: process.cwd(),
        outputRoot,
        requestedRunId: REQUESTED_RUN_ID,
        requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
        captureRunId: fixture.producer.captureRunId,
        selection: fixture.selection,
        deadlineAt: performance.now() + 120_000,
      }),
      /PID|invalid|ownership/i,
    );
    await assert.rejects(
      stat(`${fixture.captureRoot}/android-camera-native-runtime-receipt.private.json`),
      { code: 'ENOENT' },
    );
  } finally {
    await rm(fixture.captureParent, { recursive: true, force: true });
    await rm(fixture.outputParent, { recursive: true, force: true });
  }
});

void test('Android camera collector keeps log and binary stdout roles command-bound', async () => {
  const cases: readonly {
    name: string;
    expected: RegExp;
    prepare: (fixture: Fixture, row: Record<string, unknown>) => Promise<void> | void;
  }[] = [
    {
      name: 'PNG supplied as log',
      expected: /basename is not command-bound/u,
      prepare: (fixture, row) => {
        row.logPath = `${fixture.captureRoot}/camera-entry.png`;
      },
    },
    {
      name: 'text stdout supplied as log',
      expected: /basename is not command-bound/u,
      prepare: (fixture, row) => {
        row.logPath = `${fixture.captureRoot}/camera-entry.stdout`;
      },
    },
    {
      name: 'private log supplied as stdout',
      expected: /basename is not command-bound/u,
      prepare: (fixture, row) => {
        row.stdoutPath = `${fixture.captureRoot}/camera-entry.private.log`;
      },
    },
    {
      name: 'cross-label PNG supplied as stdout',
      expected: /basename is not command-bound/u,
      prepare: (fixture, row) => {
        row.stdoutPath = `${fixture.captureRoot}/camera-prompt.png`;
      },
    },
    {
      name: 'invalid PNG supplied as stdout',
      expected: /binary stdout is not PNG/u,
      prepare: async (fixture, row) => {
        row.stdoutPath = `${fixture.captureRoot}/camera-entry.png`;
        await writeFile(row.stdoutPath as string, Buffer.from('not a PNG\n'), {
          mode: 0o600,
        });
      },
    },
  ];
  for (const negativeCase of cases) {
    const fixture = await createAndroidCameraEligibilityFixture();
    try {
      const report = await writeActualCommandHistory(fixture);
      const row = (report.commandExecutions as Record<string, unknown>[])[0];
      await negativeCase.prepare(fixture, row);
      await writeReportAndReceipt(fixture, report);
      const outputRoot = await publicOutputRoot(fixture);
      await assert.rejects(
        collectAndVerifyAndroidCameraNativeRuntime({
          capture: { artifactRoot: fixture.captureRoot, exitCode: 0, report },
          producer: fixture.producer,
          repositoryRoot: process.cwd(),
          outputRoot,
          requestedRunId: REQUESTED_RUN_ID,
          requestedAttemptId: `${REQUESTED_RUN_ID}:first`,
          captureRunId: fixture.producer.captureRunId,
          selection: fixture.selection,
          deadlineAt: performance.now() + 120_000,
        }),
        negativeCase.expected,
        negativeCase.name,
      );
      await assert.rejects(
        stat(`${fixture.captureRoot}/android-camera-native-runtime-receipt.private.json`),
        { code: 'ENOENT' },
      );
    } finally {
      await rm(fixture.captureParent, { recursive: true, force: true });
      await rm(fixture.outputParent, { recursive: true, force: true });
    }
  }
});
