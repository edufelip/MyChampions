export type RoleIntent = 'student' | 'professional';

export type RoleSelectionRequest = {
  role?: RoleIntent | null;
};

export type RoleSelectionValidationErrors = {
  role?: 'auth.role.validation.required';
};

export function validateRoleSelectionInput(
  input: RoleSelectionRequest
): RoleSelectionValidationErrors {
  if (!input.role) {
    return { role: 'auth.role.validation.required' };
  }

  return {};
}

export function resolvePostRoleRoute(role: RoleIntent): string {
  if (role === 'student') {
    return '/';
  }

  return '/professional/specialty';
}
