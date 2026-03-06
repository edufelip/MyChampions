import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTabRouteFallback } from './tab-route-fallback.logic';

test('returns null fallback when role is student', () => {
  assert.equal(resolveTabRouteFallback('student'), null);
});

test('returns null fallback when role is professional', () => {
  assert.equal(resolveTabRouteFallback('professional'), null);
});

test('returns role-selection fallback when role is unavailable', () => {
  assert.equal(resolveTabRouteFallback(null), '/auth/role-selection');
});
