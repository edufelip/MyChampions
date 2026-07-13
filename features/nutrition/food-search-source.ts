/**
 * Food search source — HTTP call to the MyChampions server food catalog route.
 *
 * Contract:
 *  POST <MyChampions server>/integrations/food/search
 *  Authorization: Bearer <MyChampions server access token>
 *
 * Refs: BL-106, FR-243
 */

import { getEffectiveLocale } from '../auth/language-storage';
import { resolveE2EAuthSessionSourceOverride } from '../auth/e2e-auth-session';
import { getCurrentServerAccessToken } from '../auth/server-auth-source';
import { type FoodSearchResult } from '../plans/plan-builder.logic';
import { isDevLoggingEnabled, logNetworkDebug } from '../debug/logging';

// ─── Error type ───────────────────────────────────────────────────────────────

export type FoodSearchErrorCode =
  | 'configuration'
  | 'network'
  | 'unauthenticated'
  | 'quota'
  | 'unknown';

export class FoodSearchSourceError extends Error {
  code: FoodSearchErrorCode;

  constructor(code: FoodSearchErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'FoodSearchSourceError';
  }
}

// ─── Injectable deps (for testability) ───────────────────────────────────────

export type FoodSearchSourceDeps = {
  getServerBaseUrl: () => string | undefined;
  getCurrentAccessToken: () => Promise<string | null>;
  fetchFn: typeof fetch;
  getLocale: () => Promise<string>;
};

const defaultDeps: FoodSearchSourceDeps = {
  getServerBaseUrl: defaultGetServerBaseUrl,
  getCurrentAccessToken: async () => getCurrentServerAccessToken(),
  fetchFn: fetch,
  getLocale: () => getEffectiveLocale(),
};

function defaultGetServerBaseUrl(): string | undefined {
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

function getE2EFoodSearchFixture(query: string): FoodSearchResult[] | null {
  const override = resolveE2EAuthSessionSourceOverride({
    appVariant: process.env.APP_VARIANT,
    enabledFlag: process.env.EXPO_PUBLIC_E2E_AUTH_SESSION,
    isDev: typeof __DEV__ !== 'undefined' && __DEV__,
  });
  if (!override || process.env.EXPO_PUBLIC_E2E_FOOD_SEARCH_FIXTURE !== 'basic') return null;

  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  if (!'rice'.includes(normalized) && !normalized.includes('rice')) return [];

  return [
    {
      id: 'e2e-food-rice',
      name: 'E2E Brown Rice',
      caloriesPer100g: 111,
      carbsPer100g: 23,
      proteinsPer100g: 2.6,
      fatsPer100g: 0.9,
    },
  ];
}

type MicroserviceFoodResult = {
  id?: string;
  name?: string;
  carbohydrate?: number | string;
  protein?: number | string;
  fat?: number | string;
  serving?: number | string;
};

type SearchFoodsErrorBody = {
  error?: string;
  message?: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseNonNegativeNumber(n: unknown): number | null {
  if (typeof n === 'number' && Number.isFinite(n) && n >= 0) return n;
  if (typeof n === 'string') {
    const normalized = n.trim();
    if (!normalized) return null;
    const parsed = Number(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeAppLocale(rawLocale: string): 'en-US' | 'pt-BR' | 'es-ES' {
  const normalized = rawLocale.trim();
  if (normalized === 'en-US' || normalized === 'pt-BR' || normalized === 'es-ES') {
    return normalized;
  }
  const lower = normalized.toLowerCase();
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('es')) return 'es-ES';
  return 'en-US';
}

function resolveRegionLanguageFromLocale(rawLocale: string): { region: string; language: string } {
  const locale = normalizeAppLocale(rawLocale);
  if (locale === 'pt-BR') return { region: 'br', language: 'pt' };
  if (locale === 'es-ES') return { region: 'es', language: 'es' };
  return { region: 'us', language: 'en' };
}

function mapMicroserviceFoodResult(raw: unknown): FoodSearchResult | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as MicroserviceFoodResult;
  const id = typeof value.id === 'string' && value.id.trim().length > 0 ? value.id : null;
  const name = typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : null;
  const carbs = parseNonNegativeNumber(value.carbohydrate);
  const protein = parseNonNegativeNumber(value.protein);
  const fat = parseNonNegativeNumber(value.fat);
  const serving = parseNonNegativeNumber(value.serving);

  if (!id || !name || carbs === null || protein === null || fat === null) return null;
  if (serving !== 100) {
    logNetworkDebug(
      'searchFoodsFromSource',
      `Skipping "${name}" due to invalid serving value (expected 100):`,
      value.serving
    );
    return null;
  }

  const calories = carbs * 4 + protein * 4 + fat * 9;

  return {
    id,
    name,
    caloriesPer100g: round2(calories),
    carbsPer100g: round2(carbs),
    proteinsPer100g: round2(protein),
    fatsPer100g: round2(fat),
  };
}

function normalizeResultsArray(results: unknown): unknown[] {
  if (Array.isArray(results)) return results;
  if (!results || typeof results !== 'object') return [];

  const obj = results as Record<string, unknown>;
  const candidates = [obj['results'], obj['foods'], obj['items'], obj['food']];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
    if (candidate && typeof candidate === 'object') return [candidate];
  }
  return [results];
}

function mapErrorToSourceError(
  responseStatus: number,
  body: SearchFoodsErrorBody | null
): FoodSearchSourceError | null {
  const errorCode = body?.error ?? null;

  if (responseStatus === 401 || responseStatus === 403 || errorCode === 'unauthenticated') {
    return new FoodSearchSourceError('unauthenticated', 'Food search service rejected the server access token.');
  }

  if (responseStatus === 429 || errorCode === 'quota_exceeded') {
    return new FoodSearchSourceError('quota', 'Food search rate limit exceeded.');
  }

  if (responseStatus === 400 || errorCode === 'bad_request') {
    return new FoodSearchSourceError('unknown', body?.message ?? 'Food search request was rejected (bad_request).');
  }

  if (responseStatus === 503 || errorCode === 'configuration') {
    return new FoodSearchSourceError('configuration', body?.message ?? 'Food search endpoint is not configured.');
  }

  if (errorCode === 'upstream_ip_not_allowlisted') {
    return new FoodSearchSourceError('network', 'Food provider IP allowlist mismatch.');
  }

  if (errorCode === 'upstream_error') {
    return new FoodSearchSourceError('network', 'Food provider unavailable.');
  }

  if (!errorCode && responseStatus >= 200 && responseStatus < 300) {
    return null;
  }

  return new FoodSearchSourceError(
    'unknown',
    errorCode ? `${errorCode}${body?.message ? `: ${body.message}` : ''}` : `Service returned error status: ${responseStatus}`
  );
}

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Calls the MyChampions server to search the food database.
 * Returns an array of FoodSearchResult normalized to per-100g macros.
 *
 * @param query   - Search expression forwarded through the MyChampions server integration route
 * @param deps    - Injectable dependencies; omit in production
 */
export async function searchFoodsFromSource(
  query: string,
  deps: FoodSearchSourceDeps = defaultDeps
): Promise<FoodSearchResult[]> {
  logNetworkDebug('searchFoodsFromSource', 'Starting service search for:', query);

  const fixture = getE2EFoodSearchFixture(query);
  if (fixture) return fixture;

  let response: Response;
  const locale = await deps.getLocale();
  const { region, language } = resolveRegionLanguageFromLocale(locale);
  const requestPayload = { query, maxResults: 10, region, language };
  const serverBaseUrl = deps.getServerBaseUrl()?.replace(/\/+$/, '');
  const serverAccessToken = await deps.getCurrentAccessToken();
  const endpoint = serverBaseUrl ? `${serverBaseUrl}/integrations/food/search` : undefined;

  if (!endpoint) {
    throw new FoodSearchSourceError(
      'configuration',
      'MyChampions server URL is not configured. Set EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL.'
    );
  }

  if (!serverAccessToken) {
    throw new FoodSearchSourceError('unauthenticated', 'No authenticated server token found.');
  }

  if (isDevLoggingEnabled()) {
    logNetworkDebug('searchFoodsFromSource', 'Server auth token:', serverAccessToken);
  }

  try {
    logNetworkDebug('searchFoodsFromSource', 'Fetching from service:', endpoint);
    logNetworkDebug('searchFoodsFromSource', 'Request payload:', requestPayload);
    response = await deps.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${serverAccessToken}`,
      },
      body: JSON.stringify(requestPayload),
    });
  } catch (err) {
    console.error('[searchFoodsFromSource] Service network error:', err);
    throw new FoodSearchSourceError('network', 'Could not connect to food search service.');
  }

  logNetworkDebug('searchFoodsFromSource', 'HTTP Status:', response.status);

  let data: { results?: unknown[]; error?: string; message?: string } | null = null;
  try {
    data = await response.json();
    logNetworkDebug('searchFoodsFromSource', 'Response payload:', data);
  } catch {
    if (!response.ok) {
      const mapped = mapErrorToSourceError(response.status, null);
      if (mapped) throw mapped;
    }
    throw new FoodSearchSourceError('unknown', 'Service returned non-JSON body.');
  }

  const mappedError = mapErrorToSourceError(response.status, data);
  if (mappedError) {
    console.error('[searchFoodsFromSource] Service API error:', data?.error ?? mappedError.message);
    throw mappedError;
  }

  const rawResults = normalizeResultsArray(data?.results ?? []);
  const directResults = rawResults
    .map((item) => mapMicroserviceFoodResult(item))
    .filter((item): item is FoodSearchResult => item !== null);
  logNetworkDebug('searchFoodsFromSource', 'Final normalized results count:', directResults.length);
  return directResults;
}
