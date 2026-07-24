import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStudentHomeDisplayState } from './student-home.logic';

test('student home waits until every initial source has settled', () => {
  const state = resolveStudentHomeDisplayState({
    connections: 'ready',
    plans: 'loading',
    water: 'ready',
  });

  assert.equal(state.isInitialLoading, true);
  assert.deepEqual(state.errorSources, []);
});

test('student home preserves successful sections when one source fails', () => {
  const state = resolveStudentHomeDisplayState({
    connections: 'ready',
    plans: 'error',
    water: 'ready',
  });

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
