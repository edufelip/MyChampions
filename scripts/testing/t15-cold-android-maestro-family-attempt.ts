import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { type AndroidOwnedNativeSessionPreparation } from './capture-android-testability';
import { readNativeEvidenceObservation } from './native-view-evidence';
import { runAndroidCameraPublicAttempt } from './run-android-camera-public-attempt';
import { runAndroidConnectionAttempt } from './run-android-connection-attempt';
import { runAndroidSaveRetryAttempt } from './run-android-save-retry-attempt';
import { runAndroidSessionAttempt } from './run-android-session-attempt';
import { runAndroidTrainingAttempt } from './run-android-training-attempt';
import {
  loadQualifiedAndroidMaestroBuild,
  type AndroidMaestroQualifiedBuildReuse,
} from './t15-cold-android-maestro-build-reuse';
import {
  produceAndroidColdReset,
  type AndroidColdResetResult,
} from './t15-cold-android-reset-producer';
import type {
  T15OwnedLifecycleFamilyAttemptRunner,
  T15OwnedLifecycleSessionResult,
} from './t15-cold-owned-lifecycle';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function absolute(value: string, label: string): string {
  if (!path.isAbsolute(value) || path.normalize(value) !== value)
    throw new Error(`${label} must be an absolute canonical path`);
  return value;
}

function reportFromCapture(root: string): JsonRecord {
  const observation = readNativeEvidenceObservation(root, 'capture.private.json', true);
  try {
    const parsed = JSON.parse(observation.bytes.toString('utf8')) as unknown;
    if (!isRecord(parsed)) throw new Error('capture report is not an object');
    return parsed;
  } catch (error) {
    throw new Error(
      `Android family capture report is invalid: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }
}

function toLifecycleResult(outcome: {
  artifactRoot: string;
  captureExitCode: number;
  callbackCompleted?: boolean;
  captureCompleted?: boolean;
  verificationResult?: string;
}): T15OwnedLifecycleSessionResult {
  const artifactRoot = absolute(outcome.artifactRoot, 'Android family artifact root');
  const report = reportFromCapture(artifactRoot);
  if (!Number.isSafeInteger(outcome.captureExitCode))
    throw new Error('Android family capture exit code is invalid');
  return {
    artifactRoot,
    exitCode: outcome.captureExitCode,
    report,
    familyProducerCallbackCompleted: outcome.callbackCompleted ?? outcome.captureCompleted ?? false,
    familyProducerVerificationResult: outcome.verificationResult,
  };
}

function resetPreparation(input: Parameters<T15OwnedLifecycleFamilyAttemptRunner>[0]): {
  coldResetOwnerRunId: string;
  coldResetFixtureResetId: string;
  prepareColdReset: AndroidOwnedNativeSessionPreparation;
} {
  const coldResetOwnerRunId = randomBytes(12).toString('hex');
  const coldResetFixtureResetId = input.coldReset.fixtureResetId;
  return {
    coldResetOwnerRunId,
    coldResetFixtureResetId,
    prepareColdReset: async (context) => {
      const reset: AndroidColdResetResult = await produceAndroidColdReset({
        expectation: input.coldReset,
        outputRoot: context.output,
        captureRunId: context.captureRunId,
        ownerRunId: context.ownerRunId,
        deadlineAtMonotonicMs: context.deadlineAtMonotonicMs,
        resetStartedAt: new Date().toISOString(),
        target: context.target,
        session: context.session,
        proxy: context.proxy,
        proxyProcess: context.proxyProcess,
        fixtures: context.fixtures,
        build: context.build,
        installedApk: context.installedApk,
        commandExecutions: context.commandExecutions,
        signal: context.signal,
      });
      return structuredClone(reset) as unknown as JsonRecord;
    },
  };
}

function requireAndroidMaestroSelection(
  input: Parameters<T15OwnedLifecycleFamilyAttemptRunner>[0],
): void {
  if (input.selection.arguments.platform !== 'android') throw new Error('unsupported-platform');
  if (input.selection.arguments.engine !== 'maestro') throw new Error('unsupported-engine');
  if (input.selection.arguments.mode !== 'integration') throw new Error('unsupported-mode');
  if (
    ![
      'FLW-session',
      'FLW-training',
      'FLW-connection',
      'FLW-camera-denied',
      'FLW-save-retry',
    ].includes(input.selection.scenario.flowId)
  )
    throw new Error('unsupported-family');
}

/**
 * Composes the five existing Android Maestro producers around the one owned
 * Android cold-reset seam. The family adapters retain their source-only
 * boundary; the outer T15 lifecycle remains the only terminal owner.
 */
export function createT15AndroidMaestroFamilyAttemptRunner(options: {
  repositoryRoot: string;
}): T15OwnedLifecycleFamilyAttemptRunner {
  const repositoryRoot = absolute(options.repositoryRoot, 'Android repository root');
  return async (input) => {
    requireAndroidMaestroSelection(input);
    const qualifiedBuild: AndroidMaestroQualifiedBuildReuse =
      await loadQualifiedAndroidMaestroBuild({
        repositoryRoot,
        expected: {
          platform: 'android',
          buildId: input.reusableBuild.buildId,
          buildProfile: input.reusableBuild.buildProfile,
          sourceFingerprint: input.reusableBuild.sourceFingerprint,
          helperFingerprint: input.reusableBuild.helperFingerprint,
          flagsFingerprint: input.reusableBuild.flagsFingerprint,
          binaryHash: input.reusableBuild.binaryHash,
          current: true,
        },
        signal: input.invocation.signal,
        deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      });
    const preparation = resetPreparation(input);
    const common = {
      repositoryRoot,
      requestedRunId: input.invocation.expected.runId,
      selection: input.selection,
      signal: input.invocation.signal,
      deadlines: undefined,
      deadlineAtMonotonicMs: input.deadlineAtMonotonicMs,
      coldResetOwnerRunId: preparation.coldResetOwnerRunId,
      coldResetFixtureResetId: preparation.coldResetFixtureResetId,
      prepareColdReset: preparation.prepareColdReset,
      qualifiedBuild,
    };
    switch (input.selection.scenario.flowId) {
      case 'FLW-session':
        return toLifecycleResult(
          await runAndroidSessionAttempt({
            ...common,
            outputRoot: input.callerOutputRoot,
            qualifiedBuild,
          }),
        );
      case 'FLW-training':
        return toLifecycleResult(await runAndroidTrainingAttempt(common));
      case 'FLW-connection':
        return toLifecycleResult(await runAndroidConnectionAttempt(common));
      case 'FLW-save-retry':
        return toLifecycleResult(await runAndroidSaveRetryAttempt(common));
      case 'FLW-camera-denied':
        return toLifecycleResult(
          await runAndroidCameraPublicAttempt({
            ...common,
            outputRoot: input.callerOutputRoot,
            deadlineAt: input.deadlineAtMonotonicMs,
          }),
        );
      default:
        throw new Error('unsupported-family');
    }
  };
}

export const t15AndroidMaestroFamilyAttemptContract = {
  platform: 'android' as const,
  engine: 'maestro' as const,
  families: ['session', 'training', 'connection', 'camera-denied', 'save-retry'] as const,
  reset: 'produceAndroidColdReset-after-owned-install-and-prefs' as const,
  publicPromotion: 'outer-terminal-only' as const,
};
