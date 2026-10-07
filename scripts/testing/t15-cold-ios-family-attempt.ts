import path from 'node:path';
import {
  readNativeEvidenceObservation,
  type NativeEvidenceObservation,
} from './native-view-evidence';
import { runIosCameraAttempt } from './run-ios-camera-attempt';
import { runIosConnectionAttempt } from './run-ios-connection-attempt';
import { runIosSaveRetryAttempt } from './run-ios-save-retry-attempt';
import { runIosTrainingAttempt } from './run-ios-training-attempt';
import type { NativePilotSelection } from './native-pilot-contract';
import type {
  T15OwnedLifecycleFamilyAttemptRunner,
  T15OwnedLifecycleSessionResult,
} from './t15-cold-owned-lifecycle';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireAbsolute(value: string, label: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) !== value || value.includes('\0'))
    throw new Error(`${label} must be an absolute canonical path`);
  return value;
}

function requireCaptureObservation(root: string): NativeEvidenceObservation {
  const captureRoot = requireAbsolute(root, 'capture root');
  const observation = readNativeEvidenceObservation(captureRoot, 'capture.private.json', true);
  let parsed: unknown;
  try {
    parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  } catch {
    throw new Error('existing iOS family producer capture receipt is invalid JSON');
  }
  if (!isRecord(parsed))
    throw new Error('existing iOS family producer capture receipt is not an object');
  return observation;
}

type ExistingFamilyOutcome = {
  artifactRoot: string;
  captureExitCode: number;
  callbackCompleted?: boolean;
  verificationResult?: string;
};

/** Rehydrate the actual capture report written by the existing family producer. */
function toOwnedSessionResult(outcome: ExistingFamilyOutcome): T15OwnedLifecycleSessionResult {
  const artifactRoot = requireAbsolute(outcome.artifactRoot, 'family artifact root');
  const observation = requireCaptureObservation(artifactRoot);
  const report = JSON.parse(observation.bytes.toString('utf8')) as unknown;
  if (!isRecord(report)) throw new Error('family capture report is not an object');
  if (!Number.isSafeInteger(outcome.captureExitCode))
    throw new Error('family producer capture exit code is invalid');
  const result: T15OwnedLifecycleSessionResult = {
    artifactRoot,
    exitCode: outcome.captureExitCode,
    report,
  };
  if (outcome.callbackCompleted !== undefined)
    result.familyProducerCallbackCompleted = outcome.callbackCompleted;
  if (outcome.verificationResult !== undefined)
    result.familyProducerVerificationResult = outcome.verificationResult;
  return result;
}

function requireIosMaestroSelection(selection: NativePilotSelection): void {
  if (selection.arguments.platform !== 'ios') throw new Error('unsupported-platform');
  if (selection.arguments.engine !== 'maestro') throw new Error('unsupported-engine');
  if (selection.arguments.mode !== 'integration') throw new Error('unsupported-mode');
  if (
    !['FLW-training', 'FLW-connection', 'FLW-save-retry', 'FLW-camera-denied'].includes(
      selection.scenario.flowId,
    )
  )
    throw new Error('unsupported-family');
}

/**
 * Connects the reviewed lifecycle owner to the four existing iOS family
 * producers.  Each producer still owns its normal UI/API/SQL observation,
 * protected adapter and cleanup path; this bridge only supplies the same
 * caller identity/deadline and rehydrates the protected capture report for
 * the outer cold lifecycle.
 */
export function createT15IosFamilyAttemptRunner(options: {
  repositoryRoot: string;
}): T15OwnedLifecycleFamilyAttemptRunner {
  const repositoryRoot = requireAbsolute(options.repositoryRoot, 'repository root');
  return async (input) => {
    requireIosMaestroSelection(input.selection);
    const common = {
      repositoryRoot,
      requestedRunId: input.invocation.expected.runId,
      selection: input.selection,
      signal: input.invocation.signal,
      callerOutputRoot: input.callerOutputRoot,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      reuseBuildRunId: input.reusableBuild.buildId,
      reuseBuildSourceRoot: repositoryRoot,
      coldReset: input.coldReset,
    };
    let outcome: ExistingFamilyOutcome;
    switch (input.selection.scenario.flowId) {
      case 'FLW-training':
        outcome = await runIosTrainingAttempt(common);
        break;
      case 'FLW-connection':
        outcome = await runIosConnectionAttempt(common);
        break;
      case 'FLW-save-retry':
        outcome = await runIosSaveRetryAttempt(common);
        break;
      case 'FLW-camera-denied':
        outcome = await runIosCameraAttempt({
          ...common,
          outputRoot: input.callerOutputRoot,
          deadlineAt: input.deadlineAtMonotonicMs,
        });
        break;
      default:
        throw new Error('unsupported-family');
    }
    return toOwnedSessionResult(outcome);
  };
}

export const t15IosFamilyAttemptContract = {
  producerKind: 'existing-ios-family-producer',
  families: ['training', 'connection', 'save-retry', 'camera-denied'] as const,
  platform: 'ios' as const,
  engine: 'maestro' as const,
  resetAndCleanupOwner: 'runOwnedIosNativeSession' as const,
  protectedCaptureReadback: true as const,
  publicPromotionEligible: false as const,
};
