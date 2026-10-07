import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import {
  runIosDetoxConnectionAttemptForNativePilot,
  createDetoxDispatchLifecycleAt,
  detoxDispatchFence,
  type DetoxDispatchDependencies,
  type DetoxDispatchLifecycle,
  type DetoxDispatchQualifiedBuild,
  type DetoxNativePilotAttemptResult,
} from './native-detox-connection-public-dispatch';
import {
  verifyIosDetoxConnectionRuntimeForCanonicalFinalization,
  type DetoxIosConnectionRuntimeFacts,
  type DetoxIosConnectionRuntimeVerificationResult,
} from './native-detox-connection-runtime-verification';
import {
  assertNativePilotCompletion,
  type NativePilotAttemptIdentity,
  type NativePilotSelection,
} from './native-pilot-contract';
import { readNativeEvidenceObservation, type NativeEvidenceIdentity } from './native-view-evidence';
import type { NativeConnectionAssertionBinding } from './native-connection-public-evidence';
import type { DetoxIosConnectionPublicBridgeResult } from './native-detox-connection-public-bridge';
import type {
  NativePilotNamespaceIdentity,
  NativePilotPathIdentity,
  NativePilotTerminalPublication,
} from './native-pilot-invocation';

/**
 * This wrapper is the only source-level bridge between the existing private
 * Detox adapter and the reviewed runtime verifier. The adapter remains
 * source-only; a real producer must provide the original protected receipts,
 * and the canonical runner must provide the terminal publication boundary.
 */
export const DETOX_RUNTIME_DISPATCH_KIND =
  'private-detox-ios-connection-runtime-dispatch-not-public-receipt' as const;

export const IOS_DETOX_TERMINAL_PUBLICATION_BINDING =
  'terminal-publication-binding.private.json' as const;

export type DetoxRuntimeProducerInput = Readonly<{
  repositoryRoot: string;
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  build: DetoxDispatchQualifiedBuild;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  attempt: DetoxNativePilotAttemptResult;
  lifecycle: DetoxDispatchLifecycle;
}>;

/**
 * A producer returns null when the current source-only adapter has no runtime
 * envelope. A non-null value must be built from the producer's protected
 * original receipts; the verifier re-reads every referenced file and rejects
 * caller-only metadata.
 */
export type DetoxRuntimeProducer = (
  input: DetoxRuntimeProducerInput,
) => Promise<DetoxIosConnectionRuntimeFacts | null>;

export type DetoxRuntimeTerminalInput = Readonly<{
  repositoryRoot: string;
  outputRoot: string;
  requestedRunId: string;
  requestedAttemptId: string;
  selection: NativePilotSelection;
  build: DetoxDispatchQualifiedBuild;
  bridgeResult: DetoxIosConnectionPublicBridgeResult;
  attempt: DetoxNativePilotAttemptResult;
  runtime: DetoxIosConnectionRuntimeFacts;
  verification: DetoxIosConnectionRuntimeVerificationResult;
  lifecycle: DetoxDispatchLifecycle;
}>;

/**
 * The callback is owned by the canonical runner. Its receipt is checked with
 * assertNativePilotCompletion before this wrapper can report publication. A
 * missing or unverified publication is always blocked and never promoted.
 */
export type DetoxRuntimeTerminalPublication = Readonly<
  | {
      status: 'published';
      receiptPath: string;
      receipt: unknown;
    }
  | {
      status: 'unverified';
      receiptPath: string;
      receipt: unknown;
      error: { name: string; message: string } | null;
    }
>;

export type DetoxRuntimeDispatchDependencies = Readonly<{
  dispatch?: DetoxDispatchDependencies;
  runAttempt?: typeof runIosDetoxConnectionAttemptForNativePilot;
  loadRuntime?: DetoxRuntimeProducer;
  publishTerminal?: (input: DetoxRuntimeTerminalInput) => Promise<DetoxRuntimeTerminalPublication>;
  validateBuild?: (
    build: DetoxDispatchQualifiedBuild,
    repositoryRoot: string,
  ) => void | Promise<void>;
}>;

export type DetoxRuntimeDispatchResult = Readonly<{
  kind: typeof DETOX_RUNTIME_DISPATCH_KIND;
  status: 'source-only' | 'verified-private' | 'published' | 'blocked';
  requestedRunId: string;
  requestedAttemptId: string;
  attempt: DetoxNativePilotAttemptResult;
  runtime: DetoxIosConnectionRuntimeFacts | null;
  verification: DetoxIosConnectionRuntimeVerificationResult | null;
  terminal: Readonly<{
    status: 'published';
    receiptPath: string;
    assertionBindings: readonly NativeConnectionAssertionBinding[];
  }> | null;
  blocker: Readonly<{
    code:
      | 'runtime-facts-unavailable'
      | 'runtime-producer-failed'
      | 'runtime-verification-failed'
      | 'terminal-boundary-unavailable'
      | 'terminal-publication-failed';
    message: string;
  }> | null;
}>;

/**
 * The binding-aware publisher is reserved for receipts that can actually be
 * promoted. A verified-private dispatcher may still produce a truthful
 * harness-blocked row after repository or finalization evidence fails; that
 * row must use the generic terminal writer so its recovery record survives.
 */
export function shouldUseVerifiedIosDetoxTerminalPublisher(
  input: Readonly<{
    dispatchStatus: DetoxRuntimeDispatchResult['status'] | null | undefined;
    receiptResult: unknown;
  }>,
): boolean {
  return input.dispatchStatus === 'verified-private' && input.receiptResult === 'passed';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blocked(
  input: Readonly<{
    attempt: DetoxNativePilotAttemptResult;
    code: NonNullable<DetoxRuntimeDispatchResult['blocker']>['code'];
    error: unknown;
    runtime?: DetoxIosConnectionRuntimeFacts | null;
    verification?: DetoxIosConnectionRuntimeVerificationResult | null;
  }>,
): DetoxRuntimeDispatchResult {
  return {
    kind: DETOX_RUNTIME_DISPATCH_KIND,
    status: 'blocked',
    requestedRunId: input.attempt.requestedRunId,
    requestedAttemptId: input.attempt.requestedAttemptId,
    attempt: input.attempt,
    runtime: input.runtime ?? null,
    verification: input.verification ?? null,
    terminal: null,
    blocker: { code: input.code, message: errorMessage(input.error) },
  };
}

function requireSourceOnlyRuntimeBoundary(attempt: DetoxNativePilotAttemptResult): void {
  assert.equal(attempt.requestedAttemptId, `${attempt.requestedRunId}:first`);
  assert.equal(attempt.verificationResult, 'passed');
  assert.equal(attempt.captureResult, 'observed');
  assert.equal(attempt.captureExitCode, 0);
  assert.equal(attempt.childExitCode, 0);
  assert.equal(attempt.childSignal, null);
  assert.equal(attempt.childClassification, 'completed');
  assert.equal(attempt.captureCleanup, 'cleaned');
  assert.equal(attempt.externalCleanupResult, 'passed');
  assert.equal(attempt.captureTimeout, null);
  assert.equal(attempt.cancellation, null);
  assert.equal(attempt.deadline, null);
  assert.equal(attempt.postCaptureFailure, null);
  assert.equal(attempt.captureCompleted, true);
  assert.equal(attempt.captureInvocation.count, 1);
  assert.equal(attempt.captureInvocation.returned, true);
  assert.equal(attempt.nativePassingCases, 0);
  assert.equal(attempt.publicFinalization, null);
  assert.equal(attempt.publicFinalizationInput, null);
  assert.equal(attempt.staged, null);
  assert.equal(attempt.detoxBridgeResult.attempt.status, 'source-only');
  assert.equal(attempt.detoxBridgeResult.attempt.acquired, true);
  assert.equal(attempt.detoxBridgeResult.attempt.cleanup, 'cleaned');
  assert.equal(attempt.detoxBridgeResult.attempt.recoveryStatus, 'verified');
  assert.equal(attempt.detoxBridgeResult.nativePassingCases, 0);
  assert.equal(attempt.detoxBridgeResult.publicPromotionEligible, false);
}

function lifecycleForDispatch(
  deadlineMs: number,
  signal: AbortSignal,
  startedAtMonotonicMs: number,
): DetoxDispatchLifecycle {
  return {
    signal,
    deadlineAtMonotonicMs: startedAtMonotonicMs + deadlineMs,
    now: () => performance.now(),
  };
}

function terminalExpected(
  selection: NativePilotSelection,
  build: DetoxDispatchQualifiedBuild,
  runtime: DetoxIosConnectionRuntimeFacts,
  attempt: DetoxNativePilotAttemptResult,
): NativePilotAttemptIdentity {
  return {
    runId: attempt.requestedRunId,
    attemptId: attempt.requestedAttemptId,
    target: {
      deviceId: runtime.target.deviceId,
      osVersion: runtime.target.osVersion,
      appId: runtime.target.appId,
      buildProfile: build.configuration,
      binaryHash: build.binaryHash,
      apiOrigin: runtime.target.apiOrigin,
    },
    inputs: {
      scenarioHash: selection.scenarioHash,
      requirementHash: selection.requirementHash,
      fixtureHash: attempt.fixtureHash,
      flagsHash: attempt.flagsHash,
      toolVersions: attempt.toolVersions,
    },
  };
}

function requirePublishedTerminal(
  input: DetoxRuntimeTerminalInput,
  publication: DetoxRuntimeTerminalPublication,
): Readonly<{
  status: 'published';
  receiptPath: string;
  assertionBindings: readonly NativeConnectionAssertionBinding[];
}> {
  assert.equal(publication.status, 'published');
  assert(typeof publication.receiptPath === 'string' && publication.receiptPath.length > 0);
  const absoluteReceipt = path.isAbsolute(publication.receiptPath)
    ? path.resolve(publication.receiptPath)
    : path.resolve(input.outputRoot, publication.receiptPath);
  const outputRoot = path.resolve(input.outputRoot);
  const relativeReceipt = path.relative(outputRoot, absoluteReceipt);
  assert(relativeReceipt && !relativeReceipt.startsWith('..') && !path.isAbsolute(relativeReceipt));
  detoxDispatchFence(input.lifecycle, 'terminal receipt before read');
  const receiptObservation = readNativeEvidenceObservation(outputRoot, relativeReceipt, true);
  const actualReceipt: unknown = JSON.parse(receiptObservation.bytes.toString('utf8'));
  detoxDispatchFence(input.lifecycle, 'terminal receipt after read');
  assert.deepEqual(
    actualReceipt,
    publication.receipt,
    'Canonical terminal receipt bytes differ from the publisher object',
  );
  assertNativePilotCompletion(
    actualReceipt,
    input.selection,
    terminalExpected(input.selection, input.build, input.runtime, input.attempt),
    [input.attempt.requestedAttemptId],
    outputRoot,
  );
  const receipt = actualReceipt as {
    assertions: NativeConnectionAssertionBinding[];
  };
  const assertionBindings = input.verification.assertionBindings;
  assert.deepEqual(
    receipt.assertions.map((row) => row.id),
    assertionBindings.map((row) => row.id),
    'Canonical terminal assertion order differs from the verified runtime ledger',
  );
  detoxDispatchFence(input.lifecycle, 'terminal receipt validated');
  return {
    status: 'published',
    receiptPath: relativeReceipt,
    assertionBindings,
  };
}

/**
 * Compose the existing private Detox producer with the reviewed verifier. The
 * source-only bridge is called first; runtime facts and the terminal callback
 * are both optional seams so the current adapter remains source-only until a
 * real producer and the canonical writer are present.
 */
export async function runIosDetoxConnectionRuntimeForCanonicalTerminal(
  input: Readonly<{
    repositoryRoot: string;
    serverRoot: string;
    artifactRoot: string;
    outputRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs?: number;
    buildRunId: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  }>,
  dependencies: DetoxRuntimeDispatchDependencies = {},
): Promise<DetoxRuntimeDispatchResult> {
  const startedAtMonotonicMs = performance.now();
  const runAttempt = dependencies.runAttempt ?? runIosDetoxConnectionAttemptForNativePilot;
  const attempt = await runAttempt(input, dependencies.dispatch);
  const lifecycle =
    input.deadlineAtMonotonicMs === undefined
      ? lifecycleForDispatch(input.deadlineMs, input.signal, startedAtMonotonicMs)
      : createDetoxDispatchLifecycleAt(input.deadlineAtMonotonicMs, input.signal);
  try {
    requireSourceOnlyRuntimeBoundary(attempt);
  } catch (error) {
    return blocked({ attempt, code: 'runtime-verification-failed', error });
  }
  if (!dependencies.loadRuntime && attempt.detoxRuntimeFacts === null) {
    try {
      detoxDispatchFence(lifecycle, 'runtime facts unavailable');
    } catch (error) {
      return blocked({ attempt, code: 'runtime-verification-failed', error });
    }
    return {
      kind: DETOX_RUNTIME_DISPATCH_KIND,
      status: 'source-only',
      requestedRunId: attempt.requestedRunId,
      requestedAttemptId: attempt.requestedAttemptId,
      attempt,
      runtime: null,
      verification: null,
      terminal: null,
      blocker: {
        code: 'runtime-facts-unavailable',
        message: 'The source-only Detox producer did not provide an original runtime envelope',
      },
    };
  }
  let runtime: DetoxIosConnectionRuntimeFacts | null;
  try {
    runtime = dependencies.loadRuntime
      ? await dependencies.loadRuntime({
          repositoryRoot: input.repositoryRoot,
          captureRoot: attempt.artifactRoot,
          outputRoot: input.outputRoot,
          requestedRunId: input.requestedRunId,
          requestedAttemptId: input.requestedAttemptId,
          selection: input.selection,
          build: attempt.detoxBuild,
          bridgeResult: attempt.detoxBridgeResult,
          attempt,
          lifecycle,
        })
      : attempt.detoxRuntimeFacts;
  } catch (error) {
    return blocked({ attempt, code: 'runtime-producer-failed', error });
  }
  try {
    detoxDispatchFence(lifecycle, 'runtime facts loaded');
  } catch (error) {
    return blocked({
      attempt,
      runtime,
      code: 'runtime-verification-failed',
      error,
    });
  }
  if (runtime === null) {
    return {
      kind: DETOX_RUNTIME_DISPATCH_KIND,
      status: 'source-only',
      requestedRunId: attempt.requestedRunId,
      requestedAttemptId: attempt.requestedAttemptId,
      attempt,
      runtime: null,
      verification: null,
      terminal: null,
      blocker: {
        code: 'runtime-facts-unavailable',
        message: 'The Detox producer has no complete original runtime envelope',
      },
    };
  }
  let verification: DetoxIosConnectionRuntimeVerificationResult;
  try {
    verification = await verifyIosDetoxConnectionRuntimeForCanonicalFinalization({
      repositoryRoot: input.repositoryRoot,
      captureRoot: attempt.artifactRoot,
      outputRoot: input.outputRoot,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      selection: input.selection,
      build: attempt.detoxBuild,
      bridgeResult: attempt.detoxBridgeResult,
      runtime,
      lifecycle,
      validateBuild: dependencies.validateBuild,
    });
    detoxDispatchFence(lifecycle, 'runtime verification complete');
  } catch (error) {
    return blocked({
      attempt,
      runtime,
      verification: null,
      code: 'runtime-verification-failed',
      error,
    });
  }
  if (!dependencies.publishTerminal) {
    return {
      kind: DETOX_RUNTIME_DISPATCH_KIND,
      status: 'verified-private',
      requestedRunId: attempt.requestedRunId,
      requestedAttemptId: attempt.requestedAttemptId,
      attempt,
      runtime,
      verification,
      terminal: null,
      blocker: {
        code: 'terminal-boundary-unavailable',
        message:
          'Runtime evidence is verified privately; the canonical terminal writer is unavailable',
      },
    };
  }
  let publication: DetoxRuntimeTerminalPublication;
  try {
    publication = await dependencies.publishTerminal({
      repositoryRoot: input.repositoryRoot,
      outputRoot: input.outputRoot,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      selection: input.selection,
      build: attempt.detoxBuild,
      bridgeResult: attempt.detoxBridgeResult,
      attempt,
      runtime,
      verification,
      lifecycle,
    });
  } catch (error) {
    return blocked({
      attempt,
      runtime,
      verification,
      code: 'terminal-publication-failed',
      error,
    });
  }
  if (publication.status !== 'published')
    return blocked({
      attempt,
      runtime,
      verification,
      code: 'terminal-publication-failed',
      error: publication.error ?? 'Canonical terminal publication remained unverified',
    });
  try {
    const terminal = requirePublishedTerminal(
      {
        repositoryRoot: input.repositoryRoot,
        outputRoot: input.outputRoot,
        requestedRunId: input.requestedRunId,
        requestedAttemptId: input.requestedAttemptId,
        selection: input.selection,
        build: attempt.detoxBuild,
        bridgeResult: attempt.detoxBridgeResult,
        attempt,
        runtime,
        verification,
        lifecycle,
      },
      publication,
    );
    return {
      kind: DETOX_RUNTIME_DISPATCH_KIND,
      status: 'published',
      requestedRunId: attempt.requestedRunId,
      requestedAttemptId: attempt.requestedAttemptId,
      attempt,
      runtime,
      verification,
      terminal,
      blocker: null,
    };
  } catch (error) {
    return blocked({
      attempt,
      runtime,
      verification,
      code: 'terminal-publication-failed',
      error,
    });
  }
}

/**
 * Re-read and stage the verified private runtime at the outer P4 boundary.
 * This deliberately has no terminal callback: run-native-pilot owns the one
 * canonical receipt writer. A second protected verification is required so
 * the final receipt cannot rely on earlier private staging or caller metadata
 * that changed while the native attempt was settling.
 */
export async function reverifyIosDetoxConnectionRuntimeForOuterTerminal(
  input: Readonly<{
    dispatch: DetoxRuntimeDispatchResult;
    repositoryRoot: string;
    outputRoot: string;
    selection: NativePilotSelection;
    lifecycle: DetoxDispatchLifecycle;
  }>,
): Promise<DetoxIosConnectionRuntimeVerificationResult> {
  assert.equal(input.dispatch.status, 'verified-private');
  assert(input.dispatch.runtime, 'Verified Detox runtime facts are unavailable');
  assert(input.dispatch.verification, 'Verified Detox runtime ledger is unavailable');
  const attempt = input.dispatch.attempt;
  assert.equal(attempt.requestedRunId, input.dispatch.requestedRunId);
  assert.equal(attempt.requestedAttemptId, input.dispatch.requestedAttemptId);
  return verifyIosDetoxConnectionRuntimeForCanonicalFinalization({
    repositoryRoot: input.repositoryRoot,
    captureRoot: attempt.artifactRoot,
    outputRoot: input.outputRoot,
    requestedRunId: input.dispatch.requestedRunId,
    requestedAttemptId: input.dispatch.requestedAttemptId,
    selection: input.selection,
    build: attempt.detoxBuild,
    bridgeResult: attempt.detoxBridgeResult,
    runtime: input.dispatch.runtime,
    lifecycle: {
      signal: input.lifecycle.signal,
      deadlineAtMonotonicMs: input.lifecycle.deadlineAtMonotonicMs,
    },
  });
}

export type DetoxOuterTerminalPublisher = (input: {
  root: string;
  receipt: unknown;
  namespaceIdentity: NativePilotNamespaceIdentity;
  callerSignal?: AbortSignal;
  recoveryDeadlineMs: number;
}) => Promise<NativePilotTerminalPublication>;

type DetoxTerminalPublicationBinding = {
  kind: 'native-detox-ios-terminal-publication-binding-v1';
  status: 'staged' | 'published' | 'invalidated';
  receiptPath: string;
  receiptHash: string;
  receiptIdentity: NativeEvidenceIdentity;
  outputRoot: string;
  outputIdentity: NativePilotPathIdentity;
  requestedRunId: string;
  requestedAttemptId: string;
  deadlineAtMonotonicMs: number;
  committedAtMonotonicMs: number;
  invalidationReason?: string;
  writer: { kind: 'native-pilot-terminal-receipt'; pid: number };
};

function samePathIdentity(
  expected: NativePilotPathIdentity,
  actual: {
    path: string;
    dev: number;
    ino: number;
    uid: number;
    gid: number;
    mode: number;
  },
): boolean {
  return (
    expected.path === actual.path &&
    expected.dev === actual.dev &&
    expected.ino === actual.ino &&
    expected.uid === actual.uid &&
    expected.gid === actual.gid &&
    expected.mode === actual.mode
  );
}

function assertNamespaceOutputIdentity(
  outputRoot: string,
  namespaceIdentity: NativePilotNamespaceIdentity,
): NativePilotPathIdentity {
  const resolvedRoot = path.resolve(outputRoot);
  const expectedOutput = namespaceIdentity.output.entries.at(-1);
  assert(expectedOutput && expectedOutput.path === resolvedRoot);
  const rootStat = lstatSync(resolvedRoot);
  assert(rootStat.isDirectory());
  assert.equal(realpathSync(resolvedRoot), resolvedRoot);
  const actualRoot = {
    path: resolvedRoot,
    dev: rootStat.dev,
    ino: rootStat.ino,
    uid: rootStat.uid,
    gid: rootStat.gid,
    mode: rootStat.mode,
  };
  assert(
    samePathIdentity(expectedOutput, actualRoot),
    'Detox terminal output root identity changed',
  );
  return expectedOutput;
}

/**
 * Commit the collector binding as the last non-yielding publication step.
 * The receipt itself is written by the existing bounded writer and reread by
 * the protected reader first. A collector may only promote an iOS/Detox
 * receipt when this direct-child binding exists and matches that readback.
 * O_EXCL/O_NOFOLLOW plus the captured output identity keep the binding tied to
 * the same owned namespace; no later async operation can turn an unverified
 * helper result into a bound publication.
 */
function commitDetoxTerminalPublicationBinding(input: {
  outputRoot: string;
  namespaceIdentity: NativePilotNamespaceIdentity;
  receiptPath: string;
  receiptBytes: Buffer;
  receiptIdentity: NativeEvidenceIdentity;
  requestedRunId: string;
  requestedAttemptId: string;
  signal: AbortSignal;
  deadlineAtMonotonicMs: number;
}): string {
  const outputIdentity = assertNamespaceOutputIdentity(input.outputRoot, input.namespaceIdentity);
  const bindingPath = path.join(
    path.resolve(input.outputRoot),
    IOS_DETOX_TERMINAL_PUBLICATION_BINDING,
  );
  const bindingBase: Omit<DetoxTerminalPublicationBinding, 'status' | 'committedAtMonotonicMs'> = {
    kind: 'native-detox-ios-terminal-publication-binding-v1',
    receiptPath: path.resolve(input.receiptPath),
    receiptHash: createHash('sha256').update(input.receiptBytes).digest('hex'),
    receiptIdentity: input.receiptIdentity,
    outputRoot: path.resolve(input.outputRoot),
    outputIdentity,
    requestedRunId: input.requestedRunId,
    requestedAttemptId: input.requestedAttemptId,
    deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    writer: { kind: 'native-pilot-terminal-receipt', pid: process.pid },
  };

  const writeBinding = (
    binding: DetoxTerminalPublicationBinding,
    create: boolean,
    expectedIdentity?: NativePilotPathIdentity,
  ): NativePilotPathIdentity => {
    const flags = create
      ? fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW
      : fsConstants.O_WRONLY | fsConstants.O_NOFOLLOW;
    const descriptor = openSync(bindingPath, flags, 0o600);
    let failure: unknown;
    try {
      const descriptorBefore = fstatSync(descriptor);
      assert(descriptorBefore.isFile());
      assert.equal(descriptorBefore.nlink, 1);
      assert.equal(descriptorBefore.mode & 0o777, 0o600);
      if (expectedIdentity)
        assert(
          samePathIdentity(expectedIdentity, {
            path: bindingPath,
            dev: descriptorBefore.dev,
            ino: descriptorBefore.ino,
            uid: descriptorBefore.uid,
            gid: descriptorBefore.gid,
            mode: descriptorBefore.mode,
          }),
          'Detox terminal publication binding identity changed before rewrite',
        );
      ftruncateSync(descriptor, 0);
      const bytes = Buffer.from(JSON.stringify(binding) + '\n');
      let offset = 0;
      while (offset < bytes.length) {
        const written = writeSync(descriptor, bytes, offset, bytes.length - offset);
        if (written <= 0) throw new Error('Detox terminal publication binding made no progress');
        offset += written;
      }
      fsyncSync(descriptor);
      const descriptorAfter = fstatSync(descriptor);
      assert(descriptorAfter.isFile());
      assert.equal(descriptorAfter.nlink, 1);
      assert.equal(descriptorAfter.mode & 0o777, 0o600);
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        closeSync(descriptor);
      } catch (closeError) {
        if (!failure) throw closeError;
      }
    }
    const final = lstatSync(bindingPath);
    assert(final.isFile());
    assert.equal(final.nlink, 1);
    assert.equal(final.mode & 0o777, 0o600);
    const identity: NativePilotPathIdentity = {
      path: bindingPath,
      dev: final.dev,
      ino: final.ino,
      uid: final.uid,
      gid: final.gid,
      mode: final.mode,
    };
    if (expectedIdentity) assert(samePathIdentity(expectedIdentity, identity));
    return identity;
  };

  const invalidate = (markerIdentity: NativePilotPathIdentity, reason: string): void => {
    try {
      writeBinding(
        {
          ...bindingBase,
          status: 'invalidated',
          committedAtMonotonicMs: performance.now(),
          invalidationReason: reason,
        },
        false,
        markerIdentity,
      );
    } catch (error) {
      try {
        const current = lstatSync(bindingPath);
        const currentIdentity: NativePilotPathIdentity = {
          path: bindingPath,
          dev: current.dev,
          ino: current.ino,
          uid: current.uid,
          gid: current.gid,
          mode: current.mode,
        };
        if (samePathIdentity(markerIdentity, currentIdentity)) unlinkSync(bindingPath);
      } catch {
        // The caller still returns unverified; collector intake rejects any
        // missing, staged, malformed or identity-mismatched binding.
      }
      throw error;
    }
  };

  const stagedIdentity = writeBinding(
    { ...bindingBase, status: 'staged', committedAtMonotonicMs: 0 },
    true,
  );
  if (input.signal.aborted || performance.now() >= input.deadlineAtMonotonicMs) {
    invalidate(
      stagedIdentity,
      input.signal.aborted
        ? 'cancelled before binding commit'
        : 'deadline elapsed before binding commit',
    );
    throw new Error(
      input.signal.aborted
        ? 'iOS Detox terminal publication was cancelled before binding commit'
        : 'iOS Detox terminal publication deadline elapsed before binding commit',
    );
  }

  const committedAtMonotonicMs = performance.now();
  const publishedIdentity = writeBinding(
    { ...bindingBase, status: 'published', committedAtMonotonicMs },
    false,
    stagedIdentity,
  );
  if (input.signal.aborted || performance.now() >= input.deadlineAtMonotonicMs) {
    invalidate(
      publishedIdentity,
      input.signal.aborted
        ? 'cancelled during binding commit'
        : 'deadline elapsed during binding commit',
    );
    throw new Error(
      input.signal.aborted
        ? 'iOS Detox terminal publication was cancelled during binding commit'
        : 'iOS Detox terminal publication deadline elapsed during binding commit',
    );
  }
  return bindingPath;
}

/**
 * Publish the already-finalized iOS Detox receipt through the one outer writer.
 * The producer/verifier remains private until the caller has staged the actual
 * assertion artifacts and assembled the P4 receipt. This helper is deliberately
 * separate from the pre-finalization runtime dispatch so a callback cannot
 * publish a partial receipt or create a second owner/terminal writer.
 */
export async function publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal(
  input: Readonly<{
    dispatch: DetoxRuntimeDispatchResult;
    receipt: unknown;
    outputRoot: string;
    selection: NativePilotSelection;
    namespaceIdentity: NativePilotNamespaceIdentity;
    signal: AbortSignal;
    deadlineAtMonotonicMs: number;
    recoveryDeadlineMs?: number;
    publishTerminal: DetoxOuterTerminalPublisher;
  }>,
): Promise<NativePilotTerminalPublication> {
  const receiptPath = path.join(input.outputRoot, 'receipt.json');
  const unverified = (
    error: unknown,
    recoveryRecordPath: string | null = null,
  ): NativePilotTerminalPublication => ({
    status: 'unverified',
    receiptPath,
    recoveryRecordPath,
    error: {
      name: error instanceof Error ? error.name : 'TerminalPublicationError',
      code: null,
      message: error instanceof Error ? error.message : String(error),
    },
  });
  const assertOuterLifecycle = (phase: string): void => {
    assert(!input.signal.aborted, `iOS Detox terminal publication was cancelled during ${phase}`);
    assert(
      performance.now() < input.deadlineAtMonotonicMs,
      `iOS Detox terminal publication deadline elapsed during ${phase}`,
    );
  };
  try {
    assert.equal(input.dispatch.status, 'verified-private');
    assert(input.dispatch.runtime, 'Verified iOS Detox runtime facts are unavailable');
    assert(input.dispatch.verification, 'Verified iOS Detox runtime ledger is unavailable');
    assertOuterLifecycle('pre-write validation');
    const attempt = input.dispatch.attempt;
    assert.equal(attempt.requestedRunId, input.dispatch.requestedRunId);
    assert.equal(attempt.requestedAttemptId, input.dispatch.requestedAttemptId);
    assertNativePilotCompletion(
      input.receipt,
      input.selection,
      terminalExpected(input.selection, attempt.detoxBuild, input.dispatch.runtime, attempt),
      [attempt.requestedAttemptId],
      input.outputRoot,
    );
    const receiptRecord = input.receipt as {
      assertions: readonly { id: string }[];
    };
    assert.deepEqual(
      receiptRecord.assertions.map((row) => row.id),
      input.dispatch.verification.assertionBindings.map((row) => row.id),
      'Outer receipt assertion order differs from the protected Detox runtime ledger',
    );
    const publication = await input.publishTerminal({
      root: input.outputRoot,
      receipt: input.receipt,
      namespaceIdentity: input.namespaceIdentity,
      callerSignal: input.signal,
      recoveryDeadlineMs: input.recoveryDeadlineMs ?? 30_000,
    });
    try {
      assertOuterLifecycle('publisher completion');
    } catch (error) {
      return unverified(error, publication.recoveryRecordPath);
    }
    if (publication.status !== 'published') return publication;
    assert(path.resolve(publication.receiptPath) === path.resolve(receiptPath));
    const observation = readNativeEvidenceObservation(input.outputRoot, 'receipt.json', false);
    assertOuterLifecycle('receipt reread');
    const actualReceipt: unknown = JSON.parse(observation.bytes.toString('utf8'));
    assert.deepEqual(
      actualReceipt,
      input.receipt,
      'Outer canonical receipt bytes differ from the publisher input',
    );
    assertOuterLifecycle('receipt byte validation');
    assertNativePilotCompletion(
      actualReceipt,
      input.selection,
      terminalExpected(input.selection, attempt.detoxBuild, input.dispatch.runtime, attempt),
      [attempt.requestedAttemptId],
      input.outputRoot,
    );
    assertOuterLifecycle('final receipt validation');
    commitDetoxTerminalPublicationBinding({
      outputRoot: input.outputRoot,
      namespaceIdentity: input.namespaceIdentity,
      receiptPath,
      receiptBytes: observation.bytes,
      receiptIdentity: observation.identity,
      requestedRunId: input.dispatch.requestedRunId,
      requestedAttemptId: input.dispatch.requestedAttemptId,
      signal: input.signal,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
    });
    return publication;
  } catch (error) {
    return unverified(error);
  }
}
