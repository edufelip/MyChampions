import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  hydrateProfileFromSource,
  lockRoleInSource,
  deleteAccountAndDataFromSource,
  setAcceptedTermsVersionInSource,
  ProfileSourceError,
  type ProfileSourceDeps,
} from './profile-source';

type FakeProfile = {
  authUid: string;
  displayName: string;
  emailNormalized: string;
  lockedRole: 'student' | 'professional' | null;
  acceptedTermsVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

function makeDeps(seed?: FakeProfile | null): ProfileSourceDeps {
  let profile = seed ?? null;
  let userDeleted = false;

  return {
    getFirestoreInstance: () => ({}) as never,
    getFirebaseAuth: () => ({}) as never,
    getCurrentAuthUid: () => (userDeleted ? undefined : 'uid-1'),
    getCurrentUser: () => (userDeleted ? null : ({ uid: 'uid-1' } as never)),
    readProfile: async (_firestore, uid) => {
      if (!profile || userDeleted) return null;
      return { ...profile, authUid: uid };
    },
    upsertProfile: async (_firestore, uid, input) => {
      profile = {
        authUid: uid,
        displayName: input.displayName,
        emailNormalized: input.emailNormalized,
        lockedRole: null,
        acceptedTermsVersion: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    },
    setLockedRole: async () => {
      if (!profile) {
        throw new ProfileSourceError('profile_row_not_found_after_upsert', 'Profile missing');
      }
      if (profile.lockedRole && profile.lockedRole !== 'student') {
        throw new ProfileSourceError('graphql', 'Role already locked');
      }
      profile = { ...profile, lockedRole: 'student' };
    },
    setAcceptedTermsVersion: async (_firestore, _uid, version) => {
      if (!profile) {
        throw new ProfileSourceError('profile_row_not_found_after_upsert', 'Profile missing');
      }
      profile = { ...profile, acceptedTermsVersion: version };
    },
    deleteProfile: async () => {
      profile = null;
    },
    deleteUser: async () => {
      userDeleted = true;
    },
    delay: async () => {},
  };
}

describe('profile-source firestore', () => {
  it('hydrates existing profile without upsert', async () => {
    const deps = makeDeps({
      authUid: 'uid-1',
      displayName: 'A',
      emailNormalized: 'a@a.com',
      lockedRole: 'professional',
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await hydrateProfileFromSource(
      { uid: 'uid-1', displayName: 'A', email: 'a@a.com' },
      deps
    );

    assert.equal(result.lockedRole, 'professional');
    assert.equal(result.acceptedTermsVersion, null);
  });

  it('upserts when profile is missing', async () => {
    const deps = makeDeps(null);

    const result = await hydrateProfileFromSource(
      { uid: 'uid-1', displayName: 'A', email: 'a@a.com' },
      deps
    );

    assert.equal(result.lockedRole, null);
    assert.equal(result.acceptedTermsVersion, null);
  });

  it('locks role and confirms persisted value', async () => {
    const deps = makeDeps({
      authUid: 'uid-1',
      displayName: 'A',
      emailNormalized: 'a@a.com',
      lockedRole: null,
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    const result = await lockRoleInSource('student', deps);
    assert.equal(result.lockedRole, 'student');
  });

  it('deletes account and data', async () => {
    const deps = makeDeps({
      authUid: 'uid-1',
      displayName: 'A',
      emailNormalized: 'a@a.com',
      lockedRole: null,
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await deleteAccountAndDataFromSource(deps);

    assert.equal(deps.getCurrentAuthUid(), undefined);
    assert.equal(deps.getCurrentUser(), null);
  });

  it('persists accepted terms version in source', async () => {
    const deps = makeDeps({
      authUid: 'uid-1',
      displayName: 'A',
      emailNormalized: 'a@a.com',
      lockedRole: null,
      acceptedTermsVersion: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });

    await setAcceptedTermsVersionInSource('v2', deps);
    const hydrated = await hydrateProfileFromSource(
      { uid: 'uid-1', displayName: 'A', email: 'a@a.com' },
      deps
    );

    assert.equal(hydrated.acceptedTermsVersion, 'v2');
  });
});
