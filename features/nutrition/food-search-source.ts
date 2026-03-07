/**
 * fatsecret food search source — HTTP call to Firebase Cloud Function proxy.
 *
 * This implementation replaces the direct OAuth integration to avoid IP restriction
 * issues and securely hide API credentials on the server.
 *
 * Pattern: Cloud Function proxy + foods.search.v2
 * Refs: D-113, D-127, BL-106, FR-243
 */

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
  getFunctionUrl: () => string | undefined;
  fetchFn: typeof fetch;
};

const defaultDeps: FoodSearchSourceDeps = {
  getFunctionUrl: () => process.env['EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL'],
  fetchFn: fetch,
};

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Calls the Firebase Cloud Function proxy to search the food database.
 * Returns an array of FoodSearchResult normalized to per-100g macros.
 *
 * @param user    - Authenticated Firebase user with getIdToken capability
 * @param query   - Search expression forwarded to fatsecret foods.search
 * @param deps    - Injectable dependencies; omit in production
 */
export async function searchFoodsFromSource(
  user: { getIdToken: () => Promise<string> } | null,
  query: string,
  deps: FoodSearchSourceDeps = defaultDeps
): Promise<FoodSearchResult[]> {
  console.log('[searchFoodsFromSource] Starting proxy search for:', query);

  const endpoint = deps.getFunctionUrl();
  if (!endpoint) {
    throw new FoodSearchSourceError(
      'configuration',
      'Food search Cloud Function URL is not configured. Set EXPO_PUBLIC_FOOD_SEARCH_FUNCTION_URL.'
    );
  }

  if (!user) {
    throw new FoodSearchSourceError('unauthenticated', 'No active user found.');
  }

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch (err) {
    console.error('[searchFoodsFromSource] Failed to get ID token:', err);
    throw new FoodSearchSourceError('unauthenticated', 'Failed to retrieve Firebase ID token.');
  }

  let response: Response;
  try {
    console.log('[searchFoodsFromSource] Fetching from Proxy:', endpoint);
    response = await deps.fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ query, maxResults: 20 }),
    });
  } catch (err) {
    console.error('[searchFoodsFromSource] Proxy network error:', err);
    throw new FoodSearchSourceError('network', 'Could not connect to food search proxy.');
  }

  console.log('[searchFoodsFromSource] HTTP Status:', response.status);

  if (response.status === 401 || response.status === 403) {
    throw new FoodSearchSourceError('unauthenticated', 'Proxy rejected Auth ID token.');
  }

  if (!response.ok) {
    throw new FoodSearchSourceError('unknown', `Proxy returned error status: ${response.status}`);
  }

  let data: { results?: unknown[], error?: string };
  try {
    data = await response.json();
  } catch {
    throw new FoodSearchSourceError('unknown', 'Proxy returned non-JSON body.');
  }

  if (data.error) {
    console.error('[searchFoodsFromSource] Proxy API error:', data.error);
    if (data.error === 'quota_exceeded') {
      throw new FoodSearchSourceError('quota', 'API quota exceeded.');
    }
    throw new FoodSearchSourceError('unknown', data.error);
  }

  const rawResults = data.results ?? [];
  const rawFoods = normalizeFoodArray(rawResults);
  console.log('[searchFoodsFromSource] Raw foods count:', rawFoods.length);

  const results = rawFoods
    .map((f) => normalizeFoodSearchResult(f))
    .filter((r): r is FoodSearchResult => r !== null);

  console.log('[searchFoodsFromSource] Final normalized results count:', results.length);
  return results;
}
