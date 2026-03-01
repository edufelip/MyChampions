import type { RoleIntent } from './role-selection.logic';

export type AuthGuardInput = {
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  pathname: string;
};

export function roleHomePath(role: RoleIntent): string {
  if (role === 'professional') {
    return '/explore';
  }

  return '/';
}

export function resolveAuthGuardRedirect(input: AuthGuardInput): string | null {
  const path = input.pathname || '/';
  const isAuthRoute = path.startsWith('/auth/');

  if (!input.isAuthenticated) {
    if (isAuthRoute) {
      return null;
    }

    return '/auth/sign-in';
  }

  if (!input.lockedRole) {
    if (path === '/auth/sign-in' || path === '/auth/create-account') {
      return '/auth/role-selection';
    }

    if (!isAuthRoute) {
      return '/auth/role-selection';
    }

    return null;
  }

  const home = roleHomePath(input.lockedRole);

  if (path === '/auth/sign-in' || path === '/auth/create-account' || path === '/auth/role-selection') {
    return home;
  }

  // Role-scoped route guard: students cannot access /professional/* and vice versa
  if (input.lockedRole === 'student') {
    if (path.startsWith('/explore') || path.startsWith('/professional/')) {
      return '/';
    }
  }

  if (input.lockedRole === 'professional') {
    if (path === '/' || path.startsWith('/student/')) {
      return '/explore';
    }
  }

  return null;
}
