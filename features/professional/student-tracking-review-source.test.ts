import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildStudentTrackingReviewDateWindow,
  normalizeStudentTrackingReviewError,
} from './student-tracking-review-source';

test('buildStudentTrackingReviewDateWindow returns inclusive seven-day date and timestamp boundaries', () => {
  const window = buildStudentTrackingReviewDateWindow('2026-06-01');

  assert.equal(window.startDateKey, '2026-05-26');
  assert.equal(window.endDateKey, '2026-06-01');
  assert.equal(window.startLoggedAtIso, '2026-05-26T00:00:00.000Z');
});

test('normalizeStudentTrackingReviewError maps network and configuration failures', () => {
  assert.equal(normalizeStudentTrackingReviewError({ code: 'unavailable' }).code, 'network');
  assert.equal(normalizeStudentTrackingReviewError(new Error('Firebase not initialized')).code, 'configuration');
  assert.equal(normalizeStudentTrackingReviewError(new Error('unexpected')).code, 'invalid_response');
});
