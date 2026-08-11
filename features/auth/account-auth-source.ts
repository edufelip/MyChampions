/**
 * Account auth actions backed by the MyChampions server where available.
 */

import {
  ResetPasswordConfirmFailure,
  type ResetPasswordConfirmErrorReason,
} from './reset-password.logic';
import { clearPersistedServerAuthSession } from './server-auth-source';

export type AccountAuthSourceDeps = {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getServerBaseUrl: () => string | undefined;
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

function makeDeps(): AccountAuthSourceDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    getServerBaseUrl: resolveServerBaseUrl,
  };
}

export async function requestPasswordResetFromSource(
  email: string,
  deps: AccountAuthSourceDeps = makeDeps(),
): Promise<void> {
  const emailNormalized = email.trim().toLowerCase();
  const baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');

  if (!baseUrl) {
    throw new Error('MyChampions server URL is not configured.');
  }

  const response = await deps.fetch(`${baseUrl}/auth/password-reset`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: emailNormalized }),
  });

  if (!response.ok) {
    throw new Error(`Password reset request failed with status ${response.status}.`);
  }
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

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function confirmPasswordResetReasonForResponse(
  status: number,
  payload: unknown,
): ResetPasswordConfirmErrorReason {
  const code = normalizeServerErrorCode(payload);
  if (code === 'invalid_or_expired_token') return 'invalid_or_expired_token';
  if (code === 'invalid_email') return 'invalid_email';
  if (code === 'account_not_found' || status === 404) return 'account_not_found';
  if (code === 'configuration') return 'configuration';
  return status >= 500 ? 'network' : 'unknown';
}

export type ConfirmPasswordResetInput = {
  email: string;
  token: string;
  newPassword: string;
};

export async function confirmPasswordResetFromSource(
  input: ConfirmPasswordResetInput,
  deps: AccountAuthSourceDeps = makeDeps(),
): Promise<void> {
  const emailNormalized = input.email.trim().toLowerCase();
  let baseUrl: string | undefined;
  try {
    baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  } catch {
    throw new ResetPasswordConfirmFailure('configuration');
  }
  if (!baseUrl) {
    throw new ResetPasswordConfirmFailure('configuration');
  }

  let response: Response;
  try {
    response = await deps.fetch(`${baseUrl}/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: emailNormalized,
        token: input.token,
        newPassword: input.newPassword,
      }),
    });
  } catch {
    throw new ResetPasswordConfirmFailure('network');
  }

  const payload = await readJson(response);
  if (!response.ok) {
    throw new ResetPasswordConfirmFailure(
      confirmPasswordResetReasonForResponse(response.status, payload),
    );
  }
}

export async function signOutFromSource(deps: AccountAuthSourceDeps = makeDeps()): Promise<void> {
  await clearPersistedServerAuthSession(deps);
}
