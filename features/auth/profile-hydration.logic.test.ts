import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveProfileHydrationFailure } from './profile-hydration.logic';
import { resolveTabShellState } from './tab-shell.logic';

const currentProfile = {
  authUid: 'user-a',
  lockedRole: 'student' as const,
  acceptedTermsVersion: 'v2',
  updatedAt: '2026-07-24T12:00:00.000Z',
};

for (const errorCode of ['network', 'configuration', 'token_unavailable'] as const) {
  for (const lockedRole of ['student', 'professional'] as const) {
    test(`keeps the same-user cached ${lockedRole} shell after ${errorCode}`, () => {
      const resolution = resolveProfileHydrationFailure({
        hydrationAuthUid: 'user-a',
        activeAuthUid: 'user-a',
        errorCode,
        cachedProfile: { ...currentProfile, lockedRole },
        requiredTermsVersion: 'v2',
      });

      assert.deepEqual(resolution, {
        lockedRole,
        acceptedTermsVersion: 'v2',
        lastProfileSyncedAtIso: '2026-07-24T12:00:00.000Z',
        requiresTermsAcceptance: false,
      });
      assert.equal(
        resolveTabShellState({
          isHydrated: true,
          currentUid: 'user-a',
          lockedRole: resolution.lockedRole,
          needsTermsAcceptance: resolution.requiresTermsAcceptance,
          establishedUid: 'user-a',
          establishedRole: lockedRole,
        }).effectiveRole,
        lockedRole,
      );
    });
  }
}

test('keeps the terms gate for a stale cached acceptance', () => {
  const resolution = resolveProfileHydrationFailure({
    hydrationAuthUid: 'user-a',
    activeAuthUid: 'user-a',
    errorCode: 'network',
    cachedProfile: { ...currentProfile, acceptedTermsVersion: 'v1' },
    requiredTermsVersion: 'v2',
  });

  assert.equal(resolution.lockedRole, 'student');
  assert.equal(resolution.requiresTermsAcceptance, true);
  assert.equal(
    resolveTabShellState({
      isHydrated: true,
      currentUid: 'user-a',
      lockedRole: resolution.lockedRole,
      needsTermsAcceptance: resolution.requiresTermsAcceptance,
      establishedUid: 'user-a',
      establishedRole: 'student',
    }).effectiveRole,
    null,
  );
});

test('keeps the role-selection gate for a cached profile without a locked role', () => {
  const resolution = resolveProfileHydrationFailure({
    hydrationAuthUid: 'user-a',
    activeAuthUid: 'user-a',
    errorCode: 'token_unavailable',
    cachedProfile: { ...currentProfile, lockedRole: null },
    requiredTermsVersion: 'v2',
  });

  assert.equal(resolution.requiresTermsAcceptance, false);
  assert.equal(resolution.lockedRole, null);
  assert.equal(
    resolveTabShellState({
      isHydrated: true,
      currentUid: 'user-a',
      lockedRole: resolution.lockedRole,
      needsTermsAcceptance: resolution.requiresTermsAcceptance,
      establishedUid: 'user-a',
      establishedRole: 'student',
    }).effectiveRole,
    null,
  );
});

test('does not grant cached state to a different active user or a signed-out session', () => {
  for (const activeAuthUid of ['user-b', null]) {
    assert.deepEqual(
      resolveProfileHydrationFailure({
        hydrationAuthUid: 'user-a',
        activeAuthUid,
        errorCode: 'network',
        cachedProfile: currentProfile,
        requiredTermsVersion: 'v2',
      }),
      {
        lockedRole: null,
        acceptedTermsVersion: null,
        lastProfileSyncedAtIso: null,
        requiresTermsAcceptance: true,
      },
    );
  }
});

test('does not grant missing, malformed, or cross-user cached profiles', () => {
  for (const cachedProfile of [
    null,
    {},
    { ...currentProfile, authUid: 'user-b' },
    { ...currentProfile, lockedRole: 'admin' },
    { ...currentProfile, acceptedTermsVersion: 2 },
    { ...currentProfile, updatedAt: null },
  ]) {
    const resolution = resolveProfileHydrationFailure({
      hydrationAuthUid: 'user-a',
      activeAuthUid: 'user-a',
      errorCode: 'network',
      cachedProfile,
      requiredTermsVersion: 'v2',
    });

    assert.equal(resolution.lockedRole, null);
    assert.equal(resolution.requiresTermsAcceptance, true);
  }
});

test('does not grant cached state after a definitive authentication rejection', () => {
  for (const errorCode of ['unauthenticated', 'invalid_response']) {
    const resolution = resolveProfileHydrationFailure({
      hydrationAuthUid: 'user-a',
      activeAuthUid: 'user-a',
      errorCode,
      cachedProfile: currentProfile,
      requiredTermsVersion: 'v2',
    });

    assert.equal(resolution.lockedRole, null);
    assert.equal(resolution.requiresTermsAcceptance, true);
  }
});
