import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePlanAssignmentTargets } from './plan-source';

test('nutrition draft assignment requires an active nutritionist connection', () => {
  const result = validatePlanAssignmentTargets({
    planType: 'nutrition',
    targetStudentUids: ['student-a'],
    activeStudentUids: [],
  });

  assert.deepEqual(result, {
    isValid: false,
    requiredSpecialty: 'nutritionist',
    invalidStudentUids: ['student-a'],
  });
});

test('nutrition bulk assignment rejects targets without active nutritionist connection', () => {
  const result = validatePlanAssignmentTargets({
    planType: 'nutrition',
    targetStudentUids: ['student-a', 'student-b', 'student-c'],
    activeStudentUids: ['student-a', 'student-c'],
  });

  assert.deepEqual(result, {
    isValid: false,
    requiredSpecialty: 'nutritionist',
    invalidStudentUids: ['student-b'],
  });
});

test('training assignment remains fitness-coach scoped', () => {
  const result = validatePlanAssignmentTargets({
    planType: 'training',
    targetStudentUids: ['student-a', 'student-b'],
    activeStudentUids: ['student-a'],
  });

  assert.deepEqual(result, {
    isValid: false,
    requiredSpecialty: 'fitness_coach',
    invalidStudentUids: ['student-b'],
  });
});
