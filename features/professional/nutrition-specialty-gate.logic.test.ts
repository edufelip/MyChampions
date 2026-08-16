import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canAccessNutritionSurface,
  resolveNutritionBuilderRouteGate,
  resolveNutritionSurfaceGate,
  resolveProfessionalNutritionRouteGate,
} from './specialty.logic';

test('allows students to access nutrition regardless of professional specialties', () => {
  assert.equal(
    canAccessNutritionSurface({
      role: 'student',
      specialties: [],
    }),
    true,
  );
});

test('allows professionals with active nutritionist specialty to access nutrition', () => {
  assert.equal(
    canAccessNutritionSurface({
      role: 'professional',
      specialties: [
        { id: 'nutritionist', specialty: 'nutritionist', isActive: true, credential: null },
      ],
    }),
    true,
  );
});

test('blocks professionals without active nutritionist specialty from nutrition', () => {
  assert.equal(
    canAccessNutritionSurface({
      role: 'professional',
      specialties: [
        { id: 'coach', specialty: 'fitness_coach', isActive: true, credential: null },
        {
          id: 'inactive-nutritionist',
          specialty: 'nutritionist',
          isActive: false,
          credential: null,
        },
      ],
    }),
    false,
  );
});

test('waits for professional specialties before resolving nutrition route access', () => {
  assert.equal(
    resolveNutritionSurfaceGate({
      role: 'professional',
      specialties: [],
      specialtiesStatus: 'loading',
    }),
    'loading',
  );
});

test('redirects professional nutrition routes without active nutritionist specialty', () => {
  assert.equal(
    resolveNutritionSurfaceGate({
      role: 'professional',
      specialties: [{ id: 'coach', specialty: 'fitness_coach', isActive: true, credential: null }],
      specialtiesStatus: 'ready',
    }),
    'redirect',
  );
});

test('allows student nutrition routes without professional specialties', () => {
  assert.equal(
    resolveNutritionSurfaceGate({
      role: 'student',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'allow',
  );
});

test('redirects students away from professional nutrition routes', () => {
  assert.equal(
    resolveProfessionalNutritionRouteGate({
      role: 'student',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'redirect',
  );
});

test('allows active nutritionist professionals to use professional nutrition routes', () => {
  assert.equal(
    resolveProfessionalNutritionRouteGate({
      role: 'professional',
      specialties: [
        { id: 'nutritionist', specialty: 'nutritionist', isActive: true, credential: null },
      ],
      specialtiesStatus: 'ready',
    }),
    'allow',
  );
});

// The nutrition plan builder screen is mounted for both
// /student/nutrition/plans/:planId and /professional/nutrition/plans/:planId
// (app/student/nutrition/plans/[planId].tsx re-exports the professional
// screen). usePathname() can transiently report neither prefix (e.g. '/')
// while expo-router settles a deep link or an in-flight navigation -- a
// Student session must never be bounced off their own plan because of that
// transient value. See resolveNutritionBuilderRouteGate's doc comment.
test('stays in loading while the builder pathname has not settled to a known prefix, regardless of role', () => {
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/',
      role: 'student',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'loading',
  );
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/',
      role: 'professional',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'loading',
  );
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '',
      role: null,
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'loading',
  );
});

test('always allows a settled Student builder pathname, independent of specialties state', () => {
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/student/nutrition/plans/new',
      role: 'student',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'allow',
  );
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/student/nutrition/plans/new',
      role: null,
      specialties: [],
      specialtiesStatus: 'error',
    }),
    'allow',
  );
});

test('applies the professional route gate once the builder pathname settles to the professional prefix', () => {
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/professional/nutrition/plans/new',
      role: 'student',
      specialties: [],
      specialtiesStatus: 'idle',
    }),
    'redirect',
  );
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/professional/nutrition/plans/new',
      role: 'professional',
      specialties: [],
      specialtiesStatus: 'loading',
    }),
    'loading',
  );
  assert.equal(
    resolveNutritionBuilderRouteGate({
      pathname: '/professional/nutrition/plans/new',
      role: 'professional',
      specialties: [
        { id: 'nutritionist', specialty: 'nutritionist', isActive: true, credential: null },
      ],
      specialtiesStatus: 'ready',
    }),
    'allow',
  );
});
