import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runOwnedIosNativeSession } from './capture-native-testability';
import { readQualifiedNativeQuantityFailure } from './native-maestro-assertion-failure';
import { requireNativePilotAssertions, selectNativePilotScenario } from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import { writeNativeTrainingAttemptBinding } from './native-training-attempt-binding';
import {
  normalizeNativeCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
  trainingAttemptChildExitCode,
} from './native-training-attempt-outcome';
import { observeIosSavedTrainingJourney } from './native-training-maestro-driver';
import {
  prepareIosTrainingPilotEvidence,
  writeIosTrainingRuntimeFrames,
} from './native-training-pilot-evidence';
import { iosSimulatorBootstatusDeadline } from './owned-ios-simulator';
import { verifyOwnedIosCleanup } from './verify-owned-ios-cleanup';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

const id = /^[a-f0-9]{24}$/;
const commandExecutions = new Set([
  'completed',
  'child-failed',
  'deadline',
  'cancelled',
  'output-limit',
  'output-failed',
  'harness-blocked',
]);
const cleanupStatuses = new Set([
  'not-acquired',
  'cleaned',
  'failed-recovery-ledger-retained',
  'unknown',
]);

type NativeCommandDiagnostic = ReturnType<typeof normalizeNativeCommandDiagnostic>;

export type IosCaptureCleanup =
  'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } | null;

export type IosTrainingCommandProjection = {
  commandDiagnostics: NativeCommandDiagnostic[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification: NativeCommandDiagnostic['execution'];
  historyKnown: boolean;
};

export type IosTrainingAttemptProjection = IosTrainingCommandProjection & {
  captureResult: string;
  captureCleanup: IosCaptureCleanup;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function projectIosCaptureCleanup(value: unknown): IosCaptureCleanup {
  if (value === 'not-acquired' || value === 'cleaned') return value;
  if (
    isRecord(value) &&
    value.status === 'failed-recovery-retained' &&
    Array.isArray(value.resources) &&
    value.resources.every((resource) => typeof resource === 'string')
  )
    return value as { status: 'failed-recovery-retained'; resources: string[] };
  return null;
}

function isKnownNativeCommandDiagnostic(raw: unknown, row: NativeCommandDiagnostic): boolean {
  if (
    !isRecord(raw) ||
    typeof row.label !== 'string' ||
    !row.label.trim() ||
    typeof row.phase !== 'string' ||
    !['build', 'step'].includes(row.phase) ||
    row.execution === null ||
    !commandExecutions.has(row.execution) ||
    row.cleanup === null ||
    !cleanupStatuses.has(row.cleanup) ||
    typeof row.deadlineMs !== 'number' ||
    !Number.isFinite(row.deadlineMs) ||
    row.deadlineMs <= 0
  )
    return false;
  if (
    raw.childExitCode !== undefined &&
    raw.childExitCode !== null &&
    (typeof raw.childExitCode !== 'number' || !Number.isSafeInteger(raw.childExitCode))
  )
    return false;
  if (
    raw.childSignal !== undefined &&
    raw.childSignal !== null &&
    typeof raw.childSignal !== 'string'
  )
    return false;
  if (raw.outputFailure !== undefined && raw.outputFailure !== null && row.outputFailure === null)
    return false;
  return true;
}

/** Project an owned command ledger without acquiring a process or touching artifacts. */
export function projectIosTrainingCommandDiagnostics(
  value: unknown,
  callbackCompleted: boolean,
): IosTrainingCommandProjection {
  const rawRows = Array.isArray(value) ? value : [];
  const commandDiagnostics = rawRows.map(normalizeNativeCommandDiagnostic);
  const historyKnown =
    rawRows.length > 0 &&
    rawRows.every((raw, index) => isKnownNativeCommandDiagnostic(raw, commandDiagnostics[index]));
  const censusFailures = commandDiagnostics
    .map((row) => row.censusFailure)
    .filter((failure): failure is unknown => failure !== null);
  const outputFailures = commandDiagnostics
    .map((row) => row.outputFailure)
    .filter((failure): failure is NonNullable<typeof failure> => failure !== null);
  const childSignal =
    commandDiagnostics.find((row) => row.childSignal !== null)?.childSignal ?? null;
  const nonCompleted = commandDiagnostics.find((row) => row.execution !== 'completed');
  const childClassification = !historyKnown
    ? ('harness-blocked' as const)
    : (nonCompleted?.execution ?? (callbackCompleted ? ('completed' as const) : null));
  return {
    commandDiagnostics,
    censusFailures,
    outputFailures,
    childExitCode: historyKnown
      ? trainingAttemptChildExitCode(commandDiagnostics, callbackCompleted)
      : null,
    childSignal,
    childClassification,
    historyKnown,
  };
}

/** Preserve every projected command-diagnostic channel at the adapter boundary. */
export function projectIosTrainingAttemptRuntimeDiagnostics(
  terminal: IosTrainingAttemptProjection,
): Pick<IosTrainingCommandProjection, 'commandDiagnostics' | 'censusFailures' | 'outputFailures'> {
  return {
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
  };
}

/** Preserve capture-level terminal facts alongside the command projection. */
export function projectIosTrainingAttemptTerminalFacts(input: {
  commandExecutions: unknown;
  callbackCompleted: boolean;
  captureResult: unknown;
  captureExitCode: number;
  captureCleanup?: unknown;
  budgetTimeout?: unknown;
  cancellation?: unknown;
}): IosTrainingAttemptProjection {
  const command = projectIosTrainingCommandDiagnostics(
    input.commandExecutions,
    input.callbackCompleted,
  );
  const cancellation =
    input.cancellation === 'SIGINT' || input.cancellation === 'SIGTERM'
      ? input.cancellation
      : input.captureExitCode === 130
        ? 'SIGINT'
        : input.captureExitCode === 143
          ? 'SIGTERM'
          : null;
  return {
    ...command,
    captureResult:
      typeof input.captureResult === 'string' ? input.captureResult : 'harness-blocked',
    captureCleanup: projectIosCaptureCleanup(input.captureCleanup),
    captureTimeout: input.budgetTimeout === 'whole-capture' ? 'whole-capture' : null,
    cancellation,
  };
}

/** Product-failure candidates require a known, clean child-1 command history. */
export function isQualifiedIosApplicationFailureCommandHistory(value: unknown): boolean {
  const projection = projectIosTrainingCommandDiagnostics(value, false);
  if (!projection.historyKnown || projection.commandDiagnostics.length === 0) return false;
  const rawRows = Array.isArray(value) ? value : [];
  const qualifyingFailures = projection.commandDiagnostics.filter(
    (row, index) =>
      row.execution === 'child-failed' &&
      row.childExitCode === 1 &&
      row.phase === 'step' &&
      isRecord(rawRows[index]) &&
      typeof rawRows[index].childExitCode === 'number' &&
      Number.isSafeInteger(rawRows[index].childExitCode) &&
      Object.hasOwn(rawRows[index], 'childSignal') &&
      rawRows[index].childSignal === null,
  );
  if (qualifyingFailures.length !== 1) return false;
  return (
    projection.censusFailures.length === 0 &&
    projection.outputFailures.length === 0 &&
    projection.childSignal === null &&
    projection.commandDiagnostics.every((row, index) =>
      row.execution === 'child-failed'
        ? row === qualifyingFailures[0] &&
          row.cleanup === 'cleaned' &&
          row.childExitCode === 1 &&
          isRecord(rawRows[index]) &&
          typeof rawRows[index].childExitCode === 'number' &&
          Number.isSafeInteger(rawRows[index].childExitCode) &&
          Object.hasOwn(rawRows[index], 'childSignal') &&
          rawRows[index].childSignal === null
        : row.execution === 'completed' &&
          row.cleanup === 'cleaned' &&
          row.childExitCode === 0 &&
          row.childSignal === null &&
          isRecord(rawRows[index]) &&
          typeof rawRows[index].childExitCode === 'number' &&
          Number.isSafeInteger(rawRows[index].childExitCode) &&
          rawRows[index].childExitCode === 0 &&
          Object.hasOwn(rawRows[index], 'childSignal') &&
          rawRows[index].childSignal === null,
    )
  );
}

export { trainingAttemptChildExitCode };

/** Require the adapter's projected history to retain the exact successful command facts. */
export function requireIosSuccessfulTrainingCommandDiagnostics(value: unknown) {
  const diagnostics = requireSuccessfulNativeCommandDiagnostics(value);
  const projection = projectIosTrainingCommandDiagnostics(value, true);
  assert.equal(projection.historyKnown, true, 'iOS command history must be known');
  assert.deepEqual(
    diagnostics,
    projection.commandDiagnostics,
    'iOS command diagnostics projection changed command facts',
  );
  return diagnostics;
}

/** Actual owned execution. Public receipt finalization remains a separate checked boundary. */
export async function runIosTrainingAttempt(options: {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  /** Optional caller-owned cold-comparison namespace and absolute deadline. */
  callerOutputRoot?: string;
  deadlineAtMonotonicMs?: number;
  bootstatusDeadlineMs?: number;
  deadlines?: NativeExecutionDeadlines;
  reuseBuildRunId?: string;
  reuseBuildSourceRoot?: string;
  /** Fingerprints only; capture derives target/backend from acquired handles. */
  coldReset?: ColdResetPreparationExpectation;
}) {
  assert.match(options.requestedRunId, id);
  if (options.reuseBuildRunId !== undefined) assert.match(options.reuseBuildRunId, id);
  if (options.reuseBuildSourceRoot !== undefined)
    assert(path.isAbsolute(options.reuseBuildSourceRoot));
  iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs);
  nativeExecutionDeadlines(options.deadlines);
  options.signal.throwIfAborted();
  const root = await realpath(options.repositoryRoot);
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8')),
    root,
  );
  assert.deepEqual(
    options.selection,
    current,
    'Public native selection changed before acquisition',
  );
  assert.deepEqual(current.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-training-ios',
    mode: 'integration',
  });
  assert.equal(requireNativePilotAssertions(current).length, 7);
  options.signal.throwIfAborted();
  let callbackInvocations = 0;
  let callbackCompleted = false;
  const capture = await runOwnedIosNativeSession({
    charter: 'training-journey',
    requestedRunId: options.requestedRunId,
    callerOutputRoot: options.callerOutputRoot,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldReset: options.coldReset,
    signal: options.signal,
    bootstatusDeadlineMs: options.bootstatusDeadlineMs,
    deadlines: options.deadlines,
    reuseBuildRunId: options.reuseBuildRunId,
    reuseBuildSourceRoot: options.reuseBuildSourceRoot,
    executeTraining: async (context) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Training callback must execute once');
      assert.equal(context.fixtures.scope, 'native-entry-ios');
      const binding = await writeNativeTrainingAttemptBinding({
        repositoryRoot: root,
        artifactRoot: context.output,
        requestedRunId: options.requestedRunId,
        backendRunId: context.fixtures.runId,
        selection: current,
      });
      const report: Record<string, unknown> = {};
      await observeIosSavedTrainingJourney({ ...context, report });
      const journey = report.trainingJourney as {
        input: { runId: string; attemptId: string };
        sixSqlCheckpoints: boolean;
        threeAuthenticatedApiReads: boolean;
        savedPlanDurableAfterRestart: boolean;
        publicNativePassingCases: number;
      };
      assert(journey && journey.sixSqlCheckpoints && journey.threeAuthenticatedApiReads);
      assert(journey.savedPlanDurableAfterRestart);
      assert.equal(journey.publicNativePassingCases, 0);
      assert.equal(journey.input.runId, binding.backendRunId);
      assert.equal(journey.input.attemptId, binding.backendAttemptId);
      await writeFile(
        path.join(context.output, 'training-runtime-metadata.private.json'),
        JSON.stringify({
          ...journey,
          requestedAttemptId: binding.requestedAttemptId,
          selection: binding.selection,
        }),
        { flag: 'wx', mode: 0o600 },
      );
      callbackCompleted = true;
    },
  });
  const cleanupStarted = performance.now();
  const externalCleanup = await verifyOwnedIosCleanup({
    repositoryRoot: root,
    artifactRoot: capture.artifactRoot,
  });
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  const terminal = projectIosTrainingAttemptTerminalFacts({
    commandExecutions: capture.report.commandExecutions,
    callbackCompleted,
    captureResult: capture.report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: capture.report.cleanup,
    budgetTimeout: capture.report.budgetTimeout,
    cancellation: capture.report.cancellation,
  });
  let assertionEvidence: Awaited<ReturnType<typeof prepareIosTrainingPilotEvidence>> | null = null;
  let verificationResult: 'passed' | 'failed' | 'not-executed' | 'application-failed' =
    'not-executed';
  let applicationFailure: {
    assertionId: string;
    label: string;
    candidateHash: string;
  } | null = null;
  let verificationFailure: { name: string; message: string } | null = null;
  const applicationFailureCandidate =
    typeof capture.report.applicationFailureCandidate === 'string'
      ? capture.report.applicationFailureCandidate
      : null;
  if (
    capture.report.applicationFailureCandidate &&
    callbackInvocations === 1 &&
    !callbackCompleted &&
    externalCleanup.result === 'passed' &&
    !options.signal.aborted
  ) {
    if (!isQualifiedIosApplicationFailureCommandHistory(capture.report.commandExecutions)) {
      verificationResult = 'failed';
      verificationFailure = {
        name: 'NativeCommandHistoryError',
        message:
          'iOS application-failure candidate has incomplete or harness-failed command history',
      };
    } else {
      try {
        const proof = readQualifiedNativeQuantityFailure({
          captureRoot: capture.artifactRoot,
          requestedRunId: options.requestedRunId,
          fixtureRunId: (capture.report.backend as { runId: string }).runId,
          selection: current,
        });
        applicationFailure = {
          assertionId: proof.assertionId,
          label: proof.label,
          candidateHash: proof.candidateHash,
        };
        verificationResult = 'application-failed';
      } catch (error) {
        verificationResult = 'failed';
        verificationFailure =
          error instanceof Error
            ? { name: error.name, message: error.message }
            : {
                name: 'UnknownError',
                message: 'iOS failure qualification rejected',
              };
      }
    }
  }
  if (
    capture.exitCode === 0 &&
    callbackCompleted &&
    externalCleanup.result === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      requireIosSuccessfulTrainingCommandDiagnostics(capture.report.commandExecutions);
      await writeIosTrainingRuntimeFrames(capture.artifactRoot);
      assertionEvidence = await prepareIosTrainingPilotEvidence({
        repositoryRoot: root,
        artifactRoot: capture.artifactRoot,
        selection: current,
        purpose: 'runtime',
        requestedRunId: options.requestedRunId,
      });
      verificationResult = 'passed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : {
              name: 'UnknownError',
              message: 'iOS evidence verification rejected',
            };
    }
  }
  const outcome = {
    kind: 'private-owned-ios-training-attempt-not-public-receipt',
    requestedRunId: options.requestedRunId,
    requestedAttemptId: `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    captureExitCode: capture.exitCode,
    childExitCode: terminal.childExitCode,
    childSignal: terminal.childSignal,
    childClassification: terminal.childClassification,
    captureResult: terminal.captureResult,
    captureCleanup: terminal.captureCleanup,
    captureTimeout: terminal.captureTimeout,
    cancellation: terminal.cancellation,
    callbackInvocations,
    callbackCompleted,
    externalCleanupResult: externalCleanup.result,
    verificationResult,
    applicationFailure,
    applicationFailureCandidate,
    verificationFailure,
    deadline: (capture.report.deadline as { step: string; deadlineMs: number } | undefined) ?? null,
    simulatorBootstrapFailure:
      (capture.report.simulatorBootstrapFailure as
        | {
            phase: string;
            failureReason: string;
            deadlineMs: number;
            elapsedMs: number;
          }
        | undefined) ?? null,
    assertionBindings: assertionEvidence?.bindings ?? [],
    fixtureRunId: (capture.report.backend as { runId?: string } | undefined)?.runId ?? null,
    fixtureHash: (capture.report.fixtureHash as string | undefined) ?? null,
    flagsHash:
      (capture.report.build as { environmentHash?: string } | undefined)?.environmentHash ?? null,
    toolVersions: (capture.report.toolVersions as Record<string, string> | undefined) ?? {},
    ...projectIosTrainingAttemptRuntimeDiagnostics(terminal),
    timingsMs: {
      ...(capture.report.timingsMs as {
        build: number;
        install: number;
        reset: number;
        scenario: number;
        verify: number;
        cleanup: number;
      }),
      verify:
        (capture.report.timingsMs as { verify: number }).verify + performance.now() - verifyStarted,
      cleanup: (capture.report.timingsMs as { cleanup: number }).cleanup + cleanupMs,
    },
    nativePassingCases: 0,
  };
  await writeFile(
    path.join(capture.artifactRoot, 'runtime-adapter.private.json'),
    JSON.stringify(outcome, null, 2),
    {
      flag: 'wx',
      mode: 0o600,
    },
  );
  return { ...outcome, artifactRoot: capture.artifactRoot };
}
