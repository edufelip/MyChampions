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

test('checkStudentCapEnforcement allows when entitlement is unknown (optimistic)', () => {
  assert.deepEqual(
    checkStudentCapEnforcement({ activeStudentCount: FREE_STUDENT_CAP + 5, entitlementStatus: 'unknown' }),
    { allowed: true }
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

test('resolveSubscriptionState shows pre-lapse warning when active at threshold', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP,
    entitlementStatus: 'active',
  });
  assert.equal(state.isPreLapseWarningVisible, true);
  assert.equal(state.isAboveCapLocked, false);
});

test('resolveSubscriptionState uses custom preLapseThreshold', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: 7,
    entitlementStatus: 'active',
    preLapseThreshold: 7,
  });
  assert.equal(state.isPreLapseWarningVisible, true);
});

test('resolveSubscriptionState no warning below threshold', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP - 1,
    entitlementStatus: 'active',
  });
  assert.equal(state.isPreLapseWarningVisible, false);
});

test('resolveSubscriptionState not locked when not lapsed even above cap', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 5,
    entitlementStatus: 'active',
  });
  assert.equal(state.isAboveCapLocked, false);
});

test('resolveSubscriptionState unknown entitlement — no lock and no warning (optimistic, D-041)', () => {
  const state = resolveSubscriptionState({
    activeStudentCount: FREE_STUDENT_CAP + 3,
    entitlementStatus: 'unknown',
  });
  // Unknown entitlement is optimistic: neither locked nor warning shown
  assert.equal(state.isAboveCapLocked, false);
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
