import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterStudentRosterRows,
  filterBulkAssignmentStudentsByPlanType,
  resolveStudentRosterViewState,
} from './students-screen.logic';

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

test('SC-205 filters roster rows by assignment status and case-insensitive search', () => {
  const rows = [
    {
      studentAuthUid: 'ada',
      displayName: 'Ada Active',
      assignmentStatus: 'active' as const,
    },
    {
      studentAuthUid: 'pia',
      displayName: 'Pia Pending',
      assignmentStatus: 'pending' as const,
    },
    {
      studentAuthUid: 'ana',
      displayName: 'Ana Training',
      assignmentStatus: 'active' as const,
    },
  ];

  assert.deepEqual(
    filterStudentRosterRows(rows, { filter: 'active', search: ' an ' }).map((row) => row.studentAuthUid),
    ['ana']
  );

  assert.deepEqual(
    filterStudentRosterRows(rows, { filter: 'pending', search: 'PIA' }).map((row) => row.studentAuthUid),
    ['pia']
  );
});

test('SC-205 bulk nutrition picker only targets active nutritionist students', () => {
  const rows = [
    {
      studentAuthUid: 'nutrition-active',
      displayName: 'Nutrition Active',
      specialty: 'nutritionist' as const,
      assignmentStatus: 'active' as const,
      nutritionStatus: 'active' as const,
      trainingStatus: 'none' as const,
    },
    {
      studentAuthUid: 'nutrition-pending',
      displayName: 'Nutrition Pending',
      specialty: 'nutritionist' as const,
      assignmentStatus: 'pending' as const,
      nutritionStatus: 'pending' as const,
      trainingStatus: 'none' as const,
    },
    {
      studentAuthUid: 'training-active',
      displayName: 'Training Active',
      specialty: 'fitness_coach' as const,
      assignmentStatus: 'active' as const,
      nutritionStatus: 'none' as const,
      trainingStatus: 'active' as const,
    },
  ];

  assert.deepEqual(
    filterBulkAssignmentStudentsByPlanType(rows, 'nutrition').map((row) => row.studentAuthUid),
    ['nutrition-active']
  );
});

test('SC-205 bulk training picker remains active fitness-coach scoped', () => {
  const rows = [
    {
      studentAuthUid: 'nutrition-active',
      displayName: 'Nutrition Active',
      specialty: 'nutritionist' as const,
      assignmentStatus: 'active' as const,
      nutritionStatus: 'active' as const,
      trainingStatus: 'none' as const,
    },
    {
      studentAuthUid: 'training-active',
      displayName: 'Training Active',
      specialty: 'fitness_coach' as const,
      assignmentStatus: 'active' as const,
      nutritionStatus: 'none' as const,
      trainingStatus: 'active' as const,
    },
    {
      studentAuthUid: 'dual-active',
      displayName: 'Dual Active',
      specialty: 'nutritionist' as const,
      assignmentStatus: 'active' as const,
      nutritionStatus: 'active' as const,
      trainingStatus: 'active' as const,
    },
  ];

  assert.deepEqual(
    filterBulkAssignmentStudentsByPlanType(rows, 'training').map((row) => row.studentAuthUid),
    ['training-active', 'dual-active']
  );
});
