import { getCurrentServerAccessToken, getCurrentServerUser } from '@/features/auth/server-auth-source';
import type { EntitlementStatus } from './subscription.logic';

export type SubscriptionEntitlementSnapshotInput = {
  professionalEntitlementStatus: EntitlementStatus;
  aiEntitlementStatus: EntitlementStatus;
  activeStudentCount?: number | null;
  observedAt?: string;
};

export type SubscriptionEntitlementSnapshot = {
  authUid: string;
  professionalEntitlementStatus: EntitlementStatus;
  aiEntitlementStatus: EntitlementStatus;
  activeStudentCount: number | null;
  source: 'revenuecat';
  observedAt: string;
  updatedAt: string;
};

type SubscriptionServerSourceErrorCode =
  | 'configuration'
  | 'unauthenticated'
  | 'network'
  | 'invalid_response';

export class SubscriptionServerSourceError extends Error {
  code: SubscriptionServerSourceErrorCode;

  constructor(code: SubscriptionServerSourceErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'SubscriptionServerSourceError';
  }
}

export type SubscriptionServerSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getCurrentAuthUid?: () => string | null;
  getServerBaseUrl?: () => string | undefined;
  fetchFn: typeof fetch;
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

const defaultDeps: SubscriptionServerSourceDeps = {
  getCurrentAccessToken: async () => getCurrentServerAccessToken(),
  getCurrentAuthUid: () => getCurrentServerUser()?.uid ?? null,
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: fetch,
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

async function requireLocalServerAuth(
  operation: string,
  deps: SubscriptionServerSourceDeps,
  expectedAuthUid?: string
): Promise<{ baseUrl: string; token: string }> {
  const baseUrl = deps.getServerBaseUrl?.();
  if (!baseUrl) {
    throw new SubscriptionServerSourceError(
      'configuration',
      `MyChampions server URL is not configured for subscription ${operation}.`
    );
  }

  if (expectedAuthUid && deps.getCurrentAuthUid?.() !== expectedAuthUid) {
    throw new SubscriptionServerSourceError(
      'unauthenticated',
      `MyChampions server session changed before ${operation} subscription entitlements could be used.`
    );
  }

  const token = await deps.getCurrentAccessToken?.();
  if (!token) {
    throw new SubscriptionServerSourceError(
      'unauthenticated',
      `A local MyChampions server session is required to ${operation} subscription entitlements.`
    );
  }

  if (expectedAuthUid && deps.getCurrentAuthUid?.() !== expectedAuthUid) {
    throw new SubscriptionServerSourceError(
      'unauthenticated',
      `MyChampions server session changed while preparing to ${operation} subscription entitlements.`
    );
  }

  return { baseUrl, token };
}

export async function syncSubscriptionEntitlementSnapshot(
  input: SubscriptionEntitlementSnapshotInput,
  deps: SubscriptionServerSourceDeps = defaultDeps,
  expectedAuthUid?: string
): Promise<void> {
  const { baseUrl, token } = await requireLocalServerAuth('sync', deps, expectedAuthUid);

  let response: Response;
  try {
    response = await deps.fetchFn(joinUrl(baseUrl, '/subscription/entitlements/snapshot'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        professionalEntitlementStatus: input.professionalEntitlementStatus,
        aiEntitlementStatus: input.aiEntitlementStatus,
        activeStudentCount: input.activeStudentCount ?? null,
        observedAt: input.observedAt ?? new Date().toISOString(),
      }),
    });
  } catch (error) {
    throw new SubscriptionServerSourceError(
      'network',
      `Failed to sync subscription entitlement snapshot: ${String(error)}`
    );
  }

  if (!response.ok) {
    throw new SubscriptionServerSourceError(
      response.status === 401 ? 'unauthenticated' : 'invalid_response',
      `Subscription entitlement sync failed with status ${response.status}.`
    );
  }
}

export async function getSubscriptionEntitlementSnapshot(
  deps: SubscriptionServerSourceDeps = defaultDeps,
  expectedAuthUid?: string
): Promise<SubscriptionEntitlementSnapshot | null> {
  const { baseUrl, token } = await requireLocalServerAuth('read', deps, expectedAuthUid);

  let response: Response;
  try {
    response = await deps.fetchFn(joinUrl(baseUrl, '/subscription/entitlements/snapshot'), {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    throw new SubscriptionServerSourceError(
      'network',
      `Failed to read subscription entitlement snapshot: ${String(error)}`
    );
  }

  if (!response.ok) {
    throw new SubscriptionServerSourceError(
      response.status === 401 ? 'unauthenticated' : 'invalid_response',
      `Subscription entitlement read failed with status ${response.status}.`
    );
  }

  let body: { snapshot?: SubscriptionEntitlementSnapshot | null };
  try {
    body = (await response.json()) as { snapshot?: SubscriptionEntitlementSnapshot | null };
  } catch {
    throw new SubscriptionServerSourceError(
      'invalid_response',
      'Subscription entitlement read returned invalid JSON.'
    );
  }

  if (body.snapshot === null) {
    return null;
  }

  if (!body.snapshot) {
    throw new SubscriptionServerSourceError(
      'invalid_response',
      'Subscription entitlement read response is missing snapshot.'
    );
  }

  return body.snapshot;
}
