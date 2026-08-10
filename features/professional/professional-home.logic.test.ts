import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProfessionalHomeAttention } from './professional-home.logic';

test('shows all caught up only after both task sources settle empty', () => {
  assert.deepEqual(
    resolveProfessionalHomeAttention({
      connectionRequestCount: 0,
      connectionState: 'ready',
      planChangeRequestCount: 0,
      planChangeState: 'ready',
    }),
    {
      hasConnectionRequests: false,
      hasPlanChangeRequests: false,
      hasAnyAttention: false,
      hasLoadError: false,
      isLoading: false,
      showAllCaughtUp: true,
    },
  );
});

test('keeps a ready task actionable while another source is loading', () => {
  const state = resolveProfessionalHomeAttention({
    connectionRequestCount: 2,
    connectionState: 'ready',
    planChangeRequestCount: 0,
    planChangeState: 'loading',
  });

  assert.equal(state.hasConnectionRequests, true);
  assert.equal(state.hasAnyAttention, true);
  assert.equal(state.isLoading, true);
  assert.equal(state.showAllCaughtUp, false);
});

test('reports partial source errors without hiding successful tasks', () => {
  const state = resolveProfessionalHomeAttention({
    connectionRequestCount: 0,
    connectionState: 'error',
    planChangeRequestCount: 1,
    planChangeState: 'ready',
  });

  assert.equal(state.hasPlanChangeRequests, true);
  assert.equal(state.hasLoadError, true);
  assert.equal(state.showAllCaughtUp, false);
});

test('does not interpret unknown task counts as zero', () => {
  const state = resolveProfessionalHomeAttention({
    connectionRequestCount: 0,
    connectionState: 'error',
    planChangeRequestCount: 0,
    planChangeState: 'error',
  });

  assert.equal(state.hasAnyAttention, false);
  assert.equal(state.hasLoadError, true);
  assert.equal(state.showAllCaughtUp, false);
});
