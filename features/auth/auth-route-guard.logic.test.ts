import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveAuthGuardRedirect, roleHomePath } from './auth-route-guard.logic';

test('roleHomePath resolves role home route', () => {
  assert.equal(roleHomePath('student'), '/');
  assert.equal(roleHomePath('professional'), '/explore');
});

test('guard redirects unauthenticated user from app routes to sign-in', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: false,
    lockedRole: null,
    pathname: '/',
  });

  assert.equal(redirect, '/auth/sign-in');
});

test('guard allows unauthenticated user on auth routes', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: false,
    lockedRole: null,
    pathname: '/auth/sign-in',
  });

  assert.equal(redirect, null);
});

test('guard sends authenticated unlocked user to role-selection', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    pathname: '/',
  });

  assert.equal(redirect, '/auth/role-selection');
});

test('guard bypasses role-selection when role is locked', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    pathname: '/auth/role-selection',
  });

  assert.equal(redirect, '/');
});

test('guard blocks wrong-role tab access', () => {
  const studentRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    pathname: '/explore',
  });

  const professionalRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    pathname: '/',
  });

  assert.equal(studentRedirect, '/');
  assert.equal(professionalRedirect, '/explore');
});
