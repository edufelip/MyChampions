import assert from 'node:assert/strict';
import test from 'node:test';

import { canAccessNutritionSurface, resolveNutritionSurfaceGate } from './specialty.logic';

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

test('waits for professional specialties before resolving nutrition route access', () => {
  assert.equal(
    resolveNutritionSurfaceGate({
      role: 'professional',
      specialties: [],
      specialtiesStatus: 'loading',
    }),
    'loading'
  );
});

test('redirects professional nutrition routes without active nutritionist specialty', () => {
  assert.equal(
    resolveNutritionSurfaceGate({
      role: 'professional',
      specialties: [{ id: 'coach', specialty: 'fitness_coach', isActive: true, credential: null }],
      specialtiesStatus: 'ready',
    }),
    'redirect'
  );
});

test('allows student nutrition routes without professional specialties', () => {
  assert.equal(
    resolveNutritionSurfaceGate({
      role: 'student',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'allow'
  );
});
