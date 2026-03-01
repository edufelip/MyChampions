import assert from 'node:assert/strict';
import test from 'node:test';

import { resolvePostRoleRoute, validateRoleSelectionInput } from './role-selection.logic';

test('validateRoleSelectionInput requires role selection', () => {
  const result = validateRoleSelectionInput({ role: null });

  assert.equal(result.role, 'auth.role.validation.required');
});

test('validateRoleSelectionInput passes when role is selected', () => {
  const studentResult = validateRoleSelectionInput({ role: 'student' });
  const professionalResult = validateRoleSelectionInput({ role: 'professional' });

  assert.deepEqual(studentResult, {});
  assert.deepEqual(professionalResult, {});
});

test('resolvePostRoleRoute resolves role-specific placeholder route', () => {
  assert.equal(resolvePostRoleRoute('student'), '/');
  assert.equal(resolvePostRoleRoute('professional'), '/explore');
});
