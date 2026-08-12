import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAuthReturnTo,
  normalizeGuardPathname,
  resolveAuthGuardRedirect,
  roleHomePath,
} from './auth-route-guard.logic';

test('roleHomePath resolves role home route', () => {
  assert.equal(roleHomePath('student'), '/');
  assert.equal(roleHomePath('professional'), '/(tabs)');
});

test('normalizeGuardPathname normalizes empty, duplicate, and trailing slash paths', () => {
  assert.equal(normalizeGuardPathname(''), '/');
  assert.equal(normalizeGuardPathname('auth/sign-in'), '/auth/sign-in');
  assert.equal(normalizeGuardPathname('/auth//accept-terms/'), '/auth/accept-terms');
});

test('normalizeAuthReturnTo accepts only shared recipe app paths', () => {
  assert.equal(normalizeAuthReturnTo('/shared/recipes/share-123'), '/shared/recipes/share-123');
  assert.equal(
    normalizeAuthReturnTo('%2Fshared%2Frecipes%2Fshare-123'),
    '/shared/recipes/share-123',
  );
  assert.equal(normalizeAuthReturnTo([' /shared/recipes/share-456 ']), '/shared/recipes/share-456');
  assert.equal(normalizeAuthReturnTo('/professional/home'), null);
  assert.equal(normalizeAuthReturnTo('/student/nutrition'), null);
  assert.equal(normalizeAuthReturnTo('/auth/sign-in'), null);
  assert.equal(normalizeAuthReturnTo('https://evil.test/shared/recipes/share-123'), null);
  assert.equal(normalizeAuthReturnTo('//evil.test/shared/recipes/share-123'), null);
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

test('guard redirects unauthenticated shared recipe links to sign-in with safe return target', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: false,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/shared/recipes/share-123',
  });

  assert.equal(redirect, '/auth/sign-in?returnTo=%2Fshared%2Frecipes%2Fshare-123');
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

test('guard lets authenticated users resume shared recipe links before role selection', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/shared/recipes/share-123',
  });

  assert.equal(redirect, null);
});

test('guard consumes safe return target after sign-in', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/sign-in',
    returnTo: '/shared/recipes/share-123',
  });

  assert.equal(redirect, '/shared/recipes/share-123');
});

test('guard ignores unsafe return targets and keeps normal auth routing', () => {
  const externalRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/sign-in',
    returnTo: 'https://evil.test/shared/recipes/share-123',
  });

  const professionalRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/sign-in',
    returnTo: '/professional/home',
  });

  assert.equal(externalRedirect, '/auth/role-selection');
  assert.equal(professionalRedirect, '/auth/role-selection');
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

test('guard keeps the role-selection handoff open for the committed role', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    needsTermsAcceptance: false,
    pathname: '/auth/role-selection',
    pendingRoleSelectionRole: 'professional',
  });

  assert.equal(redirect, null);
});

test('guard blocks wrong-role tab access', () => {
  const studentRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'student',
    needsTermsAcceptance: false,
    pathname: '/professional/specialty',
  });

  const professionalRedirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: 'professional',
    needsTermsAcceptance: false,
    pathname: '/',
  });

  assert.equal(studentRedirect, '/');
  assert.equal(professionalRedirect, '/(tabs)');
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

  assert.equal(redirect, '/(tabs)');
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

test('guard preserves safe return target through terms acceptance', () => {
  const beforeAcceptance = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: true,
    pathname: '/shared/recipes/share-123',
  });

  const afterAcceptance = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: false,
    pathname: '/auth/accept-terms',
    returnTo: '/shared/recipes/share-123',
  });

  assert.equal(beforeAcceptance, '/auth/accept-terms?returnTo=%2Fshared%2Frecipes%2Fshare-123');
  assert.equal(afterAcceptance, '/shared/recipes/share-123');
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

test('guard allows the controlled legal webview while terms are pending', () => {
  const redirect = resolveAuthGuardRedirect({
    isAuthenticated: true,
    lockedRole: null,
    needsTermsAcceptance: true,
    pathname: '/shared/webview',
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
  assert.equal(redirectLocked, '/(tabs)');
});
