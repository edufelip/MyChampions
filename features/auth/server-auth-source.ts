/**
 * Local MyChampions server auth source.
 *
 * This is the current local auth boundary for migrated mobile source modules.
 * It stores server-issued bearer sessions from local email/password, social,
 * or explicit local/dev-session flows so app-domain code uses MyChampions
 * server auth instead of mobile-owned provider tokens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AuthProviderId } from './auth-user';

type ServerAuthProfile = {
  authUid: string;
  displayName: string;
  emailNormalized: string;
  lockedRole: 'student' | 'professional' | null;
  acceptedTermsVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ServerAuthUser = {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  isAnonymous: boolean;
  authProviderIds: AuthProviderId[];
  getAccessToken: () => Promise<string>;
  reload: () => Promise<void>;
  delete: () => Promise<void>;
  toJSON: () => { uid: string; email: string; displayName: string };
};

export type ServerAuthSession = {
  accessToken: string;
  refreshToken: string | null;
  tokenType: 'Bearer';
  expiresAt: string;
  authProviderIds: AuthProviderId[];
  profile: ServerAuthProfile;
  user: ServerAuthUser;
};

export type ServerAuthStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type ServerAuthDeps = {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getServerBaseUrl: () => string | undefined;
  storage?: ServerAuthStorage;
};

const SERVER_AUTH_SESSION_STORAGE_KEY = 'auth.server.session';

let currentSession: ServerAuthSession | null = null;

type LocalServerSocialAuthProvider = 'google' | 'apple';

function resolveServerBaseUrl(): string | undefined {
  let expoExtra: unknown;
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: unknown } };
      expoConfig?: { extra?: unknown };
    };
    expoExtra = (Constants.default ?? Constants).expoConfig?.extra;
  } catch {
    expoExtra = undefined;
  }

  const extra = (expoExtra ?? {}) as {
    server?: {
      baseUrl?: string;
    };
  };
  return extra.server?.baseUrl?.trim() || process.env.EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL?.trim();
}

function isLocalServerAuthEnabled(): boolean {
  let appVariant: string | undefined;
  try {
    const Constants = require('expo-constants') as {
      default?: { expoConfig?: { extra?: { appVariant?: string } } };
      expoConfig?: { extra?: { appVariant?: string } };
    };
    appVariant = (Constants.default ?? Constants).expoConfig?.extra?.appVariant;
  } catch {
    appVariant = undefined;
  }

  const resolvedVariant = (appVariant ?? process.env.APP_VARIANT)?.trim();
  return resolvedVariant === undefined || resolvedVariant === '' || resolvedVariant === 'dev';
}

function makeDeps(): ServerAuthDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    getServerBaseUrl: resolveServerBaseUrl,
    storage: AsyncStorage,
  };
}

function resolveStorage(deps: Pick<ServerAuthDeps, 'storage'>): ServerAuthStorage {
  return deps.storage ?? AsyncStorage;
}

async function removePersistedSession(storage: ServerAuthStorage): Promise<void> {
  try {
    await storage.removeItem(SERVER_AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Auth memory is already cleared; stale platform storage can be retried next launch.
  }
}

function isExpired(expiresAt: string): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now();
}

function fallbackExpiresAt(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function normalizeAuthProviderIds(value: unknown): AuthProviderId[] {
  if (!Array.isArray(value)) return ['email_password'];
  const ids = value.filter((id): id is AuthProviderId => typeof id === 'string' && id.trim().length > 0);
  return ids.length > 0 ? ids : ['email_password'];
}

function makeServerUser(
  profile: ServerAuthProfile,
  accessToken: string,
  expiresAt: string,
  authProviderIds: AuthProviderId[],
  emailVerified: boolean
): ServerAuthUser {
  return {
    uid: profile.authUid,
    email: profile.emailNormalized,
    displayName: profile.displayName,
    emailVerified,
    isAnonymous: false,
    authProviderIds,
    getAccessToken: async () => (isExpired(expiresAt) ? '' : accessToken),
    reload: async () => {},
    delete: async () => {},
    toJSON: () => ({
      uid: profile.authUid,
      email: profile.emailNormalized,
      displayName: profile.displayName,
    }),
  };
}

function normalizeProfile(profile: Partial<ServerAuthProfile>): ServerAuthProfile | null {
  if (
    typeof profile.authUid !== 'string' ||
    typeof profile.displayName !== 'string' ||
    typeof profile.emailNormalized !== 'string'
  ) {
    return null;
  }

  return {
    authUid: profile.authUid,
    displayName: profile.displayName,
    emailNormalized: profile.emailNormalized,
    lockedRole:
      profile.lockedRole === 'student' || profile.lockedRole === 'professional'
        ? profile.lockedRole
        : null,
    acceptedTermsVersion:
      typeof profile.acceptedTermsVersion === 'string' ? profile.acceptedTermsVersion : null,
    createdAt: typeof profile.createdAt === 'string' ? profile.createdAt : new Date(0).toISOString(),
    updatedAt: typeof profile.updatedAt === 'string' ? profile.updatedAt : new Date(0).toISOString(),
  };
}

function makeSession(
  accessToken: string,
  profile: ServerAuthProfile,
  expiresAt: string,
  authProviderIds: AuthProviderId[] = ['email_password'],
  refreshToken: string | null = null,
  emailVerified = false
): ServerAuthSession {
  return {
    accessToken,
    refreshToken,
    tokenType: 'Bearer',
    expiresAt,
    authProviderIds,
    profile,
    user: makeServerUser(profile, accessToken, expiresAt, authProviderIds, emailVerified),
  };
}

function serializeSession(session: ServerAuthSession): string {
  return JSON.stringify({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    tokenType: session.tokenType,
    expiresAt: session.expiresAt,
    authProviderIds: session.authProviderIds,
    emailVerified: session.user.emailVerified,
    profile: session.profile,
  });
}

function parsePersistedSession(value: string): ServerAuthSession | null {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return null;
  }

  const persisted = payload as {
    accessToken?: unknown;
    refreshToken?: unknown;
    tokenType?: unknown;
    expiresAt?: unknown;
    authProviderIds?: unknown;
    emailVerified?: unknown;
    profile?: Partial<ServerAuthProfile>;
  };
  if (
    typeof persisted.accessToken !== 'string' ||
    persisted.tokenType !== 'Bearer' ||
    typeof persisted.expiresAt !== 'string' ||
    !persisted.profile
  ) {
    return null;
  }

  const profile = normalizeProfile(persisted.profile);
  if (!profile) return null;
  if (!Number.isFinite(Date.parse(persisted.expiresAt))) return null;
  return makeSession(
    persisted.accessToken,
    profile,
    persisted.expiresAt,
    normalizeAuthProviderIds(persisted.authProviderIds),
    typeof persisted.refreshToken === 'string' ? persisted.refreshToken : null,
    persisted.emailVerified === true
  );
}

export function getCurrentServerAccessToken(): string | null {
  if (currentSession && isExpired(currentSession.expiresAt)) {
    currentSession = null;
  }
  return currentSession?.accessToken ?? null;
}

export function getCurrentServerUser(): ServerAuthUser | null {
  if (currentSession && isExpired(currentSession.expiresAt)) {
    currentSession = null;
  }
  return currentSession?.user ?? null;
}

export function clearServerAuthSession(): void {
  currentSession = null;
}

export async function clearPersistedServerAuthSession(
  deps: Pick<ServerAuthDeps, 'storage'> = makeDeps()
): Promise<void> {
  currentSession = null;
  try {
    await resolveStorage(deps).removeItem(SERVER_AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Memory is already cleared; storage may be unavailable in non-app runtimes.
  }
}

export async function restoreServerAuthSession(
  deps: Partial<ServerAuthDeps> = makeDeps()
): Promise<ServerAuthSession | null> {
  if (!isLocalServerAuthEnabled()) {
    currentSession = null;
    return null;
  }

  const storage = resolveStorage(deps);
  let value: string | null;
  try {
    value = await storage.getItem(SERVER_AUTH_SESSION_STORAGE_KEY);
  } catch {
    currentSession = null;
    return null;
  }
  if (!value) {
    currentSession = null;
    return null;
  }

  const session = parsePersistedSession(value);
  if (!session) {
    await removePersistedSession(storage);
    currentSession = null;
    return null;
  }

  if (isExpired(session.expiresAt)) {
    if (!session.refreshToken) {
      await removePersistedSession(storage);
      currentSession = null;
      return null;
    }

    const refreshed = await refreshLocalServerSession(session.refreshToken, deps);
    if (refreshed) return refreshed;
    await removePersistedSession(storage);
    currentSession = null;
    return null;
  }

  currentSession = session;
  return currentSession;
}

async function refreshLocalServerSession(
  refreshToken: string,
  deps: Partial<ServerAuthDeps> = makeDeps()
): Promise<ServerAuthSession | null> {
  if (!isLocalServerAuthEnabled()) return null;
  if (!deps.fetch || !deps.getServerBaseUrl) return null;

  let baseUrl: string | undefined;
  try {
    baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  } catch {
    return null;
  }
  if (!baseUrl) return null;

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/auth/dev/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;

  let session: ServerAuthSession | null;
  try {
    session = await sessionFromPayload(await response.json());
  } catch {
    return null;
  }
  if (!session) return null;

  currentSession = session;
  try {
    await resolveStorage(deps).setItem(SERVER_AUTH_SESSION_STORAGE_KEY, serializeSession(currentSession));
  } catch {
    // Refreshed in-memory auth still works if platform storage is unavailable.
  }
  return currentSession;
}

export async function startLocalServerSession(
  input: { email: string; displayName: string; authProviderId?: AuthProviderId },
  deps: ServerAuthDeps = makeDeps()
): Promise<ServerAuthSession | null> {
  if (!isLocalServerAuthEnabled()) return null;

  const baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  if (!baseUrl) return null;

  const response = await deps.fetch(`${baseUrl}/auth/dev/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      ...(input.authProviderId ? { authProviderId: input.authProviderId } : {}),
    }),
  });

  if (!response.ok) return null;

  const session = await sessionFromPayload(await response.json());
  if (!session) return null;

  currentSession = session;
  try {
    await resolveStorage(deps).setItem(SERVER_AUTH_SESSION_STORAGE_KEY, serializeSession(currentSession));
  } catch {
    // Local dev auth must still work in test/runtime contexts where AsyncStorage is unavailable.
  }
  return currentSession;
}

async function sessionFromPayload(payload: unknown): Promise<ServerAuthSession | null> {
  const sessionPayload = payload as {
    accessToken?: unknown;
    refreshToken?: unknown;
    tokenType?: unknown;
    expiresAt?: unknown;
    authProviderIds?: unknown;
    emailVerified?: unknown;
    profile?: Partial<ServerAuthProfile>;
  };

  if (
    typeof sessionPayload.accessToken !== 'string' ||
    sessionPayload.tokenType !== 'Bearer' ||
    !sessionPayload.profile ||
    typeof sessionPayload.profile.authUid !== 'string' ||
    typeof sessionPayload.profile.displayName !== 'string' ||
    typeof sessionPayload.profile.emailNormalized !== 'string'
  ) {
    return null;
  }

  const profile = normalizeProfile(sessionPayload.profile);
  if (!profile) return null;
  const expiresAt =
    typeof sessionPayload.expiresAt === 'string' && Number.isFinite(Date.parse(sessionPayload.expiresAt))
      ? sessionPayload.expiresAt
      : fallbackExpiresAt();

  return makeSession(
    sessionPayload.accessToken,
    profile,
    expiresAt,
    normalizeAuthProviderIds(sessionPayload.authProviderIds),
    typeof sessionPayload.refreshToken === 'string' ? sessionPayload.refreshToken : null,
    sessionPayload.emailVerified === true
  );
}

export async function persistServerAuthSessionFromPayload(
  payload: unknown,
  deps: Pick<ServerAuthDeps, 'storage'> = makeDeps()
): Promise<ServerAuthSession | null> {
  const session = await sessionFromPayload(payload);
  if (!session) return null;

  currentSession = session;
  try {
    await resolveStorage(deps).setItem(SERVER_AUTH_SESSION_STORAGE_KEY, serializeSession(currentSession));
  } catch {
    // In-memory auth remains useful when platform storage is unavailable.
  }
  return currentSession;
}

export async function startLocalServerSocialSession(
  provider: LocalServerSocialAuthProvider,
  deps: ServerAuthDeps = makeDeps()
): Promise<ServerAuthSession | null> {
  const providerName = provider === 'google' ? 'Google' : 'Apple';
  return startLocalServerSession(
    {
      email: `${provider}.local@example.test`,
      displayName: `Local ${providerName} User`,
      authProviderId: provider,
    },
    deps
  );
}
