import assert from 'node:assert/strict';
import test from 'node:test';
import {
  requireT15AndroidDetoxSessionColdRouteInput,
  type T15AndroidDetoxSessionColdRouteInput,
} from '../../scripts/testing/t15-detox-android-session-cold-route';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const ids = {
  requestedRunId: 'a'.repeat(24),
  captureRunId: 'b'.repeat(24),
  resourceOwnerRunId: 'c'.repeat(24),
};

const selection = {
  arguments: {
    platform: 'android',
    engine: 'detox',
    scenario: 'SCN-session-android',
    mode: 'integration',
  },
  scenario: {
    id: 'SCN-session-android',
    platform: 'android',
    flowId: 'FLW-session',
  },
  scenarioHash: 'd'.repeat(64),
  requirementHash: 'e'.repeat(64),
} as unknown as NativePilotSelection;

function input(overrides: Partial<T15AndroidDetoxSessionColdRouteInput> = {}) {
  return {
    repositoryRoot: '/private/q',
    serverRoot: '/private/server',
    artifactRoot: `/private/q/.qa/artifacts/native-pilot/${ids.captureRunId}`,
    requestedRunId: ids.requestedRunId,
    captureRunId: ids.captureRunId,
    requestedAttemptId: `${ids.requestedRunId}:first`,
    resourceOwnerRunId: ids.resourceOwnerRunId,
    selection,
    signal: new AbortController().signal,
    deadlineMs: 60_000,
    buildRunId: 'f'.repeat(24),
    coldReset: {
      ownerRunId: ids.resourceOwnerRunId,
      expectation: {
        requestedRunId: ids.requestedRunId,
        requestedAttemptId: `${ids.requestedRunId}:first`,
        fixtureResetId: 'fixture-reset-a',
        cohortFixtureFingerprint: '1'.repeat(64),
        sourceFingerprint: '2'.repeat(64),
        helperFingerprint: '3'.repeat(64),
      },
    },
    ...overrides,
  } satisfies T15AndroidDetoxSessionColdRouteInput;
}

void test('T15 Android session route keeps request, capture, and reset owner IDs disjoint', () => {
  assert.doesNotThrow(() => requireT15AndroidDetoxSessionColdRouteInput(input()));
  assert.throws(
    () => requireT15AndroidDetoxSessionColdRouteInput(input({ captureRunId: ids.requestedRunId })),
    /strictly unequal/u,
  );
  assert.throws(
    () =>
      requireT15AndroidDetoxSessionColdRouteInput(input({ resourceOwnerRunId: ids.captureRunId })),
    /strictly unequal/u,
  );
});
