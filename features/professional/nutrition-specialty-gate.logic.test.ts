import assert from 'node:assert/strict';
import test from 'node:test';

import { canAccessNutritionSurface } from './specialty.logic';

test('allows students to access nutrition regardless of professional specialties', () => {
  assert.equal(
    canAccessNutritionSurface({
      role: 'student',
      specialties: [],
    }),
    true
  );
});

test('allows professionals with active nutritionist specialty to access nutrition', () => {
  assert.equal(
    canAccessNutritionSurface({
      role: 'professional',
      specialties: [{ id: 'nutritionist', specialty: 'nutritionist', isActive: true, credential: null }],
    }),
    true
  );
});

test('blocks professionals without active nutritionist specialty from nutrition', () => {
  assert.equal(
    canAccessNutritionSurface({
      role: 'professional',
      specialties: [
        { id: 'coach', specialty: 'fitness_coach', isActive: true, credential: null },
        { id: 'inactive-nutritionist', specialty: 'nutritionist', isActive: false, credential: null },
      ],
    }),
    false
  );
});
