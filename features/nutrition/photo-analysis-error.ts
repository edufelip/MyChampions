import { readBoundedString, readOwnField } from '@/features/errors/read-error-fields';

export const PHOTO_ANALYSIS_ERROR_REASONS = [
  'permission_denied',
  'file_too_large',
  'unrecognizable_image',
  'quota_exceeded',
  'network',
  'invalid_response',
  'configuration',
  'unauthenticated',
  'unknown',
] as const;

export type PhotoAnalysisErrorReason = (typeof PHOTO_ANALYSIS_ERROR_REASONS)[number];

const PHOTO_ANALYSIS_ERROR_REASON_SET = new Set<string>(PHOTO_ANALYSIS_ERROR_REASONS);

function mapCode(code: string | null, allowWireUnauthorized: boolean): PhotoAnalysisErrorReason {
  if (code === 'photo_permission_denied') return 'permission_denied';
  if (code === 'NETWORK_ERROR') return 'network';
  if (allowWireUnauthorized && code === 'unauthorized') return 'unauthenticated';
  if (code && PHOTO_ANALYSIS_ERROR_REASON_SET.has(code)) {
    return code as PhotoAnalysisErrorReason;
  }
  return 'unknown';
}

/**
 * Normalizes errors from the picker/compression/runtime boundary.  Only an
 * explicit code is trusted; human-readable messages have no classification
 * authority.
 */
export function normalizePhotoAnalysisError(error: unknown): PhotoAnalysisErrorReason {
  const codeField = readOwnField(error, 'code');
  const code = codeField.readable ? readBoundedString(codeField.value) : null;
  return mapCode(code, false);
}

/** Maps the exact codes accepted in the meal-photo HTTP response envelope. */
export function mapPhotoAnalysisWireCode(code: string): PhotoAnalysisErrorReason {
  return mapCode(code, true);
}
