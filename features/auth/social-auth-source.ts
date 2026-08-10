import {
  persistServerAuthSessionFromPayload,
  type ServerAuthStorage,
  waitForPendingServerAuthSignOut,
} from './server-auth-source';
import { authSessionRuntime } from './auth-session-runtime';

export type SocialAuthProvider = 'google' | 'apple';

export type SocialAuthSourceInput = {
  provider: SocialAuthProvider;
  idToken: string;
  accessToken?: string;
  nonce?: string;
};

export type SocialAuthSourceErrorCode =
  'configuration' | 'network' | 'invalid_credentials' | 'provider_conflict' | 'unknown';

export class SocialAuthSourceError extends Error {
  readonly code: SocialAuthSourceErrorCode;

  constructor(code: SocialAuthSourceErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SocialAuthSourceError';
    this.code = code;
  }
}

export type SocialAuthSourceDeps = {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getServerBaseUrl: () => string | undefined;
  storage?: ServerAuthStorage;
};

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

function makeDeps(): SocialAuthSourceDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    getServerBaseUrl: resolveServerBaseUrl,
  };
}

function normalizeServerErrorCode(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) {
    return '';
  }
  const maybeError = payload as { error?: { code?: unknown }; code?: unknown };
  if (typeof maybeError.error?.code === 'string') {
    return maybeError.error.code;
  }
  if (typeof maybeError.code === 'string') {
    return maybeError.code;
  }
  return '';
}

function errorCodeForResponse(status: number, payload: unknown): SocialAuthSourceErrorCode {
  const code = normalizeServerErrorCode(payload);
  if (code === 'configuration') return 'configuration';
  if (code === 'invalid_credentials' || status === 401) return 'invalid_credentials';
  if (code === 'provider_conflict' || status === 409) return 'provider_conflict';
  return status >= 500 ? 'network' : 'unknown';
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function trimOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function signInWithSocialProviderTokenFromSource(
  input: SocialAuthSourceInput,
  deps: SocialAuthSourceDeps = makeDeps(),
): Promise<void> {
  await waitForPendingServerAuthSignOut();
  let baseUrl: string | undefined;
  try {
    baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  } catch (error: unknown) {
    if (error instanceof SocialAuthSourceError) {
      throw error;
    }
    throw new SocialAuthSourceError(
      'configuration',
      'MyChampions server URL could not be resolved.',
    );
  }

  if (!baseUrl) {
    throw new SocialAuthSourceError('configuration', 'MyChampions server URL is not configured.');
  }

  const idToken = input.idToken.trim();
  if (!idToken) {
    throw new SocialAuthSourceError('invalid_credentials', 'Social auth idToken is required.');
  }

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/auth/social/sign-in`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: authSessionRuntime.credentials,
      body: JSON.stringify({
        provider: input.provider,
        idToken,
        ...(trimOptional(input.accessToken)
          ? { accessToken: trimOptional(input.accessToken) }
          : {}),
        ...(trimOptional(input.nonce) ? { nonce: trimOptional(input.nonce) } : {}),
        ...authSessionRuntime.sessionRequestFields,
      }),
    });
  } catch {
    throw new SocialAuthSourceError('network', 'Social auth request failed.');
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new SocialAuthSourceError(errorCodeForResponse(response.status, payload));
  }

  const session = await persistServerAuthSessionFromPayload(payload, deps);
  if (!session) {
    throw new SocialAuthSourceError(
      'unknown',
      'Social auth response did not contain a valid server session.',
    );
  }
}
