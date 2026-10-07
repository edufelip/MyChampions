import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createT15IosFamilyAttemptRunner,
  t15IosFamilyAttemptContract,
} from '../../scripts/testing/t15-cold-ios-family-attempt';
import type { NativePilotSelection } from '../../scripts/testing/native-pilot-contract';

const HASH = 'a'.repeat(64);

function selection(
  overrides: Partial<NativePilotSelection['arguments']> = {},
): NativePilotSelection {
  const args = {
    platform: 'ios' as const,
    engine: 'maestro' as const,
    scenario: 'SCN-training-ios' as const,
    mode: 'integration' as const,
    ...overrides,
  };
  return {
    arguments: args,
    scenarioHash: HASH,
    requirementHash: HASH,
    scenario: {
      id: args.scenario,
      platform: args.platform,
      flowId: 'FLW-training',
      transitionIds: [],
      requirementRefs: [],
      dataMode: 'postgres',
      fixtureRef: 'owned-postgres:training',
      freshnessInputs: { requirementPaths: [] },
      pilotAssertions: [],
    },
  };
}

void test('T15 iOS family bridge exposes only existing production families', () => {
  assert.deepEqual(t15IosFamilyAttemptContract.families, [
    'training',
    'connection',
    'save-retry',
    'camera-denied',
  ]);
  assert.equal(t15IosFamilyAttemptContract.producerKind, 'existing-ios-family-producer');
  assert.equal(t15IosFamilyAttemptContract.publicPromotionEligible, false);
});

void test('T15 family bridge blocks Android before producer acquisition', async () => {
  const bridge = createT15IosFamilyAttemptRunner({
    repositoryRoot: '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions',
  });
  await assert.rejects(
    () =>
      bridge({
        invocation: {} as never,
        selection: selection({ platform: 'android', scenario: 'SCN-training-android' }),
        reusableBuild: {} as never,
        coldReset: {} as never,
        callerOutputRoot: '/private/tmp/t15-family-test-output',
        deadlineAtMonotonicMs: 1,
      }),
    /unsupported-platform/,
  );
});

void test('T15 family bridge blocks Detox before producer acquisition', async () => {
  const bridge = createT15IosFamilyAttemptRunner({
    repositoryRoot: '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions',
  });
  await assert.rejects(
    () =>
      bridge({
        invocation: {} as never,
        selection: selection({ engine: 'detox' }),
        reusableBuild: {} as never,
        coldReset: {} as never,
        callerOutputRoot: '/private/tmp/t15-family-test-output',
        deadlineAtMonotonicMs: 1,
      }),
    /unsupported-engine/,
  );
});

void test('T15 family bridge blocks unknown flow before producer acquisition', async () => {
  const bridge = createT15IosFamilyAttemptRunner({
    repositoryRoot: '/Users/eduwaldo/.codex/worktrees/testing-native-regression/mychampions',
  });
  const unknown = selection({ scenario: 'SCN-session-ios' });
  unknown.scenario.flowId = 'FLW-session';
  await assert.rejects(
    () =>
      bridge({
        invocation: {} as never,
        selection: unknown,
        reusableBuild: {} as never,
        coldReset: {} as never,
        callerOutputRoot: '/private/tmp/t15-family-test-output',
        deadlineAtMonotonicMs: 1,
      }),
    /unsupported-family/,
  );
});
