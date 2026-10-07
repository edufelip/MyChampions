import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { lstat, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readDetoxConnectionPath } from './detox-connection-evidence';
import { assertNoIntegratedBypasses } from './integration-preflight';
import { AndroidCameraPublicStageError } from './native-android-camera-public-staging';
import { finalizeAndroidCameraNativeRuntime } from './native-android-camera-runtime-finalizer';
import {
  stageNativeAndroidSaveRetryPublicEvidence,
  verifyStagedNativeAndroidSaveRetryEvidence,
} from './native-android-save-retry-public-evidence';
import { sourceIdentity } from './native-build-identity';
import { loadReusableIosBuild } from './native-build-reuse';
import {
  nativeCameraRuntimeSidecarPaths,
  stageIosCameraSubmissionEvidence,
  validateIosCameraSubmissionPreparation,
} from './native-camera-submission-evidence';
import {
  stageNativeConnectionPublicEvidence,
  verifyStagedNativeConnectionEvidence,
} from './native-connection-public-evidence';
import {
  runAndroidDetoxSessionAttemptForNativePilot,
  type AndroidDetoxSessionNativePilotAttempt,
} from './native-detox-android-session-native-pilot-route';
import {
  androidDetoxSessionVerifiedTerminalEvidenceName,
  buildAndroidDetoxSessionVerifiedTerminalProof,
  mapAndroidDetoxSessionAssertionsToOuterTerminal,
  stageAndroidDetoxSessionPublicEvidence,
  verifyStagedAndroidDetoxSessionEvidence,
} from './native-detox-android-session-public-finalization';
import { AndroidDetoxSessionStagingError } from './native-detox-android-session-public-staging';
import {
  isAndroidDetoxCameraPublicArguments,
  runAndroidDetoxCameraAttemptForNativePilot,
  type AndroidDetoxCameraNativePilotAttempt,
} from './native-detox-camera-android-native-pilot-route';
import { ANDROID_DETOX_CAMERA_FINALIZER_RECEIPT_PATH } from './native-detox-camera-android-public-finalizer';
import { verifyDetoxIosCameraPrivateEvidence } from './native-detox-camera-ios-verifier';
import {
  ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH,
  runAndroidDetoxConnectionAttemptForNativePilot,
  type DetoxAndroidNativePilotAttemptResult,
} from './native-detox-connection-android-public-dispatch';
import {
  stageAndroidDetoxConnectionPublicEvidence,
  verifyStagedAndroidDetoxConnectionPublicEvidence,
} from './native-detox-connection-android-public-staging';
import {
  stageIosDetoxConnectionPublicEvidence,
  verifyStagedIosDetoxConnectionPublicEvidence,
} from './native-detox-connection-public-staging';
import {
  stageDetoxSessionPublicEvidence,
  verifyStagedDetoxSessionEvidence,
} from './native-detox-session-public-staging';
import { NativeHostContentionError, requireNativeHostAvailability } from './native-host-contention';
import {
  stageNativeQuantityFailure,
  verifyStagedNativeQuantityFailure,
} from './native-maestro-assertion-failure';
import {
  assertNativePilotCompletion,
  nativeCameraDeniedAssertionIds,
  requireNativePilotAssertions,
  isIosCredentialInteractionDiagnosticSelection,
  selectNativePilotScenario,
  nativePilotTargetFromCapture,
  type NativePilotArguments,
  type NativePilotSelection,
  type NativePilotTarget,
} from './native-pilot-contract';
import {
  formatNativePilotInvocationArguments,
  nativePilotDefaultOutputParent,
  prepareNativePilotColdInvocation,
  NativePilotRecoveryDeadlineError,
  type NativePilotPreflightBlockReason,
  type NativePilotRepositoryEvidence,
  parseNativePilotInvocationArguments,
  nativePilotRuntimeArtifactReferences,
  writeNativePilotOptionalPrivateFile,
  writeNativePilotPrivateFile,
  writeNativePilotBlockedReceipt,
  writeNativePilotTerminalReceipt,
  type NativePilotTerminalPublication,
  createNativePilotOutputRoot,
} from './native-pilot-invocation';
import { installNativePilotPreflightLifecycle } from './native-pilot-preflight';
import { parseNativeExecutionDeadlines } from './native-runtime-preflight';
import {
  stageNativeSaveRetryPublicEvidence,
  verifyStagedNativeSaveRetryEvidence,
} from './native-save-retry-public-evidence';
import {
  removeNativeSessionPublicEvidenceStage,
  stageNativeSessionPublicEvidence,
  verifyNativeSessionPublicEvidence,
} from './native-session-public-finalization';
import {
  NativeTrainingPublicEvidenceStageError,
  stageNativeTrainingPublicEvidence,
  verifyStagedNativeTrainingEvidence,
} from './native-training-public-evidence';
import { readNativeEvidence } from './native-view-evidence';
import { parseIosSimulatorBootstatusDeadline } from './owned-ios-simulator';
import {
  finalizeAndroidCameraPublicEvidence,
  isAndroidCameraPublicArguments,
  runAndroidCameraPublicAttempt,
  type AndroidCameraPublicAttemptOptions,
  type AndroidCameraPublicAttemptResult,
} from './run-android-camera-public-attempt';
import { runAndroidConnectionAttempt } from './run-android-connection-attempt';
import { runAndroidSaveRetryAttempt } from './run-android-save-retry-attempt';
import { runAndroidSessionAttempt } from './run-android-session-attempt';
import { runAndroidTrainingAttempt } from './run-android-training-attempt';
import { requireIosCameraAttemptLifecycle, runIosCameraAttempt } from './run-ios-camera-attempt';
import { runIosConnectionAttempt } from './run-ios-connection-attempt';
import { runIosSaveRetryAttempt } from './run-ios-save-retry-attempt';
import {
  isIosSessionCaptureResultConsistent,
  runIosSessionAttempt,
} from './run-ios-session-attempt';
import { runIosTrainingAttempt } from './run-ios-training-attempt';
import { assertPublicReceipt } from './schema-validation';
import {
  consumeChildColdReset,
  type ChildColdResetBinding,
  type ColdResetChildExpectation,
  readChildCaptureFromOwnedRoot,
} from './t15-cold-reset-child-consumption';
import {
  handoffColdResetReceiptFromProcessBinding,
  type ColdResetHandoff,
} from './t15-cold-reset-handoff';
import { buildColdResetRuntimeLinkBinding } from './t15-cold-runtime-link';
import { runT15AndroidDetoxSessionColdRoute } from './t15-detox-android-session-cold-route';
import {
  blockAndroidDetoxSessionOuterReceiptForBridgeFailure,
  promoteAndroidDetoxSessionOuterReceiptAfterBridge,
  reconcileT15AndroidDetoxSessionOuterReceipt,
} from './t15-detox-android-session-public-receipt-bridge';
import {
  runOwnedT16BFromOwnedIosNativeSession,
  type T16BOwnedIosNativeEntrypointInput,
  type T16BOwnedIosNativeEntrypointResult,
} from './t16b-owned-ios-native-entrypoint';
import {
  createRepositoryObservation,
  repositoryIdentity,
  type RepositoryIdentity,
} from './testing-repository-identity';
import type { DetoxBaselineReport } from './detox-integrated-session-baseline';
import type { AndroidDetoxSessionPublicAdapterResult } from './native-detox-android-session-public-adapter';
import type * as IosDetoxConnectionPublicDispatch from './native-detox-connection-public-dispatch';
import type * as IosDetoxConnectionRuntimeDispatch from './native-detox-connection-runtime-dispatch';
import type * as IosDetoxSessionNativePilotRoute from './native-detox-session-native-pilot-route';
import type { IosDetoxSessionPublicAdapterResult } from './native-detox-session-public-adapter';
import type * as IosDetoxTrainingPublicDispatch from './native-detox-training-public-dispatch';
import type { ProxyObservation } from './owned-api-proxy';
import type * as IosDetoxCameraPublicDispatch from './run-ios-detox-camera-attempt';
import type { ColdResetPreparationExpectation } from './t15-cold-ios-reset-producer';

/**
 * Keep iOS Detox dispatchers behind a runtime platform boundary. The Android
 * Maestro/Detox owner starts from this unified CLI, so a static import here
 * would make the Android production graph load iOS training and connection
 * code before the selected platform is known.
 */
export const IOS_DETOX_CONNECTION_PUBLIC_DISPATCH = 'ios-detox-connection' as const;
export const IOS_DETOX_TRAINING_PUBLIC_DISPATCH = 'ios-detox-training' as const;
export const IOS_DETOX_CAMERA_PUBLIC_DISPATCH = 'ios-detox-camera' as const;

const iosDetoxConnectionDispatchSpecifier = ['.', 'native-detox-connection-public-dispatch'].join(
  '/',
);
const iosDetoxTrainingDispatchSpecifier = ['.', 'native-detox-training-public-dispatch'].join('/');
const iosDetoxConnectionRuntimeDispatchSpecifier = [
  '.',
  'native-detox-connection-runtime-dispatch',
].join('/');
const iosDetoxSessionRouteSpecifier = ['.', 'native-detox-session-native-pilot-route'].join('/');
const iosDetoxCameraDispatchSpecifier = ['.', 'run-ios-detox-camera-attempt'].join('/');

async function loadIosDetoxConnectionPublicDispatch(): Promise<
  typeof IosDetoxConnectionPublicDispatch
> {
  return (await import(
    iosDetoxConnectionDispatchSpecifier
  )) as typeof IosDetoxConnectionPublicDispatch;
}

async function loadIosDetoxTrainingPublicDispatch(): Promise<
  typeof IosDetoxTrainingPublicDispatch
> {
  return (await import(iosDetoxTrainingDispatchSpecifier)) as typeof IosDetoxTrainingPublicDispatch;
}

async function loadIosDetoxConnectionRuntimeDispatch(): Promise<
  typeof IosDetoxConnectionRuntimeDispatch
> {
  return (await import(
    iosDetoxConnectionRuntimeDispatchSpecifier
  )) as typeof IosDetoxConnectionRuntimeDispatch;
}

async function loadIosDetoxSessionNativePilotRoute(): Promise<
  typeof IosDetoxSessionNativePilotRoute
> {
  return (await import(iosDetoxSessionRouteSpecifier)) as typeof IosDetoxSessionNativePilotRoute;
}

async function loadIosDetoxCameraPublicDispatch(): Promise<typeof IosDetoxCameraPublicDispatch> {
  return (await import(iosDetoxCameraDispatchSpecifier)) as typeof IosDetoxCameraPublicDispatch;
}

type ProtectedInventoryLifecycle = Readonly<{
  signal?: AbortSignal;
  deadlineAtMs: number;
  fixtureNow?: () => number;
}>;

export async function readProtectedInventory(
  root: string,
  lifecycle: ProtectedInventoryLifecycle,
): Promise<unknown> {
  const file = path.join(root, 'docs/qa/native-pilot/inventory.json');
  const evidence = await readDetoxConnectionPath(file, 16 * 1024 * 1024, {
    signal: lifecycle.signal,
    deadlineAt: lifecycle.deadlineAtMs,
  });
  assert(evidence.bytes.byteLength > 0 && evidence.bytes.byteLength <= 16 * 1024 * 1024);
  const digest = createHash('sha256').update(evidence.bytes).digest('hex');
  assert(/^[a-f0-9]{64}$/u.test(digest));
  const parsed = JSON.parse(evidence.bytes.toString('utf8')) as unknown;
  lifecycle.signal?.throwIfAborted();
  if (lifecycle.fixtureNow !== undefined) {
    assert(process.env.NODE_ENV === 'test', 'fixture clock is test-only');
  }
  const observedNow = lifecycle.fixtureNow?.() ?? performance.now();
  assert(
    observedNow < lifecycle.deadlineAtMs,
    'Protected native inventory parse exceeded the original deadline',
  );
  return parsed;
}

type NativePilotAttempt =
  | Awaited<ReturnType<typeof runIosTrainingAttempt>>
  | Awaited<ReturnType<typeof runAndroidTrainingAttempt>>
  | Awaited<ReturnType<typeof runAndroidSaveRetryAttempt>>
  | Awaited<ReturnType<typeof runIosSaveRetryAttempt>>
  | Awaited<ReturnType<typeof runIosConnectionAttempt>>
  | Awaited<ReturnType<typeof runAndroidConnectionAttempt>>
  | IosDetoxConnectionPublicDispatch.DetoxNativePilotAttemptResult
  | IosDetoxTrainingPublicDispatch.DetoxIosTrainingNativePilotAttemptResult
  | IosDetoxSessionNativePilotRoute.IosDetoxSessionNativePilotAttempt
  | AndroidDetoxSessionNativePilotAttempt
  | DetoxAndroidNativePilotAttemptResult
  | AndroidDetoxCameraNativePilotAttempt
  | Awaited<
      ReturnType<typeof IosDetoxCameraPublicDispatch.runIosDetoxCameraAttemptForPublicDispatch>
    >
  | Awaited<ReturnType<typeof runIosCameraAttempt>>
  | Awaited<ReturnType<typeof runIosSessionAttempt>>
  | Awaited<ReturnType<typeof runAndroidSessionAttempt>>
  | Awaited<ReturnType<typeof runAndroidCameraPublicAttempt>>;

function isAndroidCameraPublicAttemptResult(
  value: NativePilotAttempt,
): value is AndroidCameraPublicAttemptResult {
  return (
    'kind' in value &&
    value.kind === 'private-owned-android-camera-public-attempt-not-public-receipt'
  );
}

type AndroidCameraRecoveryReceipt = {
  artifacts: string[];
  cleanup: {
    status: string;
    recoveryRecordPath: string | null;
  };
};

/**
 * Publish only retained recovery entries that are real output-root-relative
 * paths.  Staging errors are produced after partial writes, so the runner must
 * preserve safe evidence while rejecting stale stage-root-relative or
 * traversal references instead of manufacturing receipt paths.
 */
export async function appendAndroidCameraRecoveryArtifacts(
  receipt: AndroidCameraRecoveryReceipt,
  outputRoot: string,
  retainedPaths: readonly unknown[],
): Promise<readonly string[]> {
  const resolvedRoot = path.resolve(outputRoot);
  const rejected: string[] = [];
  let canonicalRoot: string | null = null;
  try {
    canonicalRoot = await realpath(resolvedRoot);
  } catch {
    canonicalRoot = null;
  }
  for (const retainedPath of retainedPaths) {
    if (
      typeof retainedPath !== 'string' ||
      retainedPath.length === 0 ||
      path.isAbsolute(retainedPath) ||
      retainedPath.includes('\\') ||
      retainedPath.split('/').includes('..') ||
      retainedPath.includes('\0')
    ) {
      rejected.push(typeof retainedPath === 'string' ? retainedPath : String(retainedPath));
      continue;
    }
    const resolvedPath = path.resolve(resolvedRoot, retainedPath);
    if (
      canonicalRoot === null ||
      canonicalRoot !== resolvedRoot ||
      !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      rejected.push(retainedPath);
      continue;
    }
    try {
      const canonicalPath = await realpath(resolvedPath);
      if (
        canonicalPath !== resolvedPath ||
        !canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)
      ) {
        rejected.push(retainedPath);
        continue;
      }
      const observed = await lstat(resolvedPath);
      if (!observed.isFile() && !observed.isDirectory()) {
        rejected.push(retainedPath);
        continue;
      }
    } catch {
      rejected.push(retainedPath);
      continue;
    }
    if (!receipt.artifacts.includes(retainedPath)) receipt.artifacts.push(retainedPath);
  }
  if (rejected.length > 0) receipt.cleanup.status = 'failed-recovery-ledger-retained';
  return rejected;
}

type AndroidDetoxSessionRecoveryReceipt = AndroidCameraRecoveryReceipt;

/** Attach the staging ledger produced in the owned capture root to the outer
 * receipt.  Retained stage paths remain inside that ledger because they are
 * relative to a sibling staging namespace and cannot safely be re-rooted. */
export async function attachAndroidDetoxSessionStagingRecovery(
  receipt: AndroidDetoxSessionRecoveryReceipt,
  outputRoot: string,
  error: Pick<
    AndroidDetoxSessionStagingError,
    'recoveryStatus' | 'recoveryRecordPath' | 'recoveryPublication' | 'childLifecycle'
  >,
): Promise<readonly string[]> {
  if (
    error.recoveryStatus === 'failed-recovery-ledger-retained' ||
    error.recoveryPublication === 'unknown'
  )
    receipt.cleanup.status =
      error.recoveryPublication === 'unknown'
        ? 'failed-recovery-ledger-retained'
        : error.recoveryStatus;
  if (error.recoveryRecordPath === null) return [];
  const rejected = await appendAndroidCameraRecoveryArtifacts(receipt, outputRoot, [
    error.recoveryRecordPath,
  ]);
  if (!rejected.includes(error.recoveryRecordPath) && receipt.cleanup.recoveryRecordPath === null)
    receipt.cleanup.recoveryRecordPath = error.recoveryRecordPath;
  return rejected;
}

/**
 * The outer P4 row may pass only after the producer proved an executed Detox
 * command, the strict lifecycle normalizer accepted the private ledgers, the
 * protected writer published a real receipt that was reread, and the shared
 * lifecycle matched its sealed contract. Missing gate inputs are failures;
 * source fixtures and in-memory candidates never receive terminal credit.
 */
export function shouldBlockAndroidDetoxSessionOuterTerminal(input: {
  nativeExecution: boolean;
  lifecycleNormalization: { status: string };
  publicReceiptBound: boolean;
  sharedLifecycleStatus: string;
}): boolean {
  return (
    input.nativeExecution !== true ||
    input.lifecycleNormalization?.status !== 'private-candidate' ||
    input.publicReceiptBound !== true ||
    input.sharedLifecycleStatus !== 'sealed-contract-compatible'
  );
}

type NativePilotChildClassification =
  | 'completed'
  | 'child-failed'
  | 'deadline'
  | 'cancelled'
  | 'output-limit'
  | 'output-failed'
  | 'harness-blocked'
  | null;

export type NativePilotRuntimeTerminalFacts = {
  captureResult: string;
  captureTimeout: 'whole-capture' | null;
  cancellation: 'SIGINT' | 'SIGTERM' | null;
  childExitCode: number | null;
  childSignal: NodeJS.Signals | null;
  childClassification: NativePilotChildClassification;
  censusFailureCount: number;
  deadline: { step: string; deadlineMs: number } | null;
  externalCleanupResult: string;
  postCaptureFailurePhase: 'cleanup' | 'verification' | 'adapter-write' | null;
  verificationResult: string;
};

export type NativePilotTerminalDecision = {
  result: 'harness-blocked' | 'cancelled';
  exitCode: 2 | 130 | 143;
  blockerCode: string;
  detail: string;
};

function normalizeNativePilotPostCaptureFailurePhase(
  value: unknown,
): NativePilotRuntimeTerminalFacts['postCaptureFailurePhase'] {
  return value === 'cleanup' || value === 'verification' || value === 'adapter-write'
    ? value
    : null;
}

/** Preserve a verified pre-acquisition boundary separately from owned cleanup. */
export function nativePilotCleanupStatus(input: {
  runtime?: { externalCleanupResult: string; captureCleanup?: unknown };
  stage: string;
}): 'cleaned' | 'not-acquired' | 'failed-recovery-ledger-retained' {
  if (input.runtime) {
    if (input.runtime.externalCleanupResult !== 'passed') return 'failed-recovery-ledger-retained';
    if (input.runtime.captureCleanup === 'not-acquired') return 'not-acquired';
    return input.runtime.captureCleanup === 'cleaned'
      ? 'cleaned'
      : 'failed-recovery-ledger-retained';
  }
  return input.stage.startsWith('runtime-') ? 'failed-recovery-ledger-retained' : 'not-acquired';
}

/**
 * Preserve a non-passed terminal row when repository identity cannot be
 * published. This is deliberately separate from the passed-only Detox
 * publisher: incomplete source evidence remains a durable harness outcome,
 * never a product failure or a passing runtime row.
 */
export function markNativePilotReceiptBlockedForRepositoryEvidence(
  receipt: {
    result: string;
    exitCode: number;
    assertions: unknown[];
    blocker?: unknown;
  },
  evidence: NativePilotRepositoryEvidence,
): void {
  if (evidence.status === 'observed') {
    throw new Error('Observed repository evidence cannot mark a terminal receipt blocked');
  }
  receipt.result = 'harness-blocked';
  receipt.exitCode = 2;
  receipt.assertions = [];
  receipt.blocker = {
    code: 'runtime-verification-failed',
    detail:
      'Repository identity was partial or unavailable at terminal publication; no passing or product-failure classification is qualified.',
    owner: 'client/server maintainer',
    nextAction:
      'Inspect the retained private repository-read and runtime records before a fresh attempt.',
  };
}

/** Preserve the original owned runtime outcome when a late signal or bound arrives. */
export function resolveNativePilotTerminalDecision(input: {
  runtime?: NativePilotRuntimeTerminalFacts;
  signalCode?: 130 | 143;
  deadlineExpired: boolean;
  stage: string;
}): NativePilotTerminalDecision | null {
  if (!input.runtime) {
    if (input.signalCode)
      return {
        result: 'cancelled',
        exitCode: input.signalCode,
        blockerCode: 'cancelled-preflight',
        detail: 'Native preflight was cancelled before native or backend acquisition.',
      };
    if (input.deadlineExpired)
      return {
        result: 'harness-blocked',
        exitCode: 2,
        blockerCode: 'native-whole-run-deadline',
        detail:
          'Public native whole-run deadline exceeded; resolved bound and original execution/cleanup are retained privately.',
      };
    return null;
  }
  const runtime = input.runtime;
  const censusDetail =
    runtime.censusFailureCount > 0
      ? ` ${runtime.censusFailureCount} original native census diagnostic(s) are retained privately.`
      : '';
  const childDetail = runtime.childClassification
    ? ` Original command classification: ${runtime.childClassification}.`
    : '';
  if (runtime.externalCleanupResult !== 'passed')
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-cleanup-failed',
      detail: `Independent native cleanup did not prove owned-resource absence and foreign-state preservation; the original runtime and cleanup records are retained privately.${censusDetail}`,
    };
  if (runtime.captureTimeout === 'whole-capture')
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'native-whole-capture-deadline',
      detail: `The owned native capture exceeded its whole-capture bound; the original child, command and cleanup records are retained privately.${censusDetail}`,
    };
  if (runtime.deadline || runtime.childClassification === 'deadline')
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'native-command-deadline',
      detail: `An owned native command exceeded its resolved deadline; the exact step, child outcome and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (runtime.verificationResult === 'application-failed')
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-application-failed',
      detail: `A qualified native application failure was retained, but final receipt staging did not complete; the original child and private UI evidence remain authoritative.${censusDetail}`,
    };
  if (
    (runtime.childExitCode !== null && runtime.childExitCode !== 0) ||
    runtime.childClassification === 'child-failed'
  )
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-execution-failed',
      detail: `The owned native child failed; its original exit and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (runtime.childSignal)
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-execution-failed',
      detail: `The owned native child terminated by signal; its original signal and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (
    runtime.childClassification === 'output-limit' ||
    runtime.childClassification === 'output-failed' ||
    (runtime.childClassification === 'harness-blocked' &&
      input.stage !== 'runtime-bootstrap-deadline')
  )
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-execution-failed',
      detail: `The owned native command was blocked before a passing child result; its original execution classification and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (runtime.postCaptureFailurePhase)
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-post-capture-failed',
      detail: `Native post-capture ${runtime.postCaptureFailurePhase} processing failed; the original capture, child and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (
    runtime.captureResult === 'cancelled' ||
    runtime.cancellation ||
    runtime.childClassification === 'cancelled'
  ) {
    const exitCode =
      runtime.cancellation === 'SIGINT'
        ? 130
        : runtime.cancellation === 'SIGTERM'
          ? 143
          : (input.signalCode ?? 143);
    return {
      result: 'cancelled',
      exitCode,
      blockerCode: 'cancelled-runtime',
      detail: `Owned native execution was cancelled; its original child result and cleanup status are retained privately.${childDetail}${censusDetail}`,
    };
  }
  if (input.deadlineExpired)
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'native-whole-run-deadline',
      detail:
        'Public native whole-run deadline exceeded; resolved bound and original execution/cleanup are retained privately.',
    };
  if (input.stage === 'runtime-bootstrap-deadline')
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-bootstrap-deadline',
      detail: `Owned simulator bootstatus exceeded its resolved deadline; the exact bootstrap diagnostic and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (
    input.stage === 'runtime-execution-failed' &&
    runtime.censusFailureCount === 0 &&
    runtime.childClassification === null &&
    runtime.childExitCode === null &&
    runtime.childSignal === null
  )
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-execution-failed',
      detail: `The owned native controller did not complete every required action; its original capture and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (runtime.verificationResult === 'failed' || runtime.captureResult !== 'observed')
    return {
      result: 'harness-blocked',
      exitCode: 2,
      blockerCode: 'runtime-verification-failed',
      detail: `The owned native runtime did not produce a complete verified result; its original capture and cleanup records are retained privately.${childDetail}${censusDetail}`,
    };
  if (input.signalCode)
    return {
      result: 'cancelled',
      exitCode: input.signalCode,
      blockerCode: 'cancelled-runtime',
      detail:
        'A terminal signal arrived after owned native execution; its original child result and cleanup status are retained privately.',
    };
  return null;
}

export function resolveIosDetoxConnectionDeadlineMs(input: {
  runStartedMs: number;
  nowMs: number;
  wholeRunMs: number;
  stepMs: number;
}): number {
  const remainingMs = Math.floor(input.runStartedMs + input.wholeRunMs - input.nowMs);
  const deadlineMs = Math.min(input.stepMs, remainingMs);
  assert(
    Number.isSafeInteger(deadlineMs) && deadlineMs >= 30_000 && deadlineMs <= 600_000,
    'The iOS Detox connection deadline must retain at least the owned 30-second bridge bound',
  );
  return deadlineMs;
}

export function resolveAndroidDetoxConnectionDeadlineMs(input: {
  runStartedMs: number;
  nowMs: number;
  wholeRunMs: number;
  stepMs: number;
}): number {
  const remainingMs = Math.floor(input.runStartedMs + input.wholeRunMs - input.nowMs);
  const deadlineMs = Math.min(input.stepMs, remainingMs);
  assert(
    Number.isSafeInteger(deadlineMs) && deadlineMs >= 30_000 && deadlineMs <= 600_000,
    'The Android Detox connection deadline must retain at least the owned 30-second bridge bound',
  );
  return deadlineMs;
}

/**
 * Reachable native-pilot dispatch for the owned T16-B caller. The explicit
 * bundle remains the owner of target, locale, API, SQL, and cleanup facts.
 */
export async function runIosT16BOwnedAttemptForNativePilot(
  input: T16BOwnedIosNativeEntrypointInput,
): Promise<T16BOwnedIosNativeEntrypointResult> {
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  assert(
    path.resolve(input.repositoryRoot) === moduleRoot,
    'T16-B native-pilot dispatch requires the current repository source root',
  );
  input.signal?.throwIfAborted();
  return runOwnedT16BFromOwnedIosNativeSession(input);
}

type IosDetoxConnectionDispatchOptions = Parameters<
  typeof IosDetoxConnectionPublicDispatch.runIosDetoxConnectionAttemptForNativePilot
>[0];

/** Keep the engine-specific Detox branch injectable for source-only controls. */
export function runIosDetoxConnectionAttemptForPublicDispatch(
  options: IosDetoxConnectionDispatchOptions,
  runner: (
    options: IosDetoxConnectionDispatchOptions,
  ) => ReturnType<
    typeof IosDetoxConnectionPublicDispatch.runIosDetoxConnectionAttemptForNativePilot
  >,
): ReturnType<typeof IosDetoxConnectionPublicDispatch.runIosDetoxConnectionAttemptForNativePilot> {
  assert.deepEqual(options.selection.arguments, {
    platform: 'ios',
    engine: 'detox',
    scenario: 'SCN-connection-ios',
    mode: 'integration',
  });
  assert.equal(options.requestedAttemptId, `${options.requestedRunId}:first`);
  assert.match(options.buildRunId, /^[a-f0-9]{24}$/, 'Detox buildRunId is invalid');
  assert(options.signal instanceof AbortSignal);
  assert(Number.isSafeInteger(options.deadlineMs) && options.deadlineMs >= 30_000);
  return runner(options);
}

type AndroidDetoxConnectionDispatchOptions = Parameters<
  typeof runAndroidDetoxConnectionAttemptForNativePilot
>[0];

/** Keep the Android Detox route explicit at the outer runner boundary. */
export function runAndroidDetoxConnectionAttemptForPublicDispatch(
  options: AndroidDetoxConnectionDispatchOptions,
  runner: (
    options: AndroidDetoxConnectionDispatchOptions,
  ) => ReturnType<
    typeof runAndroidDetoxConnectionAttemptForNativePilot
  > = runAndroidDetoxConnectionAttemptForNativePilot,
): ReturnType<typeof runAndroidDetoxConnectionAttemptForNativePilot> {
  assert.deepEqual(options.selection.arguments, {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-connection-android',
    mode: 'integration',
  });
  assert.equal(options.requestedAttemptId, `${options.requestedRunId}:first`);
  assert.match(options.buildRunId, /^[a-f0-9]{24}$/, 'Android Detox buildRunId is invalid');
  assert(options.signal instanceof AbortSignal);
  assert(Number.isSafeInteger(options.deadlineMs) && options.deadlineMs >= 30_000);
  return runner(options);
}

/**
 * Join the already-completed iOS Detox producer to the canonical runner's
 * outer verification boundary.  The producer is deliberately supplied as a
 * completed attempt so this wrapper cannot acquire a second driver, proxy,
 * build or artifact namespace.  The only terminal writer remains the caller
 * of run-native-pilot; this function never publishes a receipt.
 */
export async function runIosDetoxConnectionRuntimeForOuterTerminal(
  input: Readonly<{
    attempt: IosDetoxConnectionPublicDispatch.DetoxNativePilotAttemptResult;
    repositoryRoot: string;
    serverRoot: string;
    outputRoot: string;
    requestedRunId: string;
    requestedAttemptId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    deadlineMs: number;
    deadlineAtMonotonicMs: number;
    buildRunId: string;
    parentEnv?: Readonly<Record<string, string | undefined>>;
  }>,
): Promise<IosDetoxConnectionRuntimeDispatch.DetoxRuntimeDispatchResult> {
  assert.equal(input.attempt.requestedRunId, input.requestedRunId);
  assert.equal(input.attempt.requestedAttemptId, input.requestedAttemptId);
  assert.equal(input.attempt.detoxBuild.platform, 'ios');
  const runtimeDispatch = await loadIosDetoxConnectionRuntimeDispatch();
  return runtimeDispatch.runIosDetoxConnectionRuntimeForCanonicalTerminal(
    {
      repositoryRoot: input.repositoryRoot,
      serverRoot: input.serverRoot,
      artifactRoot: input.attempt.artifactRoot,
      outputRoot: input.outputRoot,
      requestedRunId: input.requestedRunId,
      requestedAttemptId: input.requestedAttemptId,
      selection: input.selection,
      signal: input.signal,
      deadlineMs: input.deadlineMs,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      buildRunId: input.buildRunId,
      parentEnv: input.parentEnv,
    },
    {
      runAttempt: () => Promise.resolve(input.attempt),
    },
  );
}

function isSupportedTrainingSelection(args: NativePilotArguments): boolean {
  return (
    args.engine === 'maestro' &&
    args.scenario === `SCN-training-${args.platform}` &&
    args.mode === 'integration'
  );
}

function isSupportedDetoxTrainingSelection(args: NativePilotArguments): boolean {
  return (
    args.platform === 'ios' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-training-ios' &&
    args.mode === 'integration'
  );
}

function isSupportedAndroidSessionSelection(args: NativePilotArguments): boolean {
  return (
    args.platform === 'android' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-session-android' &&
    args.mode === 'integration'
  );
}

function isSupportedCameraSelection(args: NativePilotArguments): boolean {
  return (
    args.platform === 'ios' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-camera-denied-ios' &&
    args.mode === 'integration'
  );
}

function isSupportedDetoxCameraSelection(args: NativePilotArguments): boolean {
  return (
    args.platform === 'ios' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-camera-denied-ios' &&
    args.mode === 'integration'
  );
}

/** Resolve the CLI opt-in only after the selected public camera cell is verified. */
export function resolveIosCameraDiagnosticOption(input: {
  requested: boolean | undefined;
  selection: NativePilotSelection;
}): true | undefined {
  if (input.requested !== true) return undefined;
  assert(
    isIosCredentialInteractionDiagnosticSelection(input.selection.arguments),
    'Credential interaction diagnostic requires the iOS Maestro camera integration selection',
  );
  return true;
}

function cameraRecord(value: unknown, label: string): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} is malformed`);
  return value as Record<string, unknown>;
}

type CameraEvidenceKind = 'ui' | 'api' | 'sql';

export const nativeCameraPublicEvidenceBindings = Object.freeze({
  'NAT-camera-normal-entry': Object.freeze({
    ui: Object.freeze(['camera-prompt.png', 'camera-prompt-hierarchy.json']),
    api: Object.freeze(['transport-observations.private.json']),
    sql: Object.freeze(['camera-connection-before.private.json']),
  }),
  'NAT-camera-denial-guidance': Object.freeze({
    ui: Object.freeze(['camera-guidance.png', 'camera-guidance-hierarchy.json']),
  }),
  'NAT-camera-manual-submit': Object.freeze({
    ui: Object.freeze([
      'camera-manual.png',
      'camera-manual-hierarchy.json',
      'camera-pending.png',
      'camera-pending-hierarchy.json',
    ]),
    api: Object.freeze(['transport-observations.private.json']),
    sql: Object.freeze(['camera-connection-pending.private.json']),
  }),
  'NAT-camera-unrelated-state': Object.freeze({
    sql: Object.freeze([
      'camera-isolation-before.private.json',
      'camera-isolation-after.private.json',
      'camera-training-before.private.json',
      'camera-training-after.private.json',
    ]),
  }),
} as const);

function cameraEvidencePathsForRow(row: {
  id: string;
  evidenceKinds: readonly CameraEvidenceKind[];
}): readonly string[] {
  const binding: Partial<Record<CameraEvidenceKind, readonly string[]>> =
    nativeCameraPublicEvidenceBindings[row.id as keyof typeof nativeCameraPublicEvidenceBindings];
  assert(binding, `Camera assertion ${row.id} lacks an explicit evidence binding`);
  return row.evidenceKinds.flatMap((kind) => {
    const paths = binding[kind];
    assert(paths?.length, `Camera assertion ${row.id} lacks ${kind} evidence`);
    return paths;
  });
}

function assertCameraCleanupProof(value: Record<string, unknown>, captureRunId: string): void {
  assert.equal(value.kind, 'independent ios native inventory cleanup proof');
  assert.equal(value.runId, captureRunId);
  assert.equal(value.result, 'passed');
  assert.equal(value.captureResult, 'observed');
  assert.equal(value.captureCleanupClean, true);
  assert(Number.isSafeInteger(value.pidStartPairs) && Number(value.pidStartPairs) > 0);
  assert.deepEqual(value.survivors, []);
  assert.deepEqual(value.unknownProcessQueries, []);
  assert.deepEqual(value.missingForeignDevices, []);
  assert.equal(value.ownedDeviceAbsent, true);
  assert.equal(value.cacheAbsent, true);
  const docker = cameraRecord(value.docker, 'Camera cleanup Docker proof');
  for (const key of ['container', 'network', 'volume']) assert.deepEqual(docker[key], []);
}

function assertCameraRuntimeSidecars(options: {
  root: string;
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
}): Record<string, unknown> {
  const read = (relative: string, label: string) =>
    cameraRecord(
      JSON.parse(readNativeEvidence(options.root, relative, true).toString('utf8')),
      label,
    );
  const metadata = read(nativeCameraRuntimeSidecarPaths[0], 'Camera runtime metadata');
  assert.equal(metadata.schemaVersion, 1);
  assert.equal(metadata.kind, 'private-ios-camera-runtime-metadata-not-public-receipt');
  assert.equal(metadata.requestedRunId, options.requestedRunId);
  assert.equal(metadata.captureRunId, options.captureRunId);
  assert.equal(metadata.backendRunId, options.fixtureRunId);
  assert.deepEqual(metadata.assertionIds, nativeCameraDeniedAssertionIds);
  assert.equal(metadata.publicNativePassingCases, 0);
  const metadataSelection = cameraRecord(metadata.selection, 'Camera runtime selection');
  assert.deepEqual(metadataSelection.arguments, options.selection.arguments);
  assert.equal(metadataSelection.scenarioHash, options.selection.scenarioHash);
  assert.equal(metadataSelection.requirementHash, options.selection.requirementHash);
  assert.equal(
    metadata.assertionContractSha256,
    options.selection.scenario.pilotAssertionContract?.sha256 ?? null,
  );

  const adapter = read(nativeCameraRuntimeSidecarPaths[1], 'Camera runtime adapter');
  assert.equal(adapter.kind, 'private-owned-ios-camera-attempt-not-public-receipt');
  assert.equal(adapter.requestedRunId, options.requestedRunId);
  assert.equal(adapter.requestedAttemptId, `${options.requestedRunId}:first`);
  assert.equal(adapter.captureRunId, options.captureRunId);
  assert.equal(adapter.backendRunId, options.fixtureRunId);
  assert.equal(adapter.fixtureRunId, options.fixtureRunId);
  assert.equal(adapter.captureExitCode, 0);
  assert.equal(adapter.childExitCode, 0);
  assert.equal(adapter.childSignal, null);
  assert.equal(adapter.childClassification, 'completed');
  assert.equal(adapter.captureResult, 'observed');
  assert.equal(adapter.captureCleanup, 'cleaned');
  assert.equal(adapter.callbackInvocations, 1);
  assert.equal(adapter.callbackCompleted, true);
  assert.equal(adapter.externalCleanupResult, 'passed');
  assert.equal(adapter.verificationResult, 'passed');
  assert.equal(adapter.verificationFailure, null);
  assert.equal(adapter.postCaptureFailure, null);
  assert.deepEqual(adapter.assertionIds, nativeCameraDeniedAssertionIds);
  assert.equal(adapter.nativePassingCases, 0);

  const cleanup = read(nativeCameraRuntimeSidecarPaths[2], 'Camera cleanup proof');
  assertCameraCleanupProof(cleanup, options.captureRunId);
  return metadata;
}

export async function stageCameraPublicEvidence(options: {
  captureRoot: string;
  outputRoot: string;
  requestedRunId: string;
  captureRunId: string;
  fixtureRunId: string;
  selection: NativePilotSelection;
}): Promise<{
  assertions: {
    id: string;
    requirementRefs: string[];
    outcome: 'passed';
    evidencePaths: string[];
  }[];
  artifacts: string[];
}> {
  const readPrivateJson = (
    root: string,
    relative: string,
    label: string,
  ): Record<string, unknown> =>
    cameraRecord(JSON.parse(readNativeEvidence(root, relative, true).toString('utf8')), label);
  const metadata = assertCameraRuntimeSidecars({
    root: options.captureRoot,
    requestedRunId: options.requestedRunId,
    captureRunId: options.captureRunId,
    fixtureRunId: options.fixtureRunId,
    selection: options.selection,
  });
  assert.equal(metadata.requestedRunId, options.requestedRunId);
  assert.equal(metadata.captureRunId, options.captureRunId);
  assert.equal(metadata.backendRunId, options.fixtureRunId);
  assert.deepEqual(metadata.assertionIds, nativeCameraDeniedAssertionIds);
  const metadataSelection = cameraRecord(metadata.selection, 'Camera runtime selection');
  assert.deepEqual(metadataSelection.arguments, options.selection.arguments);
  assert.equal(metadataSelection.scenarioHash, options.selection.scenarioHash);
  assert.equal(metadataSelection.requirementHash, options.selection.requirementHash);
  assert.equal(
    metadata.assertionContractSha256,
    options.selection.scenario.pilotAssertionContract?.sha256 ?? null,
  );
  const preparation = metadata.preparation;
  const capture = readPrivateJson(options.captureRoot, 'capture.private.json', 'Camera capture');
  const connectionApiIdentity = cameraRecord(capture.connectionApiIdentity, 'Camera API identity');
  assert(typeof connectionApiIdentity.targetOrigin === 'string', 'Camera API origin is missing');
  const transport = JSON.parse(
    readNativeEvidence(options.captureRoot, 'transport-observations.private.json', true).toString(
      'utf8',
    ),
  ) as unknown;
  assert(Array.isArray(transport), 'Camera transport observations are malformed');
  const staged = await stageIosCameraSubmissionEvidence({
    captureRoot: options.captureRoot,
    outputRoot: options.outputRoot,
    captureRunId: options.captureRunId,
    requestedRunId: options.requestedRunId,
    fixtureRunId: options.fixtureRunId,
    targetOrigin: connectionApiIdentity.targetOrigin,
    preparation,
    transport: transport as readonly ProxyObservation[],
  });
  const stagedRoot = path.join(options.outputRoot, 'evidence', options.captureRunId);
  validateIosCameraSubmissionPreparation({
    root: stagedRoot,
    backendRunId: options.fixtureRunId,
    targetOrigin: connectionApiIdentity.targetOrigin,
    preparation,
    transport: transport as readonly ProxyObservation[],
  });
  for (const relative of nativeCameraRuntimeSidecarPaths) {
    assert.deepEqual(
      readNativeEvidence(options.captureRoot, relative, true),
      readNativeEvidence(stagedRoot, relative, true),
      `Staged camera sidecar ${relative} differs from the original bytes`,
    );
  }
  assertCameraRuntimeSidecars({ ...options, root: stagedRoot });
  const ledger = requireNativePilotAssertions(options.selection);
  assert.deepEqual(
    ledger.map((row) => row.id),
    nativeCameraDeniedAssertionIds,
    'Camera assertion order changed before public staging',
  );
  return {
    assertions: ledger.map((row) => ({
      id: row.id,
      requirementRefs: [...row.requirementRefs],
      outcome: 'passed' as const,
      evidencePaths: cameraEvidencePathsForRow(row).map(
        (relative) => `evidence/${options.captureRunId}/${relative}`,
      ),
    })),
    artifacts: [staged.manifestPath],
  };
}

export function nativePilotExecutionAdapter(
  args: NativePilotArguments,
):
  | 'training'
  | 'connection'
  | 'ios-save-retry'
  | 'android-save-retry'
  | 'ios-detox-connection'
  | 'ios-detox-training'
  | 'ios-detox-camera'
  | 'ios-detox-session'
  | 'android-detox-session'
  | 'android-detox-connection'
  | 'android-detox-camera'
  | 'camera'
  | 'ios-session'
  | 'android-session'
  | null {
  if (isSupportedDetoxTrainingSelection(args)) return IOS_DETOX_TRAINING_PUBLIC_DISPATCH;
  if (isSupportedDetoxCameraSelection(args)) return IOS_DETOX_CAMERA_PUBLIC_DISPATCH;
  if (isSupportedTrainingSelection(args)) return 'training';
  if (isSupportedAndroidSessionSelection(args)) return 'android-session';
  if (
    args.engine === 'maestro' &&
    args.scenario === `SCN-connection-${args.platform}` &&
    args.mode === 'integration'
  )
    return 'connection';
  if (
    args.platform === 'ios' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-session-ios' &&
    args.mode === 'integration'
  )
    return 'ios-detox-session';
  if (
    args.platform === 'ios' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-connection-ios' &&
    args.mode === 'integration'
  )
    return IOS_DETOX_CONNECTION_PUBLIC_DISPATCH;
  if (
    args.platform === 'android' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-session-android' &&
    args.mode === 'integration'
  )
    return 'android-detox-session';
  if (
    args.platform === 'android' &&
    args.engine === 'detox' &&
    args.scenario === 'SCN-connection-android' &&
    args.mode === 'integration'
  )
    return ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH;
  if (isAndroidDetoxCameraPublicArguments(args)) return 'android-detox-camera';
  if (
    args.platform === 'android' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-save-retry-android' &&
    args.mode === 'integration'
  )
    return 'android-save-retry';
  if (
    args.platform === 'ios' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-save-retry-ios' &&
    args.mode === 'integration'
  )
    return 'ios-save-retry';
  if (
    args.platform === 'ios' &&
    args.engine === 'maestro' &&
    args.scenario === 'SCN-session-ios' &&
    args.mode === 'integration'
  )
    return 'ios-session';
  if (isSupportedCameraSelection(args) || isAndroidCameraPublicArguments(args)) return 'camera';
  return null;
}

/** Keep the camera dispatch seam injectable for source-only controls. */
export async function runIosCameraAttemptForPublicDispatch(
  options: Parameters<typeof runIosCameraAttempt>[0],
  runner: (
    options: Parameters<typeof runIosCameraAttempt>[0],
  ) => ReturnType<typeof runIosCameraAttempt> = runIosCameraAttempt,
): ReturnType<typeof runIosCameraAttempt> {
  assert(
    isSupportedCameraSelection(options.selection.arguments),
    'The public camera runner accepts only the reviewed iOS Maestro integration selection',
  );
  requireIosCameraAttemptLifecycle(options);
  if (options.credentialInteractionDiagnostic === true)
    resolveIosCameraDiagnosticOption({
      requested: true,
      selection: options.selection,
    });
  return runner(options);
}

/** Keep the Android camera bridge injectable while its native gate remains Pending. */
export async function runAndroidCameraAttemptForPublicDispatch(
  options: AndroidCameraPublicAttemptOptions,
  runner: (
    options: AndroidCameraPublicAttemptOptions,
  ) => ReturnType<typeof runAndroidCameraPublicAttempt> = runAndroidCameraPublicAttempt,
): ReturnType<typeof runAndroidCameraPublicAttempt> {
  assert(
    isAndroidCameraPublicArguments(options.selection.arguments),
    'The public camera runner accepts only the reviewed Android Maestro integration selection',
  );
  return runner(options);
}

async function readRepositoryIdentityWithSignal(
  root: string,
  name: 'client' | 'server',
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const identity = await repositoryIdentity(root, name, { signal });
  signal.throwIfAborted();
  return identity;
}

async function readRepositorySources(
  root: string,
  signal: AbortSignal,
): Promise<{
  sources: readonly [RepositoryIdentity, RepositoryIdentity];
  roots: Readonly<Record<'client' | 'server', string>>;
}> {
  signal.throwIfAborted();
  const clientRoot = path.resolve(root);
  const serverRoot = await realpath(path.join(root, '../server'));
  signal.throwIfAborted();
  const client = await readRepositoryIdentityWithSignal(clientRoot, 'client', signal);
  signal.throwIfAborted();
  const server = await readRepositoryIdentityWithSignal(serverRoot, 'server', signal);
  signal.throwIfAborted();
  return {
    sources: [client, server],
    roots: { client: clientRoot, server: serverRoot },
  };
}

type RepositoryIdentityReader = (
  root: string,
  name: 'client' | 'server',
  signal: AbortSignal,
) => Promise<RepositoryIdentity>;

type RepositoryRootReader = (root: string, signal: AbortSignal) => Promise<string>;

export type NativePilotBestEffortRepositoryObservation = {
  sources: readonly RepositoryIdentity[];
  roots: Readonly<Partial<Record<'client' | 'server', string>>>;
  evidence: NativePilotRepositoryEvidence;
};

/**
 * Build terminal source evidence without turning a repository read failure into
 * generic stderr. Successful rows remain the branded observations returned by
 * repositoryIdentity; failed rows are named in evidence and never synthesized.
 * The injectable readers are only test seams. Production uses the same
 * descriptor-bound identity reader and realpath resolver as strict checks.
 */
export async function readRepositorySourcesBestEffort(
  root: string,
  signal: AbortSignal,
  options: {
    readIdentity?: RepositoryIdentityReader;
    readServerRoot?: RepositoryRootReader;
  } = {},
): Promise<NativePilotBestEffortRepositoryObservation> {
  const readIdentity = options.readIdentity ?? readRepositoryIdentityWithSignal;
  const readServerRoot =
    options.readServerRoot ??
    (async (parent: string, readSignal) => {
      readSignal.throwIfAborted();
      const resolved = await realpath(path.join(parent, '../server'));
      readSignal.throwIfAborted();
      return resolved;
    });
  const clientRoot = path.resolve(root);
  const expectedRoots: Record<string, string> = { client: clientRoot };
  const sources: RepositoryIdentity[] = [];
  const missing: ('client' | 'server')[] = [];

  const readOne = async (name: 'client' | 'server', repositoryRoot: string): Promise<void> => {
    if (signal.aborted) {
      missing.push(name);
      return;
    }
    try {
      const identity = await readIdentity(repositoryRoot, name, signal);
      signal.throwIfAborted();
      sources.push(identity);
    } catch {
      missing.push(name);
    }
  };

  await readOne('client', clientRoot);
  if (signal.aborted) {
    missing.push('server');
  } else {
    try {
      const serverRoot = await readServerRoot(root, signal);
      expectedRoots.server = serverRoot;
      await readOne('server', serverRoot);
    } catch {
      missing.push('server');
    }
  }

  const observation = createRepositoryObservation(sources, missing, expectedRoots);
  return {
    sources: observation.repositories,
    roots: expectedRoots,
    evidence: observation.evidence,
  };
}

/** Public entry point for bounded integrated Maestro training, session and save/retry lanes. */
async function main() {
  const runStarted = performance.now();
  process.umask(0o077);
  let signalCode: 130 | 143 | undefined;
  let deadlineExpired = false;
  const preflight = installNativePilotPreflightLifecycle({
    startedAtMs: runStarted,
    onSignal: (code) => {
      signalCode ??= code;
    },
    onDeadline: () => {
      deadlineExpired = true;
    },
  });
  let root!: string;
  let invocation!: ReturnType<typeof parseNativePilotInvocationArguments>;
  let preparedInvocation!: Awaited<ReturnType<typeof createNativePilotOutputRoot>>;
  // A cold input carries only the requested identity/fingerprints at this
  // boundary. Its path/receipt fields are never opened before the child owns
  // its simulator, backend, proxy, fixtures, install and capture namespace.
  let deferredColdResetBinding: typeof invocation.coldResetBinding = null;
  // The anchored worker reports the child immediately after mkdir, before any
  // post-create identity await can abort. Keep this exact namespace for the
  // blocked-receipt recovery path even when the handoff never returns.
  let outputRootCreated: string | null = null;
  let outputRootIdentity:
    Awaited<ReturnType<typeof createNativePilotOutputRoot>>['namespaceIdentity'] | null = null;
  let coldResetHandoff: ColdResetHandoff | null = null;
  let preflightPhase:
    'root-resolution' | 'argument-parse' | 'output-root' | 'identity-publication' =
    'root-resolution';
  try {
    root = await realpath(path.resolve(__dirname, '../..'));
    preflightPhase = 'argument-parse';
    invocation = parseNativePilotInvocationArguments(process.argv.slice(2));
    preflightPhase = 'output-root';
    deferredColdResetBinding = invocation.coldResetBinding;
    const invocationForPreflight = deferredColdResetBinding
      ? { ...invocation, coldResetBinding: null }
      : invocation;
    const coldPreflight = await prepareNativePilotColdInvocation<ColdResetHandoff>({
      invocation: invocationForPreflight,
      defaultOutputParent: nativePilotDefaultOutputParent(root, invocation.selection),
      signal: preflight.controller.signal,
      deadlineAt: preflight.deadlineAtMs,
      onPrepared: (prepared) => {
        preparedInvocation = prepared;
      },
      onOutputRootCreated: (outputRoot, namespaceIdentity) => {
        outputRootCreated ??= outputRoot;
        outputRootIdentity ??= namespaceIdentity ?? null;
      },
      onOutputRootReady: (prepared) => {
        outputRootIdentity = prepared.namespaceIdentity;
      },
      handoff: ({ binding, prepared, signal }) =>
        handoffColdResetReceiptFromProcessBinding({
          binding,
          prepared,
          signal,
        }),
    });
    preparedInvocation = coldPreflight.prepared;
    coldResetHandoff = coldPreflight.resetHandoff;
    preflight.controller.signal.throwIfAborted();
    preflightPhase = 'identity-publication';
    await writeNativePilotPrivateFile({
      root: preparedInvocation.outputRoot,
      relative: 'attempt-identity.private.json',
      contents: JSON.stringify({
        kind: 'private native pilot requested identity and output binding; not passing evidence',
        requestedRunId: preparedInvocation.requestedRunId,
        requestedAttemptId: preparedInvocation.requestedAttemptId,
        outputParent: preparedInvocation.outputParent,
        outputRoot: preparedInvocation.outputRoot,
        explicitOutputParent: preparedInvocation.explicitOutputParent,
        coldResetHandoff: coldResetHandoff
          ? {
              sourceReceiptPath: coldResetHandoff.source.receiptPath,
              sourceReceiptHash: coldResetHandoff.source.receiptHash,
              finalReceiptPath: coldResetHandoff.final.receiptPath,
              finalReceiptHash: coldResetHandoff.final.receiptHash,
              finalRelativePath: coldResetHandoff.finalRelativePath,
            }
          : null,
      }),
      namespaceIdentity: preparedInvocation.namespaceIdentity,
      signal: preflight.controller.signal,
      deadlineAtMonotonicMs: preflight.deadlineAtMs,
    });
    preflight.controller.signal.throwIfAborted();
  } catch (error) {
    const partialOutputRoot =
      preparedInvocation?.outputRoot ??
      outputRootCreated ??
      (error && typeof error === 'object' && 'outputRoot' in error
        ? typeof (error as { outputRoot?: unknown }).outputRoot === 'string'
          ? (error as { outputRoot: string }).outputRoot
          : undefined
        : undefined);
    const interruptedBeforeIdentity = preflight.controller.signal.aborted;
    const initialReason: NativePilotPreflightBlockReason = interruptedBeforeIdentity
      ? deadlineExpired
        ? 'native-whole-run-deadline'
        : 'cancelled-preflight'
      : preflightPhase === 'argument-parse'
        ? 'invalid-cli-arguments'
        : preflightPhase === 'root-resolution'
          ? 'preflight-root-resolution-failed'
          : preflightPhase === 'output-root'
            ? 'preflight-output-root-failed'
            : 'preflight-identity-publication-failed';
    try {
      const preflightRepositories: RepositoryIdentity[] = [];
      const missingRepositories: string[] = [];
      const expectedRepositoryRoots: Record<string, string> = {};
      const knownRoot = typeof root === 'string' && root.length > 0 ? root : null;
      let identityInterrupted = false;
      if (!knownRoot) {
        missingRepositories.push('client', 'server');
      } else if (interruptedBeforeIdentity) {
        missingRepositories.push('client', 'server');
      } else {
        try {
          preflightRepositories.push(
            await readRepositoryIdentityWithSignal(
              knownRoot,
              'client',
              preflight.controller.signal,
            ),
          );
          expectedRepositoryRoots.client = path.resolve(knownRoot);
        } catch {
          if (preflight.controller.signal.aborted) identityInterrupted = true;
          else missingRepositories.push('client');
        }
        if (!identityInterrupted) {
          try {
            const serverRoot = await realpath(path.join(knownRoot, '../server'));
            expectedRepositoryRoots.server = serverRoot;
            preflightRepositories.push(
              await readRepositoryIdentityWithSignal(
                serverRoot,
                'server',
                preflight.controller.signal,
              ),
            );
          } catch {
            if (preflight.controller.signal.aborted) identityInterrupted = true;
            else missingRepositories.push('server');
          }
        }
      }
      const interrupted = identityInterrupted || preflight.controller.signal.aborted;
      const reason: NativePilotPreflightBlockReason = interrupted
        ? deadlineExpired
          ? 'native-whole-run-deadline'
          : 'cancelled-preflight'
        : initialReason;
      const repositoryObservation = createRepositoryObservation(
        interrupted ? [] : preflightRepositories,
        interrupted ? ['client', 'server'] : missingRepositories,
        interrupted ? {} : expectedRepositoryRoots,
      );
      const blocked = await writeNativePilotBlockedReceipt({
        defaultOutputParent: nativePilotDefaultOutputParent(
          path.resolve(__dirname, '../..'),
          typeof invocation === 'undefined' ? undefined : invocation.selection,
        ),
        partialOutputRoot,
        startedAt: new Date().toISOString(),
        signal: interrupted ? undefined : preflight.controller.signal,
        recoveryDeadlineMs: 30_000,
        invocation: typeof invocation === 'undefined' ? undefined : invocation,
        reason,
        exitCode: signalCode ?? (reason === 'cancelled-preflight' ? 130 : 2),
        deadlineAt: preflight.deadlineAtMs,
        partialNamespaceIdentity: outputRootIdentity ?? undefined,
        repositoryObservation,
      });
      process.stdout.write(
        `Native pilot ${reason === 'cancelled-preflight' ? 'cancelled' : 'harness-blocked'} (${reason}); receipt: ${blocked.receiptPath}\n`,
      );
      process.exitCode = signalCode ?? (reason === 'cancelled-preflight' ? 130 : 2);
      preflight.dispose();
      return;
    } catch (error) {
      preflight.dispose();
      if (error instanceof NativePilotRecoveryDeadlineError) {
        process.stderr.write(
          `Native pilot preflight recovery publication was bounded; recovery root remains unverified${error.outputRoot ? `: ${error.outputRoot}` : ''}.\n`,
        );
        process.exitCode = 2;
        return;
      }
      throw error;
    }
  }
  const runId = preparedInvocation.requestedRunId;
  const attemptId = preparedInvocation.requestedAttemptId;
  const coldResetPreparation: ColdResetPreparationExpectation | null = deferredColdResetBinding
    ? {
        requestedRunId: runId,
        requestedAttemptId: attemptId,
        fixtureResetId: deferredColdResetBinding.fixtureResetId,
        cohortFixtureFingerprint: deferredColdResetBinding.cohortFixtureFingerprint,
        sourceFingerprint: deferredColdResetBinding.sourceFingerprint,
        helperFingerprint: deferredColdResetBinding.helperFingerprint,
      }
    : null;
  const coldResetExpectation: ColdResetChildExpectation | null = deferredColdResetBinding
    ? {
        requestedRunId: runId,
        requestedAttemptId: attemptId,
        fixtureResetId: deferredColdResetBinding.fixtureResetId,
        cohortFixtureFingerprint: deferredColdResetBinding.cohortFixtureFingerprint,
        sourceFingerprint: deferredColdResetBinding.sourceFingerprint,
        helperFingerprint: deferredColdResetBinding.helperFingerprint,
        target: deferredColdResetBinding.target,
        backend: deferredColdResetBinding.backend,
        sourceIdentity: deferredColdResetBinding.sourceIdentity,
      }
    : null;
  if (deferredColdResetBinding) {
    assert.equal(deferredColdResetBinding.ownerRunId, runId);
    assert.equal(deferredColdResetBinding.attemptId, attemptId);
  }
  const output = preparedInvocation.outputRoot;
  const startedAt = new Date().toISOString();
  const controller = preflight.controller;
  process.stdout.write(`Native pilot preflight artifacts: ${output}\n`);
  let args: NativePilotArguments | undefined;
  let selected: NativePilotSelection | undefined;
  let runtime: NativePilotAttempt | undefined;
  let inventory: unknown;
  let sourcesBefore: RepositoryIdentity[] | undefined;
  let repositoryRootsBefore: Readonly<Record<'client' | 'server', string>> | undefined;
  let bootstatusDeadlineMs: number | undefined;
  let reuseBuildRunId: string | undefined;
  let reuseBuildSourceRoot: string | undefined;
  let incrementalBuildCacheSourceRoot: string | undefined;
  let androidDetoxBuildRunId: string | undefined;
  let deadlines = preflight.deadlines;
  let deadlinesRecorded = false;
  let runtimeTarget: NativePilotTarget = nativePilotTargetFromCapture('ios');
  let runtimeTargetFailure: { name: string; message: string } | null = null;
  let executionAdapter: ReturnType<typeof nativePilotExecutionAdapter> = null;
  let serverRoot: string | undefined;
  let runtimeLinkPublished = false;
  let androidDetoxSessionOuterCandidateGateBlocked = false;
  let iosDetoxRuntimeDispatch: IosDetoxConnectionRuntimeDispatch.DetoxRuntimeDispatchResult | null =
    null;
  let iosDetoxRuntimeFailure: { code: string; message: string } | null = null;
  let coldResetHandoffPublished = false;
  let coldResetChildBinding: ChildColdResetBinding | null = null;
  let runtimeExecutionFailure: { name: string; message: string } | null = null;
  let stage:
    | 'invalid-selection'
    | 'invalid-inventory'
    | 'invalid-environment'
    | 'invalid-build-reuse'
    | 'missing-assertion-ledger'
    | 'native-host-unavailable'
    | 'native-host-contended'
    | 'native-host-lock-required'
    | 'runtime-execution-failed'
    | 'runtime-application-failed'
    | 'runtime-bootstrap-deadline'
    | 'runtime-cleanup-failed'
    | 'runtime-verification-failed'
    | 'runtime-finalization-pending'
    | 'runtime-source-only'
    | 'execution-adapter-pending' = 'invalid-selection';
  try {
    args = invocation.selection;
    executionAdapter = nativePilotExecutionAdapter(args);
    stage = 'invalid-inventory';
    inventory = await readProtectedInventory(root, {
      signal: preflight.controller.signal,
      deadlineAtMs: preflight.deadlineAtMs,
    });
    selected = await selectNativePilotScenario(args, inventory, root);
    const detoxTrainingConnectionSelection =
      executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH
        ? await selectNativePilotScenario(
            {
              platform: 'ios',
              engine: 'detox',
              scenario: 'SCN-connection-ios',
              mode: 'integration',
            },
            inventory,
            root,
          )
        : undefined;
    stage = 'invalid-environment';
    const bootstatusDeadlineOverride =
      typeof process.env.MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS === 'string'
        ? process.env.MYCHAMPIONS_NATIVE_BOOTSTATUS_DEADLINE_MS
        : undefined;
    const requestedBuildRunId =
      typeof process.env.MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID === 'string'
        ? process.env.MYCHAMPIONS_NATIVE_REUSE_BUILD_RUN_ID
        : undefined;
    const requestedBuildSourceRoot =
      typeof process.env.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT === 'string'
        ? process.env.MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT
        : undefined;
    const requestedIncrementalBuildCacheSourceRoot =
      typeof process.env.MYCHAMPIONS_NATIVE_INCREMENTAL_BUILD_CACHE_ROOT === 'string'
        ? process.env.MYCHAMPIONS_NATIVE_INCREMENTAL_BUILD_CACHE_ROOT
        : undefined;
    const requestedAndroidDetoxBuildRunId =
      typeof process.env.MYCHAMPIONS_NATIVE_ANDROID_DETOX_BUILD_RUN_ID === 'string'
        ? process.env.MYCHAMPIONS_NATIVE_ANDROID_DETOX_BUILD_RUN_ID
        : undefined;
    const iosOnlyOptionSet =
      bootstatusDeadlineOverride !== undefined ||
      requestedBuildRunId !== undefined ||
      requestedBuildSourceRoot !== undefined ||
      requestedIncrementalBuildCacheSourceRoot !== undefined;
    if (iosOnlyOptionSet) {
      assert(
        args.platform === 'ios' && executionAdapter,
        'iOS options require a supported iOS adapter',
      );
      bootstatusDeadlineMs = parseIosSimulatorBootstatusDeadline(bootstatusDeadlineOverride);
    }
    deadlines = parseNativeExecutionDeadlines(process.env);
    if (
      [
        'MYCHAMPIONS_NATIVE_BUILD_DEADLINE_MS',
        'MYCHAMPIONS_NATIVE_STEP_DEADLINE_MS',
        'MYCHAMPIONS_NATIVE_WHOLE_DEADLINE_MS',
      ].some((name) => process.env[name] !== undefined) &&
      !executionAdapter
    )
      throw new Error('Execution deadline overrides require a supported native adapter');
    if (args.mode === 'integration') {
      assertNoIntegratedBypasses(process.env);
      if (process.env.APP_VARIANT && process.env.APP_VARIANT !== 'dev')
        throw new Error('Native integration requires the dev variant');
    }
    stage = 'missing-assertion-ledger';
    requireNativePilotAssertions(selected);
    if (!executionAdapter) {
      stage = 'execution-adapter-pending';
      throw new Error('No public native adapter supports this selection');
    }
    if (
      coldResetExpectation &&
      executionAdapter !== 'android-detox-camera' &&
      (executionAdapter === 'ios-session' ||
        executionAdapter === 'ios-detox-session' ||
        executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH ||
        executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH ||
        executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH ||
        (args.platform === 'android' && executionAdapter !== 'android-detox-session'))
    ) {
      stage = 'invalid-environment';
      throw new Error(
        'Cold reset consumption requires an iOS Maestro callback adapter with the reviewed child producer; Detox cold reset is not yet bound to the same capture owner',
      );
    }
    if (
      executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH ||
      executionAdapter === 'ios-detox-session' ||
      executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH ||
      executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH
    ) {
      stage = 'invalid-build-reuse';
      assert(
        requestedBuildRunId !== undefined,
        'iOS Detox session routes require an explicit qualified build reuse ID',
      );
    }
    if (
      executionAdapter === ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH ||
      executionAdapter === 'android-detox-session' ||
      executionAdapter === 'android-detox-camera'
    ) {
      stage = 'invalid-build-reuse';
      assert(
        requestedAndroidDetoxBuildRunId !== undefined,
        'Android Detox routes require an explicit qualified build descriptor run ID',
      );
      assert.match(requestedAndroidDetoxBuildRunId, /^[a-f0-9]{24}$/);
      androidDetoxBuildRunId = requestedAndroidDetoxBuildRunId;
    }
    if (requestedBuildSourceRoot !== undefined)
      assert(
        requestedBuildRunId !== undefined,
        'MYCHAMPIONS_NATIVE_BUILD_CACHE_ROOT requires a reusable iOS build run ID',
      );
    if (requestedIncrementalBuildCacheSourceRoot !== undefined) {
      assert(
        args.platform === 'ios' && executionAdapter === 'camera',
        'MYCHAMPIONS_NATIVE_INCREMENTAL_BUILD_CACHE_ROOT requires the iOS Maestro camera adapter',
      );
      assert(
        requestedBuildRunId === undefined,
        'MYCHAMPIONS_NATIVE_INCREMENTAL_BUILD_CACHE_ROOT cannot be combined with qualified app reuse',
      );
      assert(
        path.isAbsolute(requestedIncrementalBuildCacheSourceRoot) &&
          !requestedIncrementalBuildCacheSourceRoot.includes('\0'),
        'MYCHAMPIONS_NATIVE_INCREMENTAL_BUILD_CACHE_ROOT must be an absolute path',
      );
      incrementalBuildCacheSourceRoot = requestedIncrementalBuildCacheSourceRoot;
    }
    if (requestedBuildRunId !== undefined) {
      stage = 'invalid-build-reuse';
      reuseBuildRunId = requestedBuildRunId;
      reuseBuildSourceRoot = requestedBuildSourceRoot;
      assert.match(requestedBuildRunId, /^[a-f0-9]{24}$/);
      await loadReusableIosBuild(root, requestedBuildRunId, await sourceIdentity(root), {
        sourceRoot: reuseBuildSourceRoot,
      });
    }
    if (executionAdapter) {
      await writeNativePilotPrivateFile({
        root: output,
        relative: 'execution-deadlines.private.json',
        contents: JSON.stringify({
          kind: 'resolved public native execution bounds; not behavioral evidence',
          requestedRunId: runId,
          ...deadlines,
        }),
        namespaceIdentity: preparedInvocation.namespaceIdentity,
        signal: controller.signal,
        deadlineAtMonotonicMs: preflight.deadlineAtMs,
      });
      deadlinesRecorded = true;
    }
    stage = 'native-host-unavailable';
    await requireNativeHostAvailability(output);
    if (executionAdapter) {
      stage = 'native-host-lock-required';
      if (process.env.MYCHAMPIONS_NATIVE_HOST_LOCK_HELD !== '1')
        throw new Error('Native host lock is required');
      if (!signalCode) {
        const sourceObservation = await readRepositorySources(root, controller.signal);
        serverRoot = sourceObservation.roots.server;
        sourcesBefore = [...sourceObservation.sources];
        repositoryRootsBefore = sourceObservation.roots;
        controller.signal.throwIfAborted();
        stage = 'runtime-execution-failed';
        const adapterOptions = {
          repositoryRoot: root,
          requestedRunId: runId,
          requestedAttemptId: attemptId,
          selection: selected,
          signal: controller.signal,
          outputRoot: output,
          deadlines,
          deadlineAt: runStarted + deadlines.wholeRunMs,
          coldReset: coldResetPreparation ?? undefined,
          reuseBuildSourceRoot,
          incrementalBuildCacheSourceRoot,
          credentialInteractionDiagnostic: resolveIosCameraDiagnosticOption({
            requested: invocation.credentialInteractionDiagnostic,
            selection: selected,
          }),
        };
        const iosDetoxConnectionDispatch =
          executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH
            ? await loadIosDetoxConnectionPublicDispatch()
            : undefined;
        const iosDetoxTrainingDispatch =
          executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH
            ? await loadIosDetoxTrainingPublicDispatch()
            : undefined;
        const iosDetoxCameraDispatch =
          executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH
            ? await loadIosDetoxCameraPublicDispatch()
            : undefined;
        const iosDetoxSessionRoute =
          executionAdapter === 'ios-detox-session'
            ? await loadIosDetoxSessionNativePilotRoute()
            : undefined;
        if (
          executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH ||
          executionAdapter === ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH ||
          executionAdapter === 'android-detox-session' ||
          executionAdapter === 'android-detox-camera' ||
          executionAdapter === 'ios-detox-session' ||
          executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH ||
          executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH
        )
          assert(serverRoot, 'Detox server root is unavailable');
        runtime =
          executionAdapter === 'android-session'
            ? await runAndroidSessionAttempt(adapterOptions)
            : executionAdapter === 'android-save-retry'
              ? await runAndroidSaveRetryAttempt(adapterOptions)
              : executionAdapter === 'connection'
                ? selected.arguments.platform === 'android'
                  ? await runAndroidConnectionAttempt(adapterOptions)
                  : await runIosConnectionAttempt({
                      ...adapterOptions,
                      bootstatusDeadlineMs,
                      reuseBuildRunId,
                      reuseBuildSourceRoot,
                    })
                : executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH
                  ? await runIosDetoxConnectionAttemptForPublicDispatch(
                      {
                        repositoryRoot: root,
                        serverRoot,
                        artifactRoot: output,
                        requestedRunId: runId,
                        requestedAttemptId: attemptId,
                        selection: selected,
                        signal: controller.signal,
                        deadlineMs: resolveIosDetoxConnectionDeadlineMs({
                          runStartedMs: runStarted,
                          nowMs: performance.now(),
                          wholeRunMs: deadlines.wholeRunMs,
                          stepMs: deadlines.stepMs,
                        }),
                        deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                        buildRunId: reuseBuildRunId!,
                        reuseBuildSourceRoot,
                        parentEnv: process.env,
                      },
                      iosDetoxConnectionDispatch!.runIosDetoxConnectionAttemptForNativePilot,
                    )
                  : executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH
                    ? await iosDetoxCameraDispatch!.runIosDetoxCameraAttemptForPublicDispatch({
                        repositoryRoot: root,
                        serverRoot,
                        artifactRoot: output,
                        requestedRunId: runId,
                        requestedAttemptId: attemptId,
                        selection: selected,
                        signal: controller.signal,
                        deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                        buildRunId: reuseBuildRunId!,
                        reuseBuildSourceRoot,
                        parentEnv: process.env,
                      })
                    : executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH
                      ? await iosDetoxTrainingDispatch!.runIosDetoxTrainingAttemptForPublicDispatch(
                          {
                            repositoryRoot: root,
                            serverRoot:
                              serverRoot ??
                              assert.fail('iOS Detox training server root is unavailable'),
                            artifactRoot: output,
                            requestedRunId: runId,
                            requestedAttemptId: attemptId,
                            selection: selected,
                            connectionSelection:
                              detoxTrainingConnectionSelection ??
                              assert.fail('iOS Detox training connection selection is unavailable'),
                            signal: controller.signal,
                            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                            buildRunId: reuseBuildRunId!,
                            reuseBuildSourceRoot,
                            parentEnv: process.env,
                          },
                        )
                      : executionAdapter === ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH
                        ? await runAndroidDetoxConnectionAttemptForPublicDispatch({
                            repositoryRoot: root,
                            serverRoot,
                            artifactRoot: output,
                            requestedRunId: runId,
                            requestedAttemptId: attemptId,
                            selection: selected,
                            signal: controller.signal,
                            deadlineMs: resolveAndroidDetoxConnectionDeadlineMs({
                              runStartedMs: runStarted,
                              nowMs: performance.now(),
                              wholeRunMs: deadlines.wholeRunMs,
                              stepMs: deadlines.stepMs,
                            }),
                            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                            buildRunId: androidDetoxBuildRunId!,
                            parentEnv: process.env,
                          })
                        : executionAdapter === 'android-detox-camera'
                          ? await runAndroidDetoxCameraAttemptForNativePilot({
                              repositoryRoot: root,
                              serverRoot,
                              artifactRoot: output,
                              requestedRunId: runId,
                              requestedAttemptId: attemptId,
                              selection: selected,
                              signal: controller.signal,
                              deadlineAt: runStarted + deadlines.wholeRunMs,
                              parentEnv: process.env,
                              expectedLocale: 'en-US',
                              coldReset: coldResetExpectation ?? undefined,
                            })
                          : executionAdapter === 'android-detox-session'
                            ? coldResetPreparation
                              ? await (async () => {
                                  const captureInvocation = await createNativePilotOutputRoot({
                                    invocation: {
                                      selection: selected.arguments,
                                      requestedRunId: null,
                                      requestedAttemptId: null,
                                      outputParent: null,
                                    },
                                    defaultOutputParent: path.join(
                                      root,
                                      '.qa/artifacts/native-pilot',
                                    ),
                                    signal: controller.signal,
                                    deadlineAt: runStarted + deadlines.wholeRunMs,
                                  });
                                  const resourceOwnerRunId = randomBytes(12).toString('hex');
                                  assert.notEqual(resourceOwnerRunId, runId);
                                  assert.notEqual(
                                    resourceOwnerRunId,
                                    path.basename(captureInvocation.outputRoot),
                                  );
                                  return runT15AndroidDetoxSessionColdRoute({
                                    repositoryRoot: root,
                                    serverRoot,
                                    artifactRoot: captureInvocation.outputRoot,
                                    requestedRunId: runId,
                                    captureRunId: path.basename(captureInvocation.outputRoot),
                                    requestedAttemptId: attemptId,
                                    resourceOwnerRunId,
                                    selection: selected,
                                    signal: controller.signal,
                                    deadlineMs: resolveAndroidDetoxConnectionDeadlineMs({
                                      runStartedMs: runStarted,
                                      nowMs: performance.now(),
                                      wholeRunMs: deadlines.wholeRunMs,
                                      stepMs: deadlines.stepMs,
                                    }),
                                    deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                                    buildRunId: androidDetoxBuildRunId!,
                                    parentEnv: process.env,
                                    coldReset: {
                                      expectation: coldResetPreparation,
                                      ownerRunId: resourceOwnerRunId,
                                    },
                                  });
                                })()
                              : await (async () => {
                                  // The session baseline writes its own census and
                                  // receipts, so it needs a capture root separate from
                                  // the runner's output root (as the cold route does).
                                  const captureInvocation = await createNativePilotOutputRoot({
                                    invocation: {
                                      selection: selected.arguments,
                                      requestedRunId: null,
                                      requestedAttemptId: null,
                                      outputParent: null,
                                    },
                                    defaultOutputParent: path.join(
                                      root,
                                      '.qa/artifacts/native-pilot',
                                    ),
                                    signal: controller.signal,
                                    deadlineAt: runStarted + deadlines.wholeRunMs,
                                  });
                                  return runAndroidDetoxSessionAttemptForNativePilot({
                                    repositoryRoot: root,
                                    serverRoot,
                                    artifactRoot: captureInvocation.outputRoot,
                                    captureRunId: path.basename(captureInvocation.outputRoot),
                                    requestedRunId: runId,
                                    requestedAttemptId: attemptId,
                                    selection: selected,
                                    signal: controller.signal,
                                    deadlineMs: resolveAndroidDetoxConnectionDeadlineMs({
                                      runStartedMs: runStarted,
                                      nowMs: performance.now(),
                                      wholeRunMs: deadlines.wholeRunMs,
                                      stepMs: deadlines.stepMs,
                                    }),
                                    deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                                    buildRunId: androidDetoxBuildRunId!,
                                    parentEnv: process.env,
                                  });
                                })()
                            : executionAdapter === 'ios-detox-session'
                              ? await iosDetoxSessionRoute!.runIosDetoxSessionAttemptForNativePilot(
                                  {
                                    repositoryRoot: root,
                                    serverRoot: serverRoot,
                                    artifactRoot: output,
                                    requestedRunId: runId,
                                    requestedAttemptId: attemptId,
                                    selection: selected,
                                    signal: controller.signal,
                                    deadlineMs: resolveIosDetoxConnectionDeadlineMs({
                                      runStartedMs: runStarted,
                                      nowMs: performance.now(),
                                      wholeRunMs: deadlines.wholeRunMs,
                                      stepMs: deadlines.stepMs,
                                    }),
                                    deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
                                    buildRunId: reuseBuildRunId!,
                                    reuseBuildSourceRoot,
                                    parentEnv: process.env,
                                  },
                                )
                              : executionAdapter === 'ios-save-retry'
                                ? await runIosSaveRetryAttempt({
                                    ...adapterOptions,
                                    bootstatusDeadlineMs,
                                    reuseBuildRunId,
                                    reuseBuildSourceRoot,
                                  })
                                : executionAdapter === 'ios-session'
                                  ? await runIosSessionAttempt({
                                      ...adapterOptions,
                                      bootstatusDeadlineMs,
                                      reuseBuildRunId,
                                    })
                                  : executionAdapter === 'camera'
                                    ? selected.arguments.platform === 'android'
                                      ? await runAndroidCameraAttemptForPublicDispatch(
                                          adapterOptions,
                                        )
                                      : await runIosCameraAttemptForPublicDispatch({
                                          ...adapterOptions,
                                          bootstatusDeadlineMs,
                                          reuseBuildRunId,
                                        })
                                    : selected.arguments.platform === 'android'
                                      ? await runAndroidTrainingAttempt(adapterOptions)
                                      : await runIosTrainingAttempt({
                                          ...adapterOptions,
                                          bootstatusDeadlineMs,
                                          reuseBuildRunId,
                                        });
        runtimeTarget = nativePilotTargetFromCapture(selected.arguments.platform);
        if (
          executionAdapter === 'ios-detox-session' ||
          executionAdapter === 'android-detox-session'
        ) {
          assert(runtime, 'Detox session runtime is unavailable');
          const detoxRuntime = runtime as
            | IosDetoxSessionNativePilotRoute.IosDetoxSessionNativePilotAttempt
            | AndroidDetoxSessionNativePilotAttempt;
          assert(detoxRuntime.target.deviceId, 'Detox session target identity is missing');
          assert(detoxRuntime.target.apiOrigin, 'Detox session API origin is missing');
          runtimeTarget = detoxRuntime.target;
        } else if (executionAdapter === 'android-detox-camera') {
          assert(runtime && 'target' in runtime, 'Android Detox camera target is unavailable');
          runtimeTarget = runtime.target;
        } else if (executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH) {
          const cameraRuntime = runtime as Awaited<
            ReturnType<
              typeof IosDetoxCameraPublicDispatch.runIosDetoxCameraAttemptForPublicDispatch
            >
          >;
          runtimeTarget = cameraRuntime.target;
        } else {
          try {
            const runtimeCapture = (
              await readChildCaptureFromOwnedRoot({
                captureRoot: runtime.artifactRoot,
                expectedCaptureRunId: path.basename(runtime.artifactRoot),
              })
            ).capture;
            assert(
              runtimeCapture &&
                typeof runtimeCapture === 'object' &&
                !Array.isArray(runtimeCapture) &&
                (runtimeCapture as { platform?: unknown }).platform === selected.arguments.platform,
              'Runtime capture platform differs from selected platform',
            );
            runtimeTarget = nativePilotTargetFromCapture(
              selected.arguments.platform,
              runtimeCapture,
            );
            if (coldResetExpectation) {
              const childBinding = consumeChildColdReset({
                capture: runtimeCapture,
                captureRoot: runtime.artifactRoot,
                expectation: coldResetExpectation,
              });
              coldResetChildBinding = childBinding;
              coldResetHandoff = await handoffColdResetReceiptFromProcessBinding({
                binding: childBinding,
                prepared: preparedInvocation,
                signal: controller.signal,
              });
              await writeNativePilotPrivateFile({
                root: output,
                relative: 'cold-reset-handoff.private.json',
                contents: JSON.stringify({
                  kind: 'private child-produced cold reset handoff; not standalone public evidence',
                  source: coldResetHandoff.source,
                  final: coldResetHandoff.final,
                  finalRelativePath: coldResetHandoff.finalRelativePath,
                  sourceIdentity: coldResetHandoff.sourceIdentity,
                  finalIdentity: coldResetHandoff.finalIdentity,
                  target: childBinding.target,
                  backend: childBinding.backend,
                }),
                namespaceIdentity: preparedInvocation.namespaceIdentity,
                signal: controller.signal,
                deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
              });
              coldResetHandoffPublished = true;
            }
          } catch (error) {
            if (coldResetExpectation) {
              stage = 'runtime-verification-failed';
              throw new Error(
                `Child-produced cold reset could not be consumed for ${attemptId}: ${
                  error instanceof Error ? error.message : 'unknown child reset error'
                }`,
              );
            }
            runtimeTargetFailure = {
              name: error instanceof Error ? error.name : 'UnknownError',
              message:
                error instanceof Error ? error.message : 'Runtime target metadata unavailable',
            };
          }
        }
        assert.equal(runtime.requestedRunId, runId, 'Adapter run ID differs from requested run ID');
        assert.equal(
          runtime.requestedAttemptId,
          attemptId,
          'Adapter attempt ID differs from requested attempt ID',
        );
        await writeNativePilotPrivateFile({
          root: output,
          relative: 'runtime-link.private.json',
          contents: JSON.stringify({
            kind: 'private native execution link, not passing evidence',
            requestedRunId: runId,
            requestedAttemptId: attemptId,
            adapterRunId: runtime.requestedRunId,
            adapterAttemptId: runtime.requestedAttemptId,
            outputParent: preparedInvocation.outputParent,
            outputRoot: output,
            captureRunId: runtime.captureRunId,
            backendRunId: 'backendRunId' in runtime ? runtime.backendRunId : runtime.fixtureRunId,
            backendAttemptId: 'backendAttemptId' in runtime ? runtime.backendAttemptId : null,
            faultAttemptId: 'faultAttemptId' in runtime ? runtime.faultAttemptId : null,
            captureExitCode: runtime.captureExitCode,
            childExitCode: runtime.childExitCode,
            childSignal: 'childSignal' in runtime ? runtime.childSignal : null,
            childClassification:
              'childClassification' in runtime ? runtime.childClassification : null,
            captureResult: runtime.captureResult,
            captureCleanup: 'captureCleanup' in runtime ? runtime.captureCleanup : null,
            captureTimeout: 'captureTimeout' in runtime ? runtime.captureTimeout : null,
            cancellation: 'cancellation' in runtime ? runtime.cancellation : null,
            deadline: runtime.deadline,
            simulatorBootstrapFailure:
              'simulatorBootstrapFailure' in runtime ? runtime.simulatorBootstrapFailure : null,
            externalCleanupResult: runtime.externalCleanupResult,
            verificationResult: runtime.verificationResult,
            publicFinalization: 'publicFinalization' in runtime ? runtime.publicFinalization : null,
            publicDependencyStatus:
              'publicDependency' in runtime && runtime.publicDependency
                ? runtime.publicDependency.status
                : null,
            applicationFailure: 'applicationFailure' in runtime ? runtime.applicationFailure : null,
            verificationFailure:
              'verificationFailure' in runtime ? runtime.verificationFailure : null,
            callbackInvocations:
              'callbackInvocations' in runtime ? runtime.callbackInvocations : null,
            callbackCompleted: 'callbackCompleted' in runtime ? runtime.callbackCompleted : null,
            captureInvocation: 'captureInvocation' in runtime ? runtime.captureInvocation : null,
            captureCompleted: 'captureCompleted' in runtime ? runtime.captureCompleted : null,
            coldReset: 'coldReset' in runtime ? runtime.coldReset : null,
            timingsMs: runtime.timingsMs,
            target: runtimeTarget,
            targetFailure: runtimeTargetFailure,
            commandDiagnostics: 'commandDiagnostics' in runtime ? runtime.commandDiagnostics : [],
            censusFailures: 'censusFailures' in runtime ? runtime.censusFailures : [],
            outputFailures: 'outputFailures' in runtime ? runtime.outputFailures : [],
            recoveryLedgerReadFailures:
              'recoveryLedgerReadFailures' in runtime ? runtime.recoveryLedgerReadFailures : [],
            postCaptureFailure: 'postCaptureFailure' in runtime ? runtime.postCaptureFailure : null,
            coldResetHandoff:
              coldResetHandoff && coldResetChildBinding
                ? buildColdResetRuntimeLinkBinding({
                    requestedRunId: runId,
                    requestedAttemptId: attemptId,
                    captureRoot: runtime.artifactRoot,
                    captureRunId: runtime.captureRunId ?? path.basename(runtime.artifactRoot),
                    outputRoot: output,
                    child: coldResetChildBinding,
                    handoff: coldResetHandoff,
                  })
                : null,
            nativePassingCases: 0,
          }),
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        });
        runtimeLinkPublished = true;
        const invocationEvidenceValid =
          executionAdapter === 'ios-detox-session' ||
          executionAdapter === 'android-detox-session' ||
          executionAdapter === 'android-detox-camera'
            ? 'captureInvocation' in runtime &&
              runtime.captureInvocation.count === 1 &&
              runtime.captureInvocation.returned === true
            : executionAdapter === 'ios-session'
              ? isIosSessionCaptureResultConsistent(runtime)
              : executionAdapter === 'android-session'
                ? 'captureInvocation' in runtime &&
                  runtime.captureInvocation.count === 1 &&
                  runtime.captureInvocation.returned === true
                : 'callbackInvocations' in runtime && runtime.callbackInvocations === 1;
        stage = runtimeTargetFailure
          ? 'runtime-verification-failed'
          : runtime.externalCleanupResult !== 'passed'
            ? 'runtime-cleanup-failed'
            : 'postCaptureFailure' in runtime && runtime.postCaptureFailure
              ? 'runtime-verification-failed'
              : 'simulatorBootstrapFailure' in runtime &&
                  runtime.simulatorBootstrapFailure?.phase === 'bootstatus' &&
                  runtime.simulatorBootstrapFailure.failureReason === 'deadline'
                ? 'runtime-bootstrap-deadline'
                : executionAdapter === 'training' &&
                    'applicationFailure' in runtime &&
                    runtime.applicationFailure &&
                    runtime.verificationResult === 'application-failed'
                  ? 'runtime-application-failed'
                  : runtime.captureExitCode !== 0 || !invocationEvidenceValid
                    ? 'runtime-execution-failed'
                    : runtime.verificationResult !== 'passed' &&
                        // The Android Detox camera owner reports its finalized
                        // native result as 'verified-native'; the terminal
                        // camera branch below re-verifies and publishes it.
                        !(
                          executionAdapter === 'android-detox-camera' &&
                          runtime.verificationResult === 'verified-native'
                        )
                      ? executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH &&
                        'detoxBridgeResult' in runtime &&
                        runtime.detoxBridgeResult.attempt.status === 'source-only' &&
                        runtime.captureCompleted
                        ? 'runtime-finalization-pending'
                        : (executionAdapter === 'android-detox-camera' ||
                              (executionAdapter === 'camera' &&
                                selected.arguments.platform === 'android')) &&
                            runtime.verificationResult === 'source-only'
                          ? 'runtime-finalization-pending'
                          : (executionAdapter === 'ios-session' ||
                                executionAdapter === 'android-session' ||
                                executionAdapter === 'android-detox-session' ||
                                executionAdapter === 'camera') &&
                              runtime.verificationResult === 'source-only'
                            ? executionAdapter === 'ios-session' &&
                              'publicFinalization' in runtime &&
                              runtime.publicFinalization !== null
                              ? 'runtime-finalization-pending'
                              : 'runtime-source-only'
                            : 'runtime-verification-failed'
                      : 'runtime-finalization-pending';
      }
    } else {
      stage = 'execution-adapter-pending';
    }
  } catch (error) {
    if (error instanceof NativeHostContentionError) stage = 'native-host-contended';
    if (stage.startsWith('runtime-') && error instanceof Error)
      runtimeExecutionFailure = {
        name: error.name.slice(0, 128),
        message: error.message.slice(0, 1024),
      };
    // Do not echo arbitrary argv, file errors, credentials or malformed inventory.
    // The fixed stage code identifies the failed prerequisite without private data.
  }
  let sources: RepositoryIdentity[] = [];
  let repositoryRoots: Readonly<Record<'client' | 'server', string>> | undefined;
  let repositoryEvidenceForReceipt: NativePilotRepositoryEvidence | undefined;
  const terminalSourceObservation = await readRepositorySourcesBestEffort(root, controller.signal);
  sources = [...terminalSourceObservation.sources];
  if (terminalSourceObservation.evidence.status === 'observed') {
    const observedRoots = terminalSourceObservation.roots;
    assert(typeof observedRoots.client === 'string');
    assert(typeof observedRoots.server === 'string');
    repositoryRoots = {
      client: observedRoots.client,
      server: observedRoots.server,
    };
  } else {
    repositoryEvidenceForReceipt = {
      ...terminalSourceObservation.evidence,
      reason: `repository identity read failed or was unavailable for ${terminalSourceObservation.evidence.missing.join(', ')} before the terminal receipt; no source rows were synthesized`,
    };
  }
  const unknownRuntime = !runtime && stage.startsWith('runtime-');
  let runtimeFailurePublished = false;
  if (unknownRuntime) {
    const runtimeFailurePublication = await writeNativePilotOptionalPrivateFile({
      root: output,
      relative: 'runtime-failure.private.json',
      contents: JSON.stringify({
        kind: 'native runtime outcome unavailable; acquisition and cleanup are unproven',
        requestedRunId: runId,
        requestedAttemptId: attemptId,
        stage,
        nativePassingCases: 0,
        runtimeExecutionFailure,
      }),
      namespaceIdentity: preparedInvocation.namespaceIdentity,
      recoveryDeadlineMs: 30_000,
    });
    runtimeFailurePublished = runtimeFailurePublication.status === 'published';
  }
  const runtimeArtifactReferences = nativePilotRuntimeArtifactReferences({
    runtimePresent: runtime !== undefined,
    runtimeExternalCleanupFailed: runtime?.externalCleanupResult !== 'passed',
    runtimeLinkPublished,
    runtimeFailurePublished,
  });
  const detail = {
    'invalid-selection': 'Native pilot requires one supported platform, engine, scenario and mode.',
    'invalid-inventory':
      'Requested native scenario or current canonical declaration is unavailable.',
    'invalid-environment':
      'Inherited integration bypass flags, app variant or native execution deadlines are unsupported.',
    'invalid-build-reuse':
      'Requested native build lacks current qualified source, binary, configuration or reviewed entry evidence; no fallback or resources acquired.',
    'missing-assertion-ledger':
      'The requested native scenario lacks a complete shared core assertion ledger.',
    'native-host-unavailable':
      'The bounded native host census or its private receipt is unavailable.',
    'native-host-contended':
      'A live known native job is using the host; no native resources acquired.',
    'native-host-lock-required':
      'Owned native execution requires the shared host-lock wrapper and configured private state root.',
    'runtime-execution-failed':
      'The owned native controller did not complete every required action; retain its private capture.',
    'runtime-application-failed':
      'A required native quantity assertion has a qualified failing child and observed wrong rendered value; complete journey verification was not performed.',
    'runtime-bootstrap-deadline':
      'Owned simulator bootstatus exceeded its configured deadline; inspect the private diagnostic for the exact bound and elapsed time.',
    'runtime-cleanup-failed':
      'Independent native cleanup did not prove owned-resource absence and foreign-state preservation.',
    'runtime-verification-failed':
      'The complete native assertion ledger or current runtime evidence could not be verified.',
    'runtime-finalization-pending':
      'The owned native assertions were verified privately; public evidence staging and finalization remain pending.',
    'runtime-source-only':
      'The native dependency and private staging checks passed source-only; public/native promotion remains explicitly ineligible.',
    'execution-adapter-pending':
      'Qualified owned build/reset/network, engine execution and runtime verification adapters are pending.',
  }[stage];
  const receipt = {
    schemaVersion: 1,
    runId,
    attemptId,
    scenarioId: selected?.scenario.id ?? 'invalid-selection',
    phase: 'P4',
    layer: 'native',
    engine: args?.engine ?? 'node',
    dataMode: args ? (args.mode === 'integration' ? 'postgres' : 'fixture') : 'none',
    platform: args?.platform ?? 'none',
    locale: null,
    repositories: sources,
    ...(repositoryEvidenceForReceipt ? { repositoryEvidence: repositoryEvidenceForReceipt } : {}),
    target: runtimeTarget,
    inputs: {
      scenarioHash: selected?.scenarioHash ?? null,
      requirementHash: selected?.requirementHash ?? null,
      fixtureHash: runtime?.fixtureHash ?? null,
      flagsHash: runtime?.flagsHash ?? null,
      toolVersions: runtime?.toolVersions ?? { node: process.version },
    },
    command: {
      executable: 'node',
      argv: [
        'scripts/testing/run-native-pilot.ts',
        ...(args && selected ? formatNativePilotInvocationArguments(invocation) : []),
      ],
    },
    startedAt,
    finishedAt: new Date().toISOString(),
    result: signalCode ? 'cancelled' : 'harness-blocked',
    exitCode: signalCode ?? 2,
    childExitCode: runtime?.childExitCode ?? null,
    assertions: [] as {
      id: string;
      requirementRefs: string[];
      outcome: 'passed' | 'failed';
      evidencePaths: string[];
    }[],
    timingsMs: runtime?.timingsMs ?? {
      build: 0,
      install: 0,
      reset: 0,
      scenario: 0,
      verify: 0,
      cleanup: 0,
    },
    cleanup: {
      status: nativePilotCleanupStatus({ runtime, stage }),
      ownedResourceIds: runtimeTarget.deviceId ? [runtimeTarget.deviceId] : [],
      recoveryRecordPath: runtimeArtifactReferences.recoveryRecordPath,
    },
    artifacts: [
      'attempt-identity.private.json',
      ...runtimeArtifactReferences.artifacts,
      ...(coldResetHandoffPublished && coldResetHandoff
        ? ['cold-reset-handoff.private.json', coldResetHandoff.finalRelativePath]
        : []),
    ],
    blocker:
      signalCode || stage
        ? {
            code: signalCode
              ? runtime || stage.startsWith('runtime-')
                ? 'cancelled-runtime'
                : 'cancelled-preflight'
              : stage,
            detail: signalCode
              ? runtime || stage.startsWith('runtime-')
                ? 'Owned native execution was cancelled; its child result and cleanup status are retained.'
                : 'Native preflight was cancelled before native or backend acquisition.'
              : detail,
            owner: 'client/server maintainer',
            nextAction:
              stage === 'invalid-selection'
                ? 'Supply the documented native pilot arguments.'
                : stage === 'invalid-inventory'
                  ? 'Refresh and validate the canonical native declaration and selected platform.'
                  : 'Complete the applicable T12/T13/T14 prerequisite; preserve pending native and lifecycle gates.',
          }
        : null,
  };
  if (deadlinesRecorded) receipt.artifacts.push('execution-deadlines.private.json');
  if (
    (executionAdapter === 'ios-session' ||
      executionAdapter === 'android-session' ||
      executionAdapter === 'android-detox-session') &&
    runtime &&
    'staged' in runtime &&
    runtime.staged
  )
    receipt.artifacts.push(...runtime.staged.artifacts);
  if (
    !signalCode &&
    !deadlineExpired &&
    executionAdapter === 'training' &&
    stage === 'runtime-application-failed' &&
    runtime &&
    selected
  ) {
    const started = performance.now();
    try {
      assert.deepEqual(sourcesBefore, sources);
      const currentInventory = await readProtectedInventory(root, {
        signal: controller.signal,
        deadlineAtMs: preflight.deadlineAtMs,
      });
      inventory = currentInventory;
      const current = await selectNativePilotScenario(selected.arguments, currentInventory, root);
      assert.deepEqual(current, selected);
      assert(runtime.fixtureRunId && runtime.fixtureHash && runtime.flagsHash);
      assert.equal(runtime.childExitCode, 1);
      const staged = await stageNativeQuantityFailure({
        captureRoot: runtime.artifactRoot,
        outputRoot: output,
        requestedRunId: runId,
        fixtureRunId: runtime.fixtureRunId,
        selection: selected,
      });
      await verifyStagedNativeQuantityFailure(output, staged.manifestHash);
      const currentSources = await readRepositorySources(root, controller.signal);
      assert.deepEqual(currentSources.sources, sources);
      assert.deepEqual(currentSources.roots, repositoryRoots);
      receipt.result = 'application-failed';
      receipt.exitCode = 1;
      receipt.assertions = [staged.assertion];
      receipt.artifacts.push(...staged.artifacts);
      receipt.blocker = {
        code: 'native-application-assertion-failed',
        detail:
          'A required rendered quantity differs from its documented expected value; original child1 and private UI evidence are retained. The journey is incomplete.',
        owner: 'client/server maintainer',
        nextAction:
          'Diagnose the retained failed assertion; preserve this attempt and verify a separate restored clean control.',
      };
    } catch {
      receipt.result = 'harness-blocked';
      receipt.exitCode = 2;
      receipt.assertions = [];
      receipt.blocker = {
        code: 'native-application-failure-unqualified',
        detail:
          'Candidate failure bytes, runtime identity or cleanup could not be qualified; no product-failure classification is established.',
        owner: 'client/server maintainer',
        nextAction:
          'Inspect the original private candidate and lifecycle records; preserve the attempt.',
      };
    } finally {
      receipt.timingsMs.verify += performance.now() - started;
    }
  }
  if (!signalCode && stage === 'runtime-finalization-pending' && runtime && selected) {
    const finalizationStarted = performance.now();
    let iosDetoxCameraSourceOnly = false;
    try {
      assert.deepEqual(sourcesBefore, sources, 'Native repository inputs changed during execution');
      const current = await selectNativePilotScenario(
        selected.arguments,
        await readProtectedInventory(root, {
          signal: controller.signal,
          deadlineAtMs: preflight.deadlineAtMs,
        }),
        root,
      );
      assert.deepEqual(current, selected, 'Native selection changed before finalization');
      assert(runtime.fixtureRunId, 'Native fixture identity is unavailable');
      const finalizationCaptureRunId = runtime.captureRunId;
      assert(finalizationCaptureRunId, 'Native capture identity is unavailable');
      for (const [phase, value] of Object.entries(receipt.timingsMs))
        assert(
          typeof value === 'number' &&
            Number.isFinite(value) &&
            // The Android Detox camera attempt only reuses a qualified APK pair.
            (phase === 'build' && executionAdapter === 'android-detox-camera'
              ? value >= 0
              : value > 0),
          'Actual native phase timing is unavailable',
        );
      const assertionBindings =
        'assertionBindings' in runtime ? runtime.assertionBindings : undefined;
      const writableAssertionBindings =
        assertionBindings?.map((binding) => ({
          id: binding.id,
          requirementRefs: [...binding.requirementRefs],
          evidencePaths: [...binding.evidencePaths],
        })) ?? [];
      let stagedAssertions: typeof receipt.assertions = [];
      let stagedArtifacts: string[] = [];
      let stagedCopyManifest: { path: string; sha256: string } | undefined;
      let androidCameraSourceOnly = false;
      let androidDetoxCameraSourceOnly = false;
      let androidDetoxCameraVerified = false;
      let iosDetoxSourceOnly = false;
      let iosDetoxTrainingSourceOnly = false;
      const iosDetoxTrainingFinalizationDispatch =
        executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH
          ? await loadIosDetoxTrainingPublicDispatch()
          : undefined;
      let iosDetoxTrainingPublicFinalization:
        | ReturnType<
            typeof IosDetoxTrainingPublicDispatch.selectVerifiedIosDetoxTrainingPublicFinalization
          >
        | undefined;
      let androidDetoxSourceOnly = false;
      let androidDetoxSessionOuterLifecycleCandidate: Awaited<
        ReturnType<typeof reconcileT15AndroidDetoxSessionOuterReceipt>
      > | null = null;
      let androidDetoxSessionStaged:
        Awaited<ReturnType<typeof stageAndroidDetoxSessionPublicEvidence>> | undefined;
      if (executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH) {
        assert('detoxBridgeResult' in runtime, 'iOS Detox bridge result is unavailable');
        assert('detoxBuild' in runtime, 'iOS Detox qualified build is unavailable');
        const iosDetoxRuntime =
          runtime as IosDetoxConnectionPublicDispatch.DetoxNativePilotAttemptResult;
        iosDetoxRuntimeDispatch = await runIosDetoxConnectionRuntimeForOuterTerminal({
          attempt: iosDetoxRuntime,
          repositoryRoot: root,
          serverRoot: serverRoot!,
          outputRoot: output,
          requestedRunId: runId,
          requestedAttemptId: iosDetoxRuntime.requestedAttemptId,
          selection: selected,
          signal: controller.signal,
          deadlineMs: deadlines.stepMs,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          buildRunId: reuseBuildRunId!,
          parentEnv: process.env,
        });
        if (iosDetoxRuntimeDispatch.status === 'verified-private') {
          const verification = iosDetoxRuntimeDispatch.verification;
          assert(verification, 'Verified iOS Detox runtime result is missing its ledger');
          const staged = verification.staged;
          assert.equal(path.resolve(staged.outputRoot), path.resolve(output));
          stagedAssertions = verification.assertionBindings.map((binding) => ({
            id: binding.id,
            requirementRefs: [...binding.requirementRefs],
            outcome: 'passed' as const,
            evidencePaths: [...binding.evidencePaths],
          }));
          stagedArtifacts = [
            path.relative(
              output,
              path.join(staged.outputRoot, 'detox-connection-evidence-copy.private.json'),
            ),
            ...staged.manifest.files.map((file) =>
              path.relative(staged.outputRoot, path.join(staged.outputRoot, file.name)),
            ),
          ];
        } else {
          if (iosDetoxRuntimeDispatch.status === 'blocked')
            iosDetoxRuntimeFailure = iosDetoxRuntimeDispatch.blocker;
          const stagingOutputRoot = path.join(
            path.dirname(output),
            `${path.basename(output)}-detox-public`,
          );
          const stagingLifecycle = {
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          };
          const stagedDetox = await stageIosDetoxConnectionPublicEvidence({
            repositoryRoot: root,
            captureRoot: runtime.artifactRoot,
            outputRoot: stagingOutputRoot,
            requestedRunId: runId,
            requestedAttemptId: runtime.requestedAttemptId,
            selection: selected,
            bridgeResult: runtime.detoxBridgeResult as Parameters<
              typeof stageIosDetoxConnectionPublicEvidence
            >[0]['bridgeResult'],
            build: runtime.detoxBuild,
            lifecycle: stagingLifecycle,
          });
          await verifyStagedIosDetoxConnectionPublicEvidence({
            repositoryRoot: root,
            captureRoot: runtime.artifactRoot,
            outputRoot: stagedDetox.outputRoot,
            requestedRunId: runId,
            requestedAttemptId: runtime.requestedAttemptId,
            selection: selected,
            bridgeResult: runtime.detoxBridgeResult as Parameters<
              typeof verifyStagedIosDetoxConnectionPublicEvidence
            >[0]['bridgeResult'],
            build: runtime.detoxBuild,
            lifecycle: stagingLifecycle,
            copyManifest: stagedDetox.manifest,
          });
          await writeNativePilotPrivateFile({
            root: output,
            relative: 'detox-staging-link.private.json',
            contents: JSON.stringify({
              kind: 'private iOS Detox staging link; not public receipt',
              requestedRunId: runId,
              requestedAttemptId: runtime.requestedAttemptId,
              captureRoot: runtime.artifactRoot,
              stagingOutputRoot: stagedDetox.outputRoot,
              manifestPath: stagedDetox.manifestPath,
              runtimeDispatch: iosDetoxRuntimeDispatch,
              manifest: {
                kind: stagedDetox.manifest.kind,
                files: stagedDetox.manifest.files,
                nativePassingCases: stagedDetox.manifest.nativePassingCases,
                publicPromotionEligible: stagedDetox.manifest.publicPromotionEligible,
              },
            }),
            namespaceIdentity: preparedInvocation.namespaceIdentity,
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          });
          stagedArtifacts = ['detox-staging-link.private.json'];
          iosDetoxSourceOnly = true;
        }
      } else if (executionAdapter === 'ios-detox-session') {
        const detoxRuntime =
          runtime as IosDetoxSessionNativePilotRoute.IosDetoxSessionNativePilotAttempt;
        const report = JSON.parse(
          readNativeEvidence(
            detoxRuntime.artifactRoot,
            'detox-integrated-session-baseline.private.json',
            true,
          ).toString('utf8'),
        ) as DetoxBaselineReport;
        const stagedOutputIdentity = preparedInvocation.namespaceIdentity.output.entries.at(-1);
        assert(stagedOutputIdentity, 'iOS Detox session output identity is unavailable');
        const stagedDetoxSession = await stageDetoxSessionPublicEvidence({
          captureRoot: detoxRuntime.artifactRoot,
          outputRoot: output,
          requestedRunId: runId,
          requestedAttemptId: detoxRuntime.requestedAttemptId,
          selection: selected,
          report,
          adapter: detoxRuntime as unknown as IosDetoxSessionPublicAdapterResult,
          expectedOutputRootIdentity: {
            dev: stagedOutputIdentity.dev,
            ino: stagedOutputIdentity.ino,
            uid: stagedOutputIdentity.uid,
            gid: stagedOutputIdentity.gid,
            mode: stagedOutputIdentity.mode,
          },
          lifecycle: {
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          },
        });
        stagedAssertions = stagedDetoxSession.assertions.map((assertion) => ({
          id: assertion.id,
          requirementRefs: [...assertion.requirementRefs],
          outcome: assertion.outcome,
          evidencePaths: [...assertion.evidencePaths],
        }));
        stagedArtifacts = [...stagedDetoxSession.artifacts];
        stagedCopyManifest = stagedDetoxSession.copyManifest;
      } else if (executionAdapter === 'android-detox-session') {
        const detoxRuntime = runtime as AndroidDetoxSessionNativePilotAttempt;
        const report = JSON.parse(
          readNativeEvidence(
            detoxRuntime.artifactRoot,
            'detox-integrated-session-baseline.private.json',
            true,
          ).toString('utf8'),
        ) as DetoxBaselineReport;
        const stagingOutputRoot = path.join(
          path.dirname(output),
          `${path.basename(output)}-detox-android-session-public`,
        );
        const stagingLifecycle = {
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        };
        androidDetoxSessionStaged = await stageAndroidDetoxSessionPublicEvidence({
          captureRoot: detoxRuntime.artifactRoot,
          outputRoot: stagingOutputRoot,
          requestedRunId: runId,
          requestedAttemptId: detoxRuntime.requestedAttemptId,
          selection: selected,
          report,
          adapter: detoxRuntime as unknown as AndroidDetoxSessionPublicAdapterResult,
          lifecycle: stagingLifecycle,
        });
        stagedAssertions = androidDetoxSessionStaged.assertions.map((assertion) => ({
          id: assertion.id,
          requirementRefs: [...assertion.requirementRefs],
          outcome: assertion.outcome,
          evidencePaths: [...assertion.evidencePaths],
        }));
        stagedCopyManifest = androidDetoxSessionStaged.copyManifest;
        await writeNativePilotPrivateFile({
          root: output,
          relative: 'detox-android-session-staging-link.private.json',
          contents: JSON.stringify({
            kind: 'private Android Detox session staging link; not public receipt',
            requestedRunId: runId,
            requestedAttemptId: detoxRuntime.requestedAttemptId,
            captureRoot: detoxRuntime.artifactRoot,
            stagingOutputRoot: androidDetoxSessionStaged.outputRoot,
            manifestPath: androidDetoxSessionStaged.manifestPath,
            outputIdentity: androidDetoxSessionStaged.outputIdentity,
            manifest: {
              kind: androidDetoxSessionStaged.manifest.kind,
              files: androidDetoxSessionStaged.manifest.files,
              nativePassingCases: androidDetoxSessionStaged.manifest.nativePassingCases,
              publicPromotionEligible: androidDetoxSessionStaged.manifest.publicPromotionEligible,
            },
          }),
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        });
        await writeNativePilotPrivateFile({
          root: output,
          relative: 'detox-android-session-lifecycle-normalization.private.json',
          contents: JSON.stringify({
            kind: 'private Android Detox session split-identity lifecycle normalization; not public receipt',
            requestedRunId: runId,
            requestedAttemptId: detoxRuntime.requestedAttemptId,
            captureRunId: detoxRuntime.captureRunId,
            resourceOwnerRunId: detoxRuntime.resourceOwnerRunId,
            normalization: detoxRuntime.lifecycleNormalization,
          }),
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        });
        stagedArtifacts = [
          'detox-android-session-staging-link.private.json',
          'detox-android-session-lifecycle-normalization.private.json',
        ];
        // Private fixture/source controls can satisfy every structural staging
        // assertion while still lacking an executed Detox command. Keep that
        // boundary explicit: a real completed owned command may reach the
        // verified outer terminal, while source-only output remains blocked.
        androidDetoxSessionOuterCandidateGateBlocked = shouldBlockAndroidDetoxSessionOuterTerminal({
          nativeExecution: detoxRuntime.nativeExecution,
          lifecycleNormalization: detoxRuntime.lifecycleNormalization,
          publicReceiptBound: false,
          sharedLifecycleStatus: 'blocked',
        });
        // Candidate validation records a blocked public binding, but it cannot
        // classify a real native execution as source-only. The protected
        // post-publication reread below owns the terminal decision.
        androidDetoxSourceOnly = detoxRuntime.nativeExecution !== true;
      } else if (executionAdapter === ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH) {
        assert('detoxBridgeResult' in runtime, 'Android Detox bridge result is unavailable');
        assert('detoxBuild' in runtime, 'Android Detox qualified build is unavailable');
        const stagingOutputRoot = path.join(
          path.dirname(output),
          `${path.basename(output)}-detox-android-public`,
        );
        const stagingLifecycle = {
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        };
        const stagedDetox = await stageAndroidDetoxConnectionPublicEvidence({
          repositoryRoot: root,
          captureRoot: runtime.artifactRoot,
          outputRoot: stagingOutputRoot,
          requestedRunId: runId,
          requestedAttemptId: runtime.requestedAttemptId,
          selection: selected,
          bridgeResult: runtime.detoxBridgeResult as Parameters<
            typeof stageAndroidDetoxConnectionPublicEvidence
          >[0]['bridgeResult'],
          build: runtime.detoxBuild,
          lifecycle: stagingLifecycle,
        });
        await verifyStagedAndroidDetoxConnectionPublicEvidence({
          repositoryRoot: root,
          captureRoot: runtime.artifactRoot,
          outputRoot: stagedDetox.outputRoot,
          requestedRunId: runId,
          requestedAttemptId: runtime.requestedAttemptId,
          selection: selected,
          bridgeResult: runtime.detoxBridgeResult as Parameters<
            typeof verifyStagedAndroidDetoxConnectionPublicEvidence
          >[0]['bridgeResult'],
          build: runtime.detoxBuild,
          lifecycle: stagingLifecycle,
          copyManifest: stagedDetox.manifest,
        });
        await writeNativePilotPrivateFile({
          root: output,
          relative: 'detox-android-staging-link.private.json',
          contents: JSON.stringify({
            kind: 'private Android Detox staging link; not public receipt',
            requestedRunId: runId,
            requestedAttemptId: runtime.requestedAttemptId,
            captureRoot: runtime.artifactRoot,
            stagingOutputRoot: stagedDetox.outputRoot,
            manifestPath: stagedDetox.manifestPath,
            manifest: {
              kind: stagedDetox.manifest.kind,
              files: stagedDetox.manifest.files,
              nativePassingCases: stagedDetox.manifest.nativePassingCases,
              publicPromotionEligible: stagedDetox.manifest.publicPromotionEligible,
            },
          }),
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        });
        stagedArtifacts = ['detox-android-staging-link.private.json'];
        androidDetoxSourceOnly = true;
      } else if (executionAdapter === 'android-detox-camera') {
        const detoxCameraRuntime = runtime as AndroidDetoxCameraNativePilotAttempt;
        assert(detoxCameraRuntime.cameraStage, 'Android Detox camera stage is unavailable');
        assert(detoxCameraRuntime.fixtureHash, 'Android Detox camera fixture hash is unavailable');
        assert(detoxCameraRuntime.flagsHash, 'Android Detox camera flags hash is unavailable');
        assert(
          typeof detoxCameraRuntime.toolVersions.detox === 'string' &&
            detoxCameraRuntime.toolVersions.detox.length > 0,
          'Android Detox camera Detox version is unavailable',
        );
        assert.equal(
          detoxCameraRuntime.assertionContractSha256,
          selected.scenario.pilotAssertionContract?.sha256,
          'Android Detox camera assertion contract is not bound to the selected declaration',
        );
        assert.equal(
          detoxCameraRuntime.deadlineAtMonotonicMs,
          runStarted + deadlines.wholeRunMs,
          'Android Detox camera caller deadline was changed before terminal verification',
        );
        assert.equal(
          detoxCameraRuntime.backendRunId,
          detoxCameraRuntime.cameraProducer?.backendRunId,
          'Android Detox camera backend run identity is not producer-bound',
        );
        assert.equal(
          detoxCameraRuntime.buildIdentity.sourceTreeHash,
          detoxCameraRuntime.cameraProducer?.sourceTreeHash,
          'Android Detox camera source identity is not producer-bound',
        );
        assert.equal(
          detoxCameraRuntime.buildIdentity.helperInputsHash,
          detoxCameraRuntime.cameraProducer?.helperInputsHash,
          'Android Detox camera helper identity is not producer-bound',
        );
        assert.equal(
          detoxCameraRuntime.buildIdentity.appId,
          detoxCameraRuntime.target.appId,
          'Android Detox camera app identity is not target-bound',
        );
        assert.equal(
          detoxCameraRuntime.buildIdentity.buildProfile,
          detoxCameraRuntime.target.buildProfile,
          'Android Detox camera build profile is not target-bound',
        );
        assert.equal(
          detoxCameraRuntime.buildIdentity.apiOrigin,
          detoxCameraRuntime.target.apiOrigin,
          'Android Detox camera API origin is not target-bound',
        );
        assert(
          typeof detoxCameraRuntime.target.osVersion === 'string' &&
            detoxCameraRuntime.target.osVersion.length > 0,
          'Android Detox camera OS version is unavailable',
        );
        assert.equal(
          detoxCameraRuntime.buildIdentity.binaryHash,
          detoxCameraRuntime.target.binaryHash,
          'Android Detox camera build and target binary identities differ',
        );
        for (const [phase, elapsed] of Object.entries(detoxCameraRuntime.timingsMs)) {
          // The camera attempt reuses a qualified APK pair, so its build phase is 0.
          assert(
            Number.isFinite(elapsed) && (phase === 'build' ? elapsed >= 0 : elapsed > 0),
            `Android Detox camera ${phase} timing is unavailable at terminal verification`,
          );
        }
        stagedAssertions = [];
        stagedArtifacts = [detoxCameraRuntime.cameraStage.manifestPath];
        if (detoxCameraRuntime.nativeFinalization) {
          assert.equal(detoxCameraRuntime.verificationResult, 'verified-native');
          assert.equal(detoxCameraRuntime.nativePassingCases, 4);
          assert.equal(detoxCameraRuntime.publicPassingCases, 4);
          assert.equal(detoxCameraRuntime.publicPromotionEligible, true);
          stagedAssertions = detoxCameraRuntime.cameraStage.assertionBindings.map((binding) => ({
            id: binding.id,
            requirementRefs: [
              ...(selected.scenario.pilotAssertions?.find((row) => row.id === binding.id)
                ?.requirementRefs ??
                assert.fail(`Android Detox camera requirement refs missing for ${binding.id}`)),
            ],
            outcome: 'passed' as const,
            evidencePaths: [...binding.evidencePaths],
          }));
          stagedArtifacts.push(
            detoxCameraRuntime.nativeFinalization.receipt.path ||
              ANDROID_DETOX_CAMERA_FINALIZER_RECEIPT_PATH,
          );
          androidDetoxCameraVerified = true;
        } else {
          assert.equal(detoxCameraRuntime.verificationResult, 'source-only');
          androidDetoxCameraSourceOnly = true;
        }
        stagedCopyManifest = undefined;
      } else if (executionAdapter === 'ios-session') {
        assert('publicFinalization' in runtime && runtime.publicFinalization);
        assert(
          'publicFinalizationInput' in runtime && runtime.publicFinalizationInput,
          'Native session finalization input is unavailable',
        );
        const finalizationLifecycle = {
          signal: controller.signal,
          deadlineAtMs: runStarted + deadlines.wholeRunMs,
        };
        const stagedSession = await stageNativeSessionPublicEvidence(
          {
            ...runtime.publicFinalizationInput,
            outputRoot: output,
            requestedRunId: runId,
            requestedAttemptId: runtime.requestedAttemptId,
          },
          finalizationLifecycle,
        );
        stagedAssertions = [...stagedSession.assertions];
        stagedArtifacts = [...stagedSession.artifacts];
        stagedCopyManifest = stagedSession.copyManifest;
      } else if (executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH) {
        const cameraRuntime = runtime as Awaited<
          ReturnType<typeof IosDetoxCameraPublicDispatch.runIosDetoxCameraAttemptForPublicDispatch>
        >;
        let cameraVerification: Awaited<
          ReturnType<typeof verifyDetoxIosCameraPrivateEvidence>
        > | null = null;
        try {
          cameraVerification = await verifyDetoxIosCameraPrivateEvidence({
            result: cameraRuntime.detoxCameraResult,
            runtimeFacts: cameraRuntime.runtimeFacts,
            artifactRoot: cameraRuntime.artifactRoot,
            outputRoot: output,
            requestedRunId: runId,
            requestedAttemptId: cameraRuntime.requestedAttemptId,
            lifecycle: {
              signal: controller.signal,
              deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
            },
          });
          const assertionById = new Map(
            (selected.scenario.pilotAssertions ?? []).map((assertion) => [assertion.id, assertion]),
          );
          stagedAssertions = cameraVerification.assertionBindings.map((binding) => {
            const assertion = assertionById.get(binding.id);
            assert(
              assertion,
              `Camera assertion ${binding.id} is absent from the selected inventory`,
            );
            return {
              id: binding.id,
              requirementRefs: [...assertion.requirementRefs],
              outcome: 'passed' as const,
              evidencePaths: [...binding.evidencePaths],
            };
          });
          assert.equal(stagedAssertions.length, 4);
          stagedArtifacts = [...cameraVerification.artifacts];
        } catch {
          iosDetoxCameraSourceOnly = true;
        }
        await writeNativePilotPrivateFile({
          root: output,
          relative: 'detox-camera-staging-link.private.json',
          contents: JSON.stringify({
            kind: 'private iOS Detox camera staging link; not public receipt',
            requestedRunId: runId,
            requestedAttemptId: runtime.requestedAttemptId,
            captureRoot: runtime.artifactRoot,
            reportPath: cameraVerification?.reportPath ?? null,
            stagePath: cameraVerification?.stagePath ?? null,
            terminalPath: cameraVerification?.terminalPath ?? null,
            assertionIds: cameraVerification?.assertionBindings.map((binding) => binding.id) ?? [],
            outerVerification: cameraVerification,
            publicPromotionEligible: false,
          }),
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        });
        stagedArtifacts = [...stagedArtifacts, 'detox-camera-staging-link.private.json'];
      } else if (executionAdapter === 'camera') {
        assert(runtime.fixtureRunId, 'Native camera fixture identity is unavailable');
        if (selected.arguments.platform === 'android') {
          assert(
            isAndroidCameraPublicAttemptResult(runtime),
            'Android camera runtime result is malformed',
          );
          if (runtime.nativeRuntimeEligibility && runtime.nativeRuntimeFinalizerReceipt) {
            const finalized = await finalizeAndroidCameraNativeRuntime({
              repositoryRoot: root,
              eligibility: runtime.nativeRuntimeEligibility,
              captureRoot: runtime.artifactRoot,
              outputRoot: output,
              signal: controller.signal,
              deadlineAt: runStarted + deadlines.wholeRunMs,
            });
            assert.equal(finalized.publicPassingCases, 4);
            assert.equal(finalized.publicPromotionEligible, true);
            stagedAssertions = finalized.assertionBindings.map((binding) => ({
              id: binding.id,
              requirementRefs: [...binding.requirementRefs],
              outcome: 'passed' as const,
              evidencePaths: [...binding.evidencePaths],
            }));
            stagedArtifacts = [
              ...finalized.eligibility.stage.artifacts,
              runtime.nativeRuntimeFinalizerReceipt.path,
            ];
            stagedCopyManifest = finalized.eligibility.stage.copyManifest;
          } else {
            const stagedCamera = await finalizeAndroidCameraPublicEvidence({
              repositoryRoot: root,
              inventory,
              captureRoot: runtime.artifactRoot,
              outputRoot: output,
              requestedRunId: runId,
              captureRunId: finalizationCaptureRunId,
              fixtureRunId: runtime.fixtureRunId,
              selection: selected,
              runtime,
              signal: controller.signal,
            });
            stagedAssertions = [...stagedCamera.stage.assertions];
            stagedArtifacts = [...stagedCamera.stage.artifacts];
            stagedCopyManifest = stagedCamera.stage.copyManifest;
            androidCameraSourceOnly = stagedCamera.sourceOnly;
          }
        } else {
          const stagedCamera = await stageCameraPublicEvidence({
            captureRoot: runtime.artifactRoot,
            outputRoot: output,
            requestedRunId: runId,
            captureRunId: finalizationCaptureRunId,
            fixtureRunId: runtime.fixtureRunId,
            selection: selected,
          });
          stagedAssertions = [...stagedCamera.assertions];
          stagedArtifacts = stagedCamera.artifacts;
        }
      } else {
        assert(assertionBindings, 'Native runtime assertion bindings are unavailable');
        const stageOptions = {
          captureRoot: runtime.artifactRoot,
          outputRoot: output,
          requestedRunId: runId,
          fixtureRunId: runtime.fixtureRunId,
          selection: selected,
          bindings: writableAssertionBindings,
        };
        if (executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH)
          iosDetoxTrainingPublicFinalization =
            'publicFinalization' in runtime
              ? iosDetoxTrainingFinalizationDispatch!.selectVerifiedIosDetoxTrainingPublicFinalization(
                  runtime as IosDetoxTrainingPublicDispatch.DetoxIosTrainingNativePilotAttemptResult,
                )
              : undefined;
        const staged =
          executionAdapter === 'connection'
            ? await stageNativeConnectionPublicEvidence({
                ...stageOptions,
                repositoryRoot: root,
                platform: selected.arguments.platform,
              })
            : executionAdapter === 'ios-save-retry'
              ? await stageNativeSaveRetryPublicEvidence({
                  ...stageOptions,
                  repositoryRoot: root,
                })
              : executionAdapter === 'android-save-retry'
                ? await stageNativeAndroidSaveRetryPublicEvidence({
                    ...stageOptions,
                    repositoryRoot: root,
                  })
                : await stageNativeTrainingPublicEvidence({
                    ...stageOptions,
                    publicFinalization: iosDetoxTrainingPublicFinalization,
                    lifecycle: {
                      signal: controller.signal,
                      deadlineAtMs: runStarted + deadlines.wholeRunMs,
                    },
                  });
        stagedAssertions = staged.assertions.map((assertion) => ({
          id: assertion.id,
          requirementRefs: [...assertion.requirementRefs],
          outcome: assertion.outcome,
          evidencePaths: [...assertion.evidencePaths],
        }));
        stagedArtifacts = [...staged.artifacts];
        stagedCopyManifest = staged.copyManifest;
        if (executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH)
          iosDetoxTrainingSourceOnly = iosDetoxTrainingPublicFinalization === undefined;
      }
      const finalSources = await readRepositorySources(root, controller.signal);
      assert.deepEqual(
        finalSources.sources,
        sourcesBefore,
        'Native repository inputs changed during finalization',
      );
      assert.deepEqual(
        finalSources.roots,
        repositoryRootsBefore,
        'Native repository roots changed during finalization',
      );
      if (executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH) {
        assert(
          iosDetoxRuntimeDispatch?.status === 'verified-private' || iosDetoxSourceOnly,
          'iOS Detox runtime verification or source-only staging was not completed',
        );
      } else if (executionAdapter === IOS_DETOX_TRAINING_PUBLIC_DISPATCH) {
        assert(
          iosDetoxTrainingSourceOnly || iosDetoxTrainingPublicFinalization !== undefined,
          'iOS Detox training staging did not produce a verified private or public outcome',
        );
      } else if (executionAdapter === ANDROID_DETOX_CONNECTION_PUBLIC_DISPATCH) {
        assert(androidDetoxSourceOnly, 'Android Detox source-only staging was not completed');
      } else if (executionAdapter === 'android-detox-camera') {
        assert(
          androidDetoxCameraSourceOnly || androidDetoxCameraVerified,
          'Android Detox camera staging was not completed',
        );
      } else if (executionAdapter === 'android-detox-session') {
        assert(androidDetoxSessionStaged, 'Android Detox session staging result is unavailable');
        const verifiedManifest = await verifyStagedAndroidDetoxSessionEvidence({
          outputRoot: androidDetoxSessionStaged.outputRoot,
          outputIdentity: androidDetoxSessionStaged.outputIdentity,
          copyManifest: androidDetoxSessionStaged.copyManifest,
          requestedRunId: runId,
          requestedAttemptId: runtime.requestedAttemptId,
          selection: selected,
          lifecycle: {
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          },
        });
        const detoxRuntime = runtime as AndroidDetoxSessionNativePilotAttempt;
        const verifiedReport = JSON.parse(
          readNativeEvidence(
            detoxRuntime.artifactRoot,
            'detox-integrated-session-baseline.private.json',
            true,
          ).toString('utf8'),
        ) as DetoxBaselineReport;
        const terminalProof = buildAndroidDetoxSessionVerifiedTerminalProof({
          requestedRunId: runId,
          requestedAttemptId: runtime.requestedAttemptId,
          selection: selected,
          report: verifiedReport,
          adapter: detoxRuntime as unknown as AndroidDetoxSessionPublicAdapterResult,
          staged: androidDetoxSessionStaged,
          verifiedManifest,
        });
        await writeNativePilotPrivateFile({
          root: output,
          relative: androidDetoxSessionVerifiedTerminalEvidenceName,
          contents: terminalProof,
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          signal: controller.signal,
          deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
        });
        stagedAssertions = mapAndroidDetoxSessionAssertionsToOuterTerminal({
          assertions: androidDetoxSessionStaged.assertions,
          terminalEvidencePath: androidDetoxSessionVerifiedTerminalEvidenceName,
        });
        const terminalAliases = [
          ...new Set(
            stagedAssertions
              .flatMap((assertion) => assertion.evidencePaths)
              .filter((relative) => relative !== androidDetoxSessionVerifiedTerminalEvidenceName),
          ),
        ];
        for (const relative of terminalAliases)
          await writeNativePilotPrivateFile({
            root: output,
            relative,
            contents: terminalProof,
            namespaceIdentity: preparedInvocation.namespaceIdentity,
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          });
        stagedArtifacts.push(androidDetoxSessionVerifiedTerminalEvidenceName, ...terminalAliases);
      } else if (executionAdapter === 'ios-detox-session') {
        assert(stagedCopyManifest, 'iOS Detox session public copy manifest is unavailable');
        const stagedOutputIdentity = preparedInvocation.namespaceIdentity.output.entries.at(-1);
        assert(stagedOutputIdentity, 'iOS Detox session output identity is unavailable');
        await verifyStagedDetoxSessionEvidence({
          outputRoot: output,
          copyManifest: stagedCopyManifest,
          requestedRunId: runId,
          requestedAttemptId: runtime.requestedAttemptId,
          selection: selected,
          expectedOutputRootIdentity: {
            dev: stagedOutputIdentity.dev,
            ino: stagedOutputIdentity.ino,
            uid: stagedOutputIdentity.uid,
            gid: stagedOutputIdentity.gid,
            mode: stagedOutputIdentity.mode,
          },
          lifecycle: {
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
          },
        });
      } else if (executionAdapter === 'ios-session') {
        assert(stagedCopyManifest, 'Native session public copy manifest is unavailable');
        await verifyNativeSessionPublicEvidence(
          {
            outputRoot: output,
            copyManifest: stagedCopyManifest,
            requestedRunId: runId,
            captureRunId: finalizationCaptureRunId,
            fixtureRunId: runtime.fixtureRunId,
            captureRoot: runtime.artifactRoot,
            repositoryRoot: root,
          },
          {
            signal: controller.signal,
            deadlineAtMs: runStarted + deadlines.wholeRunMs,
          },
        );
      } else if (
        executionAdapter !== 'camera' &&
        executionAdapter !== IOS_DETOX_CAMERA_PUBLIC_DISPATCH
      ) {
        assert(assertionBindings, 'Native runtime assertion bindings are unavailable');
        const verifyOptions = {
          outputRoot: output,
          copyManifest: stagedCopyManifest,
          requestedRunId: runId,
          captureRunId: finalizationCaptureRunId,
          fixtureRunId: runtime.fixtureRunId,
          captureRoot: runtime.artifactRoot,
        };
        if (executionAdapter === 'connection')
          await verifyStagedNativeConnectionEvidence({
            ...verifyOptions,
            copyManifest: stagedCopyManifest!,
            repositoryRoot: root,
            selection: selected,
            bindings: writableAssertionBindings,
            platform: selected.arguments.platform,
          });
        else if (executionAdapter === 'ios-save-retry')
          await verifyStagedNativeSaveRetryEvidence({
            ...verifyOptions,
            copyManifest: stagedCopyManifest!,
            repositoryRoot: root,
            selection: selected,
          });
        else if (executionAdapter === 'android-save-retry')
          await verifyStagedNativeAndroidSaveRetryEvidence({
            ...verifyOptions,
            copyManifest: stagedCopyManifest!,
            repositoryRoot: root,
            selection: selected,
          });
        else
          await verifyStagedNativeTrainingEvidence({
            ...verifyOptions,
            copyManifest: stagedCopyManifest!,
            expectedPublicFinalization: iosDetoxTrainingPublicFinalization,
            lifecycle: {
              signal: controller.signal,
              deadlineAtMs: runStarted + deadlines.wholeRunMs,
            },
          });
      }
      controller.signal.throwIfAborted();
      receipt.assertions = stagedAssertions;
      receipt.artifacts.push(...stagedArtifacts);
      if (executionAdapter === 'android-detox-session' && runtime && selected) {
        const detoxRuntime = runtime as AndroidDetoxSessionNativePilotAttempt;
        if (detoxRuntime.nativeExecution) {
          try {
            androidDetoxSessionOuterLifecycleCandidate =
              reconcileT15AndroidDetoxSessionOuterReceipt({
                outputRoot: output,
                requestedRunId: runId,
                requestedAttemptId: detoxRuntime.requestedAttemptId,
                selection: selected,
                runtimeTarget,
                expectedFixtureHash: detoxRuntime.fixtureHash,
                expectedFlagsHash: detoxRuntime.flagsHash,
                expectedToolVersions: detoxRuntime.toolVersions,
                runtime: detoxRuntime,
                candidateReceipt: {
                  ...receipt,
                  result: 'passed',
                  exitCode: 0,
                  blocker: null,
                },
              });
          } catch {
            androidDetoxSessionOuterLifecycleCandidate = null;
          }
        }
        androidDetoxSessionOuterCandidateGateBlocked = shouldBlockAndroidDetoxSessionOuterTerminal({
          nativeExecution: detoxRuntime.nativeExecution,
          lifecycleNormalization:
            androidDetoxSessionOuterLifecycleCandidate?.normalization ??
            detoxRuntime.lifecycleNormalization,
          publicReceiptBound:
            androidDetoxSessionOuterLifecycleCandidate !== null &&
            androidDetoxSessionOuterLifecycleCandidate.publicReceipt !== null,
          sharedLifecycleStatus:
            androidDetoxSessionOuterLifecycleCandidate?.sharedLifecycle.status ?? 'blocked',
        });
        // The candidate has no public receipt by design. Keep its blocked gate
        // as private provenance and let the actual published reread decide
        // whether this native execution can receive terminal credit.
        androidDetoxSourceOnly = detoxRuntime.nativeExecution !== true;
      }
      if (iosDetoxRuntimeFailure) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'runtime-verification-failed',
          detail: `The producer supplied a runtime envelope but the protected outer verification boundary rejected it: ${iosDetoxRuntimeFailure.message}`,
          owner: 'client/server maintainer',
          nextAction:
            'Retain the original producer receipts and repair the failing identity, transport, SQL, UI or cleanup binding before a fresh attempt.',
        };
      } else if (iosDetoxSourceOnly || iosDetoxCameraSourceOnly) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'runtime-source-only',
          detail: iosDetoxCameraSourceOnly
            ? 'The owned iOS Detox camera dispatcher and protected private staging completed source-only; native/public promotion remains explicitly ineligible.'
            : 'The owned iOS Detox connection dispatcher and protected private staging completed source-only; native/public promotion remains explicitly ineligible.',
          owner: 'client/server maintainer',
          nextAction: iosDetoxCameraSourceOnly
            ? 'Run the declared iOS Detox camera cell and retain the actual device, build, API, SQL, transport, child, four assertion, and cleanup receipts before promotion.'
            : 'Run the declared iOS Detox integrated connection cell and retain the actual device, build, API, SQL, transport, child, and cleanup receipts before promotion.',
        };
      } else if (iosDetoxTrainingSourceOnly) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'runtime-source-only',
          detail:
            'The owned iOS Detox training dispatcher and protected private staging completed source-only; native/public promotion remains explicitly ineligible.',
          owner: 'client/server maintainer',
          nextAction:
            'Run the declared iOS Detox training cell and retain the actual device, build, API, SQL, transport, child, staged-original and cleanup receipts before promotion.',
        };
      } else if (androidDetoxSourceOnly) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'runtime-source-only',
          detail:
            executionAdapter === 'android-detox-session'
              ? 'The owned Android Detox session dispatcher and protected private staging completed source-only; native/public promotion remains explicitly ineligible.'
              : 'The owned Android Detox connection dispatcher and protected private staging completed source-only; native/public promotion remains explicitly ineligible.',
          owner: 'client/server maintainer',
          nextAction:
            executionAdapter === 'android-detox-session'
              ? 'Run the declared Android Detox session cell and retain the actual device, build, API, SQL, storage, transport, child, protected UI and cleanup receipts before promotion.'
              : 'Run the declared Android Detox integrated connection cell and retain the actual device, build, API, SQL, transport, child, and cleanup receipts before promotion.',
        };
      } else if (
        executionAdapter === 'android-detox-session' &&
        androidDetoxSessionOuterCandidateGateBlocked
      ) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'android-detox-session-outer-receipt-pending',
          detail:
            'The private Android Detox session candidate passed structural staging but cannot receive terminal credit until the protected writer publishes and rereads receipt.json.',
          owner: 'client/server maintainer',
          nextAction:
            'Retain the provisional blocked row and let the final protected public-receipt bridge decide promotion.',
        };
      } else if (androidDetoxCameraSourceOnly) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'runtime-source-only',
          detail:
            'Android Detox camera producer and protected private staging checks passed source-only; native/public promotion remains explicitly ineligible.',
          owner: 'client/server maintainer',
          nextAction:
            'Run the declared Android Detox camera cell and retain the exact device, child, build, API, SQL, transport, frame and cleanup receipts before promotion.',
        };
      } else if (androidCameraSourceOnly) {
        receipt.result = 'harness-blocked';
        receipt.exitCode = 2;
        receipt.blocker = {
          code: 'runtime-source-only',
          detail:
            'Android camera producer and protected private staging checks passed source-only; native/public promotion remains explicitly ineligible.',
          owner: 'client/server maintainer',
          nextAction:
            'Run the declared Android Maestro camera cell and retain the exact device permission, frame, transport and SQL receipts before promotion.',
        };
      } else {
        receipt.result = 'passed';
        receipt.exitCode = 0;
        receipt.blocker = null;
        assertNativePilotCompletion(
          receipt,
          selected,
          { runId, attemptId, target: receipt.target, inputs: receipt.inputs },
          [attemptId],
          output,
        );
      }
    } catch (error) {
      // Keep the original terminal-verification error privately; the public
      // blocker only carries a generic detail.
      await writeFile(
        path.join(output, 'terminal-verification-failure.private.json'),
        `${JSON.stringify({
          kind: 'private terminal verification failure; not public evidence',
          name: error instanceof Error ? error.name.slice(0, 128) : 'UnknownError',
          message: (error instanceof Error ? error.message : String(error)).slice(0, 2048),
        })}\n`,
        { flag: 'wx', mode: 0o600 },
      ).catch(() => undefined);
      if (executionAdapter === 'ios-session' && runtime) {
        try {
          if (runtime.captureRunId)
            await removeNativeSessionPublicEvidenceStage({
              outputRoot: output,
              captureRunId: runtime.captureRunId,
            });
        } catch {
          // Preserve the outer blocked receipt when a partial stage cannot be removed.
        }
      }
      if (error instanceof NativeTrainingPublicEvidenceStageError) {
        if (error.recoveryStatus === 'failed-recovery-ledger-retained')
          receipt.cleanup.status = error.recoveryStatus;
        if (
          error.recoveryRecordPath !== null &&
          !receipt.artifacts.includes(error.recoveryRecordPath)
        )
          receipt.artifacts.push(error.recoveryRecordPath);
      }
      if (executionAdapter === IOS_DETOX_CAMERA_PUBLIC_DISPATCH) iosDetoxCameraSourceOnly = true;
      let rejectedCameraRecoveryPaths: readonly string[] = [];
      if (error instanceof AndroidCameraPublicStageError) {
        if (error.recoveryStatus === 'failed-recovery-ledger-retained')
          receipt.cleanup.status = error.recoveryStatus;
        const cameraRecoveryPaths = [
          ...(error.recoveryRecordPath === null ? [] : [error.recoveryRecordPath]),
          ...error.retainedPaths,
        ];
        rejectedCameraRecoveryPaths = await appendAndroidCameraRecoveryArtifacts(
          receipt,
          output,
          cameraRecoveryPaths,
        );
        if (
          error.recoveryRecordPath !== null &&
          !rejectedCameraRecoveryPaths.includes(error.recoveryRecordPath)
        )
          receipt.cleanup.recoveryRecordPath = error.recoveryRecordPath;
      }
      if (error instanceof AndroidDetoxSessionStagingError)
        await attachAndroidDetoxSessionStagingRecovery(receipt, output, error);
      receipt.result = 'harness-blocked';
      receipt.exitCode = 2;
      receipt.assertions = [];
      const blocker = {
        code: 'runtime-finalization-failed',
        detail:
          error instanceof NativeTrainingPublicEvidenceStageError ||
          error instanceof AndroidCameraPublicStageError ||
          error instanceof AndroidDetoxSessionStagingError
            ? `${error.message}${
                error instanceof AndroidDetoxSessionStagingError
                  ? ` Recovery publication=${error.recoveryPublication}; child lifecycle=${JSON.stringify(error.childLifecycle)}.`
                  : ''
              }`
            : 'Current native identities, fingerprints, timings or staged proof did not satisfy final completion.',
        owner: 'client/server maintainer',
        nextAction:
          'Inspect the retained private adapter and staging artifacts; preserve the original attempt.',
      };
      if (rejectedCameraRecoveryPaths.length > 0) {
        blocker.detail += ` Rejected non-published Android camera recovery references: ${rejectedCameraRecoveryPaths.join(', ')}.`;
      }
      receipt.blocker = blocker;
    } finally {
      receipt.timingsMs.verify += performance.now() - finalizationStarted;
    }
  }
  const runtimeFacts: NativePilotRuntimeTerminalFacts | undefined = runtime
    ? {
        captureResult:
          typeof runtime.captureResult === 'string' ? runtime.captureResult : 'harness-blocked',
        captureTimeout:
          'captureTimeout' in runtime && runtime.captureTimeout === 'whole-capture'
            ? 'whole-capture'
            : null,
        cancellation:
          'cancellation' in runtime &&
          (runtime.cancellation === 'SIGINT' || runtime.cancellation === 'SIGTERM')
            ? runtime.cancellation
            : null,
        childExitCode: runtime.childExitCode,
        childSignal: 'childSignal' in runtime && runtime.childSignal ? runtime.childSignal : null,
        childClassification: 'childClassification' in runtime ? runtime.childClassification : null,
        censusFailureCount:
          'censusFailures' in runtime && Array.isArray(runtime.censusFailures)
            ? runtime.censusFailures.length
            : 0,
        deadline: runtime.deadline,
        externalCleanupResult: runtime.externalCleanupResult,
        postCaptureFailurePhase: normalizeNativePilotPostCaptureFailurePhase(
          'postCaptureFailure' in runtime && runtime.postCaptureFailure
            ? runtime.postCaptureFailure.phase
            : null,
        ),
        verificationResult: runtime.verificationResult,
      }
    : undefined;
  const terminalDecision = resolveNativePilotTerminalDecision({
    runtime: runtimeFacts,
    signalCode,
    deadlineExpired,
    stage,
  });
  if (terminalDecision && (receipt.result === 'harness-blocked' || signalCode || deadlineExpired)) {
    receipt.result = terminalDecision.result;
    receipt.exitCode = terminalDecision.exitCode;
    receipt.assertions = [];
    receipt.blocker = {
      code: terminalDecision.blockerCode,
      detail: terminalDecision.detail,
      owner: 'client/server maintainer',
      nextAction:
        'Inspect the private runtime link, capture and cleanup records before a fresh attempt.',
    };
  }
  if (repositoryEvidenceForReceipt && !signalCode && !deadlineExpired) {
    // A clean runtime cannot become a passing receipt when source freshness is
    // unknown. Keep the original private runtime and cleanup artifacts, but
    // publish a truthful blocked terminal record. The stage remains unchanged
    // so a pre-acquisition invalid selection still reports not-acquired cleanup.
    markNativePilotReceiptBlockedForRepositoryEvidence(receipt, repositoryEvidenceForReceipt);
  }
  receipt.finishedAt = new Date().toISOString();
  assertPublicReceipt(receipt, output);
  const iosDetoxConnectionRuntimeDispatch =
    executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH
      ? await loadIosDetoxConnectionRuntimeDispatch()
      : undefined;
  const verifiedIosDetoxDispatch =
    executionAdapter === IOS_DETOX_CONNECTION_PUBLIC_DISPATCH &&
    iosDetoxRuntimeDispatch !== null &&
    iosDetoxConnectionRuntimeDispatch!.shouldUseVerifiedIosDetoxTerminalPublisher({
      dispatchStatus: iosDetoxRuntimeDispatch.status,
      receiptResult: receipt.result,
    })
      ? iosDetoxRuntimeDispatch
      : null;
  const terminalPublication: NativePilotTerminalPublication =
    verifiedIosDetoxDispatch !== null
      ? await iosDetoxConnectionRuntimeDispatch!.publishVerifiedIosDetoxConnectionRuntimeForOuterTerminal(
          {
            dispatch: verifiedIosDetoxDispatch,
            receipt,
            outputRoot: output,
            selection: selected!,
            namespaceIdentity: preparedInvocation.namespaceIdentity,
            signal: controller.signal,
            deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
            recoveryDeadlineMs: 30_000,
            publishTerminal: writeNativePilotTerminalReceipt,
          },
        )
      : await writeNativePilotTerminalReceipt({
          root: output,
          receipt,
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          callerSignal: controller.signal,
          recoveryDeadlineMs: 30_000,
        });
  preflight.dispose();
  if (terminalPublication.status !== 'published') {
    process.stderr.write(
      `Native pilot terminal receipt publication remained unverified${terminalPublication.recoveryRecordPath ? `; recovery: ${terminalPublication.recoveryRecordPath}` : ''}.\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (
    executionAdapter === 'android-detox-session' &&
    runtime &&
    selected &&
    'resourceOwnerRunId' in runtime &&
    'lifecycleNormalization' in runtime
  ) {
    const androidDetoxRuntime = runtime;
    let outerReceiptBridge = reconcileT15AndroidDetoxSessionOuterReceipt({
      outputRoot: output,
      requestedRunId: runId,
      requestedAttemptId: androidDetoxRuntime.requestedAttemptId,
      selection: selected,
      runtimeTarget,
      expectedFixtureHash: androidDetoxRuntime.fixtureHash,
      expectedFlagsHash: androidDetoxRuntime.flagsHash,
      expectedToolVersions: androidDetoxRuntime.toolVersions,
      runtime: androidDetoxRuntime,
    });
    const finalOuterGateBlocked =
      outerReceiptBridge.status !== 'normalized' ||
      shouldBlockAndroidDetoxSessionOuterTerminal({
        nativeExecution: androidDetoxRuntime.nativeExecution,
        lifecycleNormalization: outerReceiptBridge.normalization,
        publicReceiptBound: outerReceiptBridge.publicReceipt != null,
        sharedLifecycleStatus: outerReceiptBridge.sharedLifecycle.status,
      });
    const bridgeBlocked =
      finalOuterGateBlocked &&
      blockAndroidDetoxSessionOuterReceiptForBridgeFailure(receipt, outerReceiptBridge);
    if (!finalOuterGateBlocked) {
      const promoted = promoteAndroidDetoxSessionOuterReceiptAfterBridge(
        receipt,
        outerReceiptBridge,
      );
      if (promoted) {
        receipt.finishedAt = new Date().toISOString();
        assertPublicReceipt(receipt, output);
        const promotion = await writeNativePilotTerminalReceipt({
          root: output,
          receipt,
          namespaceIdentity: preparedInvocation.namespaceIdentity,
          callerSignal: controller.signal,
          recoveryDeadlineMs: 30_000,
          replaceExisting: true,
        });
        if (promotion.status !== 'published') {
          process.stderr.write(
            `Native pilot promoted terminal replacement remained unverified${promotion.recoveryRecordPath ? `; recovery: ${promotion.recoveryRecordPath}` : ''}.\n`,
          );
          process.exitCode = 2;
          return;
        }
        outerReceiptBridge = reconcileT15AndroidDetoxSessionOuterReceipt({
          outputRoot: output,
          requestedRunId: runId,
          requestedAttemptId: androidDetoxRuntime.requestedAttemptId,
          selection: selected,
          runtimeTarget,
          expectedFixtureHash: androidDetoxRuntime.fixtureHash,
          expectedFlagsHash: androidDetoxRuntime.flagsHash,
          expectedToolVersions: androidDetoxRuntime.toolVersions,
          runtime: androidDetoxRuntime,
        });
        const rereadReceipt = outerReceiptBridge.publicReceipt?.receipt as
          Record<string, unknown> | undefined;
        assert.equal(
          rereadReceipt?.result,
          receipt.result,
          'Android Detox passed bridge replacement did not persist its result',
        );
        assert.equal(
          rereadReceipt?.exitCode,
          receipt.exitCode,
          'Android Detox passed bridge replacement did not persist its exit code',
        );
      }
    }
    if (bridgeBlocked) {
      // The first receipt was only a provisional terminal row. Once the
      // protected reread proves that the bridge is blocked, rewrite the same
      // receipt through the anchored replacement path so the durable result
      // and exit code cannot retain a false pass.
      receipt.finishedAt = new Date().toISOString();
      assertPublicReceipt(receipt, output);
      const replacement = await writeNativePilotTerminalReceipt({
        root: output,
        receipt,
        namespaceIdentity: preparedInvocation.namespaceIdentity,
        callerSignal: controller.signal,
        recoveryDeadlineMs: 30_000,
        replaceExisting: true,
      });
      if (replacement.status !== 'published') {
        process.stderr.write(
          `Native pilot blocked terminal replacement remained unverified${replacement.recoveryRecordPath ? `; recovery: ${replacement.recoveryRecordPath}` : ''}.\n`,
        );
        preflight.dispose();
        process.exitCode = 2;
        return;
      }
      outerReceiptBridge = reconcileT15AndroidDetoxSessionOuterReceipt({
        outputRoot: output,
        requestedRunId: runId,
        requestedAttemptId: androidDetoxRuntime.requestedAttemptId,
        selection: selected,
        runtimeTarget,
        expectedFixtureHash: androidDetoxRuntime.fixtureHash,
        expectedFlagsHash: androidDetoxRuntime.flagsHash,
        expectedToolVersions: androidDetoxRuntime.toolVersions,
        runtime: androidDetoxRuntime,
      });
      const rereadReceipt = outerReceiptBridge.publicReceipt?.receipt as
        Record<string, unknown> | undefined;
      assert.equal(
        rereadReceipt?.result,
        receipt.result,
        'Android Detox blocked bridge replacement did not persist its result',
      );
      assert.equal(
        rereadReceipt?.exitCode,
        receipt.exitCode,
        'Android Detox blocked bridge replacement did not persist its exit code',
      );
    }
    await writeNativePilotPrivateFile({
      root: output,
      relative: 'detox-android-session-public-receipt-bridge.private.json',
      contents: JSON.stringify({
        kind: 'private Android Detox session outer-public-receipt bridge; not public receipt',
        status: outerReceiptBridge.status,
        receiptPath: outerReceiptBridge.receiptPath,
        receiptHash: outerReceiptBridge.receiptHash,
        receiptIdentity: outerReceiptBridge.receiptIdentity,
        normalization: outerReceiptBridge.normalization,
        sharedLifecycle: outerReceiptBridge.sharedLifecycle,
        blockers: outerReceiptBridge.blockers,
        candidateGateBlocked: androidDetoxSessionOuterCandidateGateBlocked,
        finalOuterGateBlocked,
        nativePassingCases: 0,
        publicPassingCases: 0,
        coldQualifiedAttempts: 0,
      }),
      namespaceIdentity: preparedInvocation.namespaceIdentity,
      signal: controller.signal,
      deadlineAtMonotonicMs: runStarted + deadlines.wholeRunMs,
    });
  }
  process.stdout.write(
    `Native pilot ${receipt.result} (${receipt.blocker?.code ?? 'complete'}); receipt: ${path.join(output, 'receipt.json')}\n`,
  );
  process.exitCode = receipt.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void main().catch(() => {
    process.stderr.write(
      'Native pilot could not finalize its receipt; inspect the private attempt and capture artifacts.\n',
    );
    process.exitCode = 2;
  });
}
