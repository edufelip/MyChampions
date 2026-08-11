import type { RoleIntent } from './role-selection.logic';

export type AuthGuardInput = {
  isAuthenticated: boolean;
  lockedRole: RoleIntent | null;
  needsTermsAcceptance: boolean;
  pathname: string;
  returnTo?: string | string[] | null;
  pendingRoleSelectionRole?: RoleIntent | null;
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
    return '/(tabs)';
  }

  return '/';
}

function isSharedRecipePath(pathname: string): boolean {
  return /^\/shared\/recipes\/[^/?#]+$/.test(pathname);
}

function encodeReturnTo(pathname: string): string {
  return encodeURIComponent(pathname);
}

function redirectWithReturnTo(
  pathname: '/auth/sign-in' | '/auth/accept-terms',
  returnTo: string,
): string {
  return `${pathname}?returnTo=${encodeReturnTo(returnTo)}`;
}

export function normalizeAuthReturnTo(value: string | string[] | null | undefined): string | null {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (typeof rawValue !== 'string') {
    return null;
  }

  const trimmed = rawValue.trim();
  if (!trimmed || trimmed.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return null;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  if (decoded.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(decoded)) {
    return null;
  }

  const normalized = normalizeGuardPathname(decoded);
  return isSharedRecipePath(normalized) ? normalized : null;
}

export function resolveAuthGuardRedirect(input: AuthGuardInput): string | null {
  const path = normalizeGuardPathname(input.pathname);
  const isAuthRoute = path.startsWith('/auth/');
  const isPublicAuthEntry =
    path === '/auth/sign-in' ||
    path === '/auth/create-account' ||
    path === '/auth/forgot-password' ||
    path === '/auth/password-reset';
  const safeReturnTo = normalizeAuthReturnTo(input.returnTo);
  const currentSharedRecipeReturnTo = isSharedRecipePath(path) ? path : null;

  if (!input.isAuthenticated) {
    if (isPublicAuthEntry) {
      return null;
    }

    if (currentSharedRecipeReturnTo) {
      return redirectWithReturnTo('/auth/sign-in', currentSharedRecipeReturnTo);
    }

    return '/auth/sign-in';
  }

  if (input.needsTermsAcceptance) {
    if (path !== '/auth/accept-terms') {
      const termsReturnTo = currentSharedRecipeReturnTo ?? safeReturnTo;
      return termsReturnTo
        ? redirectWithReturnTo('/auth/accept-terms', termsReturnTo)
        : '/auth/accept-terms';
    }

    return null;
  }

  if (path === '/auth/accept-terms') {
    if (safeReturnTo) {
      return safeReturnTo;
    }

    if (input.lockedRole) {
      return roleHomePath(input.lockedRole);
    }

    return '/auth/role-selection';
  }

  if (
    safeReturnTo &&
    (path === '/auth/sign-in' || path === '/auth/create-account' || path === '/auth/role-selection')
  ) {
    return safeReturnTo;
  }

  if (!input.lockedRole) {
    if (currentSharedRecipeReturnTo) {
      return null;
    }

    if (path === '/auth/sign-in' || path === '/auth/create-account') {
      return '/auth/role-selection';
    }

    if (!isAuthRoute) {
      return '/auth/role-selection';
    }

    return null;
  }

  const home = roleHomePath(input.lockedRole);

  // Role selection persists the role before navigating to the first
  // role-specific screen. Keep that handoff alive for one render so the
  // global guard does not race the screen's explicit destination. A direct
  // visit has no pending role and still follows FR-173 below.
  if (path === '/auth/role-selection' && input.pendingRoleSelectionRole === input.lockedRole) {
    return null;
  }

  if (
    path === '/auth/sign-in' ||
    path === '/auth/create-account' ||
    path === '/auth/role-selection'
  ) {
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
      return '/(tabs)';
    }
  }

  return null;
}
