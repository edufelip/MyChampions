/**
 * Pure fatsecret HTTP helpers — token fetch with cache and food search.
 * Extracted from index.ts to be unit-testable without Firebase Admin or
 * Cloud Function framework dependencies.
 *
 * All functions accept an injectable fetchFn so tests can mock network calls.
 * Refs: D-127, FR-243, TC-283
 */

// ─── Token cache ──────────────────────────────────────────────────────────────

export type TokenCache = {
  accessToken: string;
  expiresAt: number; // Unix ms
};

export const TOKEN_URL = 'https://oauth.fatsecret.com/connect/token';
export const SEARCH_URL = 'https://platform.fatsecret.com/rest/server.api';

/** Refresh 1 hour before the 24-hour token expiry. */
export const TOKEN_TTL_MARGIN_MS = 60 * 60 * 1000;

// ─── Deps injection type ──────────────────────────────────────────────────────

export type FatsecretHelpersDeps = {
  fetchFn: typeof fetch;
  now: () => number;
};

export const defaultHelpersDeps: FatsecretHelpersDeps = {
  fetchFn: fetch,
  now: Date.now,
};

// ─── Token fetch ──────────────────────────────────────────────────────────────

/**
 * Fetches an OAuth 2.0 Client Credentials Bearer token from fatsecret.
 * Returns the cached token if still valid; otherwise fetches a new one and
 * updates the cache in-place.
 *
 * @param clientId     fatsecret client ID
 * @param clientSecret fatsecret client secret
 * @param cache        mutable cache object (pass the module-level `tokenCache`)
 * @param deps         injectable deps (fetchFn, now)
 */
export async function getFatsecretToken(
  clientId: string,
  clientSecret: string,
  cache: { value: TokenCache | null },
  deps: FatsecretHelpersDeps = defaultHelpersDeps
): Promise<string> {
  const now = deps.now();
  if (cache.value && cache.value.expiresAt > now) {
    return cache.value.accessToken;
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await deps.fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=basic',
  });

  if (!response.ok) {
    throw new Error(`fatsecret token request failed: ${response.status}`);
  }

  const body = (await response.json()) as { access_token: string; expires_in: number };
  const expiresAt = now + body.expires_in * 1000 - TOKEN_TTL_MARGIN_MS;

  cache.value = { accessToken: body.access_token, expiresAt };
  return body.access_token;
}

// ─── Food search ──────────────────────────────────────────────────────────────

/**
 * Calls the fatsecret Platform API foods.search endpoint.
 * Returns a normalized array of raw food objects (single-result → array handled here).
 *
 * @param token      Valid fatsecret Bearer token
 * @param query      Search expression
 * @param maxResults Maximum number of results (1–50)
 * @param fetchFn    Injectable fetch implementation
 */
export async function searchFatsecret(
  token: string,
  query: string,
  maxResults: number,
  fetchFn: typeof fetch = fetch
): Promise<unknown[]> {
  const params = new URLSearchParams({
    method: 'foods.search',
    search_expression: query,
    format: 'json',
    max_results: String(maxResults),
  });

  const response = await fetchFn(`${SEARCH_URL}?${params.toString()}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(`fatsecret search request failed: ${response.status}`);
  }

  const body = (await response.json()) as {
    foods_search?: { results?: { food?: unknown } };
    error?: { message: string };
  };

  if (body.error) {
    throw new Error(`fatsecret API error: ${body.error.message}`);
  }

  const food = body.foods_search?.results?.food;
  if (!food) return [];

  // fatsecret returns a single object (not array) when there is exactly 1 result
  return Array.isArray(food) ? food : [food];
}
