/**
 * AI meal photo analysis source — HTTP call to the MyChampions server.
 * The server validates the local bearer token and calls the configured analyzer provider.
 * Provider API keys are never in the client binary; they live only in server-side config (D-106, BR-289).
 * Refs: BL-108, D-106–D-110, FR-231, FR-237, BR-287–BR-290
 *
 * Injectable deps pattern mirrors food-search-source.ts for testability (TC-285).
 */

import type { AuthUser } from '../auth/auth-user';
import { getValidServerAccessToken } from '../auth/server-auth-source';
import { defaultAppFetch } from '../platform/default-app-fetch';
import {
  parseMacroEstimateFromResponse,
  type MacroEstimate,
  type PhotoAnalysisErrorReason,
  type RawAnalysisResponse,
} from './meal-photo-analysis.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

export class PhotoAnalysisSourceError extends Error {
  /** Strongly-typed reason code — never a loose string. */
  code: PhotoAnalysisErrorReason;

  constructor(code: PhotoAnalysisErrorReason, message: string) {
    super(message);
    this.code = code;
    this.name = 'PhotoAnalysisSourceError';
  }
}

// ─── Injectable deps ──────────────────────────────────────────────────────────

export type MealPhotoAnalysisSourceDeps = {
  /** Returns the local MyChampions server base URL. Missing config fails closed. */
  getServerBaseUrl: () => string | undefined;
  /** Returns the local MyChampions server bearer token. Missing auth fails closed. */
  getCurrentAccessToken: () => Promise<string | null>;
  /** fetch implementation. Defaults to global fetch. */
  fetchFn: AppFetch;
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

async function defaultGetCurrentAccessToken(): Promise<string | null> {
  return getValidServerAccessToken();
}

function analysisErrorForResponse(responseStatus: number, body: RawAnalysisResponse): PhotoAnalysisSourceError | null {
  if (responseStatus === 401 || responseStatus === 403) {
    return new PhotoAnalysisSourceError('unauthenticated', 'Meal analysis endpoint rejected bearer token.');
  }
  if (body.error === 'unrecognizable_image') {
    return new PhotoAnalysisSourceError('unrecognizable_image', 'Image does not contain a recognizable meal.');
  }
  if (body.error === 'quota_exceeded' || responseStatus === 429) {
    return new PhotoAnalysisSourceError('quota_exceeded', 'Meal analysis quota exceeded. Try again later.');
  }
  if (body.error === 'configuration') {
    return new PhotoAnalysisSourceError('configuration', 'Meal analysis endpoint is not configured.');
  }
  if (body.error !== undefined || responseStatus >= 500) {
    return new PhotoAnalysisSourceError(
      body.error === 'invalid_response' ? 'invalid_response' : 'unknown',
      `Meal analysis endpoint error: ${String(body.error ?? responseStatus)}`
    );
  }
  return null;
}

async function fetchAnalysisEstimate(
  endpoint: string,
  token: string,
  base64Image: string,
  fetchFn: AppFetch,
  invalidJsonMessage: string
): Promise<MacroEstimate> {
  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ image: base64Image, mimeType: 'image/jpeg' }),
    });
  } catch {
    throw new PhotoAnalysisSourceError('network', 'Network request to meal analysis endpoint failed.');
  }

  if (response.status === 401 || response.status === 403) {
    throw new PhotoAnalysisSourceError('unauthenticated', 'Meal analysis endpoint rejected bearer token.');
  }

  let body: RawAnalysisResponse;
  try {
    body = (await response.json()) as RawAnalysisResponse;
  } catch {
    throw new PhotoAnalysisSourceError('invalid_response', invalidJsonMessage);
  }

  const responseError = analysisErrorForResponse(response.status, body);
  if (responseError) {
    throw responseError;
  }

  const estimate = parseMacroEstimateFromResponse(body);
  if (!estimate) {
    throw new PhotoAnalysisSourceError(
      'invalid_response',
      'Meal analysis endpoint response did not match expected macro estimate shape.'
    );
  }

  return estimate;
}

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Sends a base64-encoded JPEG image to the MyChampions server and
 * returns a MacroEstimate on success.
 *
 * Throws PhotoAnalysisSourceError with typed PhotoAnalysisErrorReason on all failure paths.
 * Injectable deps allow full unit-test coverage without network access.
 */
export async function analyzeMealPhoto(
  _user: AuthUser,
  base64Image: string,
  deps?: Partial<MealPhotoAnalysisSourceDeps>
): Promise<MacroEstimate> {
  const getServerBaseUrl = deps?.getServerBaseUrl ?? defaultGetServerBaseUrl;
  const getCurrentAccessToken = deps?.getCurrentAccessToken ?? defaultGetCurrentAccessToken;
  const fetchFn = deps?.fetchFn ?? defaultAppFetch;

  const serverBaseUrl = getServerBaseUrl()?.replace(/\/+$/, '');
  if (!serverBaseUrl) {
    throw new PhotoAnalysisSourceError(
      'configuration',
      'MyChampions server URL is not configured. Set EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL.'
    );
  }

  const serverAccessToken = await getCurrentAccessToken();
  if (!serverAccessToken) {
    throw new PhotoAnalysisSourceError('unauthenticated', 'No authenticated server token found.');
  }

  return fetchAnalysisEstimate(
    `${serverBaseUrl}/nutrition/meal-photo-analysis`,
    serverAccessToken,
    base64Image,
    fetchFn,
    'MyChampions server returned non-JSON body.'
  );
}
