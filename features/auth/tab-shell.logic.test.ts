import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveTabShellState } from './tab-shell.logic';

test('uses established shell when hydration is transient for same uid', () => {
  const result = resolveTabShellState({
    isHydrated: false,
    currentUid: 'u1',
    lockedRole: null,
    needsTermsAcceptance: false,
    establishedUid: 'u1',
    establishedRole: 'professional',
  });

  assert.equal(result.canUseEstablishedShell, true);
  assert.equal(result.effectiveRole, 'professional');
});

test('does not use established shell for different uid', () => {
  const result = resolveTabShellState({
    isHydrated: false,
    currentUid: 'u2',
    lockedRole: null,
    needsTermsAcceptance: false,
    establishedUid: 'u1',
    establishedRole: 'professional',
  });

  assert.equal(result.canUseEstablishedShell, false);
  assert.equal(result.effectiveRole, null);
});

test('hydrated state uses locked role when terms are accepted', () => {
  const result = resolveTabShellState({
    isHydrated: true,
    currentUid: 'u1',
    lockedRole: 'student',
    needsTermsAcceptance: false,
    establishedUid: 'u1',
    establishedRole: 'professional',
  });

  assert.equal(result.effectiveRole, 'student');
});

test('hydrated state returns null effective role when terms are pending', () => {
  const result = resolveTabShellState({
    isHydrated: true,
    currentUid: 'u1',
    lockedRole: 'professional',
    needsTermsAcceptance: true,
    establishedUid: 'u1',
    establishedRole: 'professional',
  });

  assert.equal(result.effectiveRole, null);
});
