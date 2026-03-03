/**
 * fatsecret food search source — HTTP call to Firebase Cloud Function proxy.
 *
 * The Cloud Function validates the caller's Firebase Auth ID token, fetches an
 * OAuth 2.0 Bearer token from fatsecret using Client Credentials grant, and
 * proxies the foods.search request. fatsecret credentials (Client ID + Secret)
 * are stored as Cloud Function secrets only — never in the client binary.
 *
 * Pattern: identical to meal-photo-analysis-source.ts (BL-108, D-106).
 * Refs: D-113, D-127, BL-106, FR-243
 */

import type { User } from 'firebase/auth';

import {
  normalizeFoodArray,
  normalizeFoodSearchResult,
  type FoodSearchResult,
} from '../plans/plan-builder.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

export type FoodSearchErrorCode =
  | 'configuration'
  | 'network'
  | 'unauthenticated'
  | 'not_found'
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
  getFunctionUrl: () => string | undefined;
  fetchFn: typeof fetch;
  getIdToken: (user: User) => Promise<string>;
};

const defaultDeps: FoodSearchSourceDeps = {
  getFunctionUrl: () => process.env['EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL'],
  fetchFn: fetch,
  getIdToken: (user) => user.getIdToken(),
};

// ─── Raw response types ───────────────────────────────────────────────────────

type FoodSearchFunctionResponse = {
  results?: unknown; // array of FoodSearchResult from the Cloud Function
  error?: string;
};

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Calls the Firebase Cloud Function proxy to search fatsecret food database.
 * Returns an array of FoodSearchResult normalized to per-100g macros.
 *
 * Throws FoodSearchSourceError with typed code on all failure paths.
 *
 * @param user    - Firebase Auth User (provides ID token for Cloud Function auth)
 * @param query   - Search expression forwarded to fatsecret foods.search
 * @param deps    - Injectable dependencies; omit in production
 */
export async function searchFoodsFromSource(
  user: User,
  query: string,
  deps: FoodSearchSourceDeps = defaultDeps
): Promise<FoodSearchResult[]> {
  const url = deps.getFunctionUrl();
  if (!url) {
    throw new FoodSearchSourceError(
      'configuration',
      'Food search Cloud Function URL is not configured. Set EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL.'
    );
  }

  let idToken: string;
  try {
    idToken = await deps.getIdToken(user);
  } catch {
    throw new FoodSearchSourceError('network', 'Failed to retrieve Firebase ID token.');
  }

  let response: Response;
  try {
    response = await deps.fetchFn(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ query, maxResults: 20 }),
    });
  } catch {
    throw new FoodSearchSourceError('network', 'Network request to food search Cloud Function failed.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new FoodSearchSourceError('unauthenticated', 'Cloud Function rejected Firebase Auth ID token.');
  }

  let body: FoodSearchFunctionResponse;
  try {
    body = (await response.json()) as FoodSearchFunctionResponse;
  } catch {
    throw new FoodSearchSourceError('unknown', 'Cloud Function returned non-JSON body.');
  }

  if (body.error !== undefined || response.status >= 500) {
    throw new FoodSearchSourceError(
      'unknown',
      `Cloud Function error: ${String(body.error ?? response.status)}`
    );
  }

  // Cloud Function returns raw fatsecret food objects; normalize here
  const rawFoods = normalizeFoodArray(body.results ?? []);
  const results = rawFoods
    .map((f) => normalizeFoodSearchResult(f))
    .filter((r): r is FoodSearchResult => r !== null);

  return results;
}
