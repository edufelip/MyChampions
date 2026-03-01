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

  if (input.lockedRole === 'student' && path.startsWith('/explore')) {
    return '/';
  }

  if (input.lockedRole === 'professional' && path === '/') {
    return '/explore';
  }

  return null;
}
