/**
 * Server-backed source for support messages.
 */

import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import { SupportSourceError, type SupportMessageInput } from './support.logic';

export interface SupportSourceDeps {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  getCurrentAccessToken: () => Promise<string | null>;
  getServerBaseUrl: () => string | undefined;
  getAppVersion: () => string;
  getPlatform: () => 'ios' | 'android' | 'web';
}

function resolveSupportSourceE2EOverride() {
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

export function makeDeps(): SupportSourceDeps {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    getCurrentAccessToken: async () => {
      const serverAccessToken = await getValidServerAccessToken();
      if (serverAccessToken) return serverAccessToken;

      const e2eSourceOverride = resolveSupportSourceE2EOverride();
      if (e2eSourceOverride) return e2eSourceOverride.idToken;

      return null;
    },
    getServerBaseUrl: resolveServerBaseUrl,
    getAppVersion: () => {
      const Constants = require('expo-constants').default;
      return (Constants.expoConfig?.version as string) ?? 'unknown';
    },
    getPlatform: () => {
      const { Platform } = require('react-native');
      return (Platform.OS as 'ios' | 'android' | 'web') ?? 'web';
    },
  };
}

async function readSupportResponse(response: Response): Promise<{ id?: string } | null> {
  try {
    return (await response.json()) as { id?: string };
  } catch {
    return null;
  }
}

export async function submitSupportMessage(
  input: SupportMessageInput & { userRole?: string | null },
  deps = makeDeps(),
): Promise<string> {
  const e2eSourceOverride = resolveSupportSourceE2EOverride();
  if (e2eSourceOverride) {
    return `support_${e2eSourceOverride.uid}`;
  }

  const baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  if (!baseUrl) throw new SupportSourceError('unknown');

  const accessToken = await deps.getCurrentAccessToken();
  if (!accessToken) throw new SupportSourceError('unknown');

  try {
    const response = await deps.fetch(`${baseUrl}/support/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        subject: input.subject.trim(),
        body: input.body.trim(),
        userRole: input.userRole ?? undefined,
        appVersion: deps.getAppVersion(),
        platform: deps.getPlatform(),
      }),
    });

    const payload = await readSupportResponse(response);
    if (!response.ok || typeof payload?.id !== 'string') {
      throw new SupportSourceError(response.status >= 500 ? 'network' : 'unknown');
    }

    return payload.id;
  } catch (error) {
    if (error instanceof SupportSourceError) throw error;
    throw new SupportSourceError('network');
  }
}
