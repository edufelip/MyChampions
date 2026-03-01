/**
 * AI meal photo analysis source — HTTP call to Firebase Cloud Function proxy.
 * The Cloud Function validates Firebase Auth ID token and calls OpenAI GPT-4o Vision.
 * API key is never in client binary; it lives only in Cloud Function env (D-106, BR-289).
 * Refs: BL-108, D-106–D-110, FR-231, FR-237, BR-287–BR-290
 */

import type { User } from 'firebase/auth';

import {
  parseMacroEstimateFromResponse,
  normalizePhotoAnalysisError,
  type MacroEstimate,
  type RawAnalysisResponse,
} from './meal-photo-analysis.logic';

// ─── Error type ───────────────────────────────────────────────────────────────

export class PhotoAnalysisSourceError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'PhotoAnalysisSourceError';
  }
}

// ─── Config resolution ────────────────────────────────────────────────────────

function resolveEndpoint(): string {
  // EXPO_PUBLIC_ prefix makes this available client-side via process.env (Expo).
  // The Cloud Function URL itself is not secret; only the OpenAI key on the server is.
  const url = process.env['EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL'];
  if (!url) {
    throw new PhotoAnalysisSourceError(
      'configuration',
      'Meal analysis Cloud Function URL is not configured. Set EXPO_PUBLIC_MEAL_ANALYSIS_FUNCTION_URL.'
    );
  }
  return url;
}

// ─── Source call ──────────────────────────────────────────────────────────────

/**
 * Sends a base64-encoded JPEG image to the Firebase Cloud Function proxy and
 * returns a MacroEstimate on success.
 *
 * Throws PhotoAnalysisSourceError with typed code on all failure paths.
 */
export async function analyzeMealPhoto(
  user: User,
  base64Image: string
): Promise<MacroEstimate> {
  const endpoint = resolveEndpoint(); // throws 'configuration' if not set

  let idToken: string;
  try {
    idToken = await user.getIdToken();
  } catch {
    throw new PhotoAnalysisSourceError('network', 'Failed to retrieve Firebase ID token.');
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ image: base64Image, mimeType: 'image/jpeg' }),
    });
  } catch (fetchError) {
    // Network-level failure (no connectivity, DNS failure, etc.)
    const reason = normalizePhotoAnalysisError(fetchError);
    throw new PhotoAnalysisSourceError(reason, 'Network request to analysis Cloud Function failed.');
  }

  if (response.status === 401) {
    throw new PhotoAnalysisSourceError('configuration', 'Cloud Function rejected Auth ID token.');
  }

  let body: RawAnalysisResponse;
  try {
    body = (await response.json()) as RawAnalysisResponse;
  } catch {
    throw new PhotoAnalysisSourceError('invalid_response', 'Cloud Function returned non-JSON body.');
  }

  // Cloud Function signals known domain errors via body.error field
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
