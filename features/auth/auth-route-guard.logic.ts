import type { RoleIntent } from './role-selection.logic';

export type AuthGuardInput = {
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  needsTermsAcceptance: boolean;
  pathname: string;
};

export function normalizeGuardPathname(pathname: string | null | undefined): string {
  const raw = (pathname ?? '').trim();
  if (raw.length === 0) {
    return '/';
  }

  let next = raw.startsWith('/') ? raw : `/${raw}`;
  next = next.replace(/\/{2,}/g, '/');

  if (next.length > 1 && next.endsWith('/')) {
    next = next.slice(0, -1);
  }

  return next;
}

export function roleHomePath(role: RoleIntent): string {
  if (role === 'professional') {
    return '/professional/specialty';
  }

  return '/';
}

export function resolveAuthGuardRedirect(input: AuthGuardInput): string | null {
  const path = normalizeGuardPathname(input.pathname);
  const isAuthRoute = path.startsWith('/auth/');
  const isPublicAuthEntry = path === '/auth/sign-in' || path === '/auth/create-account';

  if (!input.isAuthenticated) {
    if (isPublicAuthEntry) {
      return null;
    }

    return '/auth/sign-in';
  }

  if (input.needsTermsAcceptance) {
    if (path !== '/auth/accept-terms') {
      return '/auth/accept-terms';
    }

    return null;
  }

  if (path === '/auth/accept-terms') {
    if (input.lockedRole) {
      return roleHomePath(input.lockedRole);
    }

    return '/auth/role-selection';
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
    if (path.startsWith('/professional/')) {
      return '/';
    }
  }

  if (input.lockedRole === 'professional') {
    if (path === '/' || path.startsWith('/student/')) {
      return '/professional/specialty';
    }
  }

  return null;
}
