import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePostRoleRoute, validateRoleSelectionInput, type RoleIntent } from './role-selection.logic';

// ─── Input validation tests ────────────────────────────────────────────────────

test('validateRoleSelectionInput requires role selection', () => {
  const result = validateRoleSelectionInput({ role: null });

  assert.equal(result.role, 'auth.role.validation.required');
});

test('validateRoleSelectionInput rejects undefined role', () => {
  const result = validateRoleSelectionInput({ role: undefined });

  assert.equal(result.role, 'auth.role.validation.required');
});

test('validateRoleSelectionInput passes when role is student', () => {
  const result = validateRoleSelectionInput({ role: 'student' });

  assert.deepEqual(result, {});
});

test('validateRoleSelectionInput passes when role is professional', () => {
  const result = validateRoleSelectionInput({ role: 'professional' });

  assert.deepEqual(result, {});
});

test('validateRoleSelectionInput returns empty object on valid input (no role property)', () => {
  const result = validateRoleSelectionInput({});

  assert.equal(result.role, 'auth.role.validation.required');
});

// ─── Post-role routing tests ──────────────────────────────────────────────────

test('resolvePostRoleRoute routes student to home (/)', () => {
  assert.equal(resolvePostRoleRoute('student'), '/');
});

test('resolvePostRoleRoute routes professional to explore (/explore)', () => {
  assert.equal(resolvePostRoleRoute('professional'), '/explore');
});

test('resolvePostRoleRoute handles all role types correctly', () => {
  const roles: RoleIntent[] = ['student', 'professional'];

  roles.forEach((role) => {
    const route = resolvePostRoleRoute(role);
    assert.equal(typeof route, 'string');
    assert.ok(route.startsWith('/'), `Route for ${role} should be a valid path`);
  });
});
