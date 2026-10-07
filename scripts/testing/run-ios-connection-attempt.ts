import assert from 'node:assert/strict';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runOwnedIosNativeSession } from './capture-native-testability';
import { observeIosConnectionJourney } from './native-connection-journey';
import { prepareIosConnectionPilotEvidence } from './native-connection-public-evidence';
import {
  nativeConnectionAssertionIds,
  requireNativePilotAssertions,
  selectNativePilotScenario,
} from './native-pilot-contract';
import { nativeExecutionDeadlines } from './native-runtime-preflight';
import {
  normalizeNativeCommandDiagnostic,
  requireSuccessfulNativeCommandDiagnostics,
} from './native-training-attempt-outcome';
import { iosSimulatorBootstatusDeadline } from './owned-ios-simulator';
import {
  projectIosTrainingAttemptTerminalFacts,
  requireIosSuccessfulTrainingCommandDiagnostics,
} from './run-ios-training-attempt';
import {
  buildT16BParentOwnedInputBinding,
  readT16BOuterCleanupBinding,
  requireT16BVerifiedParentOwnedInputBinding,
  requirePassedOuterCleanupFacts,
  verifyT16BParentOwnedInputBinding,
  type T16BOuterCleanupBinding,
  type T16BParentOwnedInputBinding,
  type T16BVerifiedParentOwnedInputBinding,
} from './t16b-outer-cleanup-binding';
import { verifyOwnedIosCleanup } from './verify-owned-ios-cleanup';
import type { IosConnectionRuntimeContext } from './capture-native-testability';
import type {
  IosLocaleRuntimeContext,
  IosLocaleScenarioInput,
  IosLocaleScenarioResult,
} from './ios-locale-runtime-adapter';
import type { NativeConnectionAttemptBinding } from './native-connection-attempt-binding';
import type { NativeConnectionAssertionBinding } from './native-connection-public-evidence';
import type { NativePilotSelection } from './native-pilot-contract';
import type { NativeExecutionDeadlines } from './native-runtime-preflight';
import type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

const id = /^[a-f0-9]{24}$/;

type PostCaptureFailurePhase = 'cleanup' | 'verification' | 'adapter-write';
type PostCaptureFailure = {
  phase: PostCaptureFailurePhase;
  name: string;
  message: string;
};

type ConnectionPreparation = {
  binding?: NativeConnectionAttemptBinding;
  nativePassingCases?: number;
  [key: string]: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function postCaptureFailure(phase: PostCaptureFailurePhase, error: unknown): PostCaptureFailure {
  return {
    phase,
    name: error instanceof Error ? error.name : 'UnknownError',
    message:
      error instanceof Error ? error.message : 'iOS connection post-capture processing failed',
  };
}

function captureDeadline(value: unknown) {
  if (
    !isRecord(value) ||
    typeof value.step !== 'string' ||
    typeof value.deadlineMs !== 'number' ||
    !Number.isFinite(value.deadlineMs)
  )
    return null;
  return { step: value.step, deadlineMs: value.deadlineMs };
}

/** Keep the connection adapter on the shared command-fact projection. */
export function requireIosSuccessfulConnectionCommandDiagnostics(value: unknown) {
  const diagnostics = requireSuccessfulNativeCommandDiagnostics(value);
  assert.deepEqual(
    diagnostics,
    requireIosSuccessfulTrainingCommandDiagnostics(value),
    'iOS connection command diagnostics projection changed command facts',
  );
  return diagnostics;
}

/** Connection uses the existing terminal projection without changing its semantics. */
export function projectIosConnectionAttemptTerminalFacts(
  input: Parameters<typeof projectIosTrainingAttemptTerminalFacts>[0],
) {
  return projectIosTrainingAttemptTerminalFacts(input);
}

export type IosConnectionAttemptResult = {
  kind: 'private-owned-ios-connection-attempt-not-public-receipt';
  requestedRunId: string;
  requestedAttemptId: string;
  captureRunId: string;
  backendRunId: string | null;
  backendAttemptId: string | null;
  captureExitCode: number;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification:
    | 'completed'
    | 'child-failed'
    | 'deadline'
    | 'cancelled'
    | 'output-limit'
    | 'output-failed'
    | 'harness-blocked'
    | null;
  captureResult: string;
  captureCleanup:
    'not-acquired' | 'cleaned' | { status: 'failed-recovery-retained'; resources: string[] } | null;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  callbackInvocations: number;
  callbackCompleted: boolean;
  externalCleanupResult: 'passed' | 'failed';
  outerCleanupBinding: T16BOuterCleanupBinding | null;
  parentOwnedInputBinding: T16BVerifiedParentOwnedInputBinding | null;
  verificationResult: 'passed' | 'failed' | 'not-executed';
  applicationFailure: null;
  applicationFailureCandidate: null;
  verificationFailure: { name: string; message: string } | null;
  postCaptureFailure: PostCaptureFailure | null;
  deadline: { step: string; deadlineMs: number } | null;
  commandDiagnostics: ReturnType<typeof normalizeNativeCommandDiagnostic>[];
  censusFailures: unknown[];
  outputFailures: unknown[];
  assertionBindings: NativeConnectionAssertionBinding[];
  fixtureRunId: string | null;
  fixtureHash: string | null;
  flagsHash: string | null;
  toolVersions: Record<string, string>;
  timingsMs: {
    build: number;
    install: number;
    reset: number;
    scenario: number;
    verify: number;
    cleanup: number;
  };
  nativePassingCases: 0;
  t16BTerminal: IosConnectionT16BTerminal | null;
  artifactRoot: string;
};

export type IosConnectionT16BTerminal = {
  schemaVersion: 1;
  kind: 'private-t16-b-terminal-not-public-receipt';
  artifactRoot: string;
  status: 'observed' | 'blocked' | 'not-requested';
  outerCleanupResult: 'passed' | 'failed';
  outerCleanup: T16BOuterCleanupBinding | null;
  parentOwnedInput: T16BVerifiedParentOwnedInputBinding | null;
  captureCleanup: IosConnectionAttemptResult['captureCleanup'];
  verificationResult: 'passed' | 'failed' | 'not-executed';
  publicPublicationEligible: false;
  nativePassingCases: 0;
  blockers: string[];
};

function requireConnectionSelection(selection: NativePilotSelection): void {
  assert.deepEqual(selection.arguments, {
    platform: 'ios',
    engine: 'maestro',
    scenario: 'SCN-connection-ios',
    mode: 'integration',
  });
  assert.equal(selection.scenario.id, 'SCN-connection-ios');
  assert.equal(selection.scenario.platform, 'ios');
  assert.equal(selection.scenario.flowId, 'FLW-connection');
  assert.equal(selection.scenarioHash.length, 64);
  assert.equal(selection.requirementHash.length, 64);
  const rows = requireNativePilotAssertions(selection);
  assert.deepEqual(
    rows.map((row) => row.id),
    nativeConnectionAssertionIds,
    'Connection assertion order changed before acquisition',
  );
}

function requireBoundT16BOuterCleanup(
  outerCleanup: T16BOuterCleanupBinding,
  input: {
    artifactRoot: string;
    parentOwnedInput: T16BParentOwnedInputBinding | null;
  },
): void {
  requirePassedOuterCleanupFacts(outerCleanup.facts);
  const expectedArtifactRoot = path.resolve(input.artifactRoot);
  assert.equal(
    path.resolve(outerCleanup.artifactRoot),
    expectedArtifactRoot,
    'Outer cleanup receipt is bound to a different artifact root',
  );
  assert.equal(
    outerCleanup.captureRunId,
    path.basename(expectedArtifactRoot),
    'Outer cleanup receipt is bound to a different capture run',
  );
  assert.equal(
    outerCleanup.facts.runId,
    outerCleanup.captureRunId,
    'Outer cleanup facts are not bound to the captured run',
  );
  if (input.parentOwnedInput)
    assert.equal(
      input.parentOwnedInput.captureRunId,
      outerCleanup.captureRunId,
      'Parent-owned input is bound to a different capture run',
    );
}

export function assertT16LifecycleFence(
  signal: AbortSignal,
  deadlineAtMonotonicMs: number | undefined,
  label: string,
): void {
  signal.throwIfAborted();
  if (deadlineAtMonotonicMs !== undefined && performance.now() >= deadlineAtMonotonicMs)
    throw new Error(`T16 lifecycle deadline reached during ${label}`);
}

export async function awaitT16Lifecycle<T>(
  operation: () => Promise<T>,
  signal: AbortSignal,
  deadlineAtMonotonicMs: number | undefined,
  label: string,
): Promise<T> {
  assertT16LifecycleFence(signal, deadlineAtMonotonicMs, label);
  const value = await operation();
  assertT16LifecycleFence(signal, deadlineAtMonotonicMs, label);
  return value;
}

export function projectIosConnectionT16BTerminal(input: {
  artifactRoot: string;
  execution: unknown;
  outerCleanup: T16BOuterCleanupBinding | null;
  parentOwnedInput: T16BVerifiedParentOwnedInputBinding | T16BParentOwnedInputBinding | null;
  captureCleanup: IosConnectionAttemptResult['captureCleanup'];
  verificationResult: 'passed' | 'failed' | 'not-executed';
}): IosConnectionT16BTerminal {
  if (input.outerCleanup?.facts.result === 'passed')
    requireBoundT16BOuterCleanup(input.outerCleanup, input);
  const verifiedParentOwnedInput = input.parentOwnedInput
    ? 'verification' in input.parentOwnedInput
      ? requireT16BVerifiedParentOwnedInputBinding(input.parentOwnedInput, input.artifactRoot)
      : null
    : null;
  const explored = isRecord(input.execution) && input.execution.status === 'explored';
  const outerCleanupResult = input.outerCleanup?.facts.result === 'passed' ? 'passed' : 'failed';
  const blockers = [
    ...(input.outerCleanup?.facts.result === 'passed'
      ? []
      : [input.outerCleanup ? 'outer-cleanup-failed' : 'outer-cleanup-evidence-unavailable']),
    ...(verifiedParentOwnedInput ? [] : ['parent-owned-input-binding-unavailable']),
    ...(input.captureCleanup === 'cleaned' ? [] : ['capture-cleanup-not-cleaned']),
    ...(input.verificationResult === 'passed' ? [] : ['connection-verification-not-passed']),
    ...(explored ? [] : ['t16-execution-not-observed']),
  ];
  return {
    schemaVersion: 1,
    kind: 'private-t16-b-terminal-not-public-receipt',
    artifactRoot: input.artifactRoot,
    status: explored && blockers.length === 0 ? 'observed' : 'blocked',
    outerCleanupResult,
    outerCleanup: input.outerCleanup,
    parentOwnedInput: verifiedParentOwnedInput,
    captureCleanup: input.captureCleanup,
    verificationResult: input.verificationResult,
    publicPublicationEligible: false,
    nativePassingCases: 0,
    blockers,
  };
}

function preparationFromReport(report: Record<string, unknown>): ConnectionPreparation {
  const preparation = report.connectionJourneyPreparation;
  assert(isRecord(preparation), 'Connection journey preparation report is missing');
  assert.equal(preparation.nativePassingCases, 0);
  assert(isRecord(preparation.binding), 'Connection attempt binding is missing');
  return preparation as ConnectionPreparation;
}

function requireConnectionBinding(
  value: NativeConnectionAttemptBinding,
  options: {
    requestedRunId: string;
    captureRunId: string;
    backendRunId: string;
  },
  selection: NativePilotSelection,
): NativeConnectionAttemptBinding {
  assert.equal(value.requestedRunId, options.requestedRunId);
  assert.equal(value.requestedAttemptId, `${options.requestedRunId}:first`);
  assert.equal(value.captureRunId, options.captureRunId);
  assert.equal(value.backendRunId, options.backendRunId);
  assert.equal(value.backendAttemptId, `${options.backendRunId}:first`);
  assert.equal(value.fixtureScope, 'native-entry-ios');
  assert.equal(value.scenarioId, selection.scenario.id);
  assert.deepEqual(value.selection, {
    arguments: selection.arguments,
    scenarioHash: selection.scenarioHash,
    requirementHash: selection.requirementHash,
  });
  assert.deepEqual(value.assertionIds, nativeConnectionAssertionIds);
  assert.equal(value.nativePassingCases, 0);
  return value;
}

/** Actual owned iOS connection execution; public receipt finalization remains separate. */
export async function runIosConnectionAttempt(options: {
  repositoryRoot: string;
  requestedRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  /** Optional caller-owned namespace and absolute deadline inherited by T16. */
  callerOutputRoot?: string;
  deadlineAtMonotonicMs?: number;
  bootstatusDeadlineMs?: number;
  deadlines?: NativeExecutionDeadlines;
  reuseBuildRunId?: string;
  reuseBuildSourceRoot?: string;
  locale?: 'en-US' | 'pt-BR' | 'es-ES';
  executeConnectionLocale?: (input: {
    context: IosLocaleRuntimeContext;
    run: (scenario: IosLocaleScenarioInput) => Promise<IosLocaleScenarioResult>;
    scenario: IosLocaleScenarioInput;
  }) => Promise<IosLocaleScenarioResult>;
  /** Optional continuation used by the private T16 owned caller. */
  t16Continuation?: (context: IosConnectionRuntimeContext) => Promise<void>;
  /** Testable seams retain the production defaults and never change public wiring. */
  verifyExternalCleanup?: typeof verifyOwnedIosCleanup;
  prepareConnectionEvidence?: typeof prepareIosConnectionPilotEvidence;
  /** Fingerprints only; capture derives target/backend from acquired handles. */
  coldReset?: ColdResetPreparationExpectation;
}): Promise<IosConnectionAttemptResult> {
  assert.match(options.requestedRunId, id);
  if (options.reuseBuildRunId !== undefined) assert.match(options.reuseBuildRunId, id);
  if (options.reuseBuildSourceRoot !== undefined)
    assert(path.isAbsolute(options.reuseBuildSourceRoot));
  iosSimulatorBootstatusDeadline(options.bootstatusDeadlineMs);
  nativeExecutionDeadlines(options.deadlines);
  options.signal.throwIfAborted();
  if (
    options.deadlineAtMonotonicMs !== undefined &&
    (!Number.isFinite(options.deadlineAtMonotonicMs) ||
      options.deadlineAtMonotonicMs <= performance.now())
  )
    throw new Error('T16 lifecycle deadline reached before connection acquisition');
  const root = await realpath(options.repositoryRoot);
  const current = await selectNativePilotScenario(
    options.selection.arguments,
    JSON.parse(await readFile(path.join(root, 'docs/qa/native-pilot/inventory.json'), 'utf8')),
    root,
  );
  assert.deepEqual(
    options.selection,
    current,
    'Public connection selection changed before acquisition',
  );
  requireConnectionSelection(current);
  options.signal.throwIfAborted();

  let callbackInvocations = 0;
  let callbackCompleted = false;
  let t16ContinuationInvoked = false;
  let connectionContextForT16: IosConnectionRuntimeContext | undefined;
  const bindingState: { value: NativeConnectionAttemptBinding | null } = {
    value: null,
  };
  const invokeT16Continuation = async (context: IosConnectionRuntimeContext) => {
    if (!options.t16Continuation || t16ContinuationInvoked) return;
    t16ContinuationInvoked = true;
    await options.t16Continuation(context);
  };
  const capture = await runOwnedIosNativeSession({
    charter: 'connection-journey',
    requestedRunId: options.requestedRunId,
    callerOutputRoot: options.callerOutputRoot,
    deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
    coldReset: options.coldReset,
    signal: options.signal,
    bootstatusDeadlineMs: options.bootstatusDeadlineMs,
    deadlines: options.deadlines,
    reuseBuildRunId: options.reuseBuildRunId,
    reuseBuildSourceRoot: options.reuseBuildSourceRoot,
    locale: options.locale,
    ...(options.executeConnectionLocale
      ? {
          executeConnectionLocale: async (input: {
            context: IosLocaleRuntimeContext;
            run: (scenario: IosLocaleScenarioInput) => Promise<IosLocaleScenarioResult>;
            scenario: IosLocaleScenarioInput;
          }) => {
            return options.executeConnectionLocale!(input);
          },
        }
      : {}),
    ...(options.t16Continuation
      ? {
          executeConnectionAfterFlow: async (_context: IosConnectionRuntimeContext) => {
            if (!connectionContextForT16)
              throw new Error('Connection context was unavailable after connection flow');
            await invokeT16Continuation(connectionContextForT16);
          },
        }
      : {}),
    executeConnection: async (context: IosConnectionRuntimeContext) => {
      callbackInvocations++;
      assert.equal(callbackInvocations, 1, 'Connection callback must execute once');
      assert.equal(context.fixtures.scope, 'native-entry-ios');
      connectionContextForT16 = context;
      await observeIosConnectionJourney(context, {
        repositoryRoot: root,
        requestedRunId: options.requestedRunId,
        selection: current,
      });
      const preparation = preparationFromReport(context.report);
      const currentBinding = requireConnectionBinding(
        preparation.binding!,
        {
          requestedRunId: options.requestedRunId,
          captureRunId: path.basename(context.output),
          backendRunId: context.fixtures.runId,
        },
        current,
      );
      bindingState.value = currentBinding;
      await writeFile(
        path.join(context.output, 'connection-runtime-metadata.private.json'),
        JSON.stringify(
          {
            schemaVersion: 1,
            kind: 'private-ios-connection-runtime-metadata-not-public-receipt',
            requestedRunId: currentBinding.requestedRunId,
            requestedAttemptId: currentBinding.requestedAttemptId,
            captureRunId: currentBinding.captureRunId,
            backendRunId: currentBinding.backendRunId,
            backendAttemptId: currentBinding.backendAttemptId,
            selection: currentBinding.selection,
            assertionIds: currentBinding.assertionIds,
            assertionSemanticSha256: currentBinding.assertionSemanticSha256,
            assertionContractSha256: currentBinding.assertionContractSha256,
            preparation,
            publicNativePassingCases: 0,
          },
          null,
          2,
        ),
        { flag: 'wx', mode: 0o600 },
      );
      callbackCompleted = true;
    },
  });

  const cleanupStarted = performance.now();
  let externalCleanupResult: 'passed' | 'failed' = 'failed';
  let outerCleanupBinding: T16BOuterCleanupBinding | null = null;
  let parentOwnedInputBinding: T16BVerifiedParentOwnedInputBinding | null = null;
  let lifecycleFenceFailure: Error | null = null;
  let postCaptureFailureRecord: PostCaptureFailure | null = null;
  try {
    await awaitT16Lifecycle(
      () =>
        (options.verifyExternalCleanup ?? verifyOwnedIosCleanup)({
          repositoryRoot: root,
          artifactRoot: capture.artifactRoot,
          signal: options.signal,
          deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
        }),
      options.signal,
      options.deadlineAtMonotonicMs,
      'outer cleanup verification',
    );
    const binding = await awaitT16Lifecycle(
      async () => {
        const binding = readT16BOuterCleanupBinding({
          artifactRoot: capture.artifactRoot,
          expectedCaptureRunId: path.basename(capture.artifactRoot),
        });
        await Promise.resolve();
        return binding;
      },
      options.signal,
      options.deadlineAtMonotonicMs,
      'outer cleanup receipt read',
    );
    await awaitT16Lifecycle(
      () =>
        writeFile(
          path.join(capture.artifactRoot, 't16-b-outer-cleanup-binding.private.json'),
          JSON.stringify(binding, null, 2),
          { flag: 'wx', mode: 0o600 },
        ),
      options.signal,
      options.deadlineAtMonotonicMs,
      'outer cleanup binding publication',
    );
    outerCleanupBinding = binding;
    externalCleanupResult = binding.facts.result === 'passed' ? 'passed' : 'failed';
  } catch (error) {
    lifecycleFenceFailure = error instanceof Error ? error : new Error(String(error));
    postCaptureFailureRecord = postCaptureFailure('cleanup', error);
    outerCleanupBinding = null;
    externalCleanupResult = 'failed';
  }
  const cleanupMs = performance.now() - cleanupStarted;
  const verifyStarted = performance.now();
  const terminal = projectIosConnectionAttemptTerminalFacts({
    commandExecutions: capture.report.commandExecutions,
    callbackCompleted,
    captureResult: capture.report.result,
    captureExitCode: capture.exitCode,
    captureCleanup: capture.report.cleanup,
    budgetTimeout: capture.report.budgetTimeout,
    cancellation: capture.report.cancellation,
  });
  const captureTimings = (capture.report.timingsMs ?? {}) as Record<string, unknown>;
  const fixture = isRecord(capture.report.backend) ? capture.report.backend : {};
  const build = isRecord(capture.report.build) ? capture.report.build : {};
  const finalBinding = bindingState.value;
  try {
    const execution = capture.report.t16BExecution;
    if (isRecord(execution) && finalBinding) {
      const compactParentOwnedInputBinding = buildT16BParentOwnedInputBinding({
        connectionBinding: finalBinding,
        selectionEvidence: execution.selectionEvidence,
      });
      const verified = await verifyT16BParentOwnedInputBinding({
        artifactRoot: capture.artifactRoot,
        binding: compactParentOwnedInputBinding,
        signal: options.signal,
        deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
      });
      await awaitT16Lifecycle(
        () =>
          writeFile(
            path.join(capture.artifactRoot, 't16-b-parent-owned-input-binding.private.json'),
            JSON.stringify(verified, null, 2),
            { flag: 'wx', mode: 0o600 },
          ),
        options.signal,
        options.deadlineAtMonotonicMs,
        'parent-owned input binding publication',
      );
      parentOwnedInputBinding = verified;
      /* Keep the protected reread immediately adjacent to terminal projection. */
      const reread = await verifyT16BParentOwnedInputBinding({
        artifactRoot: capture.artifactRoot,
        binding: parentOwnedInputBinding,
        signal: options.signal,
        deadlineAtMonotonicMs: options.deadlineAtMonotonicMs,
      });
      parentOwnedInputBinding = reread;
      /* The initial compact binding is never exposed in a terminal result. */
      void requireT16BVerifiedParentOwnedInputBinding(
        parentOwnedInputBinding,
        capture.artifactRoot,
      );
    }
  } catch (error) {
    if (error instanceof Error && /deadline|aborted|abort/i.test(error.message))
      lifecycleFenceFailure = error;
    postCaptureFailureRecord ??= postCaptureFailure('verification', error);
    parentOwnedInputBinding = null;
  }
  let assertionBindings: NativeConnectionAssertionBinding[] = [];
  let verificationResult: 'passed' | 'failed' | 'not-executed' = 'not-executed';
  let verificationFailure: { name: string; message: string } | null = null;
  if (
    capture.exitCode === 0 &&
    terminal.captureResult === 'observed' &&
    terminal.captureCleanup === 'cleaned' &&
    callbackCompleted &&
    externalCleanupResult === 'passed' &&
    !options.signal.aborted
  ) {
    try {
      requireIosSuccessfulConnectionCommandDiagnostics(capture.report.commandExecutions);
      const preparation = preparationFromReport(capture.report);
      const binding = requireConnectionBinding(
        preparation.binding!,
        {
          requestedRunId: options.requestedRunId,
          captureRunId: path.basename(capture.artifactRoot),
          backendRunId:
            typeof fixture.runId === 'string' ? fixture.runId : (finalBinding?.backendRunId ?? ''),
        },
        current,
      );
      assert.equal(binding, finalBinding, 'Connection binding changed after callback completion');
      const assertionEvidence = await awaitT16Lifecycle(
        () =>
          (options.prepareConnectionEvidence ?? prepareIosConnectionPilotEvidence)({
            repositoryRoot: root,
            artifactRoot: capture.artifactRoot,
            selection: current,
            requestedRunId: options.requestedRunId,
          }),
        options.signal,
        options.deadlineAtMonotonicMs,
        'connection evidence preparation',
      );
      assert.equal(assertionEvidence.fixtureRunId, binding.backendRunId);
      assert.equal(assertionEvidence.attemptId, binding.backendAttemptId);
      assert.equal(assertionEvidence.nativePassingCases, 0);
      assertionBindings = assertionEvidence.bindings;
      verificationResult = 'passed';
    } catch (error) {
      verificationResult = 'failed';
      verificationFailure =
        error instanceof Error
          ? { name: error.name, message: error.message }
          : {
              name: 'UnknownError',
              message: 'iOS connection evidence verification rejected',
            };
      postCaptureFailureRecord ??= postCaptureFailure('verification', error);
      if (error instanceof Error && /deadline|aborted|abort/i.test(error.message))
        lifecycleFenceFailure = error;
    }
  }

  const t16BTerminal: IosConnectionT16BTerminal | null =
    options.t16Continuation || options.executeConnectionLocale
      ? (() => {
          try {
            assertT16LifecycleFence(
              options.signal,
              options.deadlineAtMonotonicMs,
              'T16 terminal projection',
            );
          } catch (error) {
            lifecycleFenceFailure = error instanceof Error ? error : new Error(String(error));
            outerCleanupBinding = null;
            parentOwnedInputBinding = null;
            externalCleanupResult = 'failed';
          }
          return projectIosConnectionT16BTerminal({
            artifactRoot: capture.artifactRoot,
            execution: capture.report.t16BExecution,
            outerCleanup: lifecycleFenceFailure ? null : outerCleanupBinding,
            parentOwnedInput: lifecycleFenceFailure ? null : parentOwnedInputBinding,
            captureCleanup: terminal.captureCleanup,
            verificationResult: lifecycleFenceFailure ? 'not-executed' : verificationResult,
          });
        })()
      : null;
  if (t16BTerminal) {
    try {
      await awaitT16Lifecycle(
        () =>
          writeFile(
            path.join(capture.artifactRoot, 't16-b-terminal.private.json'),
            JSON.stringify(t16BTerminal, null, 2),
            { flag: 'wx', mode: 0o600 },
          ),
        options.signal,
        options.deadlineAtMonotonicMs,
        'T16 terminal publication',
      );
    } catch (error) {
      lifecycleFenceFailure ??= error instanceof Error ? error : new Error(String(error));
      postCaptureFailureRecord ??= postCaptureFailure('adapter-write', error);
    }
  }
  try {
    assertT16LifecycleFence(
      options.signal,
      options.deadlineAtMonotonicMs,
      'T16 outcome projection',
    );
  } catch (error) {
    lifecycleFenceFailure = error instanceof Error ? error : new Error(String(error));
    outerCleanupBinding = null;
    parentOwnedInputBinding = null;
    externalCleanupResult = 'failed';
    verificationResult = 'not-executed';
  }

  const outcomeWithoutRoot = {
    kind: 'private-owned-ios-connection-attempt-not-public-receipt' as const,
    requestedRunId: options.requestedRunId,
    requestedAttemptId: finalBinding?.requestedAttemptId ?? `${options.requestedRunId}:first`,
    captureRunId: path.basename(capture.artifactRoot),
    backendRunId:
      finalBinding?.backendRunId ?? (typeof fixture.runId === 'string' ? fixture.runId : null),
    backendAttemptId: finalBinding?.backendAttemptId ?? null,
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
    externalCleanupResult,
    outerCleanupBinding: lifecycleFenceFailure ? null : outerCleanupBinding,
    parentOwnedInputBinding: lifecycleFenceFailure ? null : parentOwnedInputBinding,
    verificationResult,
    applicationFailure: null,
    applicationFailureCandidate: null,
    verificationFailure,
    postCaptureFailure: postCaptureFailureRecord,
    deadline: captureDeadline(capture.report.deadline),
    commandDiagnostics: terminal.commandDiagnostics,
    censusFailures: terminal.censusFailures,
    outputFailures: terminal.outputFailures,
    assertionBindings,
    fixtureRunId: typeof fixture.runId === 'string' ? fixture.runId : null,
    fixtureHash: typeof capture.report.fixtureHash === 'string' ? capture.report.fixtureHash : null,
    flagsHash: typeof build.environmentHash === 'string' ? build.environmentHash : null,
    toolVersions: isRecord(capture.report.toolVersions)
      ? (capture.report.toolVersions as Record<string, string>)
      : {},
    timingsMs: {
      build: typeof captureTimings.build === 'number' ? captureTimings.build : 0,
      install: typeof captureTimings.install === 'number' ? captureTimings.install : 0,
      reset: typeof captureTimings.reset === 'number' ? captureTimings.reset : 0,
      scenario: typeof captureTimings.scenario === 'number' ? captureTimings.scenario : 0,
      verify:
        (typeof captureTimings.verify === 'number' ? captureTimings.verify : 0) +
        performance.now() -
        verifyStarted,
      cleanup:
        (typeof captureTimings.cleanup === 'number' ? captureTimings.cleanup : 0) + cleanupMs,
    },
    nativePassingCases: 0 as const,
    t16BTerminal: lifecycleFenceFailure
      ? t16BTerminal
        ? {
            ...t16BTerminal,
            status: 'blocked' as const,
            outerCleanupResult: 'failed' as const,
            outerCleanup: null,
            parentOwnedInput: null,
            verificationResult: 'not-executed' as const,
            blockers: [...new Set([...t16BTerminal.blockers, 'lifecycle-fence-failed'])],
          }
        : null
      : t16BTerminal,
  };
  const outcome = { ...outcomeWithoutRoot, artifactRoot: capture.artifactRoot };
  try {
    await awaitT16Lifecycle(
      () =>
        writeFile(
          path.join(capture.artifactRoot, 'runtime-adapter.private.json'),
          JSON.stringify(outcomeWithoutRoot, null, 2),
          { flag: 'wx', mode: 0o600 },
        ),
      options.signal,
      options.deadlineAtMonotonicMs,
      'runtime adapter publication',
    );
  } catch (error) {
    lifecycleFenceFailure ??= error instanceof Error ? error : new Error(String(error));
    outcome.postCaptureFailure ??= postCaptureFailure('adapter-write', error);
    outcome.externalCleanupResult = 'failed';
    outcome.outerCleanupBinding = null;
    outcome.parentOwnedInputBinding = null;
    outcome.verificationResult = 'not-executed';
    if (outcome.t16BTerminal)
      outcome.t16BTerminal = {
        ...outcome.t16BTerminal,
        status: 'blocked',
        outerCleanupResult: 'failed',
        outerCleanup: null,
        parentOwnedInput: null,
        verificationResult: 'not-executed',
        blockers: [...new Set([...outcome.t16BTerminal.blockers, 'lifecycle-fence-failed'])],
      };
  }
  return outcome;
}

export { normalizeNativeCommandDiagnostic };
