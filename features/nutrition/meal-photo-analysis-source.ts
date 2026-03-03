/**
 * AI meal photo analysis source — HTTP call to Firebase Cloud Function proxy.
 * The Cloud Function validates Firebase Auth ID token and calls OpenAI GPT-4o Vision.
 * API key is never in client binary; it lives only in Cloud Function env (D-106, BR-289).
 * Refs: BL-108, D-106–D-110, FR-231, FR-237, BR-287–BR-290
 *
 * Injectable deps pattern mirrors food-search-source.ts for testability (TC-285).
 */

import type { User } from 'firebase/auth';

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
  /** Returns the Cloud Function URL. Throws PhotoAnalysisSourceError('configuration') when missing. */
  getFunctionUrl: () => string;
  /** Returns the Firebase Auth ID token. Throws on failure. */
  getIdToken: (user: User) => Promise<string>;
  /** fetch implementation. Defaults to global fetch. */
  fetchFn: typeof fetch;
};

function defaultGetFunctionUrl(): string {
  const url = process.env['EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL'];
  if (!url) {
    throw new PhotoAnalysisSourceError(
      'configuration',
      'Meal analysis Cloud Function URL is not configured. Set EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL.'
    );
  }
  return url;
}

async function defaultGetIdToken(user: User): Promise<string> {
  return user.getIdToken();
}

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Sends a base64-encoded JPEG image to the Firebase Cloud Function proxy and
 * returns a MacroEstimate on success.
 *
 * Throws PhotoAnalysisSourceError with typed PhotoAnalysisErrorReason on all failure paths.
 * Injectable deps allow full unit-test coverage without network access.
 */
export async function analyzeMealPhoto(
  user: User,
  base64Image: string,
  deps?: Partial<MealPhotoAnalysisSourceDeps>
): Promise<MacroEstimate> {
  const getFunctionUrl = deps?.getFunctionUrl ?? defaultGetFunctionUrl;
  const getIdToken = deps?.getIdToken ?? defaultGetIdToken;
  const fetchFn = deps?.fetchFn ?? fetch;

  const endpoint = getFunctionUrl(); // throws 'configuration' if not set

  let idToken: string;
  try {
    idToken = await getIdToken(user);
  } catch {
    // Any failure retrieving the ID token is a network-adjacent auth failure.
    throw new PhotoAnalysisSourceError('network', 'Failed to retrieve Firebase ID token.');
  }

  let response: Response;
  try {
    response = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ image: base64Image, mimeType: 'image/jpeg' }),
    });
  } catch {
    // Network-level failure (no connectivity, DNS failure, etc.) — always 'network'.
    throw new PhotoAnalysisSourceError('network', 'Network request to analysis Cloud Function failed.');
  }

  // 401: Firebase ID token rejected (expired / invalid).
  // 403: Firebase Admin SDK rejected for another auth reason (deleted user, etc.).
  if (response.status === 401 || response.status === 403) {
    throw new PhotoAnalysisSourceError('unauthenticated', 'Cloud Function rejected Auth ID token.');
  }

  let body: RawAnalysisResponse;
  try {
    body = (await response.json()) as RawAnalysisResponse;
  } catch {
    throw new PhotoAnalysisSourceError('invalid_response', 'Cloud Function returned non-JSON body.');
  }

  // Cloud Function signals known domain errors via body.error field.
  if (body.error === 'unrecognizable_image') {
    throw new PhotoAnalysisSourceError('unrecognizable_image', 'Image does not contain a recognizable meal.');
  }
  if (body.error === 'quota_exceeded' || response.status === 429) {
    throw new PhotoAnalysisSourceError('quota_exceeded', 'OpenAI quota exceeded. Try again later.');
  }
  if (body.error !== undefined || response.status >= 500) {
    throw new PhotoAnalysisSourceError('unknown', `Cloud Function error: ${String(body.error ?? response.status)}`);
  }

  const estimate = parseMacroEstimateFromResponse(body);
  if (!estimate) {
    throw new PhotoAnalysisSourceError(
      'invalid_response',
      'Cloud Function response did not match expected macro estimate shape.'
    );
  }

  return estimate;
}
