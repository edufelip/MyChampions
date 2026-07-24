/**
 * Auth profile source backed by the MyChampions server.
 *
 * This module intentionally keeps the public source contract used by
 * AuthSessionProvider while removing direct provider reads/writes from the
 * profile boundary.
 */

import type { RoleIntent } from './role-selection.logic';
import { resolveE2EAuthSessionSourceOverride } from './e2e-auth-session';
import { getValidServerAccessToken } from './server-auth-source';

type ProfileSourceErrorCode =
  | 'configuration'
  | 'network'
  | 'graphql'
  | 'invalid_response'
  | 'role_update_not_persisted'
  | 'profile_row_not_found_after_upsert'
  | 'token_unavailable'
  | 'unauthenticated';

export class ProfileSourceError extends Error {
  code: ProfileSourceErrorCode;

  constructor(code: ProfileSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ProfileSourceError';
  }
}

type AuthProfile = {
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
};

type ServerProfile = {
  authUid: string;
  displayName: string;
  emailNormalized: string;
  lockedRole: RoleIntent | null;
  acceptedTermsVersion: string | null;
  createdAt: string;
  updatedAt: string;
};

type ServerProfileResponse = {
  profile?: Partial<ServerProfile>;
  error?: {
    code?: string;
    message?: string;
  };
};

export type ProfileSourceDeps = {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getCurrentAccessToken: () => Promise<string | null>;
  getServerBaseUrl: () => string | undefined;
};

function resolveProfileSourceE2EOverride() {
  return resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
}

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

function getProfileSourceDeps(): ProfileSourceDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    getCurrentAccessToken: async () => {
      const serverAccessToken = await getValidServerAccessToken();
      if (serverAccessToken) return serverAccessToken;

      const e2eSourceOverride = resolveProfileSourceE2EOverride();
      if (e2eSourceOverride) return e2eSourceOverride.idToken;

      return null;
    },
    getServerBaseUrl: resolveServerBaseUrl,
  };
}

function normalizeRole(value: unknown): RoleIntent | null {
  return value === 'student' || value === 'professional' ? value : null;
}

function mapServerProfile(profile: Partial<ServerProfile> | undefined): AuthProfile {
  if (!profile || typeof profile !== 'object') {
    throw new ProfileSourceError('invalid_response', 'Profile response is missing.');
  }

  return {
    lockedRole: normalizeRole(profile.lockedRole),
    acceptedTermsVersion:
      typeof profile.acceptedTermsVersion === 'string' ? profile.acceptedTermsVersion : null,
  };
}

function normalizeServerError(status: number, payload: ServerProfileResponse | null): ProfileSourceError {
  const code = payload?.error?.code;
  const message = payload?.error?.message ?? `Profile server request failed with status ${status}.`;

  if (status === 401 || status === 403 || code === 'unauthorized') {
    return new ProfileSourceError('unauthenticated', message);
  }
  if (status === 404 || code === 'profile_not_found') {
    return new ProfileSourceError('profile_row_not_found_after_upsert', message);
  }
  if (status === 409 || code === 'role_already_locked') {
    return new ProfileSourceError('graphql', message);
  }
  if (status >= 500) {
    return new ProfileSourceError('network', message);
  }

  return new ProfileSourceError('invalid_response', message);
}

function normalizeProfileSourceError(error: unknown): ProfileSourceError {
  if (error instanceof ProfileSourceError) return error;
  return new ProfileSourceError('network', (error as Error)?.message ?? 'Network error.');
}

async function readJson(response: Response): Promise<ServerProfileResponse | null> {
  if (response.status === 204) return null;
  try {
    return (await response.json()) as ServerProfileResponse;
  } catch {
    return null;
  }
}

async function requestProfile(
  path: string,
  deps: ProfileSourceDeps,
  options: {
    method?: string;
    body?: unknown;
    accessToken?: string | null;
  } = {}
): Promise<ServerProfileResponse | null> {
  const baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  if (!baseUrl) {
    throw new ProfileSourceError(
      'configuration',
      'MyChampions server URL is not configured. Set EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL.'
    );
  }

  const accessToken = options.accessToken ?? (await deps.getCurrentAccessToken());
  if (!accessToken) {
    throw new ProfileSourceError('token_unavailable', 'No usable server access token found.');
  }

  const response = await deps.fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await readJson(response);

  if (!response.ok) {
    throw normalizeServerError(response.status, payload);
  }

  return payload;
}

export async function hydrateProfileFromSource(
  user: { uid: string; displayName: string | null; email: string | null },
  deps: ProfileSourceDeps = getProfileSourceDeps()
): Promise<AuthProfile> {
  try {
    const payload = await requestProfile('/me/hydrate', deps, {
      method: 'POST',
      body: {
        displayName: user.displayName ?? '',
        email: user.email?.toLowerCase() ?? 'unknown@example.invalid',
      },
    });
    return mapServerProfile(payload?.profile);
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

export async function lockRoleInSource(
  role: RoleIntent,
  deps: ProfileSourceDeps = getProfileSourceDeps()
): Promise<AuthProfile> {
  try {
    const payload = await requestProfile('/me/role', deps, {
      method: 'PATCH',
      body: { role },
    });
    return mapServerProfile(payload?.profile);
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

export async function deleteAccountAndDataFromSource(
  deps: ProfileSourceDeps = getProfileSourceDeps()
): Promise<void> {
  try {
    await requestProfile('/me', deps, { method: 'DELETE' });
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}

export async function setAcceptedTermsVersionInSource(
  version: string,
  deps: ProfileSourceDeps = getProfileSourceDeps()
): Promise<void> {
  try {
    await requestProfile('/me/terms', deps, {
      method: 'PATCH',
      body: { acceptedTermsVersion: version },
    });
  } catch (error) {
    throw normalizeProfileSourceError(error);
  }
}
