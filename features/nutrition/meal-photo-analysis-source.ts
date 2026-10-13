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
  mapPhotoAnalysisWireCode,
  parseMacroEstimateFromResponse,
  type MacroEstimate,
  type PhotoAnalysisErrorReason,
} from './meal-photo-analysis.logic';
import { isSafeRecord, readBoundedString, readOwnField } from '@/features/errors/read-error-fields';

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

const ANALYSIS_ERROR_MESSAGES: Record<PhotoAnalysisErrorReason, string> = {
  permission_denied: 'Meal photo permission was denied.',
  file_too_large: 'Meal photo is too large.',
  unrecognizable_image: 'Meal photo does not contain a recognizable meal.',
  quota_exceeded: 'Meal photo analysis quota was exceeded.',
  network: 'Meal photo analysis network request failed.',
  invalid_response: 'Meal photo analysis returned an invalid response.',
  configuration: 'Meal photo analysis is not configured.',
  unauthenticated: 'Meal photo analysis requires an authenticated session.',
  unknown: 'Meal photo analysis failed.',
};

function makeAnalysisError(reason: PhotoAnalysisErrorReason): PhotoAnalysisSourceError {
  return new PhotoAnalysisSourceError(reason, ANALYSIS_ERROR_MESSAGES[reason]);
}

type ResponseCodeExtraction = {
  code: string | null;
  malformed: boolean;
  hasErrorField: boolean;
  hasFlatCode: boolean;
};

function extractResponseCode(body: object): ResponseCodeExtraction {
  const errorField = readOwnField(body, 'error');
  const flatCodeField = readOwnField(body, 'code');
  let malformed = false;
  const candidates: string[] = [];

  if (errorField.present) {
    if (!errorField.readable) {
      malformed = true;
    } else if (typeof errorField.value === 'string') {
      const code = readBoundedString(errorField.value);
      if (!code) malformed = true;
      else candidates.push(code);
    } else if (isSafeRecord(errorField.value)) {
      const nestedCodeField = readOwnField(errorField.value, 'code');
      if (!nestedCodeField.readable || typeof nestedCodeField.value !== 'string') {
        malformed = true;
      } else {
        const code = readBoundedString(nestedCodeField.value);
        if (!code) malformed = true;
        else candidates.push(code);
      }
    } else {
      malformed = true;
    }
  }

  if (flatCodeField.present) {
    if (!flatCodeField.readable || typeof flatCodeField.value !== 'string') {
      malformed = true;
    } else {
      const code = readBoundedString(flatCodeField.value);
      if (!code) malformed = true;
      else candidates.push(code);
    }
  }

  const distinctCandidates = [...new Set(candidates)];
  if (distinctCandidates.length > 1) malformed = true;

  return {
    code: distinctCandidates[0] ?? null,
    malformed,
    hasErrorField: errorField.present,
    hasFlatCode: flatCodeField.present,
  };
}

function analysisErrorForResponse(
  responseStatus: number,
  body: unknown,
): PhotoAnalysisSourceError | null {
  if (responseStatus === 401 || responseStatus === 403) {
    return makeAnalysisError('unauthenticated');
  }
  if (responseStatus === 413) {
    return makeAnalysisError('file_too_large');
  }
  if (responseStatus === 429) {
    return makeAnalysisError('quota_exceeded');
  }
  if (!isSafeRecord(body)) {
    return makeAnalysisError('invalid_response');
  }

  const extracted = extractResponseCode(body);
  if (extracted.malformed) return makeAnalysisError('invalid_response');

  if (extracted.code !== null) {
    return makeAnalysisError(mapPhotoAnalysisWireCode(extracted.code));
  }

  if (
    extracted.hasErrorField ||
    extracted.hasFlatCode ||
    responseStatus < 200 ||
    responseStatus >= 300
  ) {
    return makeAnalysisError('unknown');
  }

  return null;
}

async function fetchAnalysisEstimate(
  endpoint: string,
  token: string,
  base64Image: string,
  fetchFn: AppFetch,
  invalidJsonMessage: string,
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
    throw new PhotoAnalysisSourceError(
      'network',
      'Network request to meal analysis endpoint failed.',
    );
  }

  // These transport classifications have precedence over any response body,
  // including HTML or an otherwise malformed body.
  if (response.status === 401 || response.status === 403) {
    throw makeAnalysisError('unauthenticated');
  }
  if (response.status === 413) {
    throw makeAnalysisError('file_too_large');
  }
  if (response.status === 429) {
    throw makeAnalysisError('quota_exceeded');
  }

  let body: unknown;
  try {
    body = await response.json();
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
      ANALYSIS_ERROR_MESSAGES.invalid_response,
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
  deps?: Partial<MealPhotoAnalysisSourceDeps>,
): Promise<MacroEstimate> {
  const getServerBaseUrl = deps?.getServerBaseUrl ?? defaultGetServerBaseUrl;
  const getCurrentAccessToken = deps?.getCurrentAccessToken ?? defaultGetCurrentAccessToken;
  const fetchFn = deps?.fetchFn ?? defaultAppFetch;

  const serverBaseUrl = getServerBaseUrl()?.replace(/\/+$/, '');
  if (!serverBaseUrl) {
    throw new PhotoAnalysisSourceError(
      'configuration',
      'MyChampions server URL is not configured. Set EXPO_PUBLIC_MYCHAMPIONS_SERVER_URL.',
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
    'MyChampions server returned non-JSON body.',
  );
}
