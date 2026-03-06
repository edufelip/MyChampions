import type { RoleIntent } from './role-selection.logic';

/**
 * Resolves a deterministic fallback route for tab wrappers when role state is
 * temporarily unavailable. This prevents transient blank tab scenes.
 */
export function resolveTabRouteFallback(lockedRole: RoleIntent | null): '/auth/role-selection' | null {
  if (lockedRole === 'student' || lockedRole === 'professional') {
    return null;
  }

  return '/auth/role-selection';
}
