import assert from 'node:assert/strict';
import path from 'node:path';
import {
  runAndroidDetoxSessionAttemptForNativePilot,
  type AndroidDetoxSessionNativePilotAttempt,
} from './native-detox-android-session-native-pilot-route';
import type { AndroidDetoxSessionProducerOverrides } from './detox-android-session-producer';
import type { DetoxBaselineFactories } from './detox-integrated-session-baseline';
import type { NativePilotSelection } from './native-pilot-contract';
import type { ColdResetPreparationExpectation } from './t15-cold-android-reset-producer';

const RUN_ID = /^[a-f0-9]{24}$/u;

export type T15AndroidDetoxSessionColdRouteInput = Readonly<{
  repositoryRoot: string;
  serverRoot: string;
  artifactRoot: string;
  requestedRunId: string;
  captureRunId: string;
  requestedAttemptId: string;
  resourceOwnerRunId: string;
  selection: NativePilotSelection;
  signal: AbortSignal;
  deadlineMs: number;
  deadlineAtMonotonicMs?: number;
  buildRunId: string;
  parentEnv?: Readonly<Record<string, string | undefined>>;
  baselineFactories?: DetoxBaselineFactories;
  sourceOnlyProducerOverrides?: AndroidDetoxSessionProducerOverrides;
  sourceOnlyControl?: true;
  coldReset: Readonly<{
    expectation: ColdResetPreparationExpectation;
    ownerRunId: string;
  }>;
}>;

function requireRunId(value: string, label: string): void {
  assert.match(value, RUN_ID, `${label} must be a 24-character run ID`);
}

/**
 * Validate the three outer namespaces before the retained real route is
 * called. The request, capture, and resource-reset owner are intentionally
 * separate; the underlying target/backend IDs are checked by the producer
 * after acquisition and are never inferred here.
 */
export function requireT15AndroidDetoxSessionColdRouteInput(
  input: T15AndroidDetoxSessionColdRouteInput,
): void {
  requireRunId(input.requestedRunId, 'requestedRunId');
  requireRunId(input.captureRunId, 'captureRunId');
  requireRunId(input.resourceOwnerRunId, 'resourceOwnerRunId');
  assert.notEqual(input.requestedRunId, input.captureRunId);
  assert.notEqual(input.requestedRunId, input.resourceOwnerRunId);
  assert.notEqual(input.captureRunId, input.resourceOwnerRunId);
  assert.equal(input.requestedAttemptId, `${input.requestedRunId}:first`);
  assert.equal(input.coldReset.ownerRunId, input.resourceOwnerRunId);
  assert.equal(input.coldReset.expectation.requestedRunId, input.requestedRunId);
  assert.equal(input.coldReset.expectation.requestedAttemptId, input.requestedAttemptId);
  assert.equal(path.basename(path.resolve(input.artifactRoot)), input.captureRunId);
  assert(input.signal instanceof AbortSignal);
}

/**
 * Default T15 Android session route. It invokes the existing qualified-build
 * loader, owned Android session producer, baseline, public adapter, and final
 * cleanup path. The cold reset is supplied to that same baseline before Expo
 * or the Detox child starts; no generic caller adapter is required.
 */
export async function runT15AndroidDetoxSessionColdRoute(
  input: T15AndroidDetoxSessionColdRouteInput,
): Promise<AndroidDetoxSessionNativePilotAttempt> {
  requireT15AndroidDetoxSessionColdRouteInput(input);
  return runAndroidDetoxSessionAttemptForNativePilot({
    ...input,
    coldReset: input.coldReset,
  });
}

export const t15AndroidDetoxSessionColdRouteContract = Object.freeze({
  route: 'session|android',
  resetBefore: ['expo', 'detox-child', 'requested-action'] as const,
  defaultOwner: 'owned-android-detox-session-producer',
  defaultPublicConsumer: 'native-detox-android-session-public-adapter',
  targetBackendFixtureBinding: 'producer-verified',
  cleanup: 'baseline-capture-final-and-independent-android-cleanup',
  androidCamera: 'separate-pending-adapter',
  nativePassingCases: 0,
  coldQualifiedAttempts: 0,
});
