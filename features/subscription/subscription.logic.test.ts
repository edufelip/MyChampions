import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FREE_STUDENT_CAP,
  checkStudentCapEnforcement,
  resolveSubscriptionState,
  normalizeEntitlementStatus,
  isPlanUpdateLocked,
  hasAiAnalysisAccess,
  AI_ENTITLEMENT_ID,
  resolveSubscriptionStatusPresentation,
} from './subscription.logic';

// --- checkStudentCapEnforcement ---

test('checkStudentCapEnforcement allows below free cap regardless of entitlement', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: 0, entitlementStatus: 'lapsed' }),
    { allowed: true }
  );
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP - 1, entitlementStatus: 'lapsed' }),
    { allowed: true }
  );
});

test('checkStudentCapEnforcement allows at cap with active entitlement (D-010)', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP, entitlementStatus: 'active' }),
    { allowed: true }
  );
});

test('checkStudentCapEnforcement blocks at cap when lapsed (D-043)', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP, entitlementStatus: 'lapsed' }),
    { allowed: false, reason: 'lapsed_above_cap' }
  );
});

test('checkStudentCapEnforcement fails closed when entitlement is unknown', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP + 5, entitlementStatus: 'unknown' }),
    { allowed: false, reason: 'requires_entitlement' }
  );
});

test('checkStudentCapEnforcement blocks above cap when lapsed', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP + 1, entitlementStatus: 'lapsed' }),
    { allowed: false, reason: 'lapsed_above_cap' }
  );
});

// --- resolveSubscriptionState ---

test('resolveSubscriptionState returns correct state for lapsed above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 1,
    entitlementStatus: 'lapsed',
  });
  assert.equal(state.isAboveCapLocked, true);
  assert.equal(state.isPreLapseWarningVisible, false);
});

test('resolveSubscriptionState never infers billing expiry from active student count', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 5,
    entitlementStatus: 'active',
  });
  assert.equal(state.isPreLapseWarningVisible, false);
  assert.equal(state.isAboveCapLocked, false);
});

test('resolveSubscriptionState shows pre-lapse warning only from an explicit expiry signal', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: 2,
    entitlementStatus: 'active',
    isExpiringSoon: true,
  });
  assert.equal(state.isPreLapseWarningVisible, true);
});

test('resolveSubscriptionState does not show warning without an expiry signal', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP - 1,
    entitlementStatus: 'active',
  });
  assert.equal(state.isPreLapseWarningVisible, false);
});

test('resolveSubscriptionStatusPresentation separates loading, entitlement, and failure states', () => {
  assert.equal(
    resolveSubscriptionStatusPresentation({
      entitlementStatus: 'unknown',
      isLoading: true,
      hasError: false,
    }),
    'loading'
  );
  assert.equal(
    resolveSubscriptionStatusPresentation({
      entitlementStatus: 'active',
      isLoading: false,
      hasError: false,
    }),
    'active'
  );
  assert.equal(
    resolveSubscriptionStatusPresentation({
      entitlementStatus: 'lapsed',
      isLoading: false,
      hasError: false,
    }),
    'inactive'
  );
  assert.equal(
    resolveSubscriptionStatusPresentation({
      entitlementStatus: 'unknown',
      isLoading: false,
      hasError: true,
    }),
    'unavailable'
  );
});

test('resolveSubscriptionState not locked when not lapsed even above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 5,
    entitlementStatus: 'active',
  });
  assert.equal(state.isAboveCapLocked, false);
});

test('resolveSubscriptionState unknown entitlement fails closed above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 3,
    entitlementStatus: 'unknown',
  });
  assert.equal(state.isAboveCapLocked, true);
  assert.equal(state.isPreLapseWarningVisible, false);
  assert.equal(state.entitlementStatus, 'unknown');
  assert.equal(state.activeStudentCount, FREE_STUDENT_CAP + 3);
});

// --- normalizeEntitlementStatus ---

test('normalizeEntitlementStatus accepts valid statuses', () => {
  assert.equal(normalizeEntitlementStatus('active'), 'active');
  assert.equal(normalizeEntitlementStatus('lapsed'), 'lapsed');
});

test('normalizeEntitlementStatus returns unknown for unrecognized', () => {
  assert.equal(normalizeEntitlementStatus(null), 'unknown');
  assert.equal(normalizeEntitlementStatus('expired'), 'unknown');
  assert.equal(normalizeEntitlementStatus(undefined), 'unknown');
});

// --- isPlanUpdateLocked ---

test('isPlanUpdateLocked returns true when lapsed above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 1,
    entitlementStatus: 'lapsed',
  });
  assert.equal(isPlanUpdateLocked(state), true);
});

test('isPlanUpdateLocked returns false when active', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 1,
    entitlementStatus: 'active',
  });
  assert.equal(isPlanUpdateLocked(state), false);
});

// --- hasAiAnalysisAccess (D-132) ---

test('AI_ENTITLEMENT_ID is student_pro', () => {
  assert.equal(AI_ENTITLEMENT_ID, 'student_pro');
});

test('hasAiAnalysisAccess: professional active + student unknown → true', () => {
  assert.equal(hasAiAnalysisAccess('active', 'unknown'), true);
});

test('hasAiAnalysisAccess: professional unknown + student active → true', () => {
  assert.equal(hasAiAnalysisAccess('unknown', 'active'), true);
});

test('hasAiAnalysisAccess: both active → true', () => {
  assert.equal(hasAiAnalysisAccess('active', 'active'), true);
});

test('hasAiAnalysisAccess: professional lapsed + student lapsed → false', () => {
  assert.equal(hasAiAnalysisAccess('lapsed', 'lapsed'), false);
});

test('hasAiAnalysisAccess: both unknown → false (strict lock on unknown)', () => {
  assert.equal(hasAiAnalysisAccess('unknown', 'unknown'), false);
});

test('hasAiAnalysisAccess: professional lapsed + student unknown → false', () => {
  assert.equal(hasAiAnalysisAccess('lapsed', 'unknown'), false);
});

test('hasAiAnalysisAccess: professional unknown + student lapsed → false', () => {
  assert.equal(hasAiAnalysisAccess('unknown', 'lapsed'), false);
});
