import { getCurrentServerUser, getValidServerAccessToken } from '@/features/auth/server-auth-source';
import { resolveE2ESubscriptionOverride } from '@/features/auth/e2e-auth-session';
import type { EntitlementStatus } from './subscription.logic';

export type SubscriptionEntitlementSnapshotInput = {
  professionalEntitlementStatus: EntitlementStatus;
  aiEntitlementStatus: EntitlementStatus;
  professionalEntitlementExpiresAt?: string | null;
  professionalEntitlementRenewalRisk?: boolean;
  activeStudentCount?: number | null;
  observedAt?: string;
};

export type SubscriptionEntitlementSnapshot = {
  authUid: string;
  professionalEntitlementStatus: EntitlementStatus;
  aiEntitlementStatus: EntitlementStatus;
  professionalEntitlementExpiresAt: string | null;
  professionalEntitlementRenewalRisk: boolean;
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

export type SubscriptionServerFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type SubscriptionServerSourceDeps = {
  getCurrentAccessToken?: () => Promise<string | null>;
  getCurrentAuthUid?: () => string | null;
  getServerBaseUrl?: () => string | undefined;
  fetchFn: SubscriptionServerFetch;
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
  getCurrentAccessToken: () => getValidServerAccessToken(),
  getCurrentAuthUid: () => getCurrentServerUser()?.uid ?? null,
  getServerBaseUrl: resolveServerBaseUrl,
  fetchFn: (input, init) =>
    Reflect.apply(globalThis.fetch, globalThis, [input, init]),
};

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEntitlementStatus(value: unknown): value is EntitlementStatus {
  return value === 'active' || value === 'lapsed' || value === 'unknown';
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    Number.isFinite(new Date(value).getTime())
  );
}

function parseSubscriptionEntitlementSnapshot(
  value: unknown,
  expectedAuthUid?: string
): SubscriptionEntitlementSnapshot {
  if (
    !isRecord(value) ||
    typeof value.authUid !== 'string' ||
    !value.authUid.trim() ||
    !isEntitlementStatus(value.professionalEntitlementStatus) ||
    !isEntitlementStatus(value.aiEntitlementStatus) ||
    !(
      value.professionalEntitlementExpiresAt === null ||
      isIsoTimestamp(value.professionalEntitlementExpiresAt)
    ) ||
    typeof value.professionalEntitlementRenewalRisk !== 'boolean' ||
    !(
      value.activeStudentCount === null ||
      (Number.isInteger(value.activeStudentCount) &&
        Number(value.activeStudentCount) >= 0)
    ) ||
    value.source !== 'revenuecat' ||
    !isIsoTimestamp(value.observedAt) ||
    !isIsoTimestamp(value.updatedAt)
  ) {
    throw new SubscriptionServerSourceError(
      'invalid_response',
      'Subscription entitlement read returned a malformed snapshot.'
    );
  }

  if (expectedAuthUid && value.authUid !== expectedAuthUid) {
    throw new SubscriptionServerSourceError(
      'unauthenticated',
      'Subscription entitlement read returned a snapshot for a different user.'
    );
  }

  return value as SubscriptionEntitlementSnapshot;
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
  const fetchFn = deps.fetchFn;

  let response: Response;
  try {
    response = await fetchFn(joinUrl(baseUrl, '/subscription/entitlements/snapshot'), {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        professionalEntitlementStatus: input.professionalEntitlementStatus,
        aiEntitlementStatus: input.aiEntitlementStatus,
        professionalEntitlementExpiresAt: input.professionalEntitlementExpiresAt ?? null,
        professionalEntitlementRenewalRisk: input.professionalEntitlementRenewalRisk ?? false,
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
  if (deps === defaultDeps) {
    const fixture = resolveE2ESubscriptionOverride({
      activeStudentCount: process.env.EXPO_PUBLIC_E2E_PRO_ACTIVE_STUDENT_COUNT,
      aiEntitlementStatus: process.env.EXPO_PUBLIC_E2E_AI_ENTITLEMENT_STATUS,
      appVariant: process.env.APP_VARIANT,
      enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
      entitlementStatus: process.env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_STATUS,
      professionalEntitlementRenewalRisk:
        process.env.EXPO_PUBLIC_E2E_PRO_ENTITLEMENT_RENEWAL_RISK,
      isDev: typeof __DEV__ !== 'undefined' && __DEV__,
    });
    if (fixture && expectedAuthUid) {
      const observedAt = new Date().toISOString();
      return {
        authUid: expectedAuthUid,
        professionalEntitlementStatus: fixture.entitlementStatus,
        aiEntitlementStatus: fixture.aiEntitlementStatus,
        professionalEntitlementExpiresAt: null,
        professionalEntitlementRenewalRisk: fixture.professionalEntitlementRenewalRisk,
        activeStudentCount: fixture.activeStudentCount,
        source: 'revenuecat',
        observedAt,
        updatedAt: observedAt,
      };
    }
  }

  const { baseUrl, token } = await requireLocalServerAuth('read', deps, expectedAuthUid);
  const fetchFn = deps.fetchFn;

  let response: Response;
  try {
    response = await fetchFn(joinUrl(baseUrl, '/subscription/entitlements/snapshot'), {
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

  if (expectedAuthUid && deps.getCurrentAuthUid?.() !== expectedAuthUid) {
    throw new SubscriptionServerSourceError(
      'unauthenticated',
      'MyChampions server session changed while reading subscription entitlements.'
    );
  }

  let body: { snapshot?: unknown };
  try {
    body = (await response.json()) as { snapshot?: unknown };
  } catch {
    throw new SubscriptionServerSourceError(
      'invalid_response',
      'Subscription entitlement read returned invalid JSON.'
    );
  }

  if (body.snapshot === null) {
    return null;
  }

  if (body.snapshot === undefined) {
    throw new SubscriptionServerSourceError(
      'invalid_response',
      'Subscription entitlement read response is missing snapshot.'
    );
  }

  return parseSubscriptionEntitlementSnapshot(body.snapshot, expectedAuthUid);
}
