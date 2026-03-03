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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeLockedRole(value: unknown): RoleIntent | null {
  return value === 'student' || value === 'professional' ? value : null;
}

// ─── Operations ───────────────────────────────────────────────────────────────

/**
 * Upserts the user profile in Data Connect (creates if not exists, updates display name/email).
 * Ref: FR-101
 */
async function upsertRemoteProfile(
  authUid: string,
  displayName: string,
  emailNormalized: string,
  deps: ProfileSourceDeps
): Promise<void> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.upsertUserProfile(dc, {
    auth_uid: authUid,
    display_name: displayName,
    email_normalized: emailNormalized,
  });

  if (!data.userProfile_upsert?.id) {
    throw new ProfileSourceError(
      'invalid_response',
      'Data Connect did not return upserted profile identity.'
    );
  }
}

/**
 * Reads the current locked role from the remote profile.
 * Returns null if no profile exists or role is not set.
 */
async function getRemoteLockedRole(deps: ProfileSourceDeps): Promise<RoleIntent | null> {
  const dc = deps.getDataConnectInstance();
  const { data } = await deps.getMyProfile(dc);

  const profile = data.userProfiles[0];
  return normalizeLockedRole(profile?.lockedRole ?? null);
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
    user.uid,
    user.displayName ?? '',
    user.email?.toLowerCase() ?? '',
    deps
  );
  return { lockedRole: await getRemoteLockedRole(deps) };
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
  await deps.setLockedRole(dc, { role });

  // Re-read to get confirmed server-side value
  const confirmedRole = await getRemoteLockedRole(deps);
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
