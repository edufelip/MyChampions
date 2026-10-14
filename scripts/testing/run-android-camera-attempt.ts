import assert from 'node:assert/strict';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import {
  androidCameraSelectionHash,
  ANDROID_CAMERA_SCENARIO,
  blockedCameraGate,
  requireAndroidCameraIdentityBoundary,
} from './native-camera-android-contract';
import {
  androidCameraBlockedGates,
  reselectAndroidCameraScenario,
} from './native-camera-android-observation';
import {
  requireAndroidCameraProducerOutput,
  requireAndroidCameraSelectionShape,
  runAndroidCameraDeniedProducer,
  type AndroidCameraProducerContext,
  type AndroidCameraProducerReceipts,
} from './native-camera-android-producer';
import {
  type AndroidCameraExecutionResult,
  type AndroidCameraAttemptResultV4Core,
  runAndroidCameraAttemptV4Core,
} from './run-android-camera-attempt-core';
import type { NativePilotSelection } from './native-pilot-contract';

const RUN_ID = /^[a-f0-9]{24}$/u;

export type AndroidCameraOwnedSessionBridge = {
  /**
   * This is the future `executeCamera` branch of
   * `runOwnedAndroidNativeSession`. It must acquire the target, build, API
   * proxy, fixture/session snapshots and independent cleanup exactly once.
   * The bridge is deliberately not implemented by this packet because the
   * canonical Android capture has no camera charter yet.
   */
  run: (input: {
    /** Forwarded from the public caller closure; never derived by the producer. */
    requestedRunId: string;
    selection: NativePilotSelection;
    signal: AbortSignal;
    executeCamera: (
      context: AndroidCameraProducerContext,
    ) => Promise<AndroidCameraProducerReceipts>;
  }) => Promise<AndroidCameraExecutionResult>;
};

export type AndroidCameraAttemptResultV4 = AndroidCameraAttemptResultV4Core & {
  selectionRevalidated: boolean;
  bridgeInvoked: boolean;
  producerOutput: 'not-run' | 'receipts-bound';
};

export type AndroidCameraAttemptOptionsV4 = {
  repositoryRoot: string;
  inventory: unknown;
  requestedRunId: string;
  selection: NativePilotSelection;
  requiredSourcePaths: readonly string[];
  requiredDeclarationPath: string;
  signal: AbortSignal;
  bridge?: AndroidCameraOwnedSessionBridge;
  /** Source-only private seam; production defaults to the real producer. */
  producerRunner?: (
    context: AndroidCameraProducerContext,
  ) => Promise<AndroidCameraProducerReceipts>;
  /** Source-only private seam; production defaults to canonical inventory reselection. */
  reselectScenario?: typeof reselectAndroidCameraScenario;
};

function requireRunId(value: unknown): asserts value is string {
  assert(
    typeof value === 'string' && RUN_ID.test(value),
    'Android camera requested run ID is invalid',
  );
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 128) : 'UnknownError';
}

function blockedResult(
  options: AndroidCameraAttemptOptionsV4,
  reason: string,
  selectionRevalidated: boolean,
): AndroidCameraAttemptResultV4 {
  return {
    kind: 'private-owned-android-camera-v4-attempt',
    status: options.signal.aborted ? 'cancelled' : 'harness-blocked',
    requestedRunId: options.requestedRunId,
    captureRunId: null,
    callbackInvocations: 0,
    runtimeQualification: 'Pending',
    publicPromotionEligible: false,
    nativePassingCases: 0,
    cleanup: 'not-acquired',
    blockedGates: [...androidCameraBlockedGates(), blockedCameraGate('android-selection', reason)],
    errorName: options.signal.aborted ? 'AbortError' : 'AndroidCameraProducerUnavailable',
    selectionRevalidated,
    bridgeInvoked: false,
    producerOutput: 'not-run',
  };
}

/**
 * Revalidates the current Android camera declaration and then delegates to
 * one owned session bridge. There is no fallback to the connection charter,
 * no metadata-only execution, and no public/native promotion in this packet.
 */
export async function runAndroidCameraAttemptV4(
  options: AndroidCameraAttemptOptionsV4,
): Promise<AndroidCameraAttemptResultV4> {
  requireRunId(options.requestedRunId);
  assert(
    path.isAbsolute(options.repositoryRoot),
    'Android camera repository root must be absolute',
  );
  assert.equal(
    await realpath(options.repositoryRoot),
    options.repositoryRoot,
    'Android camera repository root is not canonical',
  );
  options.signal.throwIfAborted();

  let current: NativePilotSelection;
  try {
    current = await (options.reselectScenario ?? reselectAndroidCameraScenario)({
      repositoryRoot: options.repositoryRoot,
      inventory: options.inventory,
      arguments: {
        platform: 'android',
        engine: 'maestro',
        scenario: ANDROID_CAMERA_SCENARIO,
        mode: 'integration',
      },
      expectedSelection: options.selection,
      requiredSourcePaths: options.requiredSourcePaths,
      requiredDeclarationPath: options.requiredDeclarationPath,
    });
    requireAndroidCameraSelectionShape(current);
  } catch (error) {
    return blockedResult(
      options,
      `Android camera selection is unavailable: ${errorName(error)}`,
      false,
    );
  }
  options.signal.throwIfAborted();
  if (!options.bridge)
    return blockedResult(
      options,
      'Android camera owned session bridge is unavailable; capture charter and cleanup remain pending',
      true,
    );

  let producerOutput: AndroidCameraAttemptResultV4['producerOutput'] = 'not-run';
  const result = await runAndroidCameraAttemptV4Core({
    repositoryRoot: options.repositoryRoot,
    requestedRunId: options.requestedRunId,
    selection: current,
    signal: options.signal,
    execute: async ({ requestedRunId, selection, signal }) => {
      const execution = await options.bridge!.run({
        requestedRunId,
        selection,
        signal,
        executeCamera: async (context) => {
          // The outer requested run is a caller boundary. The owned capture
          // creates an independent artifact root, target owner, and backend
          // session. Validate all four before the producer can emit receipts;
          // none may be relabeled into another identity.
          requireAndroidCameraIdentityBoundary({
            requestedRunId,
            captureRunId: context.identity.captureRunId,
            ownerRunId: context.identity.ownerRunId,
            backendRunId: context.identity.backendRunId,
          });
          const output = await (options.producerRunner ?? runAndroidCameraDeniedProducer)(context);
          requireAndroidCameraProducerOutput(output, {
            selectionHash: androidCameraSelectionHash(selection),
            runId: context.identity.captureRunId,
          });
          assert.equal(output.identity.captureRunId, context.identity.captureRunId);
          assert.equal(output.identity.ownerRunId, context.identity.ownerRunId);
          producerOutput = 'receipts-bound';
          return output;
        },
      });
      assert.equal(execution.sourceSelectionHash, androidCameraSelectionHash(selection));
      return execution;
    },
  });
  return {
    ...result,
    selectionRevalidated: true,
    bridgeInvoked: true,
    producerOutput,
  };
}
