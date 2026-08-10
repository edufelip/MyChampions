import type { RoleIntent } from './role-selection.logic';
import { needsTermsAcceptance } from './terms.logic';

export type RetryableProfileHydrationErrorCode = 'configuration' | 'network' | 'token_unavailable';

type CachedProfile = {
  authUid: string;
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
  updatedAt: string;
};

export type ProfileHydrationFailureResolution = {
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
  lastProfileSyncedAtIso: string | null;
  requiresTermsAcceptance: boolean;
};

const CLOSED_PROFILE_RESOLUTION: ProfileHydrationFailureResolution = {
  lockedRole: null,
  acceptedTermsVersion: null,
  lastProfileSyncedAtIso: null,
  requiresTermsAcceptance: true,
};

function isCachedProfile(value: unknown): value is CachedProfile {
  if (!value || typeof value !== 'object') return false;

  const profile = value as Partial<CachedProfile>;
  return (
    typeof profile.authUid === 'string' &&
    (profile.lockedRole === 'student' ||
      profile.lockedRole === 'professional' ||
      profile.lockedRole === null) &&
    (typeof profile.acceptedTermsVersion === 'string' || profile.acceptedTermsVersion === null) &&
    typeof profile.updatedAt === 'string'
  );
}

export function resolveProfileHydrationFailure(input: {
  hydrationAuthUid: string;
  activeAuthUid: string | null;
  errorCode: string | null;
  cachedProfile: unknown;
  requiredTermsVersion: string;
}): ProfileHydrationFailureResolution {
  const retryable =
    input.errorCode === 'configuration' ||
    input.errorCode === 'network' ||
    input.errorCode === 'token_unavailable';

  if (
    !retryable ||
    input.activeAuthUid !== input.hydrationAuthUid ||
    !isCachedProfile(input.cachedProfile) ||
    input.cachedProfile.authUid !== input.hydrationAuthUid
  ) {
    return CLOSED_PROFILE_RESOLUTION;
  }

  return {
    lockedRole: input.cachedProfile.lockedRole,
    acceptedTermsVersion: input.cachedProfile.acceptedTermsVersion,
    lastProfileSyncedAtIso: input.cachedProfile.updatedAt,
    requiresTermsAcceptance: needsTermsAcceptance({
      requiredVersion: input.requiredTermsVersion,
      acceptedVersion: input.cachedProfile.acceptedTermsVersion,
    }),
  };
}
