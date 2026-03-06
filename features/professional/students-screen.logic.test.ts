import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveStudentRosterViewState } from './students-screen.logic';

test('SC-205 first load renders list shell (loading path, no empty hero)', () => {
  const state = resolveStudentRosterViewState({
    hasLoadedOnce: false,
    isLoading: true,
    hasError: false,
    visibleCount: 0,
  });

  assert.equal(state, 'list_shell');
});

test('SC-205 loaded empty renders hero empty state', () => {
  const state = resolveStudentRosterViewState({
    hasLoadedOnce: true,
    isLoading: false,
    hasError: false,
    visibleCount: 0,
  });

  assert.equal(state, 'hero_empty');
});

test('SC-205 load error excludes hero empty state', () => {
  const state = resolveStudentRosterViewState({
    hasLoadedOnce: true,
    isLoading: false,
    hasError: true,
    visibleCount: 0,
  });

  assert.equal(state, 'list_shell');
});

test('SC-205 non-empty list always renders list shell', () => {
  const state = resolveStudentRosterViewState({
    hasLoadedOnce: true,
    isLoading: false,
    hasError: false,
    visibleCount: 3,
  });

  assert.equal(state, 'list_shell');
});
