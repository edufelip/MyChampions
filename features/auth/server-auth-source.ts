/**
 * Local MyChampions server auth source.
 *
 * This is the current local auth boundary for migrated mobile source modules.
 * It stores server-issued bearer sessions from local email/password, social,
 * or explicit local/dev-session flows so app-domain code uses MyChampions
 * server auth instead of mobile-owned provider tokens.
 */

import type { AuthProviderId } from './auth-user';
import { authSessionRuntime, type AuthSessionRuntime } from './auth-session-runtime';
import { serverAuthStorage } from './server-auth-storage';

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
  runtime?: AuthSessionRuntime;
  storage?: ServerAuthStorage;
};

const SERVER_AUTH_SESSION_STORAGE_KEY = 'auth.server.session';
const ACCESS_TOKEN_REFRESH_LEEWAY_MS = 30_000;

let currentSession: ServerAuthSession | null = null;
let sessionRevision = 0;
type RefreshServerSessionOutcome =
  | { kind: 'success'; session: ServerAuthSession }
  | { kind: 'rejected' }
  | { kind: 'transient_failure' }
  | { kind: 'stale' };
let refreshInFlight: {
  revision: number;
  promise: Promise<RefreshServerSessionOutcome>;
} | null = null;
let browserSignOutInFlight: Promise<void> | null = null;
const sessionListeners = new Set<(session: ServerAuthSession | null) => void>();

type LocalServerSocialAuthProvider = 'google' | 'apple';

function resolveServerBaseUrl(): string | undefined {
  let expoExtra: unknown;
  try {
    // Runtime loading keeps provider-free Node contract tests from importing React Native.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    // Runtime loading keeps provider-free Node contract tests from importing React Native.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
    ...(authSessionRuntime.persistsSession ? { storage: serverAuthStorage } : {}),
  };
}

function resolveStorage(deps: Pick<ServerAuthDeps, 'storage'>): ServerAuthStorage {
  return deps.storage ?? serverAuthStorage;
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

function expiresWithin(expiresAt: string, leewayMs: number): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + leewayMs;
}

function setCurrentSession(session: ServerAuthSession | null): void {
  sessionRevision += 1;
  currentSession = session;
  for (const listener of sessionListeners) {
    listener(session);
  }
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
  return currentSession && !isExpired(currentSession.expiresAt) ? currentSession.accessToken : null;
}

export function getCurrentServerUser(): ServerAuthUser | null {
  return currentSession?.user ?? null;
}

export function getCurrentServerProfile(): ServerAuthProfile | null {
  return currentSession?.profile ?? null;
}

export function clearServerAuthSession(): void {
  refreshInFlight = null;
  setCurrentSession(null);
}

export async function waitForPendingServerAuthSignOut(): Promise<void> {
  if (browserSignOutInFlight) {
    await browserSignOutInFlight;
  }
}

export function subscribeServerAuthSession(
  listener: (session: ServerAuthSession | null) => void
): () => void {
  sessionListeners.add(listener);
  return () => {
    sessionListeners.delete(listener);
  };
}

export async function getValidServerAccessToken(
  deps: Partial<ServerAuthDeps> = makeDeps()
): Promise<string | null> {
  const session = currentSession;
  if (!session) return null;
  if (!expiresWithin(session.expiresAt, ACCESS_TOKEN_REFRESH_LEEWAY_MS)) {
    return session.accessToken;
  }

  if (authSessionRuntime.persistsSession && !session.refreshToken) {
    setCurrentSession(null);
    await removePersistedSession(resolveStorage(deps));
    return null;
  }

  const refreshRevision = sessionRevision;
  if (!refreshInFlight || refreshInFlight.revision !== refreshRevision) {
    const flight = {
      revision: refreshRevision,
      promise: Promise.resolve<RefreshServerSessionOutcome>({
        kind: 'transient_failure',
      }),
    };
    flight.promise = refreshServerSession(
      session.refreshToken,
      deps,
      () => sessionRevision === refreshRevision && currentSession === session
    )
      .then(async (outcome) => {
        if (outcome.kind !== 'rejected') return outcome;
        if (sessionRevision !== refreshRevision || currentSession !== session) {
          return { kind: 'stale' } as const;
        }
        setCurrentSession(null);
        if (authSessionRuntime.persistsSession) {
          await removePersistedSession(resolveStorage(deps));
        }
        return outcome;
      })
      .finally(() => {
        if (refreshInFlight === flight) {
          refreshInFlight = null;
        }
      });
    refreshInFlight = flight;
  }

  const outcome = await refreshInFlight.promise;
  if (outcome.kind === 'success') return outcome.session.accessToken;
  if (
    outcome.kind === 'transient_failure' &&
    sessionRevision === refreshRevision &&
    currentSession === session &&
    !isExpired(session.expiresAt)
  ) {
    return session.accessToken;
  }
  return null;
}

export async function clearPersistedServerAuthSession(
  deps: Partial<ServerAuthDeps> = makeDeps()
): Promise<void> {
  const runtime = deps.runtime ?? authSessionRuntime;
  if (!runtime.persistsSession) {
    if (!browserSignOutInFlight) {
      const signOut = (async () => {
        try {
          const baseUrl = deps.getServerBaseUrl?.()?.replace(/\/+$/, '');
          if (baseUrl && deps.fetch) {
            await deps.fetch(`${baseUrl}/auth/session/sign-out`, {
              method: 'POST',
              credentials: runtime.credentials,
            });
          }
        } catch {
          // Local identity is already cleared; a failed request still releases the login barrier.
        }
      })();
      browserSignOutInFlight = signOut;
    }

    // Clear the local identity synchronously so the UI can leave the account
    // immediately. The browser request remains a barrier for every subsequent
    // session-establishing auth source until its response can no longer race
    // the replacement cookie.
    refreshInFlight = null;
    setCurrentSession(null);

    const signOut = browserSignOutInFlight;
    try {
      await signOut;
    } finally {
      if (browserSignOutInFlight === signOut) {
        browserSignOutInFlight = null;
      }
    }
    return;
  }

  refreshInFlight = null;
  setCurrentSession(null);
  try {
    await resolveStorage(deps).removeItem(SERVER_AUTH_SESSION_STORAGE_KEY);
  } catch {
    // Memory is already cleared; storage may be unavailable in non-app runtimes.
  }
}

export async function restoreServerAuthSession(
  deps: Partial<ServerAuthDeps> = makeDeps()
): Promise<ServerAuthSession | null> {
  if (!authSessionRuntime.persistsSession) {
    const restoreRevision = sessionRevision;
    const outcome = await refreshServerSession(
      null,
      deps,
      () => sessionRevision === restoreRevision
    );
    if (outcome.kind === 'success') return outcome.session;
    if (outcome.kind === 'rejected' && sessionRevision === restoreRevision) {
      setCurrentSession(null);
    }
    return outcome.kind === 'transient_failure' ? currentSession : null;
  }

  const storage = resolveStorage(deps);
  let value: string | null;
  try {
    value = await storage.getItem(SERVER_AUTH_SESSION_STORAGE_KEY);
  } catch {
    setCurrentSession(null);
    return null;
  }
  if (!value) {
    setCurrentSession(null);
    return null;
  }

  const session = parsePersistedSession(value);
  if (!session) {
    await removePersistedSession(storage);
    setCurrentSession(null);
    return null;
  }

  if (isExpired(session.expiresAt)) {
    if (!session.refreshToken) {
      await removePersistedSession(storage);
      setCurrentSession(null);
      return null;
    }

    const restoreRevision = sessionRevision;
    const outcome = await refreshServerSession(
      session.refreshToken,
      deps,
      () => sessionRevision === restoreRevision
    );
    if (outcome.kind === 'success') return outcome.session;
    if (sessionRevision !== restoreRevision || outcome.kind === 'stale') return null;
    if (outcome.kind === 'rejected') {
      await removePersistedSession(storage);
      setCurrentSession(null);
      return null;
    }

    // Preserve the expired bearer session and rotating refresh token after
    // retryable failures so cached read models remain available offline.
    // Token-requiring operations still fail closed until refresh succeeds.
    setCurrentSession(session);
    return currentSession;
  }

  setCurrentSession(session);
  return currentSession;
}

async function refreshServerSession(
  refreshToken: string | null,
  deps: Partial<ServerAuthDeps> = makeDeps(),
  canCommit: () => boolean = () => true
): Promise<RefreshServerSessionOutcome> {
  if (!deps.fetch || !deps.getServerBaseUrl) return { kind: 'transient_failure' };

  let baseUrl: string | undefined;
  try {
    baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  } catch {
    return { kind: 'transient_failure' };
  }
  if (!baseUrl) return { kind: 'transient_failure' };

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}${authSessionRuntime.refreshPath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: authSessionRuntime.credentials,
      body: JSON.stringify(authSessionRuntime.refreshRequestBody(refreshToken)),
    });
  } catch {
    return { kind: 'transient_failure' };
  }
  if (response.status === 401 || response.status === 403) {
    return { kind: 'rejected' };
  }
  if (!response.ok) return { kind: 'transient_failure' };

  let session: ServerAuthSession | null;
  try {
    session = await sessionFromPayload(await response.json());
  } catch {
    return { kind: 'transient_failure' };
  }
  if (!session) return { kind: 'transient_failure' };
  if (!canCommit()) return { kind: 'stale' };

  setCurrentSession(session);
  if (authSessionRuntime.persistsSession) {
    try {
      await resolveStorage(deps).setItem(SERVER_AUTH_SESSION_STORAGE_KEY, serializeSession(session));
    } catch {
      // Refreshed in-memory auth still works if platform storage is unavailable.
    }
  }
  return { kind: 'success', session };
}

export async function startLocalServerSession(
  input: { email: string; displayName: string; authProviderId?: AuthProviderId },
  deps: ServerAuthDeps = makeDeps()
): Promise<ServerAuthSession | null> {
  await waitForPendingServerAuthSignOut();
  if (!isLocalServerAuthEnabled()) return null;

  const baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  if (!baseUrl) return null;

  const response = await deps.fetch(`${baseUrl}/auth/dev/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: authSessionRuntime.credentials,
    body: JSON.stringify({
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim(),
      ...(input.authProviderId ? { authProviderId: input.authProviderId } : {}),
      ...authSessionRuntime.sessionRequestFields,
    }),
  });

  if (!response.ok) return null;

  const session = await sessionFromPayload(await response.json());
  if (!session) return null;

  setCurrentSession(session);
  if (authSessionRuntime.persistsSession) {
    try {
      await resolveStorage(deps).setItem(SERVER_AUTH_SESSION_STORAGE_KEY, serializeSession(session));
    } catch {
      // Local dev auth must still work in test/runtime contexts where AsyncStorage is unavailable.
    }
  }
  return session;
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
  await waitForPendingServerAuthSignOut();
  const session = await sessionFromPayload(payload);
  if (!session) return null;

  setCurrentSession(session);
  if (authSessionRuntime.persistsSession) {
    try {
      await resolveStorage(deps).setItem(SERVER_AUTH_SESSION_STORAGE_KEY, serializeSession(session));
    } catch {
      // In-memory auth remains useful when platform storage is unavailable.
    }
  }
  return session;
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
