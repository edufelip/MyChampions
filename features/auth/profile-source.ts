/**
 * Auth profile Data Connect source — profile hydration, role-lock, deletion.
 * Uses generated SDK (D-114 pattern) instead of raw GraphQL fetch.
 * Refs: D-114, D-072, FR-101, BR-201
 */

import type { DataConnect } from 'firebase/data-connect';
import {
  getMyProfile as _getMyProfile,
  upsertUserProfile as _upsertUserProfile,
  setLockedRole as _setLockedRole,
  deleteProfile as _deleteProfile,
  type GetMyProfileData,
  type UpsertUserProfileData,
  type SetLockedRoleData,
  type DeleteProfileData,
  type UpsertUserProfileVariables,
  type SetLockedRoleVariables,
} from '@mychampions/dataconnect-generated';
import { getDataConnectInstance as _getDataConnectInstance } from '../dataconnect';
import { getFirebaseAuth } from './firebase';

import type { RoleIntent } from './role-selection.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

type ProfileSourceErrorCode = 'configuration' | 'network' | 'graphql' | 'invalid_response';

export class ProfileSourceError extends Error {
  code: ProfileSourceErrorCode;

  constructor(code: ProfileSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfileSourceError';
  }
}

// ─── Injectable deps (D-114 pattern) ─────────────────────────────────────────

export type ProfileSourceDeps = {
  getMyProfile: (dc: DataConnect) => Promise<{ data: GetMyProfileData }>;
  upsertUserProfile: (dc: DataConnect, vars: UpsertUserProfileVariables) => Promise<{ data: UpsertUserProfileData }>;
  setLockedRole: (dc: DataConnect, vars: SetLockedRoleVariables) => Promise<{ data: SetLockedRoleData }>;
  deleteProfile: (dc: DataConnect) => Promise<{ data: DeleteProfileData }>;
  getDataConnectInstance: () => DataConnect;
};

const defaultProfileSourceDeps: ProfileSourceDeps = {
  getMyProfile: _getMyProfile,
  upsertUserProfile: _upsertUserProfile,
  setLockedRole: _setLockedRole,
  deleteProfile: _deleteProfile,
  getDataConnectInstance: _getDataConnectInstance,
};

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthProfile = {
  lockedRole: RoleIntent | null;
};

type RemoteProfileSnapshot = {
  exists: boolean;
  authUid: string | null;
  lockedRole: RoleIntent | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeLockedRole(value: unknown): RoleIntent | null {
  return value === 'student' || value === 'professional' ? value : null;
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeProfileSourceError(error: unknown): ProfileSourceError {
  if (error instanceof ProfileSourceError) {
    return error;
  }

  if (isObjectLike(error)) {
    const message = typeof error.message === 'string' ? error.message : 'Unknown profile source error.';
    const code = typeof error.code === 'string' ? error.code : '';
    const lowered = `${code} ${message}`.toLowerCase();

    if (lowered.includes('network') || lowered.includes('fetch') || lowered.includes('timeout')) {
      return new ProfileSourceError('network', message);
    }

    if (
      lowered.includes('permission') ||
      lowered.includes('unauth') ||
      lowered.includes('graphql') ||
      lowered.includes('failed precondition') ||
      lowered.includes('already set')
    ) {
      return new ProfileSourceError('graphql', message);
    }

    return new ProfileSourceError('configuration', message);
  }

  return new ProfileSourceError('configuration', 'Unknown profile source error.');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Upserts the user profile in Data Connect (creates if not exists, updates display name/email).
 * Ref: FR-101
 */
async function upsertRemoteProfile(
  displayName: string,
  emailNormalized: string,
  deps: ProfileSourceDeps
): Promise<void> {
  try {
    const dc = deps.getDataConnectInstance();
    const { data } = await deps.upsertUserProfile(dc, {
      displayName: displayName,
      emailNormalized: emailNormalized,
    });

    if (!data.userProfile_upsert?.id) {
      throw new ProfileSourceError(
        'invalid_response',
        'Data Connect did not return upserted profile identity.'
      );
    }
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

/**
 * Reads the current locked role from the remote profile.
 * Returns null if no profile exists or role is not set.
 */
async function getRemoteLockedRole(
  deps: ProfileSourceDeps,
  expectedAuthUid?: string
): Promise<RoleIntent | null> {
  const snapshot = await getRemoteProfileSnapshot(deps, expectedAuthUid);
  return snapshot.lockedRole;
}

async function getRemoteProfileSnapshot(
  deps: ProfileSourceDeps,
  expectedAuthUid?: string
): Promise<RemoteProfileSnapshot> {
  const dc = deps.getDataConnectInstance();
  try {
    const { data } = await deps.getMyProfile(dc);

    const profile = data.userProfiles[0];
    const authUid = typeof profile?.authUid === 'string' ? profile.authUid : null;
    if (expectedAuthUid && authUid && authUid !== expectedAuthUid) {
      if (__DEV__) {
        console.warn('[auth][profile-source] profile uid mismatch', {
          expectedAuthUid,
          receivedAuthUid: authUid,
        });
      }
      return {
        exists: false,
        authUid,
        lockedRole: null,
      };
    }

    return {
      exists: Boolean(profile),
      authUid,
      lockedRole: normalizeLockedRole(profile?.lockedRole ?? null),
    };
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

/**
 * Hydrates the user profile: upserts remote record and reads current locked role.
 * Called on every auth session start.
 * Ref: FR-101, D-072
 */
export async function hydrateProfileFromSource(
  user: { uid: string; displayName: string | null; email: string | null },
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<AuthProfile> {
  await upsertRemoteProfile(
    user.displayName ?? '',
    user.email?.toLowerCase() ?? '',
    deps
  );
  const lockedRole = await getRemoteLockedRole(deps, user.uid);
  if (__DEV__) {
    console.info('[auth][profile-source] hydrate snapshot', {
      uid: user.uid,
      lockedRole,
    });
  }

  return { lockedRole };
}

/**
 * Locks the user's role in the remote profile.
 * Calls setLockedRole then re-reads via getMyProfile to confirm the persisted value.
 * Ref: FR-101, D-072
 */
export async function lockRoleInSource(
  role: RoleIntent,
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<AuthProfile> {
  const dc = deps.getDataConnectInstance();
  const currentAuthUid = getFirebaseAuth().currentUser?.uid;

  const beforeLock = await getRemoteProfileSnapshot(deps, currentAuthUid);
  if (!beforeLock.exists) {
    await upsertRemoteProfile('', '', deps);
  }

  try {
    await deps.setLockedRole(dc, { role });
  } catch (error) {
    const current = await getRemoteProfileSnapshot(deps, currentAuthUid);
    if (current.lockedRole === role) {
      return { lockedRole: current.lockedRole };
    }
    throw normalizeProfileSourceError(error);
  }

  // Re-read to get confirmed server-side value
  let confirmedRole = await getRemoteLockedRole(deps, currentAuthUid);
  if (!confirmedRole) {
    await delay(120);
    confirmedRole = await getRemoteLockedRole(deps, currentAuthUid);
  }

  if (!confirmedRole) {
    throw new ProfileSourceError(
      'invalid_response',
      'Data Connect did not return a locked role after setLockedRole.'
    );
  }

  return { lockedRole: confirmedRole };
}

/**
 * Deletes the user's profile from Data Connect.
 * Called from account deletion flow (SC-213).
 * Ref: D-072
 */
export async function deleteProfileFromSource(
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  await deps.deleteProfile(dc);
}
