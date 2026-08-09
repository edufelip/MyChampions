import AsyncStorage from '@react-native-async-storage/async-storage';

import type { RoleIntent } from './role-selection.logic';
import type { AuthProviderId } from './auth-user';

export type E2EAuthSessionOverride = {
  acceptedTermsVersion: string;
  displayName: string;
  email: string;
  lockedRole: RoleIntent | null;
  authProviderId?: AuthProviderId;
  uid: string;
};

export type E2EAuthSessionSourceOverride = {
  idToken: string;
  uid: string;
};

export type E2ESubscriptionOverride = {
  activeStudentCount: number;
  aiEntitlementStatus: 'active' | 'lapsed' | 'unknown';
  entitlementStatus: 'active' | 'lapsed' | 'unknown';
  professionalEntitlementRenewalRisk: boolean;
};

type ResolveE2EAuthSessionOverrideInput = {
  acceptedTermsVersion?: string;
  appVariant: string | undefined;
  enabledFlag: string | undefined;
  isDev: boolean;
  requiredTermsVersion: string;
};

type ResolveE2EAuthSessionSourceOverrideInput = {
  appVariant: string | undefined;
  enabledFlag: string | undefined;
  isDev: boolean;
};

type ResolveE2ESubscriptionOverrideInput = ResolveE2EAuthSessionSourceOverrideInput & {
  activeStudentCount?: string;
  aiEntitlementStatus?: string;
  entitlementStatus?: string;
  professionalEntitlementRenewalRisk?: string;
};

type ResolveE2EEmailPasswordSignInOverrideInput = ResolveE2EAuthSessionOverrideInput & {
  email: string;
  password: string;
};

type ResolveE2EEmailPasswordCreateAccountOverrideInput = ResolveE2EAuthSessionOverrideInput & {
  email: string;
  name: string;
  password: string;
};

export type E2ESocialAuthProvider = 'google' | 'apple';

type ResolveE2ESocialAuthOverrideInput = ResolveE2EAuthSessionOverrideInput & {
  provider: E2ESocialAuthProvider;
};

const E2E_AUTH_SESSION_ID_TOKEN = 'e2e-auth-session-token';
export const E2E_AUTH_SESSION_UID = 'e2e-auth-session-user';
export const E2E_AUTH_SESSION_EMAIL = 'e2e-auth-session@example.test';
export const E2E_AUTH_SESSION_PASSWORD = 'E2E-password-123!';
export const E2E_AUTH_CREATE_ACCOUNT_UID = 'e2e-created-account-user';
export const E2E_AUTH_CREATE_ACCOUNT_EMAIL = 'e2e-created-account@example.test';
export const E2E_AUTH_CREATE_ACCOUNT_PASSWORD = 'E2E-create-123!';
export const E2E_AUTH_GOOGLE_UID = 'e2e-google-auth-user';
export const E2E_AUTH_GOOGLE_EMAIL = 'e2e-google-auth@example.test';
export const E2E_AUTH_APPLE_UID = 'e2e-apple-auth-user';
export const E2E_AUTH_APPLE_EMAIL = 'e2e-apple-auth@example.test';
const E2E_LOCKED_ROLE_STORAGE_KEY = 'mychampions.e2e.locked-role';
const E2E_AUTH_UID_MAX_LENGTH = 96;
const E2E_AUTH_UID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

/**
 * Selective native CI builds the app once and changes fixture state by
 * restarting Metro for each phase. A runtime value must therefore win even
 * when it intentionally clears a value embedded in the native app config.
 */
export function resolveE2EPhaseConfigValue(
  runtimeValue: string | undefined,
  embeddedValue: string | undefined,
): string | undefined {
  return runtimeValue ?? embeddedValue;
}

function usesNativeE2ERoleStorage(): boolean {
  return process.env.EXPO_PUBLIC_E2E_ROLE_PERSISTENCE === 'true';
}

function parsePersistedE2ELockedRole(value: string | null): RoleIntent | null {
  return value === 'student' || value === 'professional' ? value : null;
}

export async function readPersistedE2ELockedRole(): Promise<RoleIntent | null> {
  if (usesNativeE2ERoleStorage()) {
    return parsePersistedE2ELockedRole(await AsyncStorage.getItem(E2E_LOCKED_ROLE_STORAGE_KEY));
  }
  if (typeof sessionStorage === 'undefined') return null;
  return parsePersistedE2ELockedRole(sessionStorage.getItem(E2E_LOCKED_ROLE_STORAGE_KEY));
}

export async function persistE2ELockedRole(role: RoleIntent | null): Promise<void> {
  if (usesNativeE2ERoleStorage()) {
    if (role) await AsyncStorage.setItem(E2E_LOCKED_ROLE_STORAGE_KEY, role);
    else await AsyncStorage.removeItem(E2E_LOCKED_ROLE_STORAGE_KEY);
    return;
  }
  if (typeof sessionStorage === 'undefined') return;
  if (role) sessionStorage.setItem(E2E_LOCKED_ROLE_STORAGE_KEY, role);
  else sessionStorage.removeItem(E2E_LOCKED_ROLE_STORAGE_KEY);
}

function isEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'true';
}

function resolveConfiguredE2EAuthUid(
  fallback: string,
  suffix = '',
  explicitOverride?: string,
): string | null {
  const configuredOverride = explicitOverride?.trim();
  const configuredBase = process.env.EXPO_PUBLIC_E2E_AUTH_UID?.trim();
  const candidate =
    configuredOverride || (configuredBase ? `${configuredBase}${suffix}` : fallback);
  if (candidate.length > E2E_AUTH_UID_MAX_LENGTH || !E2E_AUTH_UID_PATTERN.test(candidate)) {
    return null;
  }

  return candidate;
}

function normalizeE2EEntitlementStatus(
  value: string | undefined,
): E2ESubscriptionOverride['entitlementStatus'] | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'active' || normalized === 'lapsed' || normalized === 'unknown')
    return normalized;
  return null;
}

function normalizeE2EActiveStudentCount(value: string | undefined): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function isDevE2EAuthSessionEnabled({
  appVariant,
  enabledFlag,
  isDev,
}: ResolveE2EAuthSessionSourceOverrideInput): boolean {
  const isDevVariant = appVariant === undefined || appVariant === '' || appVariant === 'dev';
  return isDev && isDevVariant && isEnabled(enabledFlag);
}

export function resolveE2EAuthSessionOverride({
  acceptedTermsVersion,
  appVariant,
  enabledFlag,
  isDev,
  requiredTermsVersion,
}: ResolveE2EAuthSessionOverrideInput): E2EAuthSessionOverride | null {
  if (!isDevE2EAuthSessionEnabled({ appVariant, enabledFlag, isDev })) {
    return null;
  }
  const uid = resolveConfiguredE2EAuthUid(E2E_AUTH_SESSION_UID);
  if (!uid) return null;

  return {
    acceptedTermsVersion: acceptedTermsVersion?.trim() || requiredTermsVersion,
    displayName: 'E2E Test User',
    email: E2E_AUTH_SESSION_EMAIL,
    lockedRole: null,
    uid,
  };
}

export function resolveE2EEmailPasswordSignInOverride({
  acceptedTermsVersion,
  appVariant,
  email,
  enabledFlag,
  isDev,
  password,
  requiredTermsVersion,
}: ResolveE2EEmailPasswordSignInOverrideInput): E2EAuthSessionOverride | null {
  if (!isDevE2EAuthSessionEnabled({ appVariant, enabledFlag, isDev })) {
    return null;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const isPrimaryAccount =
    normalizedEmail === E2E_AUTH_SESSION_EMAIL && password === E2E_AUTH_SESSION_PASSWORD;
  const isCreatedAccount =
    normalizedEmail === E2E_AUTH_CREATE_ACCOUNT_EMAIL &&
    password === E2E_AUTH_CREATE_ACCOUNT_PASSWORD;
  if (!isPrimaryAccount && !isCreatedAccount) {
    return null;
  }
  const uid = isCreatedAccount
    ? resolveConfiguredE2EAuthUid(E2E_AUTH_CREATE_ACCOUNT_UID, '-created')
    : resolveConfiguredE2EAuthUid(E2E_AUTH_SESSION_UID);
  if (!uid) return null;

  return {
    acceptedTermsVersion: acceptedTermsVersion?.trim() || requiredTermsVersion,
    displayName: isCreatedAccount ? 'New E2E User' : 'E2E Test User',
    email: isCreatedAccount ? E2E_AUTH_CREATE_ACCOUNT_EMAIL : E2E_AUTH_SESSION_EMAIL,
    lockedRole: null,
    uid,
  };
}

export function resolveE2EEmailPasswordCreateAccountOverride({
  acceptedTermsVersion,
  appVariant,
  email,
  enabledFlag,
  isDev,
  name,
  password,
  requiredTermsVersion,
}: ResolveE2EEmailPasswordCreateAccountOverrideInput): E2EAuthSessionOverride | null {
  if (!isDevE2EAuthSessionEnabled({ appVariant, enabledFlag, isDev })) {
    return null;
  }

  const displayName = name.trim();
  if (
    !displayName ||
    email.trim().toLowerCase() !== E2E_AUTH_CREATE_ACCOUNT_EMAIL ||
    password !== E2E_AUTH_CREATE_ACCOUNT_PASSWORD
  ) {
    return null;
  }
  const uid = resolveConfiguredE2EAuthUid(E2E_AUTH_CREATE_ACCOUNT_UID, '-created');
  if (!uid) return null;

  return {
    acceptedTermsVersion: acceptedTermsVersion?.trim() || requiredTermsVersion,
    displayName,
    email: E2E_AUTH_CREATE_ACCOUNT_EMAIL,
    lockedRole: null,
    uid,
  };
}

export function resolveE2ESocialAuthOverride({
  acceptedTermsVersion,
  appVariant,
  enabledFlag,
  isDev,
  provider,
  requiredTermsVersion,
}: ResolveE2ESocialAuthOverrideInput): E2EAuthSessionOverride | null {
  if (!isDevE2EAuthSessionEnabled({ appVariant, enabledFlag, isDev })) {
    return null;
  }

  if (provider === 'google') {
    const uid = resolveConfiguredE2EAuthUid(
      E2E_AUTH_GOOGLE_UID,
      '-google',
      process.env.EXPO_PUBLIC_E2E_AUTH_GOOGLE_UID,
    );
    if (!uid) return null;
    return {
      acceptedTermsVersion: acceptedTermsVersion?.trim() || requiredTermsVersion,
      displayName: 'E2E Google User',
      email: E2E_AUTH_GOOGLE_EMAIL,
      lockedRole: null,
      authProviderId: 'google',
      uid,
    };
  }

  const uid = resolveConfiguredE2EAuthUid(E2E_AUTH_APPLE_UID, '-apple');
  if (!uid) return null;
  return {
    acceptedTermsVersion: acceptedTermsVersion?.trim() || requiredTermsVersion,
    displayName: 'E2E Apple User',
    email: E2E_AUTH_APPLE_EMAIL,
    lockedRole: null,
    authProviderId: 'apple',
    uid,
  };
}

export function resolveE2EAuthSessionSourceOverride({
  appVariant,
  enabledFlag,
  isDev,
}: ResolveE2EAuthSessionSourceOverrideInput): E2EAuthSessionSourceOverride | null {
  if (!isDevE2EAuthSessionEnabled({ appVariant, enabledFlag, isDev })) {
    return null;
  }
  const uid = resolveConfiguredE2EAuthUid(E2E_AUTH_SESSION_UID);
  if (!uid) return null;

  return {
    idToken: E2E_AUTH_SESSION_ID_TOKEN,
    uid,
  };
}

export function resolveE2ESubscriptionOverride({
  activeStudentCount,
  aiEntitlementStatus,
  appVariant,
  enabledFlag,
  entitlementStatus,
  isDev,
  professionalEntitlementRenewalRisk,
}: ResolveE2ESubscriptionOverrideInput): E2ESubscriptionOverride | null {
  if (!isDevE2EAuthSessionEnabled({ appVariant, enabledFlag, isDev })) {
    return null;
  }

  const normalizedEntitlementStatus = normalizeE2EEntitlementStatus(entitlementStatus);
  const normalizedAiEntitlementStatus = normalizeE2EEntitlementStatus(
    aiEntitlementStatus ?? 'unknown',
  );
  const normalizedActiveStudentCount = normalizeE2EActiveStudentCount(activeStudentCount);

  if (
    !normalizedEntitlementStatus ||
    !normalizedAiEntitlementStatus ||
    normalizedActiveStudentCount === null
  ) {
    return null;
  }

  return {
    activeStudentCount: normalizedActiveStudentCount,
    aiEntitlementStatus: normalizedAiEntitlementStatus,
    entitlementStatus: normalizedEntitlementStatus,
    professionalEntitlementRenewalRisk: isEnabled(professionalEntitlementRenewalRisk),
  };
}
