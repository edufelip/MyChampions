import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStudentHomeDisplayState } from './student-home.logic';

test('student home waits until every initial source has settled', () => {
  const state = resolveStudentHomeDisplayState({
    connections: 'ready',
    plans: 'loading',
    water: 'ready',
  });

  assert.equal(state.hasCompletedInitialLoad, false);
  assert.equal(state.isInitialLoading, true);
  assert.deepEqual(state.errorSources, []);
});

test('student home preserves successful sections when one source fails', () => {
  const state = resolveStudentHomeDisplayState({
    connections: 'ready',
    plans: 'error',
    water: 'ready',
  });

  assert.equal(state.hasCompletedInitialLoad, true);
  assert.equal(state.isInitialLoading, false);
  assert.deepEqual(state.errorSources, ['plans']);
  assert.equal(state.canRenderPlans, false);
  assert.equal(state.canRenderWater, true);
});

test('student home reports every failed source after settlement', () => {
  const state = resolveStudentHomeDisplayState({
    connections: 'error',
    plans: 'error',
    water: 'error',
  });

  assert.equal(state.isInitialLoading, false);
  assert.deepEqual(state.errorSources, ['connections', 'plans', 'water']);
  assert.equal(state.canRenderPlans, false);
  assert.equal(state.canRenderWater, false);
});

test('student home keeps independently successful sections visible during every source retry', () => {
  const settledState = resolveStudentHomeDisplayState({
    connections: 'ready',
    plans: 'ready',
    water: 'ready',
  });
  const scenarios = [
    {
      source: 'connections',
      connections: 'loading',
      plans: 'ready',
      water: 'ready',
      canRenderPlans: true,
      canRenderWater: true,
    },
    {
      source: 'plans',
      connections: 'ready',
      plans: 'loading',
      water: 'ready',
      canRenderPlans: false,
      canRenderWater: true,
    },
    {
      source: 'water',
      connections: 'ready',
      plans: 'ready',
      water: 'loading',
      canRenderPlans: true,
      canRenderWater: false,
    },
  ] as const;

  for (const scenario of scenarios) {
    const retryingState = resolveStudentHomeDisplayState({
      connections: scenario.connections,
      plans: scenario.plans,
      water: scenario.water,
      hasCompletedInitialLoad: settledState.hasCompletedInitialLoad,
    });

    assert.equal(
      retryingState.hasCompletedInitialLoad,
      true,
      `${scenario.source} retry should retain initial-load completion`
    );
    assert.equal(
      retryingState.isInitialLoading,
      false,
      `${scenario.source} retry should not restore the full-screen spinner`
    );
    assert.equal(retryingState.canRenderPlans, scenario.canRenderPlans);
    assert.equal(retryingState.canRenderWater, scenario.canRenderWater);
  }
});

test('student home does not mistake a partially resolved first load for a retry', () => {
  const state = resolveStudentHomeDisplayState({
    connections: 'loading',
    plans: 'ready',
    water: 'ready',
    hasCompletedInitialLoad: false,
  });

  assert.equal(state.hasCompletedInitialLoad, false);
  assert.equal(state.isInitialLoading, true);
  assert.equal(state.canRenderPlans, true);
  assert.equal(state.canRenderWater, true);
});
