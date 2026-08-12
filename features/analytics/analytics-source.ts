import { redactEventProperties, type AnalyticsEvent } from './analytics.logic';

export type AnalyticsSendResult = 'sent' | 'skipped';

export type AnalyticsSourceDeps = {
  getServerBaseUrl: () => string | undefined;
  fetchFn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
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

function defaultDeps(): AnalyticsSourceDeps {
  return {
    getServerBaseUrl: resolveServerBaseUrl,
    fetchFn: globalThis.fetch.bind(globalThis),
  };
}

export async function sendAnalyticsEventToServer(
  event: AnalyticsEvent,
  deps: AnalyticsSourceDeps = defaultDeps(),
): Promise<AnalyticsSendResult> {
  const baseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  if (!baseUrl) {
    return 'skipped';
  }

  try {
    const response = await deps.fetchFn(`${baseUrl}/analytics/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: event.name,
        properties: redactEventProperties(event.properties),
      }),
    });

    return response.ok ? 'sent' : 'skipped';
  } catch {
    return 'skipped';
  }
}
