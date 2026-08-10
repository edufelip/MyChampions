/**
 * Account auth actions backed by the MyChampions server where available.
 */

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

export async function signOutFromSource(deps: AccountAuthSourceDeps = makeDeps()): Promise<void> {
  await clearPersistedServerAuthSession(deps);
}
