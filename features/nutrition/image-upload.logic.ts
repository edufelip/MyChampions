/**
 * Image upload progress and retry logic — BL-007.
 * Pure functions for upload state machine, error normalization, and display computation.
 * No Firebase/Expo dependencies — fully unit-testable.
 *
 * Refs: BL-007, FR-213, AC-424, AC-425, BR-261, BR-271, TC-426, TC-427
 * D-057, D-061
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Discriminated union for image upload state machine.
 *
 * Transitions:
 *   idle → uploading (user picks file)
 *   uploading → done | failed (upload completes or errors)
 *   failed → uploading (user retries, if retryable)
 *   done → idle (user removes image)
 */
export type ImageUploadState =
  | { kind: 'idle' }
  | { kind: 'uploading'; progressPercent: number }
  | { kind: 'done'; url: string }
  | { kind: 'failed'; reason: ImageUploadErrorReason };

/**
 * Typed reasons for image upload failure.
 * Used to select user-facing message keys and retry eligibility.
 */
export type ImageUploadErrorReason =
  | 'network'         // Transient connectivity failure — retryable
  | 'storage_quota'   // Cloud Storage quota exceeded — retryable
  | 'file_too_large'  // File exceeds post-compression limit (BR-261) — not retryable; recompress first
  | 'unauthorized'    // Auth token invalid or expired — not retryable; must re-authenticate
  | 'unknown';        // Unclassified failure — treated as retryable (optimistic)

/**
 * Locale key for image upload error messages.
 * Maps to keys in localization bundles (en-US, pt-BR, es-ES).
 */
export type ImageUploadErrorMessageKey =
  | 'custom_meal.image.upload_failed'   // retryable fallback key
  | 'custom_meal.image.file_too_large'  // permanent — user must recompress
  | 'custom_meal.image.unauthorized';   // permanent — user must re-authenticate

/**
 * Computed display state for rendering upload progress, errors, and retry CTA.
 * Consumed by the image picker component in SC-214.
 */
export type ImageUploadDisplay = {
  /** Whether the uploading progress indicator should be shown. */
  showProgress: boolean;
  /** Upload progress 0–100; null when not uploading. */
  progressPercent: number | null;
  /** Whether upload completed successfully. */
  isDone: boolean;
  /** Locale key for the error message; null when no error. */
  errorMessageKey: ImageUploadErrorMessageKey | null;
  /** Whether a retry CTA should be shown. BR-271. */
  canRetry: boolean;
};

// ─── Error normalization ──────────────────────────────────────────────────────

/**
 * Maps an unknown thrown value to a typed ImageUploadErrorReason.
 * Inspects `code` and `message` fields; falls back to 'unknown'.
 * Refs: BR-271
 */
export function normalizeImageUploadError(error: unknown): ImageUploadErrorReason {
  if (typeof error !== 'object' || error === null) {
    return 'unknown';
  }

  const e = error as { code?: unknown; message?: unknown };
  const code = typeof e.code === 'string' ? e.code.toLowerCase() : '';
  const message = typeof e.message === 'string' ? e.message.toLowerCase() : '';

  // File size
  if (
    code === 'file_too_large' ||
    message.includes('file too large') ||
    message.includes('size exceeds')
  ) {
    return 'file_too_large';
  }

  // Unauthorized / permission
  if (
    code.includes('unauthorized') ||
    code.includes('storage/unauthorized') ||
    message.includes('unauthorized') ||
    message.includes('permission denied')
  ) {
    return 'unauthorized';
  }

  // Storage quota
  if (
    code.includes('storage/quota-exceeded') ||
    message.includes('quota exceeded') ||
    message.includes('quota')
  ) {
    return 'storage_quota';
  }

  // Network / transient
  if (
    code.includes('network') ||
    code === 'network_error' ||
    message.includes('network') ||
    message.includes('fetch') ||
    message.includes('timeout')
  ) {
    return 'network';
  }

  return 'unknown';
}

// ─── Retry eligibility ────────────────────────────────────────────────────────

/**
 * Returns true when the given error reason supports a retry action.
 * Non-retryable reasons require user action (recompress, re-authenticate) before retry.
 * Refs: BR-271, AC-424
 */
export function isRetryable(reason: ImageUploadErrorReason): boolean {
  switch (reason) {
    case 'file_too_large':
    case 'unauthorized':
      return false;
    case 'network':
    case 'storage_quota':
    case 'unknown':
      return true;
  }
}

// ─── Error key mapping ────────────────────────────────────────────────────────

/**
 * Maps an upload error reason to the correct locale message key.
 * Refs: BR-271
 */
function mapErrorReasonToMessageKey(reason: ImageUploadErrorReason): ImageUploadErrorMessageKey {
  switch (reason) {
    case 'file_too_large':
      return 'custom_meal.image.file_too_large';
    case 'unauthorized':
      return 'custom_meal.image.unauthorized';
    case 'network':
    case 'storage_quota':
    case 'unknown':
      return 'custom_meal.image.upload_failed';
  }
}

// ─── Display state resolution ─────────────────────────────────────────────────

/**
 * Computes the full display state for the image upload UI component.
 * Called by the image picker widget in SC-214 to determine what to render.
 * Refs: FR-213, AC-424, AC-425
 */
export function resolveImageUploadDisplay(state: ImageUploadState): ImageUploadDisplay {
  switch (state.kind) {
    case 'idle':
      return {
        showProgress: false,
        progressPercent: null,
        isDone: false,
        errorMessageKey: null,
        canRetry: false,
      };

    case 'uploading':
      return {
        showProgress: true,
        progressPercent: state.progressPercent,
        isDone: false,
        errorMessageKey: null,
        canRetry: false,
      };

    case 'done':
      return {
        showProgress: false,
        progressPercent: null,
        isDone: true,
        errorMessageKey: null,
        canRetry: false,
      };

    case 'failed':
      return {
        showProgress: false,
        progressPercent: null,
        isDone: false,
        errorMessageKey: mapErrorReasonToMessageKey(state.reason),
        canRetry: isRetryable(state.reason),
      };
  }
}

// ─── Progress message interpolation ──────────────────────────────────────────

/**
 * Interpolates `{progress}` placeholder in a locale progress template.
 *
 * @example
 *   buildUploadProgressMessage('Uploading... {progress}%', 42) // 'Uploading... 42%'
 *
 * Refs: custom_meal.image.upload_progress locale key
 */
export function buildUploadProgressMessage(template: string, progressPercent: number): string {
  return template.replace('{progress}', String(Math.round(progressPercent)));
}
