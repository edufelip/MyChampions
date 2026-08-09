import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildProfessionalPlanChangeNotificationSummary,
  validatePlanChangeRequestInput,
  normalizePlanChangeRequestStatus,
  normalizePlanType,
  normalizePlanChangeRequestError,
} from './plan-change-request.logic';

// --- validatePlanChangeRequestInput ---

test('validatePlanChangeRequestInput returns no errors for valid input', () => {
  assert.deepEqual(
    validatePlanChangeRequestInput({ requestText: 'I would like more variety in my meals.' }),
    {},
  );
});

test('validatePlanChangeRequestInput requires requestText', () => {
  assert.equal(validatePlanChangeRequestInput({ requestText: '' }).requestText, 'required');
  assert.equal(validatePlanChangeRequestInput({ requestText: '   ' }).requestText, 'required');
});

test('validatePlanChangeRequestInput rejects requestText shorter than minimum', () => {
  assert.equal(
    validatePlanChangeRequestInput({ requestText: 'Too short' }).requestText,
    'too_short',
  );
});

test('validatePlanChangeRequestInput accepts requestText at minimum length (10 chars)', () => {
  assert.equal(
    validatePlanChangeRequestInput({ requestText: '1234567890' }).requestText,
    undefined,
  );
});

// --- normalizePlanChangeRequestStatus ---

test('normalizePlanChangeRequestStatus accepts valid statuses', () => {
  assert.equal(normalizePlanChangeRequestStatus('pending'), 'pending');
  assert.equal(normalizePlanChangeRequestStatus('reviewed'), 'reviewed');
  assert.equal(normalizePlanChangeRequestStatus('dismissed'), 'dismissed');
});

test('normalizePlanChangeRequestStatus returns null for unknown values', () => {
  assert.equal(normalizePlanChangeRequestStatus(null), null);
  assert.equal(normalizePlanChangeRequestStatus('accepted'), null);
  assert.equal(normalizePlanChangeRequestStatus('PENDING'), null);
});

// --- normalizePlanType ---

test('normalizePlanType accepts valid types', () => {
  assert.equal(normalizePlanType('nutrition'), 'nutrition');
  assert.equal(normalizePlanType('training'), 'training');
});

test('normalizePlanType returns null for unknown values', () => {
  assert.equal(normalizePlanType(null), null);
  assert.equal(normalizePlanType('wellness'), null);
  assert.equal(normalizePlanType('TRAINING'), null);
});

// --- normalizePlanChangeRequestError ---

test('normalizePlanChangeRequestError maps PLAN_NOT_FOUND', () => {
  assert.equal(normalizePlanChangeRequestError({ code: 'PLAN_NOT_FOUND' }), 'plan_not_found');
  assert.equal(normalizePlanChangeRequestError({ message: 'plan not found' }), 'plan_not_found');
});

test('normalizePlanChangeRequestError maps NO_ACTIVE_ASSIGNMENT', () => {
  assert.equal(
    normalizePlanChangeRequestError({ code: 'NO_ACTIVE_ASSIGNMENT' }),
    'no_active_assignment',
  );
  assert.equal(
    normalizePlanChangeRequestError({ message: 'no active assignment' }),
    'no_active_assignment',
  );
});

test('normalizePlanChangeRequestError maps VALIDATION', () => {
  assert.equal(normalizePlanChangeRequestError({ code: 'VALIDATION' }), 'validation');
  assert.equal(normalizePlanChangeRequestError({ message: 'validation failed' }), 'validation');
});

test('normalizePlanChangeRequestError maps network error', () => {
  assert.equal(normalizePlanChangeRequestError({ code: 'NETWORK_ERROR' }), 'network');
  assert.equal(normalizePlanChangeRequestError({ message: 'network error' }), 'network');
});

test('normalizePlanChangeRequestError maps configuration error', () => {
  assert.equal(
    normalizePlanChangeRequestError({ message: 'endpoint unavailable' }),
    'configuration',
  );
  assert.equal(normalizePlanChangeRequestError({ message: 'config not set' }), 'configuration');
});

test('normalizePlanChangeRequestError returns unknown for unrecognized', () => {
  assert.equal(normalizePlanChangeRequestError(null), 'unknown');
  assert.equal(normalizePlanChangeRequestError({ message: 'some error' }), 'unknown');
});

test('buildProfessionalPlanChangeNotificationSummary summarizes pending requests newest first', () => {
  assert.deepEqual(
    buildProfessionalPlanChangeNotificationSummary([
      {
        id: 'request-old-reviewed',
        planId: 'nutrition-plan-1',
        planType: 'nutrition',
        studentUid: 'student-1',
        requestText: 'Already reviewed request.',
        status: 'reviewed',
        createdAt: '2026-06-29T09:00:00.000Z',
      },
      {
        id: 'request-new',
        planId: 'training-plan-2',
        planType: 'training',
        studentUid: 'student-2',
        requestText: 'Please swap squats for leg press.',
        status: 'pending',
        createdAt: '2026-06-29T11:00:00.000Z',
      },
      {
        id: 'request-old',
        planId: 'nutrition-plan-1',
        planType: 'nutrition',
        studentUid: 'student-1',
        requestText: 'Please adjust dinner carbs.',
        status: 'pending',
        createdAt: '2026-06-29T10:00:00.000Z',
      },
    ]),
    {
      pendingCount: 2,
      latestRequest: {
        id: 'request-new',
        planId: 'training-plan-2',
        planType: 'training',
        studentUid: 'student-2',
        requestText: 'Please swap squats for leg press.',
        status: 'pending',
        createdAt: '2026-06-29T11:00:00.000Z',
      },
      affectedStudentUids: ['student-2', 'student-1'],
      planTypes: ['training', 'nutrition'],
    },
  );
});

test('buildProfessionalPlanChangeNotificationSummary returns an empty summary without pending requests', () => {
  assert.deepEqual(buildProfessionalPlanChangeNotificationSummary([]), {
    pendingCount: 0,
    latestRequest: null,
    affectedStudentUids: [],
    planTypes: [],
  });
});
