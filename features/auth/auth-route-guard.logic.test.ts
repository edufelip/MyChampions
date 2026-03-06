import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeGuardPathname,
  resolveAuthGuardRedirect,
  roleHomePath,
} from './auth-route-guard.logic';

test('roleHomePath resolves role home route', () => {
  assert.equal(roleHomePath('student'), '/');
  assert.equal(roleHomePath('professional'), '/explore');
});

test('normalizeGuardPathname normalizes empty, duplicate, and trailing slash paths', () => {
  assert.equal(normalizeGuardPathname(''), '/');
  assert.equal(normalizeGuardPathname('auth/sign-in'), '/auth/sign-in');
  assert.equal(normalizeGuardPathname('/auth//accept-terms/'), '/auth/accept-terms');
});

test('guard redirects unauthenticated user from app routes to sign-in', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: false,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/',
  });

  assert.equal(redirect, '/auth/sign-in');
});

test('guard allows unauthenticated user on sign-in route', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: false,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/sign-in',
  });

  assert.equal(redirect, null);
});

test('guard redirects unauthenticated user from role-selection to sign-in', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: false,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/role-selection',
  });

  assert.equal(redirect, '/auth/sign-in');
});

test('guard sends authenticated unlocked user to role-selection', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/',
  });

  assert.equal(redirect, '/auth/role-selection');
});

test('guard keeps authenticated unlocked user locked on role-selection after relaunch to tab shell', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/(tabs)',
  });

  assert.equal(redirect, '/auth/role-selection');
});

test('guard bypasses role-selection when role is locked', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: false,
    pathname: '/auth/role-selection',
  });

  assert.equal(redirect, '/');
});

test('guard blocks wrong-role tab access', () => {
  const studentRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: false,
    pathname: '/explore',
  });

  const professionalRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    needsTermsAcceptance: false,
    pathname: '/',
  });

  assert.equal(studentRedirect, '/');
  assert.equal(professionalRedirect, '/explore');
});

test('guard blocks student from accessing professional routes', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: false,
    pathname: '/professional/pending',
  });

  assert.equal(redirect, '/');
});

test('guard allows student on student-scoped routes', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: false,
    pathname: '/student/professionals',
  });

  assert.equal(redirect, null);
});

test('guard blocks professional from accessing student routes', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    needsTermsAcceptance: false,
    pathname: '/student/professionals',
  });

  assert.equal(redirect, '/explore');
});

test('guard allows professional on professional-scoped routes', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    needsTermsAcceptance: false,
    pathname: '/professional/pending',
  });

  assert.equal(redirect, null);
});
test('guard forces accept-terms before role selection/home when terms are pending', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: true,
    pathname: '/auth/role-selection',
  });

  assert.equal(redirect, '/auth/accept-terms');
});

test('guard allows accept-terms route while terms are pending', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: true,
    pathname: '/auth/accept-terms',
  });

  assert.equal(redirect, null);
});

test('guard allows accept-terms route with trailing slash while terms are pending', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: true,
    pathname: '/auth/accept-terms/',
  });

  assert.equal(redirect, null);
});

test('guard redirects away from accept-terms after acceptance', () => {
  const redirectUnlocked = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/accept-terms',
  });

  const redirectLocked = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    needsTermsAcceptance: false,
    pathname: '/auth/accept-terms',
  });

  assert.equal(redirectUnlocked, '/auth/role-selection');
  assert.equal(redirectLocked, '/explore');
});
