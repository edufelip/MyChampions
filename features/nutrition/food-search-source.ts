/**
 * fatsecret food search source — Direct integration with fatsecret Platform API v2.
 *
 * This implementation replaces the previous Cloud Function proxy.
 * It handles OAuth 2.0 Client Credentials flow locally in the client.
 *
 * Pattern: OAuth 2.0 Client Credentials + foods.search.v2
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

// ─── Constants ────────────────────────────────────────────────────────────────

const OAUTH_URL = 'https://oauth.fatsecret.com/connect/token';
const API_URL = 'https://platform.fatsecret.com/rest/foods/search/v2';

// ─── Injectable deps (for testability) ───────────────────────────────────────

export type FoodSearchSourceDeps = {
  getClientId: () => string | undefined;
  getClientSecret: () => string | undefined;
  fetchFn: typeof fetch;
};

const defaultDeps: FoodSearchSourceDeps = {
  getClientId: () => process.env['EXPO_PUBLIC_FATSECRET_CLIENT_ID'],
  getClientSecret: () => process.env['EXPO_PUBLIC_FATSECRET_CLIENT_SECRET'],
  fetchFn: fetch,
};

// ─── Token Management ────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiry: number = 0;
let tokenPromise: Promise<string> | null = null;

// Safe base64 encode for environments without btoa (e.g. bare React Native)
function encodeBase64(str: string): string {
  if (typeof btoa === 'function') return btoa(str);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let out = '', i = 0, len = str.length;
  while (i < len) {
    const c1 = str.charCodeAt(i++) & 0xff;
    if (i === len) { out += chars.charAt(c1 >> 2) + chars.charAt((c1 & 0x3) << 4) + '=='; break; }
    const c2 = str.charCodeAt(i++);
    if (i === len) { out += chars.charAt(c1 >> 2) + chars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4)) + chars.charAt((c2 & 0xf) << 2) + '='; break; }
    const c3 = str.charCodeAt(i++);
    out += chars.charAt(c1 >> 2) + chars.charAt(((c1 & 0x3) << 4) | ((c2 & 0xf0) >> 4)) + chars.charAt(((c2 & 0xf) << 2) | ((c3 & 0xc0) >> 6)) + chars.charAt(c3 & 0x3f);
  }
  return out;
}

async function getAccessToken(deps: FoodSearchSourceDeps): Promise<string> {
  const now = Date.now();
  // Buffer of 60 seconds
  if (cachedToken && now < tokenExpiry - 60000) {
    return cachedToken;
  }

  // Deduplicate concurrent token requests
  if (tokenPromise) {
    return tokenPromise;
  }

  const clientId = deps.getClientId();
  const clientSecret = deps.getClientSecret();

  if (!clientId || !clientSecret) {
    throw new FoodSearchSourceError(
      'configuration',
      'FatSecret credentials not configured. Set EXPO_PUBLIC_FATSECRET_CLIENT_ID and EXPO_PUBLIC_FATSECRET_CLIENT_SECRET.'
    );
  }

  tokenPromise = (async () => {
    try {
      const authHeader = encodeBase64(`${clientId}:${clientSecret}`);
      const response = await deps.fetchFn(OAUTH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${authHeader}`,
        },
        body: 'grant_type=client_credentials&scope=basic',
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        console.error('[FoodSearchSource] OAuth failed:', response.status, errText);
        throw new FoodSearchSourceError('unauthenticated', 'Failed to authenticate with FatSecret.');
      }

      const data = await response.json();
      cachedToken = data.access_token;
      tokenExpiry = Date.now() + data.expires_in * 1000;

      return cachedToken!;
    } catch (err) {
      console.error('[FoodSearchSource] OAuth fetch exception:', err);
      if (err instanceof FoodSearchSourceError) throw err;
      throw new FoodSearchSourceError('network', 'Could not connect to FatSecret Auth service.');
    } finally {
      tokenPromise = null;
    }
  })();

  return tokenPromise;
}

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Calls the FatSecret Platform API directly to search food database.
 * Returns an array of FoodSearchResult normalized to per-100g macros.
 *
 * @param query   - Search expression forwarded to fatsecret foods.search
 * @param deps    - Injectable dependencies; omit in production
 */
export async function searchFoodsFromSource(
  query: string,
  deps: FoodSearchSourceDeps = defaultDeps
): Promise<FoodSearchResult[]> {
  console.log('[searchFoodsFromSource] Starting search for:', query);

  try {
    const accessToken = await getAccessToken(deps);

    const searchUrl = `${API_URL}?search_expression=${encodeURIComponent(query)}&format=json&max_results=20`;
    
    console.log('[searchFoodsFromSource] Fetching from API:', searchUrl);
    const response = await deps.fetchFn(searchUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    console.log('[searchFoodsFromSource] HTTP Status:', response.status);

    if (response.status === 401 || response.status === 403) {
      cachedToken = null; // Clear possibly expired token
      throw new FoodSearchSourceError('unauthenticated', 'FatSecret API token rejected.');
    }

    if (!response.ok) {
      throw new FoodSearchSourceError('unknown', `FatSecret API returned error status: ${response.status}`);
    }

    const data = await response.json();
    
    // Check for FatSecret specific error response structure
    if (data.error) {
      console.error('[searchFoodsFromSource] API level error:', data.error);
      if (data.error.code === '13') { // Example quota error code for FatSecret
        throw new FoodSearchSourceError('quota', 'FatSecret API quota exceeded.');
      }
      throw new FoodSearchSourceError('unknown', data.error.message || 'FatSecret API error');
    }

    // FatSecret v2 search response structure: data.foods.food
    const rawResults = data?.foods?.food;
    const rawFoods = normalizeFoodArray(rawResults ?? []);
    console.log('[searchFoodsFromSource] Raw foods count:', rawFoods.length);

    const results = rawFoods
      .map((f) => normalizeFoodSearchResult(f))
      .filter((r): r is FoodSearchResult => r !== null);

    console.log('[searchFoodsFromSource] Final normalized results count:', results.length);
    return results;

  } catch (err) {
    if (err instanceof FoodSearchSourceError) throw err;
    console.error('[searchFoodsFromSource] Unexpected error:', err);
    throw new FoodSearchSourceError('unknown', 'An unexpected error occurred during food search.');
  }
}
