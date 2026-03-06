/**
 * Auth profile Firestore source — profile hydration, role-lock, deletion.
 * Firestore persistence source while preserving the public source contract.
 */

import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';

import type { RoleIntent } from './role-selection.logic';
import {
  getCurrentAuthUid as _getCurrentAuthUid,
  getFirestoreInstance as _getFirestoreInstance,
  nowIso,
} from '../firestore';
import { classifyFirestoreError } from '../firestore-error';

// ─── Error type ───────────────────────────────────────────────────────────────

type ProfileSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response'
  | 'role_update_not_persisted'
  | 'profile_row_not_found_after_upsert';

export class ProfileSourceError extends Error {
  code: ProfileSourceErrorCode;

  constructor(code: ProfileSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfileSourceError';
  }
}

// ─── Injectable deps ──────────────────────────────────────────────────────────

type FirestoreProfile = {
  authUid: string;
  displayName: string;
  emailNormalized: string;
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProfileSourceDeps = {
  getFirestoreInstance: () => Firestore;
  getCurrentAuthUid: () => string | undefined;
  readProfile: (firestore: Firestore, uid: string) => Promise<FirestoreProfile | null>;
  upsertProfile: (
    firestore: Firestore,
    uid: string,
    input: { displayName: string; emailNormalized: string }
  ) => Promise<void>;
  setLockedRole: (firestore: Firestore, uid: string, role: RoleIntent) => Promise<void>;
  setAcceptedTermsVersion: (firestore: Firestore, uid: string, version: string) => Promise<void>;
  deleteProfile: (firestore: Firestore, uid: string) => Promise<void>;
  delay: (ms: number) => Promise<void>;
};

function profileDoc(firestore: Firestore, uid: string) {
  return doc(firestore, 'userProfiles', uid);
}

const defaultProfileSourceDeps: ProfileSourceDeps = {
  getFirestoreInstance: _getFirestoreInstance,
  getCurrentAuthUid: () => {
    try {
      return _getCurrentAuthUid();
    } catch {
      return undefined;
    }
  },
  readProfile: async (firestore, uid) => {
    const snapshot = await getDoc(profileDoc(firestore, uid));
    if (!snapshot.exists()) return null;
    const data = snapshot.data() as Partial<FirestoreProfile>;
    return {
      authUid: String(data.authUid ?? uid),
      displayName: String(data.displayName ?? ''),
      emailNormalized: String(data.emailNormalized ?? ''),
      lockedRole: data.lockedRole === 'student' || data.lockedRole === 'professional' ? data.lockedRole : null,
      acceptedTermsVersion:
        typeof data.acceptedTermsVersion === 'string' ? data.acceptedTermsVersion : null,
      createdAt: String(data.createdAt ?? nowIso()),
      updatedAt: String(data.updatedAt ?? nowIso()),
    };
  },
  upsertProfile: async (firestore, uid, input) => {
    const timestamp = nowIso();
    await setDoc(
      profileDoc(firestore, uid),
      {
        authUid: uid,
        displayName: input.displayName,
        emailNormalized: input.emailNormalized,
        lockedRole: null,
        acceptedTermsVersion: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      { merge: true }
    );
  },
  setLockedRole: async (firestore, uid, role) => {
    await runTransaction(firestore, async (tx) => {
      const ref = profileDoc(firestore, uid);
      const snap = await tx.get(ref);
      if (!snap.exists()) {
        throw new ProfileSourceError('profile_row_not_found_after_upsert', 'Profile row not found for role lock.');
      }
      const current = snap.data() as Partial<FirestoreProfile>;
      const currentRole = current.lockedRole;
      if (currentRole === 'student' || currentRole === 'professional') {
        if (currentRole !== role) {
          throw new ProfileSourceError('graphql', 'Role is already locked and cannot be changed.');
        }
        return;
      }
      tx.update(ref, {
        lockedRole: role,
        updatedAt: nowIso(),
      });
    });
  },
  deleteProfile: async (firestore, uid) => {
    await deleteDoc(profileDoc(firestore, uid));
  },
  setAcceptedTermsVersion: async (firestore, uid, version) => {
    await setDoc(
      profileDoc(firestore, uid),
      {
        authUid: uid,
        acceptedTermsVersion: version,
        updatedAt: nowIso(),
      },
      { merge: true }
    );
  },
  delay: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

// ─── Types ────────────────────────────────────────────────────────────────────

type AuthProfile = {
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
};

type RemoteProfileSnapshot = {
  exists: boolean;
  authUid: string | null;
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
  hasAuthUidMismatch: boolean;
};

const ROLE_LOCK_CONFIRMATION_RETRY_DELAYS_MS = [120, 220, 350, 550, 800, 1100] as const;

function normalizeProfileSourceError(error: unknown): ProfileSourceError {
  if (error instanceof ProfileSourceError) return error;

  switch (classifyFirestoreError(error)) {
    case 'network':
      return new ProfileSourceError('network', (error as Error)?.message ?? 'Network error.');
    case 'configuration':
      return new ProfileSourceError('configuration', (error as Error)?.message ?? 'Configuration error.');
    case 'not_found':
      return new ProfileSourceError('profile_row_not_found_after_upsert', (error as Error)?.message ?? 'Profile not found.');
    default:
      return new ProfileSourceError('invalid_response', (error as Error)?.message ?? 'Unknown profile source error.');
  }
}

async function getRemoteProfileSnapshot(
  deps: ProfileSourceDeps,
  uid: string
): Promise<RemoteProfileSnapshot> {
  const firestore = deps.getFirestoreInstance();
  const profile = await deps.readProfile(firestore, uid);
  if (!profile) {
    return {
      exists: false,
      authUid: null,
      lockedRole: null,
      acceptedTermsVersion: null,
      hasAuthUidMismatch: false,
    };
  }

  if (profile.authUid !== uid) {
    return {
      exists: false,
      authUid: profile.authUid,
      lockedRole: null,
      acceptedTermsVersion: null,
      hasAuthUidMismatch: true,
    };
  }

  return {
    exists: true,
    authUid: profile.authUid,
    lockedRole: profile.lockedRole,
    acceptedTermsVersion: profile.acceptedTermsVersion,
    hasAuthUidMismatch: false,
  };
}

async function confirmLockedRoleWithRetry(
  role: RoleIntent,
  deps: ProfileSourceDeps,
  uid: string
): Promise<{ confirmedRole: RoleIntent | null; allSnapshotsMissing: boolean }> {
  let allSnapshotsMissing = true;
  for (const delayMs of ROLE_LOCK_CONFIRMATION_RETRY_DELAYS_MS) {
    const snapshot = await getRemoteProfileSnapshot(deps, uid);
    if (snapshot.exists) {
      allSnapshotsMissing = false;
    }
    if (snapshot.lockedRole === role) {
      return { confirmedRole: snapshot.lockedRole, allSnapshotsMissing };
    }
    await deps.delay(delayMs);
  }
  return { confirmedRole: null, allSnapshotsMissing };
}

export async function hydrateProfileFromSource(
  user: { uid: string; displayName: string | null; email: string | null },
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<AuthProfile> {
  try {
    const initialSnapshot = await getRemoteProfileSnapshot(deps, user.uid);
    if (initialSnapshot.exists) {
      return {
        lockedRole: initialSnapshot.lockedRole,
        acceptedTermsVersion: initialSnapshot.acceptedTermsVersion,
      };
    }

    const firestore = deps.getFirestoreInstance();
    await deps.upsertProfile(firestore, user.uid, {
      displayName: user.displayName ?? '',
      emailNormalized: user.email?.toLowerCase() ?? '',
    });

    const hydratedSnapshot = await getRemoteProfileSnapshot(deps, user.uid);
    return {
      lockedRole: hydratedSnapshot.lockedRole,
      acceptedTermsVersion: hydratedSnapshot.acceptedTermsVersion,
    };
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

export async function lockRoleInSource(
  role: RoleIntent,
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<AuthProfile> {
  const uid = deps.getCurrentAuthUid();
  if (!uid) {
    throw new ProfileSourceError('configuration', 'No authenticated user found.');
  }

  try {
    const beforeLock = await getRemoteProfileSnapshot(deps, uid);
    if (!beforeLock.exists) {
      const firestore = deps.getFirestoreInstance();
      await deps.upsertProfile(firestore, uid, { displayName: '', emailNormalized: '' });
    }

    const firestore = deps.getFirestoreInstance();
    await deps.setLockedRole(firestore, uid, role);

    const { confirmedRole, allSnapshotsMissing } = await confirmLockedRoleWithRetry(role, deps, uid);
    if (confirmedRole) {
      const confirmedSnapshot = await getRemoteProfileSnapshot(deps, uid);
      return {
        lockedRole: confirmedRole,
        acceptedTermsVersion: confirmedSnapshot.acceptedTermsVersion,
      };
    }

    if (allSnapshotsMissing) {
      throw new ProfileSourceError(
        'profile_row_not_found_after_upsert',
        'Firestore did not return user profile after role lock attempts.'
      );
    }

    throw new ProfileSourceError(
      'role_update_not_persisted',
      'Firestore accepted role lock but role was not confirmed in follow-up reads.'
    );
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

export async function deleteProfileFromSource(
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<void> {
  const uid = deps.getCurrentAuthUid();
  if (!uid) {
    throw new ProfileSourceError('configuration', 'No authenticated user found.');
  }

  try {
    const firestore = deps.getFirestoreInstance();
    await deps.deleteProfile(firestore, uid);
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

export async function setAcceptedTermsVersionInSource(
  version: string,
  deps: ProfileSourceDeps = defaultProfileSourceDeps
): Promise<void> {
  const uid = deps.getCurrentAuthUid();
  if (!uid) {
    throw new ProfileSourceError('configuration', 'No authenticated user found.');
  }

  try {
    const firestore = deps.getFirestoreInstance();
    const before = await getRemoteProfileSnapshot(deps, uid);
    if (!before.exists) {
      await deps.upsertProfile(firestore, uid, { displayName: '', emailNormalized: '' });
    }
    await deps.setAcceptedTermsVersion(firestore, uid, version);
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}
