/**
 * Unit tests for image-upload.logic.ts — BL-007 image upload progress + retry UX.
 *
 * TDD: tests written before implementation.
 * Tests cover:
 *   - ImageUploadState transitions
 *   - normalizeImageUploadError: error-to-reason mapping
 *   - isRetryable: which reasons allow retry
 *   - resolveImageUploadDisplay: UI state computation (progress %, message key, retry)
 *   - buildUploadProgressMessage: interpolation helper
 *
 * Runner: node:test + node:assert/strict (npm run test:unit)
 * Refs: BL-007, FR-213, AC-424, AC-425, BR-271, TC-426, TC-427
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeImageUploadError,
  isRetryable,
  resolveImageUploadDisplay,
  buildUploadProgressMessage,
  type ImageUploadState,
  type ImageUploadErrorReason,
} from './image-upload.logic';

// ─── normalizeImageUploadError ─────────────────────────────────────────────────

describe('normalizeImageUploadError', () => {
  // --- Network errors ---

  it('returns "network" for network-related error message', () => {
    assert.equal(normalizeImageUploadError({ message: 'network error occurred' }), 'network');
  });

  it('returns "network" for fetch-related error message', () => {
    assert.equal(normalizeImageUploadError({ message: 'fetch failed' }), 'network');
  });

  it('returns "network" for timeout error message', () => {
    assert.equal(normalizeImageUploadError({ message: 'request timeout' }), 'network');
  });

  it('returns "network" for NETWORK_ERROR code', () => {
    assert.equal(normalizeImageUploadError({ code: 'NETWORK_ERROR' }), 'network');
  });

  // --- Storage quota errors ---

  it('returns "storage_quota" for quota-exceeded message', () => {
    assert.equal(normalizeImageUploadError({ message: 'quota exceeded' }), 'storage_quota');
  });

  it('returns "storage_quota" for storage/quota-exceeded firebase code', () => {
    assert.equal(normalizeImageUploadError({ code: 'storage/quota-exceeded' }), 'storage_quota');
  });

  // --- File size limit violations ---

  it('returns "file_too_large" for file-too-large message', () => {
    assert.equal(normalizeImageUploadError({ message: 'file too large' }), 'file_too_large');
  });

  it('returns "file_too_large" for size exceeds message', () => {
    assert.equal(normalizeImageUploadError({ message: 'size exceeds limit' }), 'file_too_large');
  });

  it('returns "file_too_large" for FILE_TOO_LARGE code', () => {
    assert.equal(normalizeImageUploadError({ code: 'FILE_TOO_LARGE' }), 'file_too_large');
  });

  // --- Unauthorized errors ---

  it('returns "unauthorized" for unauthorized message', () => {
    assert.equal(normalizeImageUploadError({ message: 'unauthorized access' }), 'unauthorized');
  });

  it('returns "unauthorized" for storage/unauthorized firebase code', () => {
    assert.equal(normalizeImageUploadError({ code: 'storage/unauthorized' }), 'unauthorized');
  });

  it('returns "unauthorized" for permission denied message', () => {
    assert.equal(normalizeImageUploadError({ message: 'permission denied' }), 'unauthorized');
  });

  // --- Unknown fallback ---

  it('returns "unknown" for null input', () => {
    assert.equal(normalizeImageUploadError(null), 'unknown');
  });

  it('returns "unknown" for undefined input', () => {
    assert.equal(normalizeImageUploadError(undefined), 'unknown');
  });

  it('returns "unknown" for empty object', () => {
    assert.equal(normalizeImageUploadError({}), 'unknown');
  });

  it('returns "unknown" for string input', () => {
    assert.equal(normalizeImageUploadError('some error'), 'unknown');
  });

  it('returns "unknown" for number input', () => {
    assert.equal(normalizeImageUploadError(42), 'unknown');
  });

  it('returns "unknown" for unrecognised code', () => {
    assert.equal(normalizeImageUploadError({ code: 'SOME_RANDOM_CODE' }), 'unknown');
  });

  it('returns "unknown" for unrecognised message', () => {
    assert.equal(normalizeImageUploadError({ message: 'something went completely wrong' }), 'unknown');
  });

  // --- Case insensitivity ---

  it('is case-insensitive for message matching', () => {
    assert.equal(normalizeImageUploadError({ message: 'NETWORK ERROR' }), 'network');
    assert.equal(normalizeImageUploadError({ message: 'Quota Exceeded' }), 'storage_quota');
  });
});

// ─── isRetryable ──────────────────────────────────────────────────────────────

describe('isRetryable', () => {
  // Retryable reasons (transient, user can resolve or retry)
  it('returns true for "network"', () => {
    assert.equal(isRetryable('network'), true);
  });

  it('returns true for "storage_quota"', () => {
    assert.equal(isRetryable('storage_quota'), true);
  });

  it('returns true for "unknown" (optimistic — allow retry for unknown errors)', () => {
    assert.equal(isRetryable('unknown'), true);
  });

  // Non-retryable reasons (structural issues user cannot fix by retrying)
  it('returns false for "file_too_large" (user must recompress)', () => {
    assert.equal(isRetryable('file_too_large'), false);
  });

  it('returns false for "unauthorized" (user must re-authenticate)', () => {
    assert.equal(isRetryable('unauthorized'), false);
  });
});

// ─── resolveImageUploadDisplay ────────────────────────────────────────────────

describe('resolveImageUploadDisplay', () => {
  // --- idle state ---

  it('idle: showProgress=false, errorKey=null, canRetry=false', () => {
    const display = resolveImageUploadDisplay({ kind: 'idle' });
    assert.equal(display.showProgress, false);
    assert.equal(display.progressPercent, null);
    assert.equal(display.errorMessageKey, null);
    assert.equal(display.canRetry, false);
    assert.equal(display.isDone, false);
  });

  // --- uploading state ---

  it('uploading: showProgress=true, progressPercent matches, no error, canRetry=false', () => {
    const display = resolveImageUploadDisplay({ kind: 'uploading', progressPercent: 45 });
    assert.equal(display.showProgress, true);
    assert.equal(display.progressPercent, 45);
    assert.equal(display.errorMessageKey, null);
    assert.equal(display.canRetry, false);
    assert.equal(display.isDone, false);
  });

  it('uploading at 0%: progressPercent=0', () => {
    const display = resolveImageUploadDisplay({ kind: 'uploading', progressPercent: 0 });
    assert.equal(display.progressPercent, 0);
  });

  it('uploading at 100%: progressPercent=100', () => {
    const display = resolveImageUploadDisplay({ kind: 'uploading', progressPercent: 100 });
    assert.equal(display.progressPercent, 100);
  });

  // --- done state ---

  it('done: showProgress=false, isDone=true, no error, canRetry=false', () => {
    const display = resolveImageUploadDisplay({ kind: 'done', url: 'https://cdn.example.com/img.jpg' });
    assert.equal(display.showProgress, false);
    assert.equal(display.isDone, true);
    assert.equal(display.errorMessageKey, null);
    assert.equal(display.canRetry, false);
  });

  // --- failed state: network (retryable) ---

  it('failed/network: errorMessageKey=custom_meal.image.upload_failed, canRetry=true', () => {
    const display = resolveImageUploadDisplay({ kind: 'failed', reason: 'network' });
    assert.equal(display.showProgress, false);
    assert.equal(display.isDone, false);
    assert.equal(display.errorMessageKey, 'custom_meal.image.upload_failed');
    assert.equal(display.canRetry, true);
  });

  it('failed/storage_quota: errorMessageKey=custom_meal.image.upload_failed, canRetry=true', () => {
    const display = resolveImageUploadDisplay({ kind: 'failed', reason: 'storage_quota' });
    assert.equal(display.errorMessageKey, 'custom_meal.image.upload_failed');
    assert.equal(display.canRetry, true);
  });

  it('failed/unknown: errorMessageKey=custom_meal.image.upload_failed, canRetry=true', () => {
    const display = resolveImageUploadDisplay({ kind: 'failed', reason: 'unknown' });
    assert.equal(display.errorMessageKey, 'custom_meal.image.upload_failed');
    assert.equal(display.canRetry, true);
  });

  // --- failed state: non-retryable ---

  it('failed/file_too_large: errorMessageKey=custom_meal.image.file_too_large, canRetry=false', () => {
    const display = resolveImageUploadDisplay({ kind: 'failed', reason: 'file_too_large' });
    assert.equal(display.errorMessageKey, 'custom_meal.image.file_too_large');
    assert.equal(display.canRetry, false);
  });

  it('failed/unauthorized: errorMessageKey=custom_meal.image.unauthorized, canRetry=false', () => {
    const display = resolveImageUploadDisplay({ kind: 'failed', reason: 'unauthorized' });
    assert.equal(display.errorMessageKey, 'custom_meal.image.unauthorized');
    assert.equal(display.canRetry, false);
  });

  // --- progressPercent in failed/done/idle is null ---

  it('failed: progressPercent=null', () => {
    const display = resolveImageUploadDisplay({ kind: 'failed', reason: 'network' });
    assert.equal(display.progressPercent, null);
  });

  it('done: progressPercent=null', () => {
    const display = resolveImageUploadDisplay({ kind: 'done', url: 'https://x.com/y.jpg' });
    assert.equal(display.progressPercent, null);
  });
});

// ─── buildUploadProgressMessage ───────────────────────────────────────────────

describe('buildUploadProgressMessage', () => {
  it('interpolates {progress} with the given percent', () => {
    const template = 'Uploading image... {progress}%';
    assert.equal(buildUploadProgressMessage(template, 42), 'Uploading image... 42%');
  });

  it('replaces {progress} at 0%', () => {
    const template = 'Uploading image... {progress}%';
    assert.equal(buildUploadProgressMessage(template, 0), 'Uploading image... 0%');
  });

  it('replaces {progress} at 100%', () => {
    const template = 'Uploading image... {progress}%';
    assert.equal(buildUploadProgressMessage(template, 100), 'Uploading image... 100%');
  });

  it('handles template without {progress} placeholder gracefully (returns template unchanged)', () => {
    const template = 'Uploading...';
    assert.equal(buildUploadProgressMessage(template, 55), 'Uploading...');
  });

  it('handles integer progress values (rounds fractional)', () => {
    const template = '{progress}%';
    assert.equal(buildUploadProgressMessage(template, 33), '33%');
  });

  it('rounds fractional progress to nearest integer', () => {
    const template = '{progress}%';
    assert.equal(buildUploadProgressMessage(template, 33.7), '34%');
    assert.equal(buildUploadProgressMessage(template, 66.3), '66%');
    assert.equal(buildUploadProgressMessage(template, 99.5), '100%');
  });

  it('pt-BR template interpolation', () => {
    const template = 'Enviando imagem... {progress}%';
    assert.equal(buildUploadProgressMessage(template, 75), 'Enviando imagem... 75%');
  });

  it('es-ES template interpolation', () => {
    const template = 'Subiendo imagen... {progress}%';
    assert.equal(buildUploadProgressMessage(template, 10), 'Subiendo imagen... 10%');
  });
});

// ─── State machine exhaustiveness ────────────────────────────────────────────

describe('ImageUploadState type coverage', () => {
  const states: ImageUploadState[] = [
    { kind: 'idle' },
    { kind: 'uploading', progressPercent: 50 },
    { kind: 'done', url: 'https://cdn.example.com/img.jpg' },
    { kind: 'failed', reason: 'network' },
    { kind: 'failed', reason: 'storage_quota' },
    { kind: 'failed', reason: 'file_too_large' },
    { kind: 'failed', reason: 'unauthorized' },
    { kind: 'failed', reason: 'unknown' },
  ];

  for (const state of states) {
    it(`resolveImageUploadDisplay handles state kind="${state.kind}"${state.kind === 'failed' ? ` reason="${(state as { reason: string }).reason}"` : ''}`, () => {
      const display = resolveImageUploadDisplay(state);
      // Structural invariants that must hold for ALL states
      assert.ok(typeof display.showProgress === 'boolean');
      assert.ok(typeof display.isDone === 'boolean');
      assert.ok(typeof display.canRetry === 'boolean');
      assert.ok(display.progressPercent === null || typeof display.progressPercent === 'number');
      assert.ok(display.errorMessageKey === null || typeof display.errorMessageKey === 'string');
    });
  }
});

// ─── Error reasons exhaustiveness ────────────────────────────────────────────

describe('ImageUploadErrorReason exhaustiveness', () => {
  const reasons: ImageUploadErrorReason[] = ['network', 'storage_quota', 'file_too_large', 'unauthorized', 'unknown'];

  for (const reason of reasons) {
    it(`isRetryable handles reason="${reason}"`, () => {
      const result = isRetryable(reason);
      assert.ok(typeof result === 'boolean');
    });
  }

  for (const reason of reasons) {
    it(`resolveImageUploadDisplay failed state handles reason="${reason}"`, () => {
      const display = resolveImageUploadDisplay({ kind: 'failed', reason });
      assert.ok(display.errorMessageKey !== null, `errorMessageKey should be set for reason="${reason}"`);
    });
  }
});
